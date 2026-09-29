import type { Document } from "mongodb";
import { toPlain } from "./mongo.js";

/** Collections the patient pages read (Denticon export). */
export const DENTICON = {
  patients: "denticon-patients",
  transactions: "denticon-transactions",
  providers: "denticon-providers",
  allocations: "denticon-payment-allocations",
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
    firstName: s("firstName") ?? "",
    lastName: s("lastName") ?? "",
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
  };
}

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
    unallocatedPayments: number;
  };
  treatments: LedgerLine[];
  visits: Visit[];
  payments: LedgerLine[];
  providers: Record<string, string>;
  transactionCount: number;
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
    source: kind === "payment" ? paymentSource(t.ledgerType, description) : undefined,
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
