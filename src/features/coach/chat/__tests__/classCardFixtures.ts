/**
 * The Coach chat's class cards as the server really sends them (API 0.36.0):
 * iOS `CoachClassCardFixtures` (Models/CoachClassCardFixtures.swift), byte for
 * byte.
 *
 * CONTRACT. These bytes were not written by hand on iOS either: they are what
 * `POST /api/v1/coach` answered in the monorepo's own route test harness (the
 * real route, schema, card builder and envelope) for a chat body with
 * `cards: ["classes"]` (and, for `plainEN`, without it), with the fixture
 * venues' activity ids swapped for UUIDs. The tests decode them with the
 * app's real decoder, so a field name cannot drift between the two sides
 * without a test going red.
 *
 * The four classes: an Abler class that is open, one that is full, one whose
 * registration opens later, and a first-party slot with a fee.
 */

/** `cards: ["classes"]`, locale en. */
export const CARDS_EN = String.raw`{"ok":true,"data":{"reply":"Here are classes in Akureyri today. Tap one to book.","classes":[{"id":"cls_292c2799eb","title":"HOT FIT","startsAt":"2026-10-13T12:10:00.000Z","endsAt":"2026-10-13T13:10:00.000Z","venueSlug":"nordur-akureyri","venueName":"Nordur Akureyri","booking":{"kind":"class","activityId":"6b1f0c52-3a7e-4d19-8f2a-0c9d4e5b7a11","eventId":2102243144},"status":"open","spotsLeft":18,"priceLabel":"Included in your plan","surchargeFromIsk":null},{"id":"cls_be41a59600","title":"Spinning","startsAt":"2026-10-13T17:15:00.000Z","endsAt":"2026-10-13T18:00:00.000Z","venueSlug":"world-class-skolastigur-akureyri-and-pool","venueName":"World Class Skólastígur Akureyri & Pool","booking":{"kind":"class","activityId":"0e8a3d27-5c41-4b6f-9a12-7d3e8f1c2b44","eventId":539288823},"status":"full","spotsLeft":0,"priceLabel":"Included in your plan","surchargeFromIsk":null},{"id":"cls_094a45a28b","title":"Yoga Flow","startsAt":"2026-10-13T18:00:00.000Z","endsAt":"2026-10-13T19:00:00.000Z","venueSlug":"sjalfsraekt-heilsumidstod","venueName":"Sjálfsrækt heilsumiðstöð","booking":{"kind":"class","activityId":"a4c2e9f1-2b7d-4e3a-8c51-9f0d6b2a3e77","eventId":743812291},"status":"opens_later","spotsLeft":18,"priceLabel":"Included in your plan","surchargeFromIsk":null},{"id":"cls_3d7ee04649","title":"Sauna ritual","startsAt":"2026-10-13T19:30:00.000Z","endsAt":"2026-10-13T20:00:00.000Z","venueSlug":"forest-lagoon","venueName":"Forest Lagoon","booking":{"kind":"slot","activityId":"d9b7a1c3-6e2f-4a8d-b5c4-3e1f7a9d0c88","startsAt":"2026-10-13T19:30:00.000Z","endsAt":"2026-10-13T20:00:00.000Z"},"status":"open","spotsLeft":9,"priceLabel":"From 4,500 ISK","surchargeFromIsk":4500}]}}`;

/** `cards: ["classes"]`, locale is. */
export const CARDS_IS = String.raw`{"ok":true,"data":{"reply":"Hér eru tímar á Akureyri í dag. Ýttu á tíma til að bóka.","classes":[{"id":"cls_292c2799eb","title":"HOT FIT","startsAt":"2026-10-13T12:10:00.000Z","endsAt":"2026-10-13T13:10:00.000Z","venueSlug":"nordur-akureyri","venueName":"Nordur Akureyri","booking":{"kind":"class","activityId":"6b1f0c52-3a7e-4d19-8f2a-0c9d4e5b7a11","eventId":2102243144},"status":"open","spotsLeft":18,"priceLabel":"Innifalið í áskriftinni","surchargeFromIsk":null},{"id":"cls_be41a59600","title":"Spinning","startsAt":"2026-10-13T17:15:00.000Z","endsAt":"2026-10-13T18:00:00.000Z","venueSlug":"world-class-skolastigur-akureyri-and-pool","venueName":"World Class Skólastígur Akureyri & Pool","booking":{"kind":"class","activityId":"0e8a3d27-5c41-4b6f-9a12-7d3e8f1c2b44","eventId":539288823},"status":"full","spotsLeft":0,"priceLabel":"Innifalið í áskriftinni","surchargeFromIsk":null},{"id":"cls_094a45a28b","title":"Yoga Flow","startsAt":"2026-10-13T18:00:00.000Z","endsAt":"2026-10-13T19:00:00.000Z","venueSlug":"sjalfsraekt-heilsumidstod","venueName":"Sjálfsrækt heilsumiðstöð","booking":{"kind":"class","activityId":"a4c2e9f1-2b7d-4e3a-8c51-9f0d6b2a3e77","eventId":743812291},"status":"opens_later","spotsLeft":18,"priceLabel":"Innifalið í áskriftinni","surchargeFromIsk":null},{"id":"cls_3d7ee04649","title":"Sauna ritual","startsAt":"2026-10-13T19:30:00.000Z","endsAt":"2026-10-13T20:00:00.000Z","venueSlug":"forest-lagoon","venueName":"Forest Lagoon","booking":{"kind":"slot","activityId":"d9b7a1c3-6e2f-4a8d-b5c4-3e1f7a9d0c88","startsAt":"2026-10-13T19:30:00.000Z","endsAt":"2026-10-13T20:00:00.000Z"},"status":"open","spotsLeft":9,"priceLabel":"Frá 4.500 kr.","surchargeFromIsk":4500}]}}`;

/** The same question without `cards`: what a build without class cards gets. */
export const PLAIN_EN = String.raw`{"ok":true,"data":{"reply":"Today in Akureyri:\n• 12:10-13:10 HOT FIT, Nordur Akureyri"}}`;

/** The 400 the route answers a body it refuses (here `cards: "classes"`). */
export const BAD_REQUEST = String.raw`{"type":"https://lifepass.is/problems/invalid-coach-request","title":"Invalid coach request","status":400,"detail":"The coach request payload is invalid.","instance":"/api/v1/coach","errors":[{"field":"cards","message":"Invalid input: expected array, received string"}]}`;

/** The fixture's own day (`SCHEDULE_NOW` on the server, 13 Oct 2026, 09:24 Iceland time). */
export const SERVER_NOW = new Date('2026-10-13T09:24:00Z');

/** The envelope of a fixture, parsed. */
export function envelope(json: string): { ok: true; data: Record<string, unknown> } {
  return JSON.parse(json) as { ok: true; data: Record<string, unknown> };
}

/** `data` of a fixture, as the API client hands it to a decoder. */
export function dataOf(json: string): Record<string, unknown> {
  return envelope(json).data;
}

/** A fixture with every class moved to `day` (YYYY-MM-DD), so its classes are upcoming whenever the test runs. */
export function onDay(json: string, day: string): string {
  return json.split('2026-10-13T').join(`${day}T`);
}
