/**
 * Per-page memory that survives navigation and tab restarts: which office a
 * page was last showing, and the list state (filters, sort, page) per office.
 * Everything lives in localStorage and every access is guarded, so a blocked
 * storage simply means nothing is remembered.
 */
export type ClinicalPage = "patients" | "procedures";

const officeKey = (page: ClinicalPage) => `um-office:${page}`;
const SHARED_OFFICE = "um-clinical-office";

/** Office this page last showed, falling back to the last office used on any clinical page. */
export function rememberedOffice(page: ClinicalPage): string | null {
  try {
    return localStorage.getItem(officeKey(page)) ?? localStorage.getItem(SHARED_OFFICE);
  } catch {
    return null;
  }
}

export function rememberOffice(page: ClinicalPage, officeId: string): void {
  try {
    localStorage.setItem(officeKey(page), officeId);
    localStorage.setItem(SHARED_OFFICE, officeId);
  } catch {}
}

export function rememberedState<T extends object>(key: string): T {
  try {
    const raw = localStorage.getItem(key) ?? sessionStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : ({} as T);
  } catch {
    return {} as T;
  }
}

export function rememberState<T extends object>(key: string, state: T): void {
  try {
    const clean = Object.fromEntries(Object.entries(state).filter(([, v]) => v !== undefined && v !== "" && v !== null));
    if (Object.keys(clean).length === 0) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(clean));
  } catch {}
}
