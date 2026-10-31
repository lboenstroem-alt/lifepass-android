/**
 * The monthly feedback ("Your month") and the mid-month note: the Android
 * port of iOS Models/FeedbackModels.swift and Services/FeedbackService.swift
 * (`SPEC` 7.2, FB-1 to FB-5).
 *
 * WHAT THE PHONE NEVER DOES WITH THESE. The text in a report or a note is the
 * member's own health picture in words: it is rendered on the Plan tab and in
 * the report screens, and nowhere else. It never enters a Coach bubble, a chat
 * request, the saved chats, analytics or a notification (`SPEC` 9, 11.4). A
 * notification says only that something is ready.
 *
 * FAIL SOFT, like the rest of the health models (src/health/decode.ts): every
 * enum reads a value this build has never heard of as `'unknown'` instead of
 * throwing, every field is optional except the ids, and a malformed row in a
 * list costs that row, never the Plan tab. The words are rendered by the
 * server in the member's language on every read, so nothing here is
 * translated on the phone.
 *
 * THE CALLS go through the API client with `Cache-Control: no-store`, like
 * every other health call: a report is the member's health in words and never
 * lands in the HTTP layer's disk cache. NOTHING HERE IS CALLED AGAINST A
 * SERVER THAT DID NOT ADVERTISE IT: the callers check `health_feedback` in the
 * server's `features` first (the feedback store's `supportsFeedback`); an
 * older server would answer every path here with a 404. Rules only, on the
 * server: none of these calls reaches a model or spends a Coach question, and
 * nothing the phone sends here is free text.
 */
import { decodeFeatureList } from '../health/models';
import {
  boolean,
  enumOf,
  instant,
  isObject,
  object,
  opt,
  soft,
  string,
  type Json,
  type Reader,
} from '../health/decode';
import type { Lang } from '../i18n';
import { dateFromServerDay, serverDay } from '../i18n/format';

import { API_TIMEOUTS, apiGet, apiPost, apiPut } from './client';
import { isMissingRoute } from './targetWeight';

// ---------------------------------------------------------------------------
// The enums (each with `'unknown'`, never a throw)

/** `monthly` (the report) or `note` (the mid-month note). */
export type FeedbackKind = 'monthly' | 'note' | 'unknown';
/** The four topics, in the order a report draws them. */
export type FeedbackTopic = 'workouts' | 'sleep' | 'eating' | 'weight_activity' | 'unknown';
export type FeedbackSectionStatus = 'shown' | 'not_enough_data' | 'unknown';
/**
 * What a line can offer to do. The PHONE decides whether it is shown
 * (`SPEC` 9.6, `feedbackActionRule`); an unknown action is never drawn. The
 * raw value is also the analytics word (`feedback_action_tapped.action`): a
 * fixed word, never a message key or a topic.
 */
export type FeedbackAction = 'adjust_plan' | 'change_days' | 'log_meal' | 'unknown';
/**
 * How `includeFoodAndWeight` was decided (`contract.ts`
 * `FEEDBACK_FOOD_SOURCES`): the member chose it (or the app did on their
 * behalf after a local safety answer), or it is the default, ON because an
 * adopted Coach plan is on record (every plan build asks the safety
 * questions) or OFF because there is none.
 */
export type FeedbackFoodSource = 'member' | 'plan' | 'no_plan' | 'unknown';
/** Why food and weight are not in a report as shown now. The REASON behind `setting` is never stored or sent. */
export type FeedbackLeftOut = 'setting' | 'targets_withheld' | 'unknown';

const readKind = enumOf<Exclude<FeedbackKind, 'unknown'>>(['monthly', 'note']);
const readTopic = enumOf<Exclude<FeedbackTopic, 'unknown'>>(['workouts', 'sleep', 'eating', 'weight_activity']);
const readSectionStatus = enumOf<Exclude<FeedbackSectionStatus, 'unknown'>>(['shown', 'not_enough_data']);
const readAction = enumOf<Exclude<FeedbackAction, 'unknown'>>(['adjust_plan', 'change_days', 'log_meal']);
const readFoodSource = enumOf<Exclude<FeedbackFoodSource, 'unknown'>>(['member', 'plan', 'no_plan']);
const readLeftOut = enumOf<Exclude<FeedbackLeftOut, 'unknown'>>(['setting', 'targets_withheld']);

// ---------------------------------------------------------------------------
// Lossy lists

/**
 * A list whose malformed elements are dropped, and whose absence (or a value
 * that is not a list at all) reads as empty (iOS `decodeLossyArray`).
 */
function lossyArray<T>(json: Json, key: string, path: string, read: Reader<T>): T[] {
  const value = json[key];
  if (!Array.isArray(value)) return [];
  const out: T[] = [];
  value.forEach((item, index) => {
    try {
      out.push(read(item, `${path}.${key}[${index}]`));
    } catch {
      // This row only.
    }
  });
  return out;
}

function isBlank(text: string): boolean {
  return text.trim().length === 0;
}

// ---------------------------------------------------------------------------
// The switches

/**
 * `FeedbackSettingsView`. The three switches, as the server holds them.
 *
 * A missing key reads as the SAFER value, not the friendlier one: the report
 * and the note default on (they are only ever about the member's own data),
 * and food and weight default OFF, because a member who never met the safety
 * questions must not be shown food and weight lines on a guess.
 */
export interface FeedbackSettings {
  readonly monthlyReport: boolean;
  readonly midMonthNote: boolean;
  readonly includeFoodAndWeight: boolean;
  /** How the value above was decided; null from a server that does not say. */
  readonly includeFoodAndWeightSource: FeedbackFoodSource | null;
  /**
   * Null when the member never changed a switch: every value is the server's
   * default (for food and weight, derived from whether a plan passed the
   * safety questions).
   */
  readonly updatedAt: Date | null;
}

/** iOS `FeedbackSettings(...)` with its defaults. */
export function feedbackSettings(values: Partial<FeedbackSettings> = {}): FeedbackSettings {
  return {
    monthlyReport: values.monthlyReport ?? true,
    midMonthNote: values.midMonthNote ?? true,
    includeFoodAndWeight: values.includeFoodAndWeight ?? false,
    includeFoodAndWeightSource: values.includeFoodAndWeightSource ?? null,
    updatedAt: values.updatedAt ?? null,
  };
}

export const decodeFeedbackSettings: Reader<FeedbackSettings> = (value, path) => {
  const json = object(value, path);
  return {
    monthlyReport: soft(json, 'monthlyReport', path, boolean) ?? true,
    midMonthNote: soft(json, 'midMonthNote', path, boolean) ?? true,
    includeFoodAndWeight: soft(json, 'includeFoodAndWeight', path, boolean) ?? false,
    includeFoodAndWeightSource: soft(json, 'includeFoodAndWeightSource', path, readFoodSource),
    updatedAt: soft(json, 'updatedAt', path, instant),
  };
};

/**
 * The member (or the app for them, after a safety answer) has set the food
 * and weight switch. Read from the source when the server sends it; otherwise
 * any saved switch counts.
 */
export function foodAndWeightChosen(settings: FeedbackSettings): boolean {
  const source = settings.includeFoodAndWeightSource;
  if (source !== null && source !== 'unknown') return source === 'member';
  return settings.updatedAt !== null;
}

/**
 * Food and weight are off only by default: the member never chose, and no
 * plan has asked them the safety questions (`no_plan`). Body and goals then
 * says they stay out until switched on, as the web's switch does. A server
 * that sends no source (or one this build does not know) makes no such claim.
 */
export function foodAndWeightOffByDefault(settings: FeedbackSettings): boolean {
  return settings.includeFoodAndWeightSource === 'no_plan' && !settings.includeFoodAndWeight;
}

/** Either kind of feedback is on. */
export function anyFeedbackOn(settings: FeedbackSettings): boolean {
  return settings.monthlyReport || settings.midMonthNote;
}

/** The three switches by their wire names. */
export type FeedbackSettingKey = 'monthlyReport' | 'midMonthNote' | 'includeFoodAndWeight';

/** One switch, as FB-2 takes it (iOS `FeedbackSettingsChange`). */
export interface FeedbackSettingsChange {
  readonly key: FeedbackSettingKey;
  readonly value: boolean;
}

/**
 * `{ "<the one switch that changed>": bool }`. ONLY the changed key is sent:
 * the schema is a strict object, and a body that restated the other two
 * switches could put back a value another device just changed.
 */
export function feedbackSettingsBody(change: FeedbackSettingsChange): Readonly<Partial<Record<FeedbackSettingKey, boolean>>> {
  return { [change.key]: change.value };
}

/** The same switch set on `settings`. */
export function applySettingsChange(change: FeedbackSettingsChange, settings: FeedbackSettings): FeedbackSettings {
  return { ...settings, [change.key]: change.value };
}

/**
 * The same switch put back to what `previous` had, leaving the others as they
 * are now (another tap may have changed one in the meantime). The food switch
 * takes its source back with it: the optimistic "member" is a choice the
 * server never recorded, and left in place it would hide the one-time offer
 * and make a later safety answer skip its food-off
 * (`shouldTurnOffFoodForSafety`).
 */
export function revertSettingsChange(
  change: FeedbackSettingsChange,
  settings: FeedbackSettings,
  previous: FeedbackSettings,
): FeedbackSettings {
  switch (change.key) {
    case 'monthlyReport':
      return { ...settings, monthlyReport: previous.monthlyReport };
    case 'midMonthNote':
      return { ...settings, midMonthNote: previous.midMonthNote };
    case 'includeFoodAndWeight':
      return {
        ...settings,
        includeFoodAndWeight: previous.includeFoodAndWeight,
        includeFoodAndWeightSource: previous.includeFoodAndWeightSource,
      };
  }
}

// ---------------------------------------------------------------------------
// The pieces of a report

/** `FeedbackMessageView`: one line, already in the member's language. */
export interface FeedbackMessage {
  readonly key: string | null;
  readonly text: string | null;
  readonly action: FeedbackAction | null;
}

export const decodeFeedbackMessage: Reader<FeedbackMessage> = (value, path) => {
  const json = object(value, path);
  return {
    key: soft(json, 'key', path, string),
    text: soft(json, 'text', path, string),
    action: soft(json, 'action', path, readAction),
  };
};

/** The text, or null when there is none to draw. */
export function shownText(message: FeedbackMessage | null | undefined): string | null {
  const text = message?.text;
  if (text === null || text === undefined || isBlank(text)) return null;
  return text;
}

/** One label and value row, both rendered by the server ("11 of 13"). */
export interface FeedbackMetric {
  readonly key: string | null;
  readonly label: string | null;
  readonly value: string | null;
}

const decodeFeedbackMetric: Reader<FeedbackMetric> = (value, path) => {
  const json = object(value, path);
  return {
    key: soft(json, 'key', path, string),
    label: soft(json, 'label', path, string),
    value: soft(json, 'value', path, string),
  };
};

/** `FeedbackSectionView`. Only rows with something to draw are kept. */
export interface FeedbackSection {
  readonly topic: FeedbackTopic;
  readonly title: string | null;
  readonly status: FeedbackSectionStatus;
  readonly metrics: readonly FeedbackMetric[];
  readonly messages: readonly FeedbackMessage[];
  readonly hint: FeedbackMessage | null;
}

const decodeFeedbackSection: Reader<FeedbackSection> = (value, path) => {
  const json = object(value, path);
  const hint = soft(json, 'hint', path, decodeFeedbackMessage);
  return {
    topic: soft(json, 'topic', path, readTopic) ?? 'unknown',
    title: soft(json, 'title', path, string),
    status: soft(json, 'status', path, readSectionStatus) ?? 'unknown',
    metrics: lossyArray(json, 'metrics', path, decodeFeedbackMetric).filter(
      (metric) => (metric.label ?? '') !== '' && (metric.value ?? '') !== '',
    ),
    messages: lossyArray(json, 'messages', path, decodeFeedbackMessage).filter((message) => shownText(message) !== null),
    hint: hint && shownText(hint) !== null ? hint : null,
  };
};

/** Whether a section has anything to draw at all. */
export function sectionHasContent(section: FeedbackSection): boolean {
  return section.metrics.length > 0 || section.messages.length > 0 || section.hint !== null;
}

// ---------------------------------------------------------------------------
// The summary, the note and the report

/** `FeedbackReportSummary`: a monthly report as the Plan card and the history list show it. */
export interface FeedbackReportSummary {
  readonly id: string;
  readonly kind: FeedbackKind;
  /** "2026-09". */
  readonly periodMonth: string | null;
  /** "September 2026", in the member's language. */
  readonly title: string | null;
  readonly createdAt: Date | null;
  readonly seenAt: Date | null;
  /** The month before today's (Iceland): the report the Plan card offers. */
  readonly current: boolean;
  /** Up to three lines, already filtered for food and weight. */
  readonly highlights: readonly string[];
}

/** At most three highlights are drawn. */
export const MAX_HIGHLIGHTS = 3;

export const decodeFeedbackReportSummary: Reader<FeedbackReportSummary> = (value, path) => {
  const json = object(value, path);
  return {
    id: string(json.id, `${path}.id`),
    kind: soft(json, 'kind', path, readKind) ?? 'monthly',
    periodMonth: soft(json, 'periodMonth', path, string),
    title: soft(json, 'title', path, string),
    createdAt: soft(json, 'createdAt', path, instant),
    seenAt: soft(json, 'seenAt', path, instant),
    current: soft(json, 'current', path, boolean) ?? false,
    highlights: lossyArray(json, 'highlights', path, string)
      .filter((line) => !isBlank(line))
      .slice(0, MAX_HIGHLIGHTS),
  };
};

/** `FeedbackNoteView`: the mid-month note the server offers right now. */
export interface FeedbackNote {
  readonly id: string;
  readonly periodMonth: string | null;
  readonly createdAt: Date | null;
  readonly seenAt: Date | null;
  /** "YYYY-MM-DD": the last Iceland day it is offered. */
  readonly expiresOn: string | null;
  readonly title: string | null;
  readonly message: FeedbackMessage | null;
}

export const decodeFeedbackNote: Reader<FeedbackNote> = (value, path) => {
  const json = object(value, path);
  return {
    id: string(json.id, `${path}.id`),
    periodMonth: soft(json, 'periodMonth', path, string),
    createdAt: soft(json, 'createdAt', path, instant),
    seenAt: soft(json, 'seenAt', path, instant),
    expiresOn: soft(json, 'expiresOn', path, string),
    title: soft(json, 'title', path, string),
    message: soft(json, 'message', path, decodeFeedbackMessage),
  };
};

/** `nextReport`: the current month's report, which the phone may pre-schedule a notification for. */
export interface FeedbackNextReport {
  /** "2026-10": the month the report will cover. */
  readonly periodMonth: string | null;
  /** "2026-11-01": the day it is written. */
  readonly readyOn: string | null;
  /** The server expects to write it (switch on, a member now, active, and the month already has activity). */
  readonly expected: boolean;
}

const decodeFeedbackNextReport: Reader<FeedbackNextReport> = (value, path) => {
  const json = object(value, path);
  return {
    periodMonth: soft(json, 'periodMonth', path, string),
    readyOn: soft(json, 'readyOn', path, string),
    expected: soft(json, 'expected', path, boolean) ?? false,
  };
};

/** `FeedbackReportView`: one report or note, rendered for reading. */
export interface FeedbackReport {
  readonly id: string;
  readonly kind: FeedbackKind;
  readonly periodMonth: string | null;
  readonly periodStart: string | null;
  readonly periodEnd: string | null;
  readonly title: string | null;
  readonly createdAt: Date | null;
  readonly seenAt: Date | null;
  readonly dismissedAt: Date | null;
  readonly rulesVersion: string | null;
  readonly leftOut: FeedbackLeftOut | null;
  readonly leftOutLine: string | null;
  /** Known topics with something to draw, in the server's order. */
  readonly sections: readonly FeedbackSection[];
  /**
   * Null for a monthly report, and for a note about food while food and
   * weight are off (the phone then says it is no longer available).
   */
  readonly note: FeedbackMessage | null;
  readonly disclaimer: string | null;
}

export const decodeFeedbackReport: Reader<FeedbackReport> = (value, path) => {
  const json = object(value, path);
  const note = soft(json, 'note', path, decodeFeedbackMessage);
  return {
    id: string(json.id, `${path}.id`),
    kind: soft(json, 'kind', path, readKind) ?? 'unknown',
    periodMonth: soft(json, 'periodMonth', path, string),
    periodStart: soft(json, 'periodStart', path, string),
    periodEnd: soft(json, 'periodEnd', path, string),
    title: soft(json, 'title', path, string),
    createdAt: soft(json, 'createdAt', path, instant),
    seenAt: soft(json, 'seenAt', path, instant),
    dismissedAt: soft(json, 'dismissedAt', path, instant),
    rulesVersion: soft(json, 'rulesVersion', path, string),
    leftOut: soft(json, 'leftOut', path, readLeftOut),
    leftOutLine: soft(json, 'leftOutLine', path, string),
    sections: lossyArray(json, 'sections', path, decodeFeedbackSection).filter(
      (section) => section.topic !== 'unknown' && sectionHasContent(section),
    ),
    note: note && shownText(note) !== null ? note : null,
    disclaimer: soft(json, 'disclaimer', path, string),
  };
};

/** A note with nothing left to show (a food note while food and weight are off) reads as gone, the same as a 404. */
export function isEmptyNote(report: FeedbackReport): boolean {
  return report.kind === 'note' && report.note === null;
}

/** `FeedbackSummaryResponseData` (FB-1). */
export interface FeedbackSummary {
  readonly settings: FeedbackSettings | null;
  /** The newest monthly report of any age; null when none exists or the monthly switch is off. */
  readonly latest: FeedbackReportSummary | null;
  /** The note to offer, already filtered by the server. */
  readonly note: FeedbackNote | null;
  readonly nextReport: FeedbackNextReport | null;
  /**
   * Offer, once, to include food and weight: the member never chose and has
   * no adopted plan. Null from a server that does not send it (the phone then
   * works it out from the settings).
   */
  readonly foodAndWeightOffer: boolean | null;
  readonly features: readonly string[] | null;
}

/** iOS `FeedbackSummary(settings:...)` with its defaults. */
export function feedbackSummary(values: Partial<FeedbackSummary> = {}): FeedbackSummary {
  return {
    settings: values.settings ?? null,
    latest: values.latest ?? null,
    note: values.note ?? null,
    nextReport: values.nextReport ?? null,
    foodAndWeightOffer: values.foodAndWeightOffer ?? null,
    features: values.features ?? null,
  };
}

/** `[String]?` read softly: a list of strings, else null. */
function softFeatures(json: Json): readonly string[] | null {
  return decodeFeatureList(json.features);
}

export const decodeFeedbackSummary: Reader<FeedbackSummary> = (value, path) => {
  const json = object(value, path);
  return {
    settings: soft(json, 'settings', path, decodeFeedbackSettings),
    latest: soft(json, 'latest', path, decodeFeedbackReportSummary),
    note: soft(json, 'note', path, decodeFeedbackNote),
    nextReport: soft(json, 'nextReport', path, decodeFeedbackNextReport),
    foodAndWeightOffer: soft(json, 'foodAndWeightOffer', path, boolean),
    features: softFeatures(json),
  };
};

/** FB-2's answer. */
export interface FeedbackSettingsResponse {
  readonly settings: FeedbackSettings | null;
  readonly features: readonly string[] | null;
}

export const decodeFeedbackSettingsResponse: Reader<FeedbackSettingsResponse> = (value, path) => {
  const json = object(value, path);
  return { settings: soft(json, 'settings', path, decodeFeedbackSettings), features: softFeatures(json) };
};

/** FB-4's answer. The report itself must read. */
export interface FeedbackReportResponse {
  readonly report: FeedbackReport;
  readonly features: readonly string[] | null;
}

export const decodeFeedbackReportResponse: Reader<FeedbackReportResponse> = (value, path) => {
  const json = object(value, path);
  return { report: decodeFeedbackReport(json.report, `${path}.report`), features: softFeatures(json) };
};

/** FB-5's answer. */
export interface FeedbackMarkResponse {
  readonly id: string | null;
  readonly seenAt: Date | null;
  readonly dismissedAt: Date | null;
}

export const decodeFeedbackMarkResponse: Reader<FeedbackMarkResponse> = (value, path) => {
  const json = object(value, path);
  return {
    id: soft(json, 'id', path, string),
    seenAt: soft(json, 'seenAt', path, instant),
    dismissedAt: soft(json, 'dismissedAt', path, instant),
  };
};

/** FB-3's page, lossy per row: one malformed month costs that month. */
export interface FeedbackReportPage {
  readonly reports: readonly FeedbackReportSummary[];
  readonly nextCursor: string | null;
  /** True only when the server says so AND gave a cursor to follow. */
  readonly hasMore: boolean;
}

export const decodeFeedbackReportPage: Reader<FeedbackReportPage> = (value, path) => {
  const json = object(value, path);
  let nextCursor: string | null = null;
  let hasMore = false;
  if (isObject(json.pagination)) {
    const info = json.pagination;
    try {
      nextCursor = opt(info, 'nextCursor', `${path}.pagination`, string);
      hasMore = opt(info, 'hasMore', `${path}.pagination`, boolean) ?? false;
    } catch {
      // An unreadable page info is no page info (iOS `decodeSoft(PageInfo.self)`).
      nextCursor = null;
      hasMore = false;
    }
  }
  return {
    reports: lossyArray(json, 'data', path, decodeFeedbackReportSummary),
    nextCursor,
    hasMore: hasMore && nextCursor !== null,
  };
};

// ---------------------------------------------------------------------------
// Months

/**
 * The calendar arithmetic the feedback needs on "YYYY-MM" and "YYYY-MM-DD"
 * strings, on the server's calendar (Iceland is UTC all year).
 */
export const FeedbackMonth = {
  /** "2026-12" to "2027-01-01": the day the report for a month is written. */
  readyOn(periodMonth: string): string | null {
    // Swift: `split(separator: "-").compactMap { Int($0) }`.
    const parts = periodMonth
      .split('-')
      .filter((part) => part.length > 0 && /^[+-]?\d+$/.test(part))
      .map(Number);
    if (parts.length < 2) return null;
    const [year, month] = parts as [number, number];
    if (month < 1 || month > 12) return null;
    const nextYear = month === 12 ? year + 1 : year;
    const nextMonth = month === 12 ? 1 : month + 1;
    return `${String(nextYear).padStart(4, '0')}-${String(nextMonth).padStart(2, '0')}-01`;
  },

  /** Whole days between two "YYYY-MM-DD" days (b minus a). */
  days(a: string, b: string): number | null {
    const da = dateFromServerDay(a);
    const db = dateFromServerDay(b);
    if (!da || !db) return null;
    return Math.round((db.getTime() - da.getTime()) / 86_400_000);
  },

  /** A "YYYY-MM-DD" day moved by `n` days. */
  day(day: string, n: number): string | null {
    const date = dateFromServerDay(day);
    if (!date) return null;
    date.setUTCDate(date.getUTCDate() + n);
    return serverDay(date);
  },
} as const;

// ---------------------------------------------------------------------------
// The calls

/** iOS `HealthNetwork.defaultTimeout`, which every feedback call uses. */
export const FEEDBACK_TIMEOUT_MS = API_TIMEOUTS.health;

/** The history's page size (FB-3 `limit`). */
export const FEEDBACK_PAGE_SIZE = 20;

/** `?locale=`: the words come back in the ACCOUNT language. */
function localeQuery(language: Lang | string): { locale: 'is' | 'en' } {
  return { locale: language === 'is' ? 'is' : 'en' };
}

/**
 * A report id as it goes in a path. Ids come from the server and are uuids;
 * anything else is percent-encoded rather than trusted, so an id can never
 * add a path segment (iOS keeps letters, digits and `-`).
 */
export function feedbackPathId(id: string): string {
  let out = '';
  for (const char of id) {
    out += /^[A-Za-z0-9-]$/.test(char)
      ? char
      : encodeURIComponent(char).replace(/[!'()*._~]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  }
  return out;
}

/**
 * A 404 that is NOT a problem document: the route does not exist on this
 * server, so the `health_feedback` flag the app holds is stale.
 * `health_feedback_report_not_found` is a problem document and means one
 * report is gone, nothing more.
 */
export function isFeedbackRouteMissing(error: unknown): boolean {
  return isMissingRoute(error);
}

/** FB-1 `GET /health/feedback?locale`. */
export function fetchFeedbackSummary(language: Lang, options: { signal?: AbortSignal } = {}): Promise<FeedbackSummary> {
  return apiGet('/health/feedback', localeQuery(language), {
    timeoutMs: FEEDBACK_TIMEOUT_MS,
    signal: options.signal,
    decode: (data) => decodeFeedbackSummary(data, 'feedback'),
  });
}

/** FB-3 `GET /health/feedback/reports?limit&cursor&locale`, newest first. */
export function fetchFeedbackReports(options: {
  readonly cursor: string | null;
  readonly limit?: number;
  readonly language: Lang;
  readonly signal?: AbortSignal;
}): Promise<FeedbackReportPage> {
  return apiGet(
    '/health/feedback/reports',
    { ...localeQuery(options.language), limit: options.limit ?? FEEDBACK_PAGE_SIZE, cursor: options.cursor ?? undefined },
    {
      timeoutMs: FEEDBACK_TIMEOUT_MS,
      signal: options.signal,
      decode: (data) => decodeFeedbackReportPage(data, 'feedback.reports'),
    },
  );
}

/** FB-4 `GET /health/feedback/reports/{reportId}?locale`. */
export function fetchFeedbackReport(id: string, language: Lang, options: { signal?: AbortSignal } = {}): Promise<FeedbackReportResponse> {
  return apiGet(`/health/feedback/reports/${feedbackPathId(id)}`, localeQuery(language), {
    timeoutMs: FEEDBACK_TIMEOUT_MS,
    signal: options.signal,
    decode: (data) => decodeFeedbackReportResponse(data, 'feedback.report'),
  });
}

export type FeedbackMarkAction = 'seen' | 'dismiss';

/**
 * FB-5 `POST /health/feedback/reports/{reportId}` with `{ action }`. `seen`
 * for either kind; `dismiss` for a note only (a monthly answers 400
 * `invalid-feedback-action`). Naturally idempotent on the server, which still
 * requires the key.
 */
export function markFeedbackReport(
  id: string,
  action: FeedbackMarkAction,
  idempotencyKey: string,
  language: Lang,
): Promise<FeedbackMarkResponse> {
  return apiPost(`/health/feedback/reports/${feedbackPathId(id)}`, { action }, {
    query: localeQuery(language),
    idempotencyKey,
    timeoutMs: FEEDBACK_TIMEOUT_MS,
    decode: (data) => decodeFeedbackMarkResponse(data, 'feedback.mark'),
  });
}

/** FB-2 `PUT /health/feedback/settings?locale` with the ONE switch that changed. */
export function updateFeedbackSettings(
  change: FeedbackSettingsChange,
  idempotencyKey: string,
  language: Lang,
  options: { signal?: AbortSignal } = {},
): Promise<FeedbackSettingsResponse> {
  return apiPut('/health/feedback/settings', feedbackSettingsBody(change), {
    query: localeQuery(language),
    idempotencyKey,
    timeoutMs: FEEDBACK_TIMEOUT_MS,
    signal: options.signal,
    decode: (data) => decodeFeedbackSettingsResponse(data, 'feedback.settings'),
  });
}
