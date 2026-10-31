/* eslint lifepass/no-literal-copy: "error" */
/**
 * The Coach's stray venue documents (iOS `CoachViewModel`, "Stray venue-JSON
 * guard").
 *
 * The server prompt tells the model to answer a venue question with a JSON
 * document rather than prose: `{"type":"venues","intro":...,"venues":[{id,
 * name,location}]}`. Venue SEARCHES run through the local wizard, so this
 * only fires for a borderline free-text question that still trips the model
 * into that branch. The model's cards are never trusted as sent: each is
 * looked up against the real catalogue, so it renders as a real venue card
 * (price pill, heart, "Book it" by slug), and a loose search hit is only
 * accepted when its name verifiably matches the model's.
 *
 * Resolution order, per card:
 *   1. `id` as a slug (`GET /venues/by-slug/{slug}`): the server prompt has
 *      the model fill `id` with the venue slug, an exact key;
 *   2. the names still unresolved, through `GET /venues?q=<name>`: only an
 *      exact (case-insensitive) name, or a venue whose every 3+ character
 *      word appears in the model's name (`nameCorresponds`);
 *   3. if no name resolved, one retry with each name's first word (4+
 *      characters), validated the same way.
 * Results are deduplicated by venue id. Nothing resolved: a plain text list
 * ("• Name, Location") with the explore nudge, never raw JSON.
 */
import { fetchVenueBySlug, fetchVenues } from '../../../api/venues';
import type { Venue } from '../../../types/venue';
import { characterCount } from './text';

/** One card as the model wrote it. Every field may be missing. */
export interface CoachVenuePayloadCard {
  /** The venue SLUG, by the server prompt's contract. */
  readonly id: string | null;
  readonly name: string | null;
  readonly location: string | null;
}

export interface CoachVenuePayload {
  readonly type: 'venues';
  readonly intro: string | null;
  readonly venues: readonly CoachVenuePayloadCard[] | null;
}

type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Thrown inside the strict decode; never escapes this module. */
class NotAPayload extends Error {}

/** An optional string member, as Swift's `decodeIfPresent(String.self)`: absent or null is null, another type fails. */
function optionalString(body: Json, key: string): string | null {
  const value = body[key];
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') throw new NotAPayload();
  return value;
}

/**
 * The reply as a venues document, or null for ordinary prose. A markdown
 * fence around it is tolerated: only the leading and trailing fence LINES are
 * dropped, so a string value that happens to contain backticks or "json" is
 * never corrupted. Anything but a whole JSON object of `type: "venues"` is
 * prose: a reply that only CONTAINS braces is shown as written.
 */
export function parseVenuePayload(reply: string): CoachVenuePayload | null {
  let trimmed = reply.trim();
  if (trimmed.startsWith('```')) {
    const lines = trimmed.split('\n');
    if (lines[0]?.replace(/^[ \t]+|[ \t]+$/g, '').startsWith('```')) lines.shift();
    if (lines.length > 0 && lines[lines.length - 1]!.replace(/^[ \t]+|[ \t]+$/g, '') === '```') lines.pop();
    trimmed = lines.join('\n').trim();
  }
  if (!trimmed.startsWith('{')) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (!isObject(parsed)) return null;
  try {
    if (typeof parsed.type !== 'string') return null;
    const intro = optionalString(parsed, 'intro');
    const rawVenues = parsed.venues;
    let venues: CoachVenuePayloadCard[] | null = null;
    if (rawVenues !== undefined && rawVenues !== null) {
      if (!Array.isArray(rawVenues)) return null;
      venues = rawVenues.map((card) => {
        if (!isObject(card)) throw new NotAPayload();
        return {
          id: optionalString(card, 'id'),
          name: optionalString(card, 'name'),
          location: optionalString(card, 'location'),
        };
      });
    }
    if (parsed.type !== 'venues') return null;
    return { type: 'venues', intro, venues };
  } catch (error) {
    if (error instanceof NotAPayload) return null;
    throw error;
  }
}

/** Letters, marks and digits in any script (Swift `CharacterSet.alphanumerics`). */
const NOT_ALPHANUMERIC = /[^\p{L}\p{M}\p{N}]+/u;

/**
 * True when every significant word (3+ characters) of the venue's own name
 * appears in the model's name: "Blue Lagoon Retreat" corresponds to "The
 * Retreat at Blue Lagoon", "Sky Lagoon" does not. A name with no such word
 * never corresponds.
 */
export function nameCorresponds(venueName: string, aiName: string): boolean {
  const ai = aiName.toLowerCase();
  const tokens = venueName
    .toLowerCase()
    .split(NOT_ALPHANUMERIC)
    .filter((token) => characterCount(token) >= 3);
  if (tokens.length === 0) return false;
  return tokens.every((token) => ai.includes(token));
}

/** What the resolution reads; the defaults are the venue API (tests pass their own). */
export interface VenueLookup {
  bySlug(slug: string): Promise<Venue>;
  search(query: string): Promise<readonly Venue[]>;
}

const apiLookup: VenueLookup = {
  bySlug: (slug) => fetchVenueBySlug(slug),
  search: (query) => fetchVenues({ search: query }),
};

interface NameQuery {
  readonly query: string;
  readonly fullName: string;
}

/** One pass: each query's best candidate, validated against the model's FULL name. */
async function lookUpVenues(queries: readonly NameQuery[], lookup: VenueLookup): Promise<Venue[]> {
  const results: Venue[] = [];
  const seen = new Set<string>();
  for (const { query, fullName } of queries) {
    let matches: readonly Venue[];
    try {
      matches = await lookup.search(query);
    } catch {
      continue;
    }
    if (matches.length === 0) continue;
    // The `q` search is a plain substring match in the server's order, so its
    // first hit alone can be a completely unrelated venue.
    const wanted = fullName.toLowerCase();
    const best =
      matches.find((venue) => venue.name.toLowerCase() === wanted) ??
      matches.find((venue) => nameCorresponds(venue.name, fullName));
    if (!best || seen.has(best.id)) continue;
    seen.add(best.id);
    results.push(best);
  }
  return results;
}

/** The payload's cards as real venues, in the model's order, deduplicated. Never throws. */
export async function resolveVenueCards(
  payload: CoachVenuePayload,
  lookup: VenueLookup = apiLookup,
): Promise<Venue[]> {
  const results: Venue[] = [];
  const seen = new Set<string>();
  const unresolvedNames: string[] = [];

  for (const card of payload.venues ?? []) {
    const slug = (card.id ?? '').trim();
    const name = (card.name ?? '').trim();
    if (slug) {
      let venue: Venue | null = null;
      try {
        venue = await lookup.bySlug(slug);
      } catch {
        // A made-up slug or a network hiccup: the name search below.
      }
      if (venue) {
        if (!seen.has(venue.id)) {
          seen.add(venue.id);
          results.push(venue);
        }
        continue;
      }
    }
    if (name) unresolvedNames.push(name);
  }
  if (unresolvedNames.length === 0) return results;

  let named = await lookUpVenues(
    unresolvedNames.map((name) => ({ query: name, fullName: name })),
    lookup,
  );
  if (named.length === 0) {
    // First-word retry. A short or article-like first word ("The", "at")
    // would return an arbitrary venue, so it is skipped.
    const retries: NameQuery[] = [];
    for (const name of unresolvedNames) {
      const first = name.split(' ').find((part) => part.length > 0);
      if (first && characterCount(first) >= 4) retries.push({ query: first, fullName: name });
    }
    named = await lookUpVenues(retries, lookup);
  }
  for (const venue of named) {
    if (seen.has(venue.id)) continue;
    seen.add(venue.id);
    results.push(venue);
  }
  return results;
}

/**
 * The payload as text, when no card resolved: the intro, a "• Name, Location"
 * line per named card, and the explore nudge. With neither an intro nor a
 * name, the explore fallback alone, never raw JSON.
 */
export function venuesReplyAsText(payload: CoachVenuePayload, t: (key: string) => string): string {
  const parts: string[] = [];
  const intro = payload.intro?.trim();
  if (intro) parts.push(intro);
  const lines: string[] = [];
  for (const card of payload.venues ?? []) {
    if (!card.name) continue;
    lines.push(card.location ? `• ${card.name}, ${card.location}` : `• ${card.name}`);
  }
  if (lines.length > 0) parts.push(lines.join('\n'));
  parts.push(t('coach.explore_nudge'));
  return parts.length === 1 ? t('coach.explore_fallback') : parts.join('\n\n');
}

/**
 * Whether `venuesReplyAsText` shows any of the model's own words (its intro
 * or a venue it named), rather than the explore fallback alone: such a
 * bubble can be reported (src/features/coach/report).
 */
export function venuesReplyHasModelWords(payload: CoachVenuePayload): boolean {
  if (payload.intro?.trim()) return true;
  return (payload.venues ?? []).some((card) => !!card.name);
}
