import type { Db, Document } from "mongodb";
import { properName, type PmsMapping } from "@usermanagement/shared";
import {
  INSURANCE_PROJECTION,
  PATIENT_PROJECTION,
  TRANSACTION_DAY_EXPR,
  applyAllocations,
  coverageByPatient,
  groupVisits,
  procedureMatch,
  providerName,
  toAllocation,
  toLedgerLine,
  toPatientSummary,
  type PatientDetail,
  type PatientSummary,
  type ProcedureFilters,
  type ProcedureGroup,
  type ProcedureGroupBy,
  type ProcedureRow,
} from "../lib/denticon.js";
import { toPlain } from "../lib/mongo.js";
import { escapeRegex, round2, type PatientListQuery, type PmsAdapter, type ProcedureGroupResult, type ProcedureListResult, type SortSpec } from "./types.js";

async function providersMap(db: Db, m: PmsMapping): Promise<Record<string, string>> {
  const docs = await db.collection(m.providers!).find({}, { projection: { providerId: 1, providerShortId: 1, title: 1, firstName: 1, lastName: 1 } }).toArray().catch(() => []);
  return Object.fromEntries(docs.map(providerName));
}

async function patientNames(db: Db, m: PmsMapping, ids: string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const docs = await db.collection(m.patients!).find({ patientId: { $in: ids } }, { projection: { patientId: 1, firstName: 1, lastName: 1 } }).toArray();
  return new Map(docs.map((p) => [String(p.patientId), [properName(p.firstName), properName(p.lastName)].filter(Boolean).join(" ")]));
}

export const denticonAdapter: PmsAdapter = {
  async listPatients(db, m, query) {
    const coll = db.collection(m.patients!);
    const words = (query.q ?? "").split(/\s+/).filter(Boolean).slice(0, 5);
    const and: Document[] = [];
    if (query.activeOnly) and.push({ active: { $ne: false } });
    for (const w of words) {
      const rx = { $regex: escapeRegex(w), $options: "i" };
      and.push({ $or: [{ firstName: rx }, { lastName: rx }, { nickname: rx }, { patientId: rx }, { cellPhone: rx }, { homePhone: rx }, { email: rx }, { chartNo: rx }] });
    }
    if (query.dateRange) {
      const { field, from, to } = query.dateRange;
      const asString: Document = {};
      const asDate: Document = {};
      if (from) {
        asString.$gte = from;
        asDate.$gte = new Date(`${from}T00:00:00.000Z`);
      }
      if (to) {
        asString.$lte = `${to}￿`;
        asDate.$lte = new Date(`${to}T23:59:59.999Z`);
      }
      and.push({ $or: [{ [field]: asString }, { [field]: asDate }] });
    }
    const filter: Document = and.length ? { $and: and } : {};
    const SORTABLE = new Set(["lastName", "firstName", "patientId", "birthDate", "lastVisitDate", "city"]);
    const sortField = query.sort && SORTABLE.has(query.sort) ? query.sort : "lastName";
    const dir = query.order === "desc" ? -1 : 1;
    const sort: Record<string, 1 | -1> = { [sortField]: dir };
    if (sortField !== "lastName") sort.lastName = 1;
    if (sortField !== "firstName") sort.firstName = 1;
    const [docs, total] = await Promise.all([
      coll.find(filter, { projection: PATIENT_PROJECTION }).sort(sort).skip((query.page - 1) * query.pageSize).limit(query.pageSize).toArray(),
      coll.countDocuments(filter, { limit: 100_000 }),
    ]);
    const patients = docs.map(toPatientSummary);
    const ids = patients.map((p) => p.patientId).filter(Boolean);
    if (ids.length && m.insurances) {
      const rows = await db.collection(m.insurances).find({ patientId: { $in: ids } }, { projection: INSURANCE_PROJECTION }).toArray().catch(() => []);
      const cov = coverageByPatient(rows);
      for (const p of patients) p.coverage = cov.get(p.patientId) ?? p.coverage;
    }
    return { patients, total };
  },

  async getPatient(db, m, patientId) {
    const patient = await db.collection(m.patients!).findOne({ patientId }, { projection: PATIENT_PROJECTION });
    if (!patient) return null;
    const [txns, providers, allocationDocs, insuranceDocs] = await Promise.all([
      db.collection(m.transactions!).find({ patientId }).sort({ transactionDate: -1, createdOn: -1 }).limit(5000).toArray(),
      providersMap(db, m),
      m.allocations ? db.collection(m.allocations).find({ patientId }).limit(10000).toArray().catch(() => [] as Document[]) : Promise.resolve([] as Document[]),
      m.insurances ? db.collection(m.insurances).find({ patientId }, { projection: INSURANCE_PROJECTION }).toArray().catch(() => [] as Document[]) : Promise.resolve([] as Document[]),
    ]);
    const summary = toPatientSummary(patient);
    summary.coverage = coverageByPatient(insuranceDocs).get(patientId) ?? summary.coverage;
    const lines = txns.map((t) => toLedgerLine(t, providers));
    applyAllocations(lines, allocationDocs.map(toAllocation));
    const visits = groupVisits(lines);
    const sum = (xs: number[]) => round2(xs.reduce((a, b) => a + b, 0));
    const treatments = lines.filter((l) => l.kind === "procedure");
    const paymentLines = lines.filter((l) => l.kind === "payment");
    const charges = sum(treatments.map((l) => l.amount));
    const payments = sum(paymentLines.map((l) => -l.amount));
    const adjustments = sum(lines.filter((l) => l.kind === "adjustment").map((l) => l.amount));
    const count = (status: string) => treatments.filter((l) => l.payment?.status === status).length;
    return {
      patient: toPlain(patient) as Record<string, unknown>,
      summary,
      totals: {
        charges,
        payments,
        adjustments,
        balance: round2(charges + adjustments - payments),
        visits: visits.filter((v) => v.procedures.length > 0).length,
        procedures: treatments.length,
        paid: count("paid"),
        partial: count("partial"),
        unpaid: count("unpaid"),
        unallocatedPayments: sum(paymentLines.map((l) => l.applied?.unallocated ?? 0)),
      },
      treatments,
      visits,
      payments: paymentLines,
      providers,
      transactionCount: lines.length,
      notes: [],
      allocationSource: m.allocations ?? undefined,
    };
  },

  async listProcedures(db, m, filters, page, pageSize, sort = { field: "date", order: "desc" }): Promise<ProcedureListResult> {
    const match = procedureMatch(filters);
    const txns = db.collection(m.transactions!);
    const FIELD: Record<string, string> = { date: "transactionDate", patient: "patientId", code: "procedureCode", description: "description", provider: "providerId", amount: "amount" };
    const dir = sort.order === "asc" ? 1 : -1;
    const sortSpec: Record<string, 1 | -1> = { [FIELD[sort.field] ?? "transactionDate"]: dir };
    if (!("transactionDate" in sortSpec)) sortSpec.transactionDate = -1;
    sortSpec._id = -1;
    const [docs, total, providers] = await Promise.all([
      txns.find(match).sort(sortSpec).skip((page - 1) * pageSize).limit(pageSize).toArray(),
      txns.countDocuments(match, { limit: 200_000 }),
      providersMap(db, m),
    ]);
    const lines = docs.map((d) => toLedgerLine(d, providers));
    const ledgerIds = lines.map((l) => l.ledgerId).filter((x): x is string => !!x);
    const patientIds = [...new Set(docs.map((d) => String(d.patientId ?? "")).filter(Boolean))];
    const [allocDocs, names] = await Promise.all([
      ledgerIds.length && m.allocations ? db.collection(m.allocations).find({ procedureLedgerId: { $in: ledgerIds } }).toArray() : Promise.resolve([] as Document[]),
      patientNames(db, m, patientIds),
    ]);
    applyAllocations(lines, allocDocs.map(toAllocation));
    const rows: ProcedureRow[] = lines.map((l, i) => {
      const pid = String(docs[i]!.patientId ?? "");
      return { ...l, patientId: pid, patientName: names.get(pid) || pid };
    });
    return { rows, total, providers };
  },

  async groupProcedures(db, m, groupBy, filters, page, pageSize, sortBy?: SortSpec): Promise<ProcedureGroupResult> {
    const match = procedureMatch(filters);
    const day = TRANSACTION_DAY_EXPR;
    const id = groupBy === "date" ? { day } : groupBy === "patient" ? { patientId: "$patientId" } : { day, patientId: "$patientId" };
    const FIELD: Record<string, string> = { day: "_id.day", patient: "_id.patientId", procedures: "procedures", patients: "patientCount", charges: "charges" };
    const defaultSort: Document = groupBy === "patient" ? { charges: -1, "_id.patientId": 1 } : { "_id.day": -1, charges: -1 };
    const sort: Document = sortBy && FIELD[sortBy.field] ? { [FIELD[sortBy.field]!]: sortBy.order === "asc" ? 1 : -1, ...defaultSort } : defaultSort;
    const [facet] = await db
      .collection(m.transactions!)
      .aggregate(
        [
          { $match: match },
          { $group: { _id: id, procedures: { $sum: 1 }, charges: { $sum: "$amount" }, patients: { $addToSet: "$patientId" }, firstDate: { $min: "$transactionDate" }, lastDate: { $max: "$transactionDate" }, ledgerIds: { $push: "$ledgerId" } } },
          { $addFields: { patientCount: { $size: "$patients" } } },
          { $sort: sort },
          { $facet: { total: [{ $count: "n" }], page: [{ $skip: (page - 1) * pageSize }, { $limit: pageSize }] } },
        ],
        { allowDiskUse: true },
      )
      .toArray();
    const total = Number(facet?.total?.[0]?.n ?? 0);
    const pageDocs = (facet?.page ?? []) as Document[];
    const ledgerIds = [...new Set(pageDocs.flatMap((g) => (g.ledgerIds as string[]) ?? []).filter(Boolean))].slice(0, 20_000);
    const patientIds = [...new Set(pageDocs.map((g) => g._id.patientId as string | undefined).filter((x): x is string => !!x))];
    const [allocDocs, names, providers] = await Promise.all([
      ledgerIds.length && m.allocations ? db.collection(m.allocations).find({ procedureLedgerId: { $in: ledgerIds } }, { projection: { procedureLedgerId: 1, amount: 1, ledgerType: 1 } }).toArray() : Promise.resolve([] as Document[]),
      patientNames(db, m, patientIds),
      providersMap(db, m),
    ]);
    const paidBy = new Map<string, { paid: number; adjusted: number }>();
    for (const a of allocDocs) {
      const k = String(a.procedureLedgerId);
      const e = paidBy.get(k) ?? { paid: 0, adjusted: 0 };
      if (a.ledgerType === "A") e.adjusted += Math.abs(Number(a.amount) || 0);
      else e.paid += Math.abs(Number(a.amount) || 0);
      paidBy.set(k, e);
    }
    const groups: ProcedureGroup[] = pageDocs.map((g) => {
      let paid = 0;
      let adjusted = 0;
      for (const lid of (g.ledgerIds as string[]) ?? []) {
        const e = paidBy.get(String(lid));
        if (e) {
          paid += e.paid;
          adjusted += e.adjusted;
        }
      }
      const charges = round2(Number(g.charges) || 0);
      const pid = (g._id.patientId as string | undefined) ?? null;
      return {
        day: (g._id.day as string | undefined) ?? null,
        patientId: pid,
        patientName: pid ? names.get(pid) || pid : null,
        procedures: Number(g.procedures) || 0,
        patients: Array.isArray(g.patients) ? g.patients.length : 0,
        charges,
        paid: round2(paid),
        adjusted: round2(adjusted),
        remaining: round2(Math.max(0, charges - paid - adjusted)),
        firstDate: g.firstDate instanceof Date ? g.firstDate.toISOString() : String(g.firstDate ?? ""),
        lastDate: g.lastDate instanceof Date ? g.lastDate.toISOString() : String(g.lastDate ?? ""),
      };
    });
    return { groups, total, providers };
  },
};
