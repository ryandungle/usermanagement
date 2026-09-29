/**
 * Practice-management systems an office's database can come from, and the
 * collections each adapter reads. Offices can override any collection name.
 */
export const PMS_TYPES = ["denticon", "opendental"] as const;
export type PmsType = (typeof PMS_TYPES)[number];

export const PMS_LABEL: Record<PmsType, string> = { denticon: "Denticon", opendental: "Open Dental" };

export interface PmsCollectionSpec {
  key: string;
  label: string;
  default: string;
  required: boolean;
  hint?: string;
}

export const PMS_COLLECTIONS: Record<PmsType, PmsCollectionSpec[]> = {
  denticon: [
    { key: "patients", label: "Patients", default: "denticon-patients", required: true },
    { key: "transactions", label: "Ledger transactions", default: "denticon-transactions", required: true, hint: "charges, payments, adjustments" },
    { key: "allocations", label: "Payment allocations", default: "denticon-payment-allocations", required: false, hint: "links payments to charges" },
    { key: "providers", label: "Providers", default: "denticon-providers", required: false },
    { key: "insurances", label: "Patient insurances", default: "denticon-patient-insurances", required: false },
  ],
  opendental: [
    { key: "patients", label: "Patients", default: "open-dental-patients", required: true },
    { key: "procedureLogs", label: "Procedure log", default: "open-dental-procedure-logs", required: true, hint: "completed procedures (ProcStatus 2)" },
    { key: "procedureCodes", label: "Procedure codes", default: "open-dental-procedure-codes", required: true },
    { key: "payments", label: "Patient payments", default: "open-dental-payments", required: true },
    { key: "claimProcs", label: "Claim procedures", default: "open-dental-claim-procs", required: false, hint: "insurance payments and write-offs per procedure" },
    { key: "claimPayments", label: "Claim payments", default: "open-dental-claim-payments", required: false },
    { key: "providers", label: "Providers", default: "open-dental-providers", required: false },
    { key: "definitions", label: "Definitions", default: "open-dental-definitions", required: false, hint: "payment type names" },
    { key: "patientPlans", label: "Patient plans", default: "open-dental-patient-plans", required: false },
    { key: "insuranceSubscribers", label: "Insurance subscribers", default: "open-dental-insurance-subscribers", required: false },
    { key: "insurancePlans", label: "Insurance plans", default: "open-dental-insurance-plans", required: false },
    { key: "insuranceCarriers", label: "Insurance carriers", default: "open-dental-insurance-carriers", required: false },
  ],
};

export type PmsMapping = Record<string, string>;

export function defaultMapping(pms: PmsType): PmsMapping {
  return Object.fromEntries(PMS_COLLECTIONS[pms].map((c) => [c.key, c.default]));
}

/** Defaults overlaid with the office's overrides (blank overrides are ignored). */
export function resolveMapping(pms: PmsType, overrides: PmsMapping | null | undefined): PmsMapping {
  const m = defaultMapping(pms);
  for (const [k, v] of Object.entries(overrides ?? {})) if (k in m && typeof v === "string" && v.trim()) m[k] = v.trim();
  return m;
}

/** Guess the system from collection names found in the database. */
export function detectPmsType(collections: string[]): PmsType | null {
  const names = new Set(collections);
  const score = (pms: PmsType) => PMS_COLLECTIONS[pms].filter((c) => names.has(c.default)).length;
  const best = PMS_TYPES.map((p) => [p, score(p)] as const).sort((a, b) => b[1] - a[1])[0];
  return best && best[1] > 0 ? best[0] : null;
}

/** Which mapped collections are missing from the database (required ones only). */
export function missingRequired(pms: PmsType, mapping: PmsMapping, collections: string[]): PmsCollectionSpec[] {
  const names = new Set(collections);
  return PMS_COLLECTIONS[pms].filter((c) => c.required && !names.has(mapping[c.key] ?? c.default));
}

/** What each adapter can do; the UI hides what an office's system cannot provide. */
export interface PmsCapabilities {
  /** Patient list can sort/filter by last visit date. */
  lastVisit: boolean;
  /** Patient payments are linked to individual procedures ("procedure") or only to the account ("account"). */
  patientPayments: "procedure" | "account";
}

export const PMS_CAPABILITIES: Record<PmsType, PmsCapabilities> = {
  denticon: { lastVisit: true, patientPayments: "procedure" },
  opendental: { lastVisit: false, patientPayments: "account" },
};
