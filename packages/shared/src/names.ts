/**
 * Proper-case a person's name exported in a single case (Denticon and Open
 * Dental often store ALL CAPS). Mixed-case input is returned unchanged so
 * deliberately cased names such as "McDonald" or "van der Berg" survive.
 */
export function properName(input: string | null | undefined): string {
  const s = (input ?? "").trim().replace(/\s+/g, " ");
  if (!s) return "";
  const hasUpper = /[A-Z]/.test(s);
  const hasLower = /[a-z]/.test(s);
  if (hasUpper && hasLower) return s;
  return s
    .toLowerCase()
    .replace(/(^|[\s\-'’.(/])([a-z])/g, (_, sep: string, ch: string) => sep + ch.toUpperCase())
    .replace(/\bMc([a-z])/g, (_, ch: string) => `Mc${ch.toUpperCase()}`)
    .replace(/\b(Ii|Iii|Iv)\b/g, (m) => m.toUpperCase());
}
