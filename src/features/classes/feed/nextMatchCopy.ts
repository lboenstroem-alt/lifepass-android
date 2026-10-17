/**
 * The words of the empty day's hint, in either language ("No Pilates today.
 * Next: Mon 5 Oct · Hress 06:00"): iOS `ClassesNextMatchCopy`
 * (ViewModels/ClassesViewModel.swift). Pure, so the tests read exactly what a
 * member reads. All days and times are venue-local (Reykjavík).
 */
import type { ClassFeedItem } from '../../../api/classFeed';
import { translate, type Lang } from '../../../i18n';
import { classLongDay, classShortDay, venueTime } from '../../../i18n/format';
import { addDays, FEATURED_CATEGORIES, isoDay, lookAheadIsTheNextTwoWeeks, startOfIsoDay } from './days';
import type { NextMatchRequest } from './nextMatch';

/**
 * Categories with a written noun in both languages. Any other slug (Plan's
 * class session can open on one) reads as "no classes match these filters",
 * which is true without naming it.
 */
const NAMED_CATEGORIES: ReadonlySet<string> = new Set(FEATURED_CATEGORIES);

/**
 * "No Pilates today." / "Engir Pilates-tímar í dag.". `horizon` for the
 * fortnight after today ("No Pilates in the next two weeks."; see
 * `noneInWindowLines` for when that holds).
 */
export function headline(request: NextMatchRequest, horizon: boolean, now: Date, lang: Lang): string {
  const when = horizon
    ? translate('classes.next_when_horizon', lang)
    : whenPhrase(request.dayIso, now, lang);
  const params: Record<string, string> = { when, km: String(request.radiusKm) };
  const nearMe = request.originLatitude !== null;

  let key: string;
  if (request.query === null && request.category !== null && NAMED_CATEGORIES.has(request.category)) {
    params.what = translate(`classes.next_what_${request.category}`, lang);
    key = nearMe ? 'classes.next_none_cat_near' : 'classes.next_none_cat';
  } else if (request.query !== null || request.category !== null) {
    key = 'classes.next_none_filtered';
  } else {
    key = nearMe ? 'classes.next_none_any_near' : 'classes.next_none_any';
  }
  return translate(key, lang, params);
}

/**
 * What the empty day says when the look-ahead found nothing. From today that
 * is the fortnight the feed holds: "No Pilates in the next two weeks." From a
 * later day the window ran past the days the feed has synced, so it names the
 * day and says no more than the data does: "No Pilates on Saturday 10
 * October." + "Nothing later is on the schedule yet."
 */
export function noneInWindowLines(request: NextMatchRequest, now: Date, lang: Lang): string[] {
  if (lookAheadIsTheNextTwoWeeks(request.dayIso, now)) return [headline(request, true, now, lang)];
  return [headline(request, false, now, lang), translate('classes.next_none_later', lang)];
}

/** "Next: Mon 5 Oct · Hress 06:00" / "Næst: mán. 5. okt. · Hress 06:00". */
export function nextLine(item: ClassFeedItem, lang: Lang): string {
  return translate('classes.next_line', lang, {
    day: classShortDay(item.startsAt, lang),
    venue: item.venue.name,
    time: venueTime(item.startsAt),
  });
}

/** The button: "Show Mon 5 Oct" / "Sýna mán. 5. okt.". */
export function showDayTitle(item: ClassFeedItem, lang: Lang): string {
  return translate('classes.next_show', lang, { day: classShortDay(item.startsAt, lang) });
}

/**
 * The spoken hint. Screen readers read abbreviations badly ("mán." is not a
 * word), so the spoken forms spell the day out.
 */
export function accessibilityLabel(headlineText: string, item: ClassFeedItem, lang: Lang): string {
  return `${headlineText} ${translate('classes.next_line_a11y', lang, {
    day: classLongDay(item.startsAt, lang),
    venue: item.venue.name,
    time: venueTime(item.startsAt),
  })}`;
}

/** "Show classes on Monday 5 October" / "Sýna tíma mánudaginn 5. október". */
export function showDayAccessibilityLabel(item: ClassFeedItem, lang: Lang): string {
  return translate('classes.next_show_a11y', lang, { day: classLongDay(item.startsAt, lang) });
}

/**
 * "today" / "tomorrow" / "on Saturday 3 October" ("í dag" / "á morgun" /
 * "laugardaginn 3. október": Icelandic names the day in the accusative with
 * the article). "Today" is Reykjavík's day, not the phone's.
 */
export function whenPhrase(dayIso: string, now: Date, lang: Lang): string {
  const today = isoDay(now);
  if (dayIso === today) return translate('classes.next_when_today', lang);
  if (dayIso === addDays(today, 1)) return translate('classes.next_when_tomorrow', lang);
  const day = startOfIsoDay(dayIso);
  if (!day) return dayIso;
  return translate('classes.next_when_on', lang, { day: classLongDay(day, lang) });
}
