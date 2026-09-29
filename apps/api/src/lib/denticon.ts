import type { Document } from "mongodb";
import { toPlain } from "./mongo.js";
import { properName } from "@usermanagement/shared";

/** Collections the patient pages read (Denticon export). */
export const DENTICON = {
  patients: "denticon-patients",
  transactions: "denticon-transactions",
  providers: "denticon-providers",
  allocations: "denticon-payment-allocations",
  insurances: "denticon-patient-insurances",
} as const;

/**
 * Denticon ledger types: C charge, P payment (patient or insurance), A
 * adjustment, M claim memo, I insurance line — an insurance payment when it
 * carries an amount ("PMT INS - EFT"), otherwise a note ("Insurance Denied").
 */
export type LedgerKind = "procedure" | "payment" | "adjustment" | "note";
export type PaymentSource = "insurance" | "patient" | "other";

export function ledgerKind(type: unknown, amount: number): LedgerKind {
  switch (type) {
    case "C":
      return "procedure";
    case "P":
      return "payment";
    case "I":
      return amount !== 0 ? "payment" : "note";
    case "A":
      return "adjustment";
    default:
      return "note";
  }
}

export function paymentSource(type: unknown, description: string): PaymentSource {
  const d = description.toUpperCase();
  if (type === "I" || d.includes("INS")) return "insurance";
  if (d.includes("PAT") || d.includes("CASH") || d.includes("CARD") || d.includes("VISA") || d.includes("CHECK")) return "patient";
  return "other";
}

export interface CoveragePlan {
  carrier: string;
  planCategory: string | null;
  planType: string | null;
  groupNo: string | null;
  relation: string | null;
}

/** How a patient pays: insurance (primary + optional secondary) or self-pay. */
export interface Coverage {
  kind: "insurance" | "self-pay";
  label: string;
  primary: CoveragePlan | null;
  secondary: CoveragePlan | null;
}

export const SELF_PAY: Coverage = { kind: "self-pay", label: "Self-pay", primary: null, secondary: null };

/** Build coverage per patient from denticon-patient-insurances rows. */
export function coverageByPatient(rows: Document[]): Map<string, Coverage> {
  const plans = new Map<string, { primary?: CoveragePlan; secondary?: CoveragePlan }>();
  for (const r of rows) {
    const pid = String(r.patientId ?? "");
    if (!pid) continue;
    const carrier = typeof r.carrierName === "string" ? r.carrierName.trim() : "";
    if (!carrier || /^(cash|self[- ]?pay|none)$/i.test(carrier)) continue; // Denticon models self-pay as a "Cash" carrier
    const plan: CoveragePlan = {
      carrier,
      planCategory: typeof r.planCategory === "string" && r.planCategory ? r.planCategory : null,
      planType: typeof r.planType === "string" && r.planType ? r.planType : null,
      groupNo: typeof r.groupNo === "string" && r.groupNo ? r.groupNo : null,
      relation: typeof r.relationToSubscriber === "string" && r.relationToSubscriber ? r.relationToSubscriber : null,
    };
    const e = plans.get(pid) ?? {};
    if (String(r.insuranceType).toLowerCase() === "secondary") e.secondary ??= plan;
    else e.primary ??= plan;
    plans.set(pid, e);
  }
  const out = new Map<string, Coverage>();
  for (const [pid, e] of plans) {
    const primary = e.primary ?? e.secondary ?? null;
    const secondary = e.primary ? (e.secondary ?? null) : null;
    if (!primary) continue;
    out.set(pid, {
      kind: "insurance",
      label: primary.planCategory ? `${primary.carrier} · ${primary.planCategory}` : primary.carrier,
      primary,
      secondary,
    });
  }
  return out;
}

export interface PatientSummary {
  id: string;
  patientId: string;
  firstName: string;
  lastName: string;
  birthDate: string | null;
  sex: string | null;
  cellPhone: string | null;
  homePhone: string | null;
  email: string | null;
  city: string | null;
  state: string | null;
  active: boolean;
  lastVisitDate: string | null;
  preferredProviderId: string | null;
  coverage: Coverage;
}

export const PATIENT_PROJECTION = {
  patientId: 1, firstName: 1, lastName: 1, middleInitial: 1, nickname: 1, birthDate: 1, sex: 1,
  cellPhone: 1, homePhone: 1, workPhone: 1, email: 1, addressLine1: 1, addressLine2: 1, city: 1, state: 1, zip: 1,
  active: 1, firstVisitDate: 1, lastVisitDate: 1, preferredProviderId: 1, preferredHygienistId: 1,
  responsiblePartyId: 1, relationToResponsibleParty: 1, chartNo: 1, isOrtho: 1, createdOn: 1, lastChangedOn: 1,
} as const;

export function toPatientSummary(d: Document): PatientSummary {
  const p = toPlain(d) as Record<string, unknown>;
  const s = (k: string) => (typeof p[k] === "string" && p[k] ? (p[k] as string) : null);
  return {
    id: String(p._id),
    patientId: String(p.patientId ?? ""),
    firstName: properName(s("firstName")),
    lastName: properName(s("lastName")),
    birthDate: s("birthDate"),
    sex: s("sex"),
    cellPhone: s("cellPhone"),
    homePhone: s("homePhone"),
    email: s("email"),
    city: s("city"),
    state: s("state"),
    active: p.active !== false,
    lastVisitDate: s("lastVisitDate"),
    preferredProviderId: s("preferredProviderId"),
    coverage: SELF_PAY,
  };
}

const INSURANCE_PROJECTION = { patientId: 1, insuranceType: 1, carrierName: 1, planCategory: 1, planType: 1, groupNo: 1, relationToSubscriber: 1 } as const;
export { INSURANCE_PROJECTION };

export type PaidStatus = "paid" | "partial" | "unpaid" | "none";

export interface Allocation {
  id: string;
  /** Denticon's own allocation id. */
  paymentAllocationId: string | null;
  paymentLedgerId: string;
  procedureLedgerId: string | null;
  amount: number;
  /** "P" payment or "A" adjustment allocation. */
  ledgerType: string | null;
  claimId: string | null;
  date: string;
}

/** An allocation row joined with the ledger line on the other side of it. */
export interface AllocationLink extends Allocation {
  /** The linked line: the paying payment/adjustment (on a procedure) or the settled charge (on a payment). */
  linkedLedgerId: string | null;
  linkedDescription: string;
  linkedCode: string | null;
  linkedDate: string;
  linkedKind: LedgerKind | null;
  linkedSource: PaymentSource | null;
}

export interface ProcedurePayment {
  /** Money applied from payments (insurance + patient). */
  paid: number;
  insurancePaid: number;
  patientPaid: number;
  /** Money written off via adjustment allocations. */
  adjusted: number;
  remaining: number;
  status: PaidStatus;
  /** Which payments/adjustments settled this charge. */
  allocations: AllocationLink[];
}

export interface LedgerLine {
  id: string;
  ledgerId: string | null;
  kind: LedgerKind;
  date: string; // ISO datetime
  dateOfService: string; // YYYY-MM-DD
  code: string | null;
  description: string;
  amount: number;
  fee: number | null;
  tooth: string | null;
  surface: string | null;
  providerId: string | null;
  provider: string | null;
  ledgerType: string | null;
  ledgerType2: string | null;
  claimId: string | null;
  treatPlanId: string | null;
  estimatedInsurance: number | null;
  estimatedPatient: number | null;
  /** Payments only: who paid. */
  source?: PaymentSource;
  /** Procedures only: how much of this charge has been paid. */
  payment?: ProcedurePayment;
  /** Payments/adjustments only: how this money was applied, with the charges it settled. */
  applied?: { total: number; unallocated: number; procedures: number; items: AllocationLink[] };
}

export interface Visit {
  dateOfService: string;
  providers: string[];
  procedures: LedgerLine[];
  payments: LedgerLine[];
  adjustments: LedgerLine[];
  notes: LedgerLine[];
  charges: number;
  paid: number;
  adjusted: number;
}

export interface PatientDetail {
  patient: Record<string, unknown>;
  summary: PatientSummary;
  totals: {
    charges: number;
    payments: number;
    adjustments: number;
    balance: number;
    visits: number;
    procedures: number;
    /** Treatments by paid status. */
    paid: number;
    partial: number;
    unpaid: number;
    /** Patient money not applied to any charge. */
    unallocatedPayments: number;
    /** Insurance + write-off above the recorded fee, kept separate from patient credit. */
    insuranceOver?: number;
    insuranceOverCount?: number;
  };
  treatments: LedgerLine[];
  visits: Visit[];
  payments: LedgerLine[];
  claims: Claim[];
  providers: Record<string, string>;
  transactionCount: number;
  /** Adapter caveats worth showing on the chart (e.g. what the export cannot tell us). */
  notes: string[];
  /** Balance as the practice system itself reports it, when the export carries one. */
  pmsBalance?: number | null;
  /** Collection the allocation popovers are built from. */
  allocationSource?: string;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function toLedgerLine(d: Document, providers: Record<string, string>): LedgerLine {
  const t = toPlain(d) as Record<string, unknown>;
  const s = (k: string) => (typeof t[k] === "string" && t[k] !== "" ? (t[k] as string) : null);
  const date = s("transactionDate") ?? s("createdOn") ?? new Date(0).toISOString();
  const providerId = s("providerId");
  const amount = typeof t.amount === "number" ? t.amount : 0;
  const description = s("description") ?? "";
  const kind = ledgerKind(t.ledgerType, amount);
  return {
    id: String(t._id),
    ledgerId: s("ledgerId"),
    kind,
    date,
    dateOfService: date.slice(0, 10),
    code: s("procedureCode"),
    description,
    amount,
    fee: typeof t.ucrFee === "number" ? t.ucrFee : null,
    tooth: s("tooth"),
    surface: s("surface"),
    providerId,
    provider: providerId ? (providers[providerId] ?? providerId) : null,
    ledgerType: s("ledgerType"),
    ledgerType2: s("ledgerType2"),
    claimId: s("claimId"),
    treatPlanId: s("treatPlanId"),
    estimatedInsurance: typeof t.estimatedInsurance === "number" ? t.estimatedInsurance : null,
    estimatedPatient: typeof t.estimatedPatient === "number" ? t.estimatedPatient : null,
    source: kind === "payment" ? paymentSource(t.ledgerType, description) : kind === "adjustment" && s("claimId") ? "insurance" : undefined,
  };
}

export function toAllocation(d: Document): Allocation {
  const a = toPlain(d) as Record<string, unknown>;
  const s = (k: string) => (typeof a[k] === "string" && a[k] !== "" ? (a[k] as string) : null);
  return {
    id: String(a._id),
    paymentAllocationId: s("paymentAllocationId"),
    paymentLedgerId: s("paymentLedgerId") ?? "",
    procedureLedgerId: s("procedureLedgerId"),
    amount: typeof a.amount === "number" ? a.amount : 0,
    ledgerType: s("ledgerType"),
    claimId: s("claimId"),
    date: s("allocationDate") ?? s("createdOn") ?? "",
  };
}

/**
 * Attach paid status to procedures and applied totals to payments/adjustments
 * using the allocation rows (paymentLedgerId → procedureLedgerId).
 */
export function applyAllocations(lines: LedgerLine[], allocations: Allocation[]): void {
  // Insurance is recognised by the allocation's claim id or by the paying line being an insurance payment.
  const insuranceLedgerIds = new Set(lines.filter((l) => l.kind === "payment" && l.source === "insurance" && l.ledgerId).map((l) => l.ledgerId!));
  const byLedgerId = new Map<string, LedgerLine>();
  for (const l of lines) if (l.ledgerId) byLedgerId.set(l.ledgerId, l);
  const link = (a: Allocation, otherId: string | null): AllocationLink => {
    const other = otherId ? byLedgerId.get(otherId) : undefined;
    return {
      ...a,
      linkedLedgerId: otherId,
      linkedDescription: other?.description ?? (otherId ? `Ledger ${otherId} (not on this chart)` : "Unallocated"),
      linkedCode: other?.code ?? null,
      linkedDate: other?.date ?? a.date,
      linkedKind: other?.kind ?? null,
      linkedSource: other?.source ?? null,
    };
  };
  const byProcedure = new Map<string, Allocation[]>();
  const byPayment = new Map<string, Allocation[]>();
  for (const a of allocations) {
    if (a.procedureLedgerId) {
      const list = byProcedure.get(a.procedureLedgerId) ?? [];
      list.push(a);
      byProcedure.set(a.procedureLedgerId, list);
    }
    const plist = byPayment.get(a.paymentLedgerId) ?? [];
    plist.push(a);
    byPayment.set(a.paymentLedgerId, plist);
  }
  for (const line of lines) {
    if (!line.ledgerId) continue;
    if (line.kind === "procedure") {
      const allocs = byProcedure.get(line.ledgerId) ?? [];
      const abs = (n: number) => Math.abs(n);
      const paidAllocs = allocs.filter((a) => a.ledgerType !== "A");
      const paid = round2(paidAllocs.reduce((s, a) => s + abs(a.amount), 0));
      const insurancePaid = round2(paidAllocs.filter((a) => a.claimId || insuranceLedgerIds.has(a.paymentLedgerId)).reduce((s, a) => s + abs(a.amount), 0));
      const adjusted = round2(allocs.filter((a) => a.ledgerType === "A").reduce((s, a) => s + abs(a.amount), 0));
      const remaining = round2(Math.max(0, line.amount - paid - adjusted));
      const status: PaidStatus =
        line.amount <= 0 ? "none" : remaining <= 0.005 ? "paid" : paid + adjusted > 0 ? "partial" : "unpaid";
      line.payment = {
        paid,
        insurancePaid,
        patientPaid: round2(paid - insurancePaid),
        adjusted,
        remaining,
        status,
        allocations: allocs.map((a) => link(a, a.paymentLedgerId)),
      };
    } else if (line.kind === "payment" || line.kind === "adjustment") {
      const allocs = byPayment.get(line.ledgerId) ?? [];
      const total = round2(allocs.reduce((s, a) => s + Math.abs(a.amount), 0));
      line.applied = {
        total,
        unallocated: round2(Math.max(0, Math.abs(line.amount) - total)),
        procedures: new Set(allocs.map((a) => a.procedureLedgerId).filter(Boolean)).size,
        items: allocs.map((a) => link(a, a.procedureLedgerId)),
      };
    }
  }
}

/** Group ledger lines into visits by date of service, newest first. */
export function groupVisits(lines: LedgerLine[]): Visit[] {
  const byDate = new Map<string, Visit>();
  for (const line of lines) {
    // Insurance money is tracked per claim, not per visit.
    if (line.source === "insurance") continue;
    let v = byDate.get(line.dateOfService);
    if (!v) {
      v = { dateOfService: line.dateOfService, providers: [], procedures: [], payments: [], adjustments: [], notes: [], charges: 0, paid: 0, adjusted: 0 };
      byDate.set(line.dateOfService, v);
    }
    switch (line.kind) {
      case "procedure":
        v.procedures.push(line);
        v.charges = round2(v.charges + line.amount);
        if (line.provider && !v.providers.includes(line.provider)) v.providers.push(line.provider);
        break;
      case "payment":
        v.payments.push(line);
        v.paid = round2(v.paid + -line.amount);
        break;
      case "adjustment":
        v.adjustments.push(line);
        v.adjusted = round2(v.adjusted + line.amount);
        break;
      default:
        v.notes.push(line);
    }
  }
  return [...byDate.values()].sort((a, b) => (a.dateOfService < b.dateOfService ? 1 : -1));
}

export function providerName(d: Document): [string, string] {
  const p = toPlain(d) as Record<string, unknown>;
  const parts = [p.title, p.firstName, p.lastName].filter((x): x is string => typeof x === "string" && x.trim() !== "");
  return [String(p.providerId ?? ""), parts.join(" ") || String(p.providerShortId ?? p.providerId ?? "")];
}

// ---------------------------------------------------------------------------
// Office-wide procedures
// ---------------------------------------------------------------------------

export type ProcedureGroupBy = "none" | "patient" | "date" | "both";

export interface ProcedureFilters {
  from?: string; // YYYY-MM-DD on transactionDate
  to?: string;
  /** Matches procedureCode or description. */
  q?: string;
  providerId?: string;
  patientId?: string;
  /** Exact day (YYYY-MM-DD); used when expanding a date group. */
  day?: string;
  /** Drop $0 lines (no-charge codes). */
  nonZero?: boolean;
}

export const PROCEDURE_SORTS = ["date", "patient", "code", "description", "provider", "amount"] as const;
export const GROUP_SORTS = ["day", "patient", "procedures", "patients", "charges"] as const;

export type ClaimStatusKey = "unsent" | "sent" | "received" | "closed" | "denied" | "other";

export interface ClaimProcedureLine {
  procedureLedgerId: string | null;
  code: string | null;
  description: string;
  date: string | null;
  feeBilled: number;
  estimate: number | null;
  insurancePaid: number;
  writeOff: number;
}

export interface ClaimPaymentLine {
  id: string;
  date: string;
  description: string;
  amount: number;
  checkNum: string | null;
}

/** An insurance claim: what went out and what came back. */
export interface Claim {
  claimId: string;
  type: string;
  status: ClaimStatusKey;
  statusLabel: string;
  carrier: string | null;
  provider: string | null;
  dateOfService: string | null;
  dateSent: string | null;
  dateReceived: string | null;
  billed: number;
  estimate: number;
  insurancePaid: number;
  writeOff: number;
  deductible: number;
  /** Days since sent with nothing received, for claims still out. */
  daysOutstanding: number | null;
  procedures: ClaimProcedureLine[];
  payments: ClaimPaymentLine[];
}

/** One member of a family account (Open Dental: everyone under the same guarantor). */
export interface FamilyMember {
  patientId: string;
  name: string;
  birthDate: string | null;
  active: boolean;
  isGuarantor: boolean;
  isCurrent: boolean;
  procedures: number;
  charges: number;
  insurancePaid: number;
  writeOff: number;
  /** Insurance + write-off above the recorded fee; account credit in Open Dental. */
  insuranceOver: number;
  /** Sum of each procedure's fee less insurance and write-off, floored at zero. */
  patientPortion: number;
  /** Net payments entered under this member. */
  patientPaid: number;
  /** Portion covered when only this member's own payments are applied. */
  ownApplied: number;
  /** Portion covered when the whole family's payments are pooled. */
  familyCovered: number;
  outstanding: number;
  /** Own charges + adjustments - own payments, ignoring family pooling. */
  balance: number;
  pmsBalance: number | null;
}

export interface FamilyTransfer {
  fromPatientId: string;
  fromName: string;
  toPatientId: string;
  toName: string;
  amount: number;
  procedures: number;
}

export interface FamilySummary {
  guarantorId: string;
  members: FamilyMember[];
  totals: { charges: number; insurancePaid: number; writeOff: number; insuranceOver: number; patientPortion: number; patientPaid: number; covered: number; outstanding: number; credit: number; balance: number; pmsBalance: number | null };
  /** Money from one member's payments applied to another member's procedures after pooling. */
  transfers: FamilyTransfer[];
  notes: string[];
}

export interface ProcedureRow extends LedgerLine {
  patientId: string;
  patientName: string;
}

export interface ProcedureGroup {
  day: string | null;
  patientId: string | null;
  patientName: string | null;
  procedures: number;
  patients: number;
  charges: number;
  paid: number;
  adjusted: number;
  remaining: number;
  firstDate: string;
  lastDate: string;
}

/**
 * transactionDate is a BSON date in some exports and an ISO string in others,
 * so every bound is matched against both representations.
 */
function dateFieldRange(field: string, from?: string, to?: string): Document | null {
  if (!from && !to) return null;
  const asDate: Document = {};
  const asString: Document = {};
  if (from) {
    asDate.$gte = new Date(`${from}T00:00:00.000Z`);
    asString.$gte = from;
  }
  if (to) {
    asDate.$lte = new Date(`${to}T23:59:59.999Z`);
    asString.$lte = `${to}\uffff`;
  }
  return { $or: [{ [field]: asDate }, { [field]: asString }] };
}

/** Aggregation expression: "YYYY-MM-DD" of transactionDate whether stored as date or string. */
export const TRANSACTION_DAY_EXPR: Document = {
  $dateToString: {
    format: "%Y-%m-%d",
    date: { $convert: { input: "$transactionDate", to: "date", onError: null, onNull: null } },
    onNull: "unknown",
  },
};

export function procedureMatch(f: ProcedureFilters): Document {
  const and: Document[] = [{ ledgerType: "C" }];
  const range = f.day ? dateFieldRange("transactionDate", f.day, f.day) : dateFieldRange("transactionDate", f.from, f.to);
  if (range) and.push(range);
  if (f.providerId) and.push({ providerId: f.providerId });
  if (f.patientId) and.push({ patientId: f.patientId });
  if (f.nonZero) and.push({ amount: { $ne: 0 } });
  if (f.q) {
    const rx = { $regex: f.q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), $options: "i" };
    and.push({ $or: [{ procedureCode: rx }, { description: rx }] });
  }
  return { $and: and };
}
