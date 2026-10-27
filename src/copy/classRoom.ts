/**
 * The class's room ("Salur 3", API 0.44.0; docs/05_MOBILE_API.md "The class
 * room"): how every screen writes it. The server decides the room by one rule
 * (`location.details`, cleaned, or null when the club only names itself, its
 * street or a brand number) and the app never works it out again: it shows
 * `room` when there is one, exactly as sent, and nothing at all when there is
 * not (no empty label, no dash). The raw `location`, `location.details` and
 * `locationText` are the provider's prose for older builds and are never shown
 * as the room.
 *
 *   - Class rows (the Classes feed, the Coach's plan classes) and My bookings
 *     rows: after the venue name, "World Class Laugar & Pool · Salur 4"
 *     (`venueWithRoom`).
 *   - A venue's own timetable, where the row has no venue name: the room
 *     alone, as sent.
 *   - The booking sheet and the confirm card: a labelled row, "Room: Salur 4"
 *     in English, "Salur: 4" in Icelandic (`roomRowValue`, `roomRowText`).
 *
 * Built from a `lang` rather than the app store so the tests read exactly the
 * words the screens show. The " · " separator is the app's own, not copy.
 */
import { translate, type Lang } from '../i18n';

/** "World Class Laugar & Pool · Salur 4", or the venue alone when the class has no room. */
export function venueWithRoom(venueName: string, room: string | null | undefined): string {
  return room ? `${venueName} · ${room}` : venueName;
}

/**
 * The club's own "Salur 4" under the Icelandic label "Salur" would read
 * "Salur: Salur 4", so the Icelandic row drops the repeated word ("Salur: 4",
 * "Salur: 2 Heitur"). The website's booking emails use this very rule
 * (`emailRoomValue`): the word, whatever its case, then at least one space and
 * something after it. A room that is only "Salur" keeps it.
 */
const LEADING_SALUR = /^salur\s+(?=\S)/iu;

/** The labelled row's value: Icelandic drops a leading "Salur ", English shows the room as sent. */
export function roomRowValue(room: string, lang: Lang): string {
  return lang === 'is' ? room.replace(LEADING_SALUR, '') : room;
}

/** "Room: Salur 4" / "Salur: 4": the labelled row as one line (the class sheet). */
export function roomRowText(room: string, lang: Lang): string {
  return `${translate('booking.room.label', lang)}: ${roomRowValue(room, lang)}`;
}
