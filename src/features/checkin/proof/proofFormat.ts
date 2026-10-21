/**
 * The words on the check-in proof, as reception reads them: the Android port
 * of iOS `CheckInProofFormat` and the string half of `CheckInProofDisplay`
 * (Views/CheckIn/CheckInView.swift). Pure, so the iOS vectors port directly.
 *
 * THE CLOCK IS THE VENUE'S, NOT THE PHONE'S. The time is the single biggest
 * thing on a screen staff hold up against the clock on their own wall, and
 * LifePass members include tourists whose phone is still on a home zone. A
 * proof reading a time the desk can see is wrong reads as a stale or borrowed
 * screen. Every LifePass venue is in Iceland (Atlantic/Reykjavik, UTC with no
 * daylight saving), so the proof is pinned there whatever the phone says.
 *
 * 24-HOUR, ALWAYS ("14:32"): a phone set to 12-hour must not put AM/PM on the
 * line reception reads first. The day line follows the ACCOUNT's language
 * ("Thu 23 Apr" / "fim., 23. apr."), never the device's: an Icelandic screen
 * with an English weekday on it in 34 pt is noticed at a desk.
 *
 * Calendar words are the app's own tables (src/i18n/format), so the output
 * never depends on the phone's ICU data.
 */
import { formatDatePattern, formatDateTemplate, iskPrefix } from '../../../i18n/format';
import type { Lang } from '../../../i18n';
import type { CheckInParty } from '../../../api/profile';

type Translate = (key: string) => string;

/** "14:32" in Reykjavík (iOS `CheckInProofFormat.time`: en_US_POSIX "HH:mm"). */
export function proofTime(date: Date): string {
  return formatDatePattern(date, 'HH:mm', 'en-posix', 'iceland');
}

/** "Thu 23 Apr" (en_US_POSIX "EEE d MMM") or "fim., 23. apr." (is_IS "EEEdMMM"), in Reykjavík. */
export function proofDay(date: Date, lang: Lang): string {
  return lang === 'is'
    ? formatDateTemplate(date, 'EEEdMMM', 'is', 'iceland')
    : formatDatePattern(date, 'EEE d MMM', 'en-posix', 'iceland');
}

function present(value: string | null | undefined): value is string {
  return typeof value === 'string' && value.length > 0;
}

/**
 * "14:32, Thu 23 Apr, World Class Laugar, Lucas B.": the three big lines as
 * one spoken line, in the order they are read, built from what is actually on
 * the screen, so a missing name is simply absent rather than a gap. The
 * eyebrow is its own element and is not repeated here.
 */
export function proofSummary(time: string, day: string, venueName: string | null, memberShortName: string | null): string {
  return [time, day, venueName, memberShortName].filter(present).join(', ');
}

/**
 * "Yoga  ·  CONFIRMATION 4F21A0": everything that is not one of the three big
 * lines, or null when there is nothing to say (never an empty row).
 */
export function proofDetailLine(activityName: string | null, confirmationCode: string | null, t: Translate): string | null {
  const parts: string[] = [];
  if (present(activityName)) parts.push(activityName);
  if (present(confirmationCode)) parts.push(`${t('checkin.proof.confirmation')} ${confirmationCode}`);
  return parts.length > 0 ? parts.join('  ·  ') : null;
}

/** How many guests came along (iOS `Party.guestCount`). */
export function partyGuestCount(party: CheckInParty): number {
  return party.adults + party.children + party.infants;
}

/**
 * Fills an iOS printf template's one value: `%d`, `%ld` or `%@` (the iOS
 * tables keep Foundation's placeholders for a few strings that went through
 * `String(format:)`).
 */
export function fillPrintf(template: string, value: string | number): string {
  return template.replace(/%(?:1\$)?(?:l{0,2}d|@)/, String(value));
}

/** "3 checked in": the member plus every guest. */
export function partyHeadline(party: CheckInParty, t: Translate): string {
  return fillPrintf(t('checkin.party.headline'), partyGuestCount(party) + 1);
}

/** "1 member · 1 adult guest · 2 children": counts from the server's party, never re-derived. */
export function partyBreakdownLine(party: CheckInParty, t: Translate): string {
  const parts = [t('checkin.party.member')];
  if (party.adults > 0) parts.push(`${party.adults} ${t(party.adults === 1 ? 'checkin.party.adult' : 'checkin.party.adults')}`);
  if (party.children > 0) {
    parts.push(`${party.children} ${t(party.children === 1 ? 'checkin.party.child' : 'checkin.party.children')}`);
  }
  if (party.infants > 0) parts.push(`${party.infants} ${t(party.infants === 1 ? 'checkin.party.infant' : 'checkin.party.infants')}`);
  return parts.join(' · ');
}

/** "Guests: ISK 5,400 charged to your card", or null when the guests cost nothing. */
export function partyChargedLine(party: CheckInParty, t: Translate): string | null {
  return party.guestChargeIsk > 0 ? fillPrintf(t('checkin.party.charged'), iskPrefix(party.guestChargeIsk)) : null;
}

/**
 * "1 member · 1 adult guest · 2 children · ISK 5,400 charged to your card":
 * the breakdown and the charge as ONE receipt line, for the accessibility
 * sizes where two paragraphs no longer fit above the fold. The charge keeps
 * its words: a lone "ISK 5,400" could as easily be a price as a payment
 * already taken.
 */
export function partyCompactLine(party: CheckInParty, t: Translate): string {
  const people = partyBreakdownLine(party, t);
  if (party.guestChargeIsk <= 0) return people;
  return `${people} · ${fillPrintf(t('checkin.party.charged.compact'), iskPrefix(party.guestChargeIsk))}`;
}
