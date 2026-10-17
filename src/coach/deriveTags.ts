import type { Booking } from '../types/booking';
import type { LegacyVenue as Venue } from '../types/venue';
import type { ActivityTag } from '../data/mockCoach';

// ─── Keyword → ActivityTag mapping ───────────────────────────────────────────
// We scan a venue/activity's name and category strings for these regexes.
// Order matters when multiple could match — first hit wins per tag.

const TAG_RULES: { pattern: RegExp; tag: ActivityTag }[] = [
  { pattern: /lagoon|spa|bath|therm|hot.?spring/i, tag: 'lagoon' },
  { pattern: /gym|fitness|strength|hiit|crossfit|lift|workout/i, tag: 'gym' },
  { pattern: /yoga|pilates|barre/i, tag: 'yoga' },
  { pattern: /swim|pool|laug/i, tag: 'swimming' },          // 'laug' = Icelandic pool
  { pattern: /sauna|massage|recover|cold.?plunge|steam/i, tag: 'recovery' },
];

function tagsFromText(s: string): ActivityTag[] {
  const found: ActivityTag[] = [];
  for (const { pattern, tag } of TAG_RULES) {
    if (pattern.test(s) && !found.includes(tag)) found.push(tag);
  }
  return found;
}

/**
 * Derive a deduplicated list of activity tags from the user's bookings and
 * favourited venues. Always includes 'general' so general-purpose chips
 * still have some weight when the user has no history yet.
 *
 * The tag set is used by `selectChips()` to pick relevant suggestion chips.
 */
export function deriveActivityTags(opts: {
  bookings: Booking[];
  favourites: Venue[];
}): ActivityTag[] {
  const tags = new Set<ActivityTag>(['general']);

  for (const b of opts.bookings) {
    for (const t of tagsFromText(b.activityName)) tags.add(t);
    for (const t of tagsFromText(b.venueName)) tags.add(t);
  }

  for (const v of opts.favourites) {
    for (const t of tagsFromText(v.name)) tags.add(t);
    for (const cat of v.category) {
      for (const t of tagsFromText(cat)) tags.add(t);
    }
  }

  return Array.from(tags);
}
