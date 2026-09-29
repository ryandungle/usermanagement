import type { Db, Document } from "mongodb";
import { properName, type PmsMapping } from "@usermanagement/shared";
import {
  SELF_PAY,
  groupVisits,
  type Allocation,
  type AllocationLink,
  type Coverage,
  type LedgerLine,
  type PatientDetail,
  type PatientSummary,
  type ProcedureFilters,
  type ProcedureGroup,
  type ProcedureGroupBy,
  type ProcedureRow,
} from "../lib/denticon.js";
import { toPlain } from "../lib/mongo.js";
import { dateFieldRange, escapeRegex, round2, type PatientListQuery, type PmsAdapter, type ProcedureGroupResult, type ProcedureListResult, type SortSpec } from "./types.js";

/**
 * Open Dental export (native table shapes): patient.PatNum, procedurelog with
 * ProcStatus 2 = completed, claimproc carrying insurance payments and
 * write-offs per procedure, payment for patient money. The export has no
 * paysplit table, so patient payments are known only at account level.
 */

// ---- value helpers ------------------------------------------------------------
const num = (v: unknown): number => {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  if (typeof v === "string") {
    const n = Number(v.replace(/[$,\s]/g, ""));
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
};
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v.trim() : v != null && typeof v !== "object" ? String(v) : null);
/** ISO datetime or null for Open Dental's "0001-01-01" / "2001-01-01" placeholders. */
const iso = (v: unknown): string | null => {
  const d = v instanceof Date ? v : typeof v === "string" && v ? new Date(v.includes("T") || /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : v.replace(/^(\d{2})\/(\d{2})\/(\d{4}).*$/, "$3-$1-$2")) : null;
  if (!d || Number.isNaN(d.getTime()) || d.getUTCFullYear() < 1900) return null;
  return d.toISOString();
};
const day = (v: unknown): string | null => iso(v)?.slice(0, 10) ?? null;

const GENDER: Record<string, string> = { "0": "M", "1": "F", "2": "U" };
const PAT_STATUS_ACTIVE = "0"; // Patient (1 NonPatient, 2 Inactive, 3 Archived, 4 Deceased, 5 Deleted, 6 Prospective)
const PROC_COMPLETE = "2"; // TP=1, C=2, EC=3, EO=4, R=5, D=6, Cn=7
const CLAIMPROC_PAID = new Set(["1", "3", "4"]); // Received, Supplemental, CapClaim
const PLAN_TYPE: Record<string, string> = { p: "PPO", f: "Flat copay", c: "Capitation", "": "Percentage" };
const RELATION: Record<string, string> = { "0": "Self", "1": "Spouse", "2": "Child", "3": "Employee", "4": "Handicap dependent", "5": "Significant other", "6": "Injured plaintiff", "7": "Life partner", "8": "Dependent" };

const PATIENT_PROJECTION = {
  PatNum: 1, LName: 1, FName: 1, MiddleI: 1, Preferred: 1, Birthdate: 1, Gender: 1, WirelessPhone: 1, HmPhone: 1, WkPhone: 1, Email: 1,
  Address: 1, Address2: 1, City: 1, State: 1, Zip: 1, PatStatus: 1, DateFirstVisit: 1, PriProv: 1, SecProv: 1, Guarantor: 1, HasIns: 1,
  BalTotal: 1, EstBalance: 1, InsEst: 1, ChartNumber: 1, DateTStamp: 1,
} as const;

function summary(p: Document): PatientSummary {
  return {
    id: String(p._id),
    patientId: String(p.PatNum ?? ""),
    firstName: properName(str(p.FName)),
    lastName: properName(str(p.LName)),
    birthDate: day(p.Birthdate),
    sex: GENDER[String(p.Gender ?? "")] ?? null,
    cellPhone: str(p.WirelessPhone),
    homePhone: str(p.HmPhone),
    email: str(p.Email),
    city: str(p.City),
    state: str(p.State),
    active: String(p.PatStatus ?? "0") === PAT_STATUS_ACTIVE,
    lastVisitDate: null,
    preferredProviderId: str(p.PriProv),
    coverage: SELF_PAY,
  };
}

async function providersMap(db: Db, m: PmsMapping): Promise<Record<string, string>> {
  if (!m.providers) return {};
  const docs = await db.collection(m.providers).find({}, { projection: { ProvNum: 1, FName: 1, LName: 1, Abbr: 1, Suffix: 1, IsNotPerson: 1 } }).toArray().catch(() => []);
  return Object.fromEntries(
    docs.map((d) => {
      const name = [d.FName, d.LName].filter((x) => typeof x === "string" && x.trim()).join(" ");
      const suffix = typeof d.Suffix === "string" && d.Suffix.trim() ? `, ${d.Suffix.trim()}` : "";
      return [String(d.ProvNum), (name ? name + suffix : String(d.Abbr ?? d.ProvNum)).trim()];
    }),
  );
}

async function codesMap(db: Db, m: PmsMapping, codeNums: string[]): Promise<Map<string, { code: string; description: string }>> {
  if (codeNums.length === 0) return new Map();
  const docs = await db.collection(m.procedureCodes!).find({ CodeNum: { $in: codeNums } }, { projection: { CodeNum: 1, ProcCode: 1, Descript: 1, AbbrDesc: 1 } }).toArray();
  return new Map(docs.map((d) => [String(d.CodeNum), { code: String(d.ProcCode ?? ""), description: String(d.Descript ?? d.AbbrDesc ?? "") }]));
}

async function patientNames(db: Db, m: PmsMapping, patNums: string[]): Promise<Map<string, string>> {
  if (patNums.length === 0) return new Map();
  const docs = await db.collection(m.patients!).find({ PatNum: { $in: patNums } }, { projection: { PatNum: 1, FName: 1, LName: 1 } }).toArray();
  return new Map(docs.map((p) => [String(p.PatNum), [properName(p.FName), properName(p.LName)].filter(Boolean).join(" ")]));
}

/** patient plan → subscriber → plan → carrier, for a set of patients. */
async function coverageFor(db: Db, m: PmsMapping, patNums: string[]): Promise<Map<string, Coverage>> {
  const out = new Map<string, Coverage>();
  if (patNums.length === 0 || !m.patientPlans || !m.insuranceSubscribers || !m.insurancePlans) return out;
  const patPlans = await db.collection(m.patientPlans).find({ PatNum: { $in: patNums } }, { projection: { PatNum: 1, InsSubNum: 1, Ordinal: 1, Relationship: 1 } }).toArray().catch(() => []);
  if (patPlans.length === 0) return out;
  const subs = await db.collection(m.insuranceSubscribers).find({ InsSubNum: { $in: [...new Set(patPlans.map((p) => String(p.InsSubNum)))] } }, { projection: { InsSubNum: 1, PlanNum: 1, SubscriberID: 1 } }).toArray().catch(() => []);
  const subByNum = new Map(subs.map((s) => [String(s.InsSubNum), s]));
  const plans = await db.collection(m.insurancePlans).find({ PlanNum: { $in: [...new Set(subs.map((s) => String(s.PlanNum)))] } }, { projection: { PlanNum: 1, CarrierNum: 1, PlanType: 1, GroupName: 1, GroupNum: 1 } }).toArray().catch(() => []);
  const planByNum = new Map(plans.map((p) => [String(p.PlanNum), p]));
  const carriers = m.insuranceCarriers
    ? await db.collection(m.insuranceCarriers).find({ CarrierNum: { $in: [...new Set(plans.map((p) => String(p.CarrierNum)))] } }, { projection: { CarrierNum: 1, CarrierName: 1 } }).toArray().catch(() => [])
    : [];
  const carrierByNum = new Map(carriers.map((c) => [String(c.CarrierNum), String(c.CarrierName ?? "")]));
  const byPatient = new Map<string, Document[]>();
  for (const pp of patPlans) {
    const k = String(pp.PatNum);
    byPatient.set(k, [...(byPatient.get(k) ?? []), pp]);
  }
  for (const [patNum, pps] of byPatient) {
    const sorted = [...pps].sort((a, b) => Number(a.Ordinal ?? 9) - Number(b.Ordinal ?? 9));
    const toPlan = (pp: Document) => {
      const sub = subByNum.get(String(pp.InsSubNum));
      const plan = sub ? planByNum.get(String(sub.PlanNum)) : undefined;
      if (!plan) return null;
      const carrier = carrierByNum.get(String(plan.CarrierNum)) || `Carrier ${plan.CarrierNum}`;
      const rawType = String(plan.PlanType ?? "").toLowerCase();
      const planCategory = PLAN_TYPE[rawType] ?? (rawType ? rawType.toUpperCase() : null);
      return { carrier, planCategory, planType: "D", groupNo: str(plan.GroupNum), relation: RELATION[String(pp.Relationship ?? "")] ?? null };
    };
    const primary = sorted[0] ? toPlan(sorted[0]) : null;
    if (!primary) continue;
    const secondary = sorted[1] ? toPlan(sorted[1]) : null;
    out.set(patNum, { kind: "insurance", label: primary.planCategory ? `${primary.carrier} · ${primary.planCategory}` : primary.carrier, primary, secondary });
  }
  return out;
}

/** Per-procedure insurance paid / write-off from claimprocs. */
function insuranceByProc(claimProcs: Document[]): Map<string, { paid: number; writeOff: number; rows: Document[] }> {
  const map = new Map<string, { paid: number; writeOff: number; rows: Document[] }>();
  for (const cp of claimProcs) {
    if (!CLAIMPROC_PAID.has(String(cp.Status))) continue;
    const k = String(cp.ProcNum);
    const e = map.get(k) ?? { paid: 0, writeOff: 0, rows: [] };
    e.paid += num(cp.InsPayAmt);
    e.writeOff += num(cp.WriteOff);
    e.rows.push(cp);
    map.set(k, e);
  }
  return map;
}

function procedureMatch(f: ProcedureFilters, codeNums?: string[]): Document {
  const and: Document[] = [{ ProcStatus: PROC_COMPLETE }];
  const range = f.day ? dateFieldRange("ProcDate", f.day, f.day) : dateFieldRange("ProcDate", f.from, f.to);
  if (range) and.push(range);
  if (f.providerId) and.push({ ProvNum: f.providerId });
  if (f.patientId) and.push({ PatNum: f.patientId });
  if (f.nonZero) and.push({ $expr: { $ne: [{ $convert: { input: "$ProcFee", to: "double", onError: 0, onNull: 0 } }, 0] } });
  if (codeNums) and.push({ CodeNum: { $in: codeNums } });
  return { $and: and };
}

const FEE_EXPR = { $convert: { input: "$ProcFee", to: "double", onError: 0, onNull: 0 } };
const DAY_EXPR = { $dateToString: { format: "%Y-%m-%d", date: { $convert: { input: "$ProcDate", to: "date", onError: null, onNull: null } }, onNull: "unknown" } };

async function codeNumsMatching(db: Db, m: PmsMapping, q: string): Promise<string[]> {
  const rx = { $regex: escapeRegex(q), $options: "i" };
  const docs = await db.collection(m.procedureCodes!).find({ $or: [{ ProcCode: rx }, { Descript: rx }, { AbbrDesc: rx }] }, { projection: { CodeNum: 1 }, limit: 1000 }).toArray();
  return docs.map((d) => String(d.CodeNum));
}

function procLine(p: Document, codes: Map<string, { code: string; description: string }>, providers: Record<string, string>): LedgerLine {
  const date = iso(p.ProcDate) ?? new Date(0).toISOString();
  const providerId = str(p.ProvNum);
  const code = codes.get(String(p.CodeNum));
  return {
    id: String(p._id),
    ledgerId: String(p.ProcNum ?? ""),
    kind: "procedure",
    date,
    dateOfService: date.slice(0, 10),
    code: code?.code ?? null,
    description: code?.description ?? `Code ${p.CodeNum}`,
    amount: num(p.ProcFee),
    fee: num(p.ProcFee),
    tooth: str(p.ToothNum),
    surface: str(p.Surf),
    providerId,
    provider: providerId ? providers[providerId] ?? providerId : null,
    ledgerType: "C",
    ledgerType2: null,
    claimId: null,
    treatPlanId: null,
    estimatedInsurance: null,
    estimatedPatient: null,
  };
}

/** Attach insurance paid / write-off to procedure lines (status + allocation links). */
function applyInsurance(lines: LedgerLine[], claimProcs: Document[], paymentDesc: (cp: Document) => string): void {
  const byProc = insuranceByProc(claimProcs);
  for (const line of lines) {
    if (line.kind !== "procedure" || !line.ledgerId) continue;
    const e = byProc.get(line.ledgerId);
    const paid = round2(e?.paid ?? 0);
    const writeOff = round2(e?.writeOff ?? 0);
    const remaining = round2(Math.max(0, line.amount - paid - writeOff));
    const status = line.amount <= 0 ? "none" : remaining <= 0.005 ? "paid" : paid + writeOff > 0 ? "partial" : "unpaid";
    const allocations: AllocationLink[] = (e?.rows ?? []).flatMap((cp) => {
      const out: AllocationLink[] = [];
      const base: Omit<Allocation, "amount" | "ledgerType"> = {
        id: String(cp._id),
        paymentAllocationId: str(cp.ClaimProcNum),
        paymentLedgerId: `claimpayment:${cp.ClaimPaymentNum}`,
        procedureLedgerId: line.ledgerId,
        claimId: str(cp.ClaimNum),
        date: iso(cp.DateCP) ?? line.date,
      };
      const link = { linkedLedgerId: base.paymentLedgerId, linkedDescription: paymentDesc(cp), linkedCode: null, linkedDate: base.date, linkedKind: "payment" as const, linkedSource: "insurance" as const };
      if (num(cp.InsPayAmt) !== 0) out.push({ ...base, ...link, amount: num(cp.InsPayAmt), ledgerType: "P" });
      if (num(cp.WriteOff) !== 0) out.push({ ...base, ...link, id: `${base.id}:wo`, amount: num(cp.WriteOff), ledgerType: "A", linkedDescription: `Insurance write-off · ${paymentDesc(cp)}`, linkedKind: "adjustment" });
      return out;
    });
    line.payment = { paid, insurancePaid: paid, patientPaid: 0, adjusted: writeOff, remaining, status, allocations };
  }
}

export const opendentalAdapter: PmsAdapter = {
  async listPatients(db, m, query) {
    const coll = db.collection(m.patients!);
    const words = (query.q ?? "").split(/\s+/).filter(Boolean).slice(0, 5);
    const and: Document[] = [];
    if (query.activeOnly) and.push({ PatStatus: PAT_STATUS_ACTIVE });
    for (const w of words) {
      const rx = { $regex: escapeRegex(w), $options: "i" };
      and.push({ $or: [{ FName: rx }, { LName: rx }, { Preferred: rx }, { PatNum: rx }, { WirelessPhone: rx }, { HmPhone: rx }, { WkPhone: rx }, { Email: rx }, { ChartNumber: rx }] });
    }
    if (query.dateRange?.field === "birthDate") {
      const r = dateFieldRange("Birthdate", query.dateRange.from, query.dateRange.to);
      if (r) and.push(r);
    }
    const filter: Document = and.length ? { $and: and } : {};
    const FIELD: Record<string, string> = { lastName: "LName", firstName: "FName", patientId: "PatNum", birthDate: "Birthdate", city: "City", lastVisitDate: "DateTStamp" };
    const sortField = FIELD[query.sort ?? "lastName"] ?? "LName";
    const dir = query.order === "desc" ? -1 : 1;
    const sort: Record<string, 1 | -1> = { [sortField]: dir };
    if (sortField !== "LName") sort.LName = 1;
    if (sortField !== "FName") sort.FName = 1;
    const [docs, total] = await Promise.all([
      coll.find(filter, { projection: PATIENT_PROJECTION }).sort(sort).skip((query.page - 1) * query.pageSize).limit(query.pageSize).toArray(),
      coll.countDocuments(filter, { limit: 100_000 }),
    ]);
    const patients = docs.map(summary);
    const cov = await coverageFor(db, m, patients.map((p) => p.patientId));
    for (const p of patients) p.coverage = cov.get(p.patientId) ?? p.coverage;
    return { patients, total };
  },

  async getPatient(db, m, patientId) {
    const patient = await db.collection(m.patients!).findOne({ PatNum: patientId }, { projection: PATIENT_PROJECTION });
    if (!patient) return null;
    const [procs, providers, claimProcs, payDocs, cov] = await Promise.all([
      db.collection(m.procedureLogs!).find({ PatNum: patientId, ProcStatus: PROC_COMPLETE }).sort({ ProcDate: -1 }).limit(5000).toArray(),
      providersMap(db, m),
      m.claimProcs ? db.collection(m.claimProcs).find({ PatNum: patientId }).limit(10000).toArray().catch(() => [] as Document[]) : Promise.resolve([] as Document[]),
      db.collection(m.payments!).find({ PatNum: patientId }).sort({ PayDate: -1 }).limit(5000).toArray(),
      coverageFor(db, m, [patientId]),
    ]);
    const codes = await codesMap(db, m, [...new Set(procs.map((p) => String(p.CodeNum)))]);
    const lines: LedgerLine[] = procs.map((p) => procLine(p, codes, providers));

    // Insurance payments: one line per claim payment (check), built from received claimprocs.
    const paidCps = claimProcs.filter((cp) => CLAIMPROC_PAID.has(String(cp.Status)) && (num(cp.InsPayAmt) !== 0 || num(cp.WriteOff) !== 0));
    const cpNums = [...new Set(paidCps.map((cp) => String(cp.ClaimPaymentNum)).filter((x) => x && x !== "0"))];
    const claimPayments = cpNums.length && m.claimPayments ? await db.collection(m.claimPayments).find({ ClaimPaymentNum: { $in: cpNums } }, { projection: { ClaimPaymentNum: 1, CarrierName: 1, CheckNum: 1, CheckAmt: 1, CheckDate: 1, PayType: 1 } }).toArray().catch(() => []) : [];
    const cpByNum = new Map(claimPayments.map((c) => [String(c.ClaimPaymentNum), c]));
    const payDesc = (cp: Document) => {
      const c = cpByNum.get(String(cp.ClaimPaymentNum));
      return c ? `Insurance payment · ${c.CarrierName ?? "carrier"}${c.CheckNum ? ` · check ${c.CheckNum}` : ""}` : `Insurance payment · claim ${cp.ClaimNum}`;
    };
    const procByNum = new Map(lines.map((l) => [l.ledgerId ?? "", l]));
    const insGroups = new Map<string, { date: string; amount: number; desc: string; providerId: string | null; items: AllocationLink[] }>();
    for (const cp of paidCps) {
      const k = String(cp.ClaimPaymentNum) !== "0" ? `claimpayment:${cp.ClaimPaymentNum}` : `claim:${cp.ClaimNum}:${day(cp.DateCP)}`;
      const g = insGroups.get(k) ?? { date: iso(cp.DateCP) ?? iso(cp.ProcDate) ?? new Date(0).toISOString(), amount: 0, desc: payDesc(cp), providerId: str(cp.ProvNum), items: [] };
      const paidAmt = num(cp.InsPayAmt);
      g.amount += paidAmt;
      if (paidAmt !== 0) {
        // Link the claim proc to the procedure it paid, so the UI can list which charges this check settled.
        const proc = procByNum.get(String(cp.ProcNum));
        g.items.push({
          id: String(cp._id),
          paymentAllocationId: str(cp.ClaimProcNum),
          paymentLedgerId: k,
          procedureLedgerId: str(cp.ProcNum),
          amount: paidAmt,
          ledgerType: "P",
          claimId: str(cp.ClaimNum),
          date: iso(cp.DateCP) ?? g.date,
          linkedLedgerId: str(cp.ProcNum),
          linkedDescription: proc?.description ?? (cp.ProcNum ? `Procedure ${cp.ProcNum}` : "Claim-level payment (no procedure)"),
          linkedCode: proc?.code ?? null,
          linkedDate: proc?.date ?? iso(cp.ProcDate) ?? g.date,
          linkedKind: proc ? "procedure" : null,
          linkedSource: null,
        });
      }
      insGroups.set(k, g);
    }
    for (const [k, g] of insGroups) {
      if (g.amount === 0) continue;
      const procedures = new Set(g.items.map((i) => i.procedureLedgerId).filter(Boolean)).size;
      lines.push({
        id: k, ledgerId: k, kind: "payment", date: g.date, dateOfService: g.date.slice(0, 10), code: null, description: g.desc, amount: -round2(g.amount), fee: null,
        tooth: null, surface: null, providerId: g.providerId, provider: g.providerId ? providers[g.providerId] ?? g.providerId : null, ledgerType: "I", ledgerType2: null,
        claimId: null, treatPlanId: null, estimatedInsurance: null, estimatedPatient: null, source: "insurance",
        applied: { total: round2(g.amount), unallocated: 0, procedures, items: g.items },
      });
    }
    // Write-offs as adjustment lines (one per claim payment group).
    const woGroups = new Map<string, { date: string; amount: number; desc: string }>();
    for (const cp of paidCps) {
      if (num(cp.WriteOff) === 0) continue;
      const k = `wo:${cp.ClaimPaymentNum}:${cp.ClaimNum}`;
      const g = woGroups.get(k) ?? { date: iso(cp.DateCP) ?? iso(cp.ProcDate) ?? new Date(0).toISOString(), amount: 0, desc: `Insurance write-off · ${payDesc(cp)}` };
      g.amount += num(cp.WriteOff);
      woGroups.set(k, g);
    }
    for (const [k, g] of woGroups) {
      lines.push({ id: k, ledgerId: k, kind: "adjustment", date: g.date, dateOfService: g.date.slice(0, 10), code: null, description: g.desc, amount: -round2(g.amount), fee: null, tooth: null, surface: null, providerId: null, provider: null, ledgerType: "A", ledgerType2: null, claimId: null, treatPlanId: null, estimatedInsurance: null, estimatedPatient: null });
    }
    // Patient payments (account level: the export has no paysplit rows).
    const payTypes = new Map<string, string>();
    if (m.definitions && payDocs.length) {
      const defs = await db.collection(m.definitions).find({ DefNum: { $in: [...new Set(payDocs.map((p) => String(p.PayType)))] } }, { projection: { DefNum: 1, ItemName: 1 } }).toArray().catch(() => []);
      for (const d of defs) payTypes.set(String(d.DefNum), String(d.ItemName ?? ""));
    }
    for (const p of payDocs) {
      const amount = num(p.PayAmt);
      if (amount === 0) continue;
      const date = iso(p.PayDate) ?? iso(p.DateEntry) ?? new Date(0).toISOString();
      const type = payTypes.get(String(p.PayType)) || `Payment type ${p.PayType}`;
      lines.push({
        id: String(p._id), ledgerId: `payment:${p.PayNum}`, kind: "payment", date, dateOfService: date.slice(0, 10), code: null,
        description: `${type}${p.CheckNum ? ` · check ${p.CheckNum}` : ""}${p.PayNote ? ` · ${String(p.PayNote).slice(0, 60)}` : ""}`, amount: -amount, fee: null, tooth: null, surface: null,
        providerId: null, provider: null, ledgerType: "P", ledgerType2: null, claimId: null, treatPlanId: null, estimatedInsurance: null, estimatedPatient: null, source: "patient",
      });
    }
    applyInsurance(lines, claimProcs, payDesc);

    const treatments = lines.filter((l) => l.kind === "procedure");
    const paymentLines = lines.filter((l) => l.kind === "payment").sort((a, b) => (a.date < b.date ? 1 : -1));
    const sum = (xs: number[]) => round2(xs.reduce((a, b) => a + b, 0));
    const charges = sum(treatments.map((l) => l.amount));
    const payments = sum(paymentLines.map((l) => -l.amount));
    const adjustments = sum(lines.filter((l) => l.kind === "adjustment").map((l) => l.amount));
    const count = (status: string) => treatments.filter((l) => l.payment?.status === status).length;
    const s = summary(patient);
    s.coverage = cov.get(patientId) ?? s.coverage;
    s.lastVisitDate = treatments[0]?.dateOfService ?? null;
    const visits = groupVisits(lines);
    return {
      patient: toPlain(patient) as Record<string, unknown>,
      summary: s,
      totals: { charges, payments, adjustments, balance: round2(charges + adjustments - payments), visits: visits.filter((v) => v.procedures.length > 0).length, procedures: treatments.length, paid: count("paid"), partial: count("partial"), unpaid: count("unpaid"), unallocatedPayments: 0 },
      treatments,
      visits,
      payments: paymentLines,
      providers,
      transactionCount: lines.length,
      notes: [
        "Open Dental export: paid status reflects insurance payments and write-offs per procedure. Patient payments are recorded at account level (no paysplit rows), so they count toward the balance but are not tied to individual procedures.",
      ],
      allocationSource: m.claimProcs ?? undefined,
      pmsBalance: typeof patient.BalTotal === "number" ? patient.BalTotal : num(patient.BalTotal) || null,
    };
  },

  async listProcedures(db, m, filters, page, pageSize, sort = { field: "date", order: "desc" }): Promise<ProcedureListResult> {
    const codeNums = filters.q ? await codeNumsMatching(db, m, filters.q) : undefined;
    const match = procedureMatch(filters, codeNums);
    const FIELD: Record<string, string> = { date: "ProcDate", patient: "PatNum", code: "CodeNum", description: "CodeNum", provider: "ProvNum", amount: "fee" };
    const sortSpec: Document = { [FIELD[sort.field] ?? "ProcDate"]: sort.order === "asc" ? 1 : -1 };
    if (!("ProcDate" in sortSpec)) sortSpec.ProcDate = -1;
    sortSpec._id = -1;
    const [facet] = await db.collection(m.procedureLogs!).aggregate([
      { $match: match },
      { $addFields: { fee: FEE_EXPR } },
      { $facet: { total: [{ $count: "n" }], page: [{ $sort: sortSpec }, { $skip: (page - 1) * pageSize }, { $limit: pageSize }] } },
    ], { allowDiskUse: true }).toArray();
    const total = Number(facet?.total?.[0]?.n ?? 0);
    const docs = (facet?.page ?? []) as Document[];
    const [providers, codes, names, claimProcs] = await Promise.all([
      providersMap(db, m),
      codesMap(db, m, [...new Set(docs.map((d) => String(d.CodeNum)))]),
      patientNames(db, m, [...new Set(docs.map((d) => String(d.PatNum)))]),
      docs.length && m.claimProcs ? db.collection(m.claimProcs).find({ ProcNum: { $in: docs.map((d) => String(d.ProcNum)) } }, { projection: { ProcNum: 1, Status: 1, InsPayAmt: 1, WriteOff: 1, ClaimPaymentNum: 1, ClaimNum: 1, DateCP: 1, ClaimProcNum: 1 } }).toArray() : Promise.resolve([] as Document[]),
    ]);
    const lines = docs.map((d) => procLine(d, codes, providers));
    applyInsurance(lines, claimProcs, (cp) => `Insurance payment · claim ${cp.ClaimNum}`);
    const rows: ProcedureRow[] = lines.map((l, i) => {
      const pid = String(docs[i]!.PatNum ?? "");
      return { ...l, patientId: pid, patientName: names.get(pid) || pid };
    });
    return { rows, total, providers };
  },

  async groupProcedures(db, m, groupBy, filters, page, pageSize, sortBy?: SortSpec): Promise<ProcedureGroupResult> {
    const codeNums = filters.q ? await codeNumsMatching(db, m, filters.q) : undefined;
    const match = procedureMatch(filters, codeNums);
    const id = groupBy === "date" ? { day: DAY_EXPR } : groupBy === "patient" ? { patientId: "$PatNum" } : { day: DAY_EXPR, patientId: "$PatNum" };
    const FIELD: Record<string, string> = { day: "_id.day", patient: "_id.patientId", procedures: "procedures", patients: "patientCount", charges: "charges" };
    const defaultSort: Document = groupBy === "patient" ? { charges: -1, "_id.patientId": 1 } : { "_id.day": -1, charges: -1 };
    const sort: Document = sortBy && FIELD[sortBy.field] ? { [FIELD[sortBy.field]!]: sortBy.order === "asc" ? 1 : -1, ...defaultSort } : defaultSort;
    const [facet] = await db.collection(m.procedureLogs!).aggregate([
      { $match: match },
      { $addFields: { fee: FEE_EXPR } },
      { $group: { _id: id, procedures: { $sum: 1 }, charges: { $sum: "$fee" }, patients: { $addToSet: "$PatNum" }, firstDate: { $min: "$ProcDate" }, lastDate: { $max: "$ProcDate" }, procNums: { $push: "$ProcNum" } } },
      { $addFields: { patientCount: { $size: "$patients" } } },
      { $sort: sort },
      { $facet: { total: [{ $count: "n" }], page: [{ $skip: (page - 1) * pageSize }, { $limit: pageSize }] } },
    ], { allowDiskUse: true }).toArray();
    const total = Number(facet?.total?.[0]?.n ?? 0);
    const pageDocs = (facet?.page ?? []) as Document[];
    const procNums = [...new Set(pageDocs.flatMap((g) => (g.procNums as string[]) ?? []).filter(Boolean))].slice(0, 20_000);
    const patNums = [...new Set(pageDocs.map((g) => g._id.patientId as string | undefined).filter((x): x is string => !!x))];
    const [claimProcs, names, providers] = await Promise.all([
      procNums.length && m.claimProcs ? db.collection(m.claimProcs).find({ ProcNum: { $in: procNums }, Status: { $in: [...CLAIMPROC_PAID] } }, { projection: { ProcNum: 1, InsPayAmt: 1, WriteOff: 1 } }).toArray() : Promise.resolve([] as Document[]),
      patientNames(db, m, patNums),
      providersMap(db, m),
    ]);
    const byProc = new Map<string, { paid: number; writeOff: number }>();
    for (const cp of claimProcs) {
      const k = String(cp.ProcNum);
      const e = byProc.get(k) ?? { paid: 0, writeOff: 0 };
      e.paid += num(cp.InsPayAmt);
      e.writeOff += num(cp.WriteOff);
      byProc.set(k, e);
    }
    const groups: ProcedureGroup[] = pageDocs.map((g) => {
      let paid = 0;
      let adjusted = 0;
      for (const pn of (g.procNums as string[]) ?? []) {
        const e = byProc.get(String(pn));
        if (e) {
          paid += e.paid;
          adjusted += e.writeOff;
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
        firstDate: iso(g.firstDate) ?? "",
        lastDate: iso(g.lastDate) ?? "",
      };
    });
    return { groups, total, providers };
  },
};
