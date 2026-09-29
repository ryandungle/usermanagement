export const money = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 }).format(n);

/** "2026-07-16" or ISO datetime → "Jul 16, 2026" */
export function dateLabel(value: string | null | undefined): string {
  if (!value) return "";
  const d = value.length === 10 ? new Date(`${value}T00:00:00Z`) : new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

export function ageFrom(birthDate: string | null | undefined): number | null {
  if (!birthDate) return null;
  const b = new Date(birthDate.length === 10 ? `${birthDate}T00:00:00Z` : birthDate);
  if (Number.isNaN(b.getTime())) return null;
  const now = new Date();
  let age = now.getUTCFullYear() - b.getUTCFullYear();
  const m = now.getUTCMonth() - b.getUTCMonth();
  if (m < 0 || (m === 0 && now.getUTCDate() < b.getUTCDate())) age--;
  return age;
}

export function fullName(p: { firstName: string; lastName: string }) {
  return [p.firstName, p.lastName].filter(Boolean).join(" ") || "(no name)";
}
