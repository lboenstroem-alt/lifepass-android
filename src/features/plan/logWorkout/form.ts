/**
 * Everything the Log a workout sheet holds, as a value (iOS `LogWorkoutForm`,
 * Views/Plan/LogWorkoutSheet.swift), so the rules (which fields Save needs,
 * how the note is cleaned, when the idempotency key changes) are tested
 * without standing up a view.
 *
 * Each function takes a form and hands back the next one (the same object
 * when nothing changed, so a caller can skip a render). The sheet keeps the
 * latest form in a ref as well as in state, so a second tap in the same
 * frame already sees `isSaving` and posts nothing.
 *
 * A workout logged here is an EXTRA on the day's row: the plan does not
 * react to it (see the sheet). The server decides where it is offered
 * (`SessionView.canLogExtra`, read by the Today card).
 */
import Graphemer from 'graphemer';

import { newIdempotencyKey } from '../../../api';
import { SessionAction, type ExtraWorkoutKind, type SessionActionBody } from '../../../health';
import { dateFromServerDay } from '../../../i18n/format';

/** The four duration chips, in minutes. */
export const PRESET_MINUTES: readonly number[] = [30, 45, 60, 90];
/**
 * The server's cap on the note, counted the way it counts (JavaScript's
 * `length`, UTF-16 units), so a note the field accepts is never a 400.
 */
export const NOTE_LIMIT = 140;
/** The counter appears this close to the cap, not before. */
export const NOTE_COUNTER_FROM = 120;
/** What "Other" minutes may be. */
export const MINUTES_MIN = 1;
export const MINUTES_MAX = 300;

export type LogWorkoutDuration = { readonly kind: 'preset'; readonly minutes: number } | { readonly kind: 'custom' };

export interface LogWorkoutForm {
  readonly kind: ExtraWorkoutKind | null;
  readonly duration: LogWorkoutDuration | null;
  readonly customMinutesText: string;
  readonly note: string;
  readonly isSaving: boolean;
  /**
   * ONE KEY PER SUBMIT. Minted when the form opens, reused for a retry of
   * the same Save (a dropped connection must not log the workout twice),
   * and replaced after a success or any change to what would be sent.
   */
  readonly idempotencyKey: string;
}

/** A fresh form, as the sheet opens. */
export function newLogWorkoutForm(): LogWorkoutForm {
  return { kind: null, duration: null, customMinutesText: '', note: '', isSaving: false, idempotencyKey: newIdempotencyKey() };
}

export const presetDuration = (minutes: number): LogWorkoutDuration => ({ kind: 'preset', minutes });
export const CUSTOM_DURATION: LogWorkoutDuration = { kind: 'custom' };

export function sameDuration(a: LogWorkoutDuration | null, b: LogWorkoutDuration | null): boolean {
  if (a === null || b === null) return a === b;
  if (a.kind === 'custom' || b.kind === 'custom') return a.kind === b.kind;
  return a.minutes === b.minutes;
}

function renewKey(form: LogWorkoutForm, change: Partial<LogWorkoutForm>): LogWorkoutForm {
  return { ...form, ...change, idempotencyKey: newIdempotencyKey() };
}

// ---------------------------------------------------------------------------
// Inputs

export function chooseKind(form: LogWorkoutForm, kind: ExtraWorkoutKind): LogWorkoutForm {
  if (form.isSaving || kind === form.kind) return form;
  return renewKey(form, { kind });
}

export function chooseDuration(form: LogWorkoutForm, duration: LogWorkoutDuration): LogWorkoutForm {
  if (form.isSaving || sameDuration(duration, form.duration)) return form;
  return renewKey(form, { duration });
}

/**
 * Digits only, at most three of them: the field is a number pad, but a paste
 * is not. ASCII digits only, as only they parse as minutes (iOS
 * `isASCIIDigit`): an Arabic-Indic "٤٥" is dropped.
 */
export function setCustomMinutes(form: LogWorkoutForm, raw: string): LogWorkoutForm {
  if (form.isSaving) return form;
  const digits = raw.replace(/[^0-9]/g, '').slice(0, 3);
  if (digits === form.customMinutesText) return form;
  return renewKey(form, { customMinutesText: digits });
}

export function setNote(form: LogWorkoutForm, raw: string): LogWorkoutForm {
  if (form.isSaving) return form;
  const cleaned = cleanNote(raw);
  if (cleaned === form.note) return form;
  return renewKey(form, { note: cleaned });
}

// ---------------------------------------------------------------------------
// Derived

/** The minutes Save would send, or null while there are none to send. */
export function formMinutes(form: LogWorkoutForm): number | null {
  const duration = form.duration;
  if (!duration) return null;
  if (duration.kind === 'preset') return duration.minutes;
  if (form.customMinutesText === '') return null;
  const value = Number(form.customMinutesText);
  return Number.isInteger(value) && value >= MINUTES_MIN && value <= MINUTES_MAX ? value : null;
}

/** Something typed in the minutes field that the server would refuse. */
export function customMinutesInvalid(form: LogWorkoutForm): boolean {
  return form.duration?.kind === 'custom' && form.customMinutesText !== '' && formMinutes(form) === null;
}

/** The note's length as the server counts it (UTF-16 units, which is JavaScript's own `length`). */
export function noteLength(form: LogWorkoutForm): number {
  return form.note.length;
}

export function showsNoteCounter(form: LogWorkoutForm): boolean {
  return noteLength(form) >= NOTE_COUNTER_FROM;
}

export function canSave(form: LogWorkoutForm): boolean {
  return form.kind !== null && formMinutes(form) !== null && !form.isSaving;
}

/**
 * The body Save posts. `clientCompletedAt` is null for today's card and noon
 * of the card's date for a past one (Iceland is UTC), so the server files
 * the workout on that date's row.
 */
export function logWorkoutBody(form: LogWorkoutForm, cardDate: string, today: string): SessionActionBody | null {
  const minutes = formMinutes(form);
  if (form.kind === null || minutes === null) return null;
  return SessionAction.logExtra({
    kind: form.kind,
    minutes,
    note: form.note,
    clientCompletedAt: cardDate === today ? null : dateFromServerDay(cardDate),
  });
}

// ---------------------------------------------------------------------------
// Saving

/**
 * Starts a Save and hands back the key to send it under with the locked
 * form, or null when Save is not possible (nothing chosen, or one already in
 * flight: a double tap posts once).
 */
export function beginSave(form: LogWorkoutForm): { readonly form: LogWorkoutForm; readonly key: string } | null {
  if (!canSave(form)) return null;
  return { form: { ...form, isSaving: true }, key: form.idempotencyKey };
}

/** The Save failed: the fields unlock and the SAME key waits for the retry. */
export function saveFailed(form: LogWorkoutForm): LogWorkoutForm {
  return form.isSaving ? { ...form, isSaving: false } : form;
}

/** The Save went through: the next workout gets its own key. */
export function saveSucceeded(form: LogWorkoutForm): LogWorkoutForm {
  return renewKey(form, { isSaving: false });
}

// ---------------------------------------------------------------------------
// The note

const ZERO_WIDTH_JOINER = 0x200d;
const WAVING_BLACK_FLAG = 0x1f3f4;
const CANCEL_TAG = 0xe007f;
/** A line break or a tab: the note is one line, so each becomes a space. */
const BREAKS: ReadonlySet<number> = new Set([0x0a, 0x0d, 0x09, 0x2028, 0x2029]);

/**
 * Unicode general categories Cc (control) and Cf (format), as code point
 * ranges. Spelled out rather than `/\p{Cc}|\p{Cf}/u` so the phone (Hermes)
 * and Jest (Node) answer the same, from one table (Unicode 17).
 */
const CONTROL_AND_FORMAT: readonly (readonly [number, number])[] = [
  [0x0000, 0x001f],
  [0x007f, 0x009f],
  [0x00ad, 0x00ad],
  [0x0600, 0x0605],
  [0x061c, 0x061c],
  [0x06dd, 0x06dd],
  [0x070f, 0x070f],
  [0x0890, 0x0891],
  [0x08e2, 0x08e2],
  [0x180e, 0x180e],
  [0x200b, 0x200f],
  [0x202a, 0x202e],
  [0x2060, 0x2064],
  [0x2066, 0x206f],
  [0xfeff, 0xfeff],
  [0xfff9, 0xfffb],
  [0x110bd, 0x110bd],
  [0x110cd, 0x110cd],
  [0x13430, 0x1343f],
  [0x1bca0, 0x1bca3],
  [0x1d173, 0x1d17a],
  [0xe0001, 0xe0001],
  [0xe0020, 0xe007f],
];

function isControlOrFormat(codePoint: number): boolean {
  return CONTROL_AND_FORMAT.some(([low, high]) => codePoint >= low && codePoint <= high);
}

/** A UTF-16 surrogate on its own (a JavaScript string can hold one; a Swift string cannot). */
function isLoneSurrogate(codePoint: number): boolean {
  return codePoint >= 0xd800 && codePoint <= 0xdfff;
}

const isTagLetterOrDigit = (codePoint: number): boolean =>
  (codePoint >= 0xe0030 && codePoint <= 0xe0039) || (codePoint >= 0xe0061 && codePoint <= 0xe007a);

/**
 * Where a subdivision flag that starts at `start` ends: the black flag, one
 * to seven tag digits or letters, and the cancel tag (the server's
 * `EMOJI_TAG_SEQUENCE`). Null when no whole sequence starts there.
 */
function emojiTagSequenceEnd(codePoints: readonly number[], start: number): number | null {
  if (codePoints[start] !== WAVING_BLACK_FLAG) return null;
  let index = start + 1;
  let tags = 0;
  while (index < codePoints.length && tags < 7 && isTagLetterOrDigit(codePoints[index]!)) {
    index += 1;
    tags += 1;
  }
  if (tags === 0 || index >= codePoints.length || codePoints[index] !== CANCEL_TAG) return null;
  return index + 1;
}

let splitter: Graphemer | null = null;

/**
 * What the server will keep, applied as the member types so the field never
 * shows something else: a line break becomes a space, control and format
 * characters (bidi overrides, zero-width spaces, the BOM, stray tags) go, and
 * the text stops at 140 UTF-16 units without splitting a character (an
 * extended grapheme cluster, as Swift's `Character`).
 *
 * Two format characters are what emoji are made of and stay, as on the
 * server (`stripFormatCharacters`): U+200D ZERO WIDTH JOINER (family,
 * profession and rainbow-flag emoji) and the tags of a whole
 * subdivision-flag sequence (England, Scotland, Wales).
 */
export function cleanNote(raw: string): string {
  const input = Array.from(raw, (character) => character.codePointAt(0)!);
  const kept: number[] = [];
  let index = 0;
  while (index < input.length) {
    const end = emojiTagSequenceEnd(input, index);
    if (end !== null) {
      kept.push(...input.slice(index, end));
      index = end;
      continue;
    }
    const codePoint = input[index]!;
    index += 1;
    if (BREAKS.has(codePoint)) {
      kept.push(0x20);
    } else if (codePoint === ZERO_WIDTH_JOINER) {
      kept.push(codePoint);
    } else if (!isControlOrFormat(codePoint) && !isLoneSurrogate(codePoint)) {
      kept.push(codePoint);
    }
  }
  // One at a time: a long paste would overflow a spread's argument list.
  const cleaned = kept.map((codePoint) => String.fromCodePoint(codePoint)).join('');
  if (cleaned.length <= NOTE_LIMIT) return cleaned;
  splitter ??= new Graphemer();
  let capped = '';
  for (const character of splitter.iterateGraphemes(cleaned)) {
    if (capped.length + character.length > NOTE_LIMIT) break;
    capped += character;
  }
  return capped;
}
