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
  type Claim,
  type ClaimStatusKey,
  type LedgerLine,
  type PatientDetail,
  type PatientSummary,
  type ProcedureFilters,
  type ProcedureGroup,
  type ProcedureGroupBy,
  type ProcedureRow,
} from "../lib/denticon.js";
import { toPlain } from "../lib/mongo.js";
import { daysSince, escapeRegex, round2, type PatientListQuery, type PmsAdapter, type ProcedureGroupResult, type ProcedureListResult, type SortSpec } from "./types.js";

async function providersMap(db: Db, m: PmsMapping): Promise<Record<string, string>> {
  const docs = await db.collection(m.providers!).find({}, { projection: { providerId: 1, providerShortId: 1, title: 1, firstName: 1, lastName: 1 } }).toArray().catch(() => []);
  return Object.fromEntries(docs.map(providerName));
}

async function patientNames(db: Db, m: PmsMapping, ids: string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const docs = await db.collection(m.patients!).find({ patientId: { $in: ids } }, { projection: { patientId: 1, firstName: 1, lastName: 1 } }).toArray();
  return new Map(docs.map((p) => [String(p.patientId), [properName(p.firstName), properName(p.lastName)].filter(Boolean).join(" ")]));
}

const CLAIM_STATUS: Record<string, [ClaimStatusKey, string]> = {
  queued: ["unsent", "Queued"], unsent: ["unsent", "Unsent"], hold: ["unsent", "On hold"],
  sent: ["sent", "Sent"], resent: ["sent", "Resent"], pending: ["sent", "Pending"],
  received: ["received", "Received"], paid: ["received", "Paid"], closed: ["closed", "Closed"],
  denied: ["denied", "Denied"], rejected: ["denied", "Rejected"],
};

const isoOf = (v: unknown): string | null => {
  const d = v instanceof Date ? v : typeof v === "string" && v ? new Date(v) : null;
  return d && Number.isFinite(d.getTime()) ? d.toISOString() : null;
};
const numOf = (v: unknown): number => (typeof v === "number" ? v : typeof v === "string" ? Number(v) || 0 : 0);

/** Claims from the denticon-claims export joined with the ledger lines that carry the same claimId. */
function denticonClaims(docs: Document[], lines: LedgerLine[], providers: Record<string, string>): Claim[] {
  const byClaim = new Map<string, LedgerLine[]>();
  for (const l of lines) if (l.claimId) byClaim.set(l.claimId, [...(byClaim.get(l.claimId) ?? []), l]);
  const sum = (xs: number[]) => round2(xs.reduce((a, b) => a + b, 0));
  const build = (claimId: string, d: Document | undefined): Claim => {
    const ls = byClaim.get(claimId) ?? [];
    const procs = ls.filter((l) => l.kind === "procedure");
    const pays = ls.filter((l) => l.kind === "payment" && l.source === "insurance");
    const adjs = ls.filter((l) => l.kind === "adjustment");
    const raw = String(d?.claimStatus ?? "").trim();
    const [status, statusLabel] = CLAIM_STATUS[raw.toLowerCase()] ?? (d ? ["other", raw || "Unknown"] : pays.length ? ["received", "Paid (no claim record)"] : ["other", "No claim record"]);
    const dateSent = isoOf(d?.claimSentDate);
    const dateReceived = pays.length ? pays.map((p) => p.date).sort().at(-1)! : null;
    const effective: ClaimStatusKey = dateReceived && (status === "sent" || status === "unsent") ? "received" : status;
    const providerId = d?.providerId != null ? String(d.providerId) : null;
    const provider = providerId ? providers[providerId] ?? ([d?.providerFirstName, d?.providerLastName].filter((x) => typeof x === "string" && x).join(" ") || providerId) : null;
    const codes = Array.isArray(d?.procedureCodeList) ? (d!.procedureCodeList as unknown[]).map(String) : [];
    return {
      claimId,
      type: String(d?.claimType ?? "Primary"),
      status: effective,
      statusLabel: effective === "received" && status !== "received" ? `${statusLabel} · paid` : statusLabel,
      carrier: typeof d?.carrierName === "string" && d.carrierName ? d.carrierName : null,
      provider,
      dateOfService: procs.length ? procs.map((p) => p.date).sort()[0]! : null,
      dateSent,
      dateReceived,
      billed: d ? numOf(d.claimAmount) || sum(procs.map((p) => p.amount)) : sum(procs.map((p) => p.amount)),
      estimate: numOf(d?.claimEstIns),
      insurancePaid: sum(pays.map((p) => -p.amount)),
      writeOff: sum(adjs.map((a) => Math.abs(a.amount))),
      deductible: 0,
      daysOutstanding: effective === "sent" ? daysSince(dateSent) : null,
      procedures: procs.length
        ? procs.map((p) => ({ procedureLedgerId: p.ledgerId, code: p.code, description: p.description, date: p.date, feeBilled: p.amount, estimate: p.estimatedInsurance, insurancePaid: p.payment?.insurancePaid ?? 0, writeOff: p.payment?.adjusted ?? 0 }))
        : codes.map((c) => ({ procedureLedgerId: null, code: c, description: `Code ${c}`, date: null, feeBilled: 0, estimate: null, insurancePaid: 0, writeOff: 0 })),
      payments: pays.map((p) => ({ id: p.id, date: p.date, description: p.description, amount: -p.amount, checkNum: null })),
    };
  };
  const seen = new Set<string>();
  const out: Claim[] = [];
  for (const d of docs) {
    const id = String(d.claimId ?? d.claimUId ?? "");
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(build(id, d));
  }
  for (const id of byClaim.keys()) if (!seen.has(id)) { seen.add(id); out.push(build(id, undefined)); }
  const rank = (c: Claim) => (c.status === "unsent" ? 0 : c.status === "sent" ? 1 : 2);
  return out.sort((a, b) => rank(a) - rank(b) || ((b.dateSent ?? b.dateOfService ?? "") < (a.dateSent ?? a.dateOfService ?? "") ? -1 : 1));
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
    const [txns, providers, allocationDocs, insuranceDocs, claimDocs] = await Promise.all([
      db.collection(m.transactions!).find({ patientId }).sort({ transactionDate: -1, createdOn: -1 }).limit(5000).toArray(),
      providersMap(db, m),
      m.allocations ? db.collection(m.allocations).find({ patientId }).limit(10000).toArray().catch(() => [] as Document[]) : Promise.resolve([] as Document[]),
      m.insurances ? db.collection(m.insurances).find({ patientId }, { projection: INSURANCE_PROJECTION }).toArray().catch(() => [] as Document[]) : Promise.resolve([] as Document[]),
      m.claims ? db.collection(m.claims).find({ patientId }).limit(500).toArray().catch(() => [] as Document[]) : Promise.resolve([] as Document[]),
    ]);
    const summary = toPatientSummary(patient);
    summary.coverage = coverageByPatient(insuranceDocs).get(patientId) ?? summary.coverage;
    const lines = txns.map((t) => toLedgerLine(t, providers));
    applyAllocations(lines, allocationDocs.map(toAllocation));
    const visits = groupVisits(lines);
    const claims = denticonClaims(claimDocs, lines, providers);
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
      adjustments: lines.filter((l) => l.kind === "adjustment").sort((a, b) => (a.date < b.date ? 1 : -1)),
      claims,
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
