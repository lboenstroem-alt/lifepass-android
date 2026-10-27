/**
 * How values look on the wire to `/api/v1`: dates, ids and request bodies.
 * The Android twin of the iOS `APIClient` coders and `UUID.wire`
 * (Services/API/APIClient.swift, APIEnvelope.swift).
 *
 * Dependency-free on purpose: the error model and the client both use it.
 */

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}(?::?\d{2})?)$/i;

/**
 * An ISO-8601 instant as the API writes it: `…Z` or `…+00:00`, with or
 * without fractional seconds ("2026-10-02T09:00:00.000Z", a server `Date`'s
 * `toISOString()`, and "2026-10-02T09:00:00Z" both read). Anything else is
 * `null`, never a guess: a model that reads its dates softly shows "no date"
 * rather than the wrong one.
 *
 * Parsed by hand rather than with `Date.parse`, whose handling of offsets and
 * long fractions differs between engines (Hermes on the phone, V8 in Jest).
 * Reykjavik is UTC with no daylight saving, so an instant is all a date needs.
 */
export function parseIsoDate(raw: string | null | undefined): Date | null {
  if (typeof raw !== 'string') return null;
  const match = ISO_DATE.exec(raw.trim());
  if (!match) return null;
  const [, year, month, day, hour, minute, second, fraction, zone] = match;
  const mo = Number(month);
  const d = Number(day);
  const h = Number(hour);
  const mi = Number(minute);
  const s = Number(second);
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || s > 60) return null;
  const ms = fraction ? Math.floor(Number(`0.${fraction}`) * 1000) : 0;
  let offsetMinutes = 0;
  if (zone.toUpperCase() !== 'Z') {
    const sign = zone.startsWith('-') ? -1 : 1;
    const digits = zone.slice(1).replace(':', '');
    offsetMinutes = sign * (Number(digits.slice(0, 2)) * 60 + Number(digits.slice(2, 4) || '0'));
  }
  const utc = Date.UTC(Number(year), mo - 1, d, h, mi, s, ms);
  // Date.UTC rolls an impossible day over (31 February is 3 March): refuse it.
  const check = new Date(utc);
  if (check.getUTCDate() !== d || check.getUTCMonth() !== mo - 1) return null;
  const time = utc - offsetMinutes * 60_000;
  return Number.isFinite(time) ? new Date(time) : null;
}

/**
 * A date as the API expects it in a request: ISO-8601 UTC with no fractional
 * seconds ("2026-10-02T14:00:00Z"), which is what the iOS encoder sends
 * (`.iso8601`). `toISOString()` would add ".000".
 */
export function toWireDate(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/**
 * An id as it goes on the wire: lowercase, which is how the server and the
 * database write every id. A server that compares ids as strings refuses its
 * own ids in another case (the iOS 2.3.0 walk-in bug), so request bodies on
 * the money paths send `wireId(id)`.
 */
export function wireId(id: string): string {
  return id.toLowerCase();
}

/**
 * A class's room ("Salur 3", API 0.44.0) as every payload carries it: on the
 * venue timetable, the Classes feed, My bookings, a booking's answer and the
 * Coach's plan classes. The server decides it by one rule and sends it ready
 * to show, so it is kept EXACTLY as sent (never trimmed, re-cased or
 * translated: it is the sign on the door).
 *
 * Read fail-soft, as a garnish: an absent key (a shared-cached feed page or a
 * Coach answer from before 0.44.0), `null`, a blank string or a value of the
 * wrong type are all "no room", which shows nothing at all. A malformed room
 * never costs the member the timetable or the booking it rides on.
 */
export function readRoom(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

/**
 * A request body as JSON. Dates go out as `toWireDate`; `undefined` members
 * are left out (as Swift's `encodeIfPresent` does), `null` stays `null`.
 */
export function encodeBody(body: unknown): string {
  return JSON.stringify(body, function replacer(this: Record<string, unknown>, key: string, value: unknown) {
    const original = key === '' ? body : this[key];
    if (original instanceof Date) return toWireDate(original);
    return value;
  });
}

/**
 * Any JSON value re-encoded with every object's keys sorted and two-space
 * indents: the account export's file. Nothing the server sent is dropped,
 * whatever the app models (a subject-access copy must never lose a field).
 */
export function stringifySorted(value: unknown): string {
  return JSON.stringify(sortKeys(value), null, 2);
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = sortKeys((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

/** The first `limit` characters of a body, trimmed, for diagnostics (iOS `snippet`). */
export function snippet(text: string | null | undefined, limit = 240): string {
  const trimmed = (text ?? '').trim();
  return trimmed.length <= limit ? trimmed : `${trimmed.slice(0, limit)}…`;
}
