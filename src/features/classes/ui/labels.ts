// The words of a feed card and the filter rows, built from the generated iOS
// keys (ClassesDiscoveryView `quickDateLabel`, `timeLine`, `venueLine`,
// `stateChip`, `daySection`). Pure, so a test reads what a member reads.
import type { ClassFeedItem } from '../../../api/classFeed';
import { formatDistance, iskPrefix, translate, type Lang } from '../../../i18n';
import { formatDatePattern, venueTime } from '../../../i18n/format';
import { startOfIsoDay } from '../feed/days';
import { chipCopy, classFeedChip } from '../model/chip';

/**
 * A quick day chip: "Today", "Tomorrow", then the weekday in the account
 * language. Icelandic weekday names are lowercase by convention
 * ("þriðjudagur"); the first letter is capitalised so the chip reads
 * consistently beside "Í dag" / "Á morgun".
 */
export function quickDateLabel(index: number, dayIso: string, lang: Lang): string {
  if (index === 0) return translate('classes.date_today', lang);
  if (index === 1) return translate('classes.date_tomorrow', lang);
  const day = startOfIsoDay(dayIso);
  if (!day) return dayIso;
  const raw = formatDatePattern(day, 'EEEE', lang);
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

/** A day's header: "Monday 5 October" / "mánudagur 5. október". */
export function dayHeader(dayIso: string, lang: Lang): string {
  const day = startOfIsoDay(dayIso);
  if (!day) return dayIso;
  return formatDatePattern(day, lang === 'is' ? 'EEEE d. MMMM' : 'EEEE d MMMM', lang);
}

/** "06:00–07:00 · Sigrún", venue-local 24 h (web parity: classes are in Iceland time). */
export function timeLine(item: ClassFeedItem): string {
  let line = `${venueTime(item.startsAt)}–${venueTime(item.endsAt)}`;
  if (item.instructor) line += ` · ${item.instructor}`;
  return line;
}

/** "350 m", "2.4 km" / "2,4 km", "12 km": only ever from the member's real position. */
export function distanceText(distanceKm: number | null, lang: Lang): string | null {
  return distanceKm === null ? null : formatDistance(distanceKm, lang);
}

/** "Surcharge from ISK 1,990" / "Aukagjald frá ISK 1,990". */
export function surchargeText(item: ClassFeedItem, lang: Lang): string | null {
  return item.surchargeFromIsk === null ? null : translate('classes.surcharge_from', lang, { price: iskPrefix(item.surchargeFromIsk) });
}

/** The state chip's words. */
export function chipText(item: ClassFeedItem, now: Date, lang: Lang): string {
  const copy = chipCopy(classFeedChip(item, now));
  return translate(copy.key, lang, copy.params);
}

/** "1 km": the radius pills, written as iOS writes them in both languages. */
export function radiusLabel(km: number): string {
  return `${km} km`;
}

/**
 * What TalkBack reads for a card, one element as VoiceOver reads the iOS
 * button: the name, the time, the venue, how far ("2.4 km away"), any
 * surcharge, and the registration state.
 */
export function cardAccessibilityLabel(item: ClassFeedItem, distanceKm: number | null, now: Date, lang: Lang): string {
  const distance = distanceText(distanceKm, lang);
  return [
    item.name ?? translate('classes.unnamed', lang),
    timeLine(item),
    item.venue.name,
    distance ? translate('classes.distance_a11y', lang, { distance }) : null,
    surchargeText(item, lang),
    chipText(item, now, lang),
  ]
    .filter((part): part is string => !!part)
    .join(', ');
}
