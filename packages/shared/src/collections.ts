/**
 * Clinic collections we surface first in an office's external database.
 * Matching is tolerant: "Patients", "patient", "PATIENT_RECORDS" all map to "patient".
 */
export const PREFERRED_COLLECTIONS = ["patient", "appointment", "payment", "procedure"] as const;
export type PreferredCollection = (typeof PREFERRED_COLLECTIONS)[number];

/** Lowercase, letters only, singularised. */
export function normalizeCollectionName(name: string): string {
  const base = name.toLowerCase().replace(/[^a-z]/g, "");
  return base.endsWith("s") && !base.endsWith("ss") ? base.slice(0, -1) : base;
}

/** Which preferred collection (if any) this name is, e.g. "Appointments" → "appointment". */
export function preferredKey(name: string): PreferredCollection | null {
  const n = normalizeCollectionName(name);
  return (PREFERRED_COLLECTIONS as readonly string[]).includes(n) ? (n as PreferredCollection) : null;
}

/** Preferred collections first, in canonical order, then the rest alphabetically. */
export function orderCollections(names: string[]): string[] {
  const rank = (name: string) => {
    const k = preferredKey(name);
    return k ? PREFERRED_COLLECTIONS.indexOf(k) : PREFERRED_COLLECTIONS.length;
  };
  return [...names].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}

/** "patient_records" → "Patient records" */
export function humanizeCollectionName(name: string): string {
  const spaced = name.replace(/[_-]+/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}
