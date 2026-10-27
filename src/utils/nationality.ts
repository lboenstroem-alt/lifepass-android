// Client-safe nationality helpers, ported 1:1 from the iOS app's
// Services/Nationality.swift (itself a port of the web app's
// apps/web/src/lib/nationality.ts) so Android signup behaves exactly like
// iOS and the website: an optional ISO alpha-2 nationality, prefilled from
// the email's TLD, normalised to an upper-case 2-letter code (or null when
// blank/invalid).

// Booking providers default unknown values to Iceland — but signup never
// applies this default (it omits nationality when unset).
export const DEFAULT_NATIONALITY = 'IS';

// Generic TLDs intentionally map to nothing: no reliable inference.
const TLD_TO_NATIONALITY: Record<string, string> = {
  is: 'IS', uk: 'GB', de: 'DE', fr: 'FR', es: 'ES', it: 'IT',
  nl: 'NL', dk: 'DK', no: 'NO', se: 'SE', fi: 'FI', pl: 'PL',
  ca: 'CA', cn: 'CN', jp: 'JP', us: 'US', ie: 'IE', be: 'BE',
  at: 'AT', ch: 'CH', pt: 'PT', cz: 'CZ', gr: 'GR', hu: 'HU',
  ee: 'EE', lv: 'LV', lt: 'LT', ua: 'UA', ru: 'RU', au: 'AU',
  nz: 'NZ', in: 'IN', br: 'BR', mx: 'MX', kr: 'KR',
};

/**
 * Canonical upper-case code, or null when the input isn't a valid 2-letter
 * code. Mirrors web's `normalizeNationality` (zod: trim, `^[A-Za-z]{2}$`,
 * upper-case).
 */
export function normalizeNationality(value: string): string | null {
  const trimmed = value.trim();
  if (!/^[A-Za-z]{2}$/.test(trimmed)) return null;
  return trimmed.toUpperCase();
}

/**
 * Suggest a nationality from an email's domain TLD (`@x.is` -> IS,
 * `@x.co.uk` -> GB). null for generic TLDs or unparseable input. The LAST
 * domain label is mapped, so any subdomain depth works.
 */
export function nationalityFromEmail(email: string): string | null {
  const at = email.lastIndexOf('@');
  if (at === -1) return null;
  const domain = email.slice(at + 1).trim().toLowerCase();
  // split('.').pop() keeps a trailing empty label, so a dangling-dot domain
  // ("x.is.") yields "" -> null — matching the web semantics exactly.
  const tld = domain.split('.').pop();
  if (!tld) return null;
  // Own keys only: `x@y.constructor` must not find Object.prototype's.
  return Object.prototype.hasOwnProperty.call(TLD_TO_NATIONALITY, tld) ? TLD_TO_NATIONALITY[tld] : null;
}

/**
 * Home market first, then alphabetical by label — matches web's
 * `COUNTRY_OPTIONS` exactly. `code` is the ISO alpha-2 value; an empty
 * selection means "unset" (nationality omitted at signup).
 */
/* eslint-disable lifepass/no-literal-copy -- English in both languages on iOS too (Nationality.swift countryOptions) and on the web */
export const COUNTRY_OPTIONS: readonly { code: string; label: string }[] = [
  { code: 'IS', label: 'Iceland' },
  { code: 'AU', label: 'Australia' },
  { code: 'AT', label: 'Austria' },
  { code: 'BE', label: 'Belgium' },
  { code: 'BR', label: 'Brazil' },
  { code: 'CA', label: 'Canada' },
  { code: 'CN', label: 'China' },
  { code: 'CZ', label: 'Czechia' },
  { code: 'DK', label: 'Denmark' },
  { code: 'EE', label: 'Estonia' },
  { code: 'FI', label: 'Finland' },
  { code: 'FR', label: 'France' },
  { code: 'DE', label: 'Germany' },
  { code: 'GR', label: 'Greece' },
  { code: 'HU', label: 'Hungary' },
  { code: 'IN', label: 'India' },
  { code: 'IE', label: 'Ireland' },
  { code: 'IT', label: 'Italy' },
  { code: 'JP', label: 'Japan' },
  { code: 'LV', label: 'Latvia' },
  { code: 'LT', label: 'Lithuania' },
  { code: 'MX', label: 'Mexico' },
  { code: 'NL', label: 'Netherlands' },
  { code: 'NZ', label: 'New Zealand' },
  { code: 'NO', label: 'Norway' },
  { code: 'PL', label: 'Poland' },
  { code: 'PT', label: 'Portugal' },
  { code: 'RU', label: 'Russia' },
  { code: 'KR', label: 'South Korea' },
  { code: 'ES', label: 'Spain' },
  { code: 'SE', label: 'Sweden' },
  { code: 'CH', label: 'Switzerland' },
  { code: 'UA', label: 'Ukraine' },
  { code: 'GB', label: 'United Kingdom' },
  { code: 'US', label: 'United States' },
];
/* eslint-enable lifepass/no-literal-copy */

/** Display label for a stored code (for the picker's current value). */
export function nationalityLabel(code: string): string | null {
  return COUNTRY_OPTIONS.find((o) => o.code === code)?.label ?? null;
}
