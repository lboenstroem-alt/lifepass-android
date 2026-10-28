/**
 * "Report this reply": the call. Android only, like "Report review" (owner
 * decision of 28 Oct 2026; Google Play's AI-generated content policy asks
 * every app with generative AI to let a member flag offensive output without
 * leaving the app). iOS has no report action yet.
 *
 *   POST /coach/reports
 *   Idempotency-Key: <one per sheet presentation, reused on a retry>
 *   { reply, reason, note?, locale }
 *   201 { ok: true, data: { id, createdAt } }
 *
 * WHAT LEAVES THE PHONE. The reply's own words, exactly as the bubble shows
 * them (trimmed, 8,000 UTF-16 units at most, as the server counts), the
 * reason, the member's optional note (trimmed, 500 at most, left out when
 * empty) and the language. NOTHING ELSE of the conversation: the member's own
 * messages never travel with a report (data minimisation; the server stores
 * the reply, the reason, the note and who reported it).
 *
 * The author comes from the bearer token. The route is newer than the
 * vendored 0.34.0 contract, so its tests read what was sent from the stub
 * server rather than the contract.
 *
 * Errors arrive typed from the client (problem+json like every v1 route):
 * `401` (the client has already ended the session: `NotAuthenticatedError`),
 * `422` (a body the server refuses; the sheet never builds one), `429` (more
 * than 20 reports from one account in 24 hours). ./outcome.ts words them.
 */
import { apiPost, type RequestOptions } from '../../../api';
import type { Lang } from '../../../i18n';
import { truncatedToUTF16 } from '../chat/text';
import { coachLocale } from '../chat/coachApi';

/** The route, relative to `/api/v1`. */
export const COACH_REPORTS_PATH = '/coach/reports';

/** What a member can say is wrong with a reply, in the order the sheet lists them. */
export const REPLY_REPORT_REASONS = ['offensive', 'harmful', 'inaccurate', 'other'] as const;
export type ReplyReportReason = (typeof REPLY_REPORT_REASONS)[number];

/** The server's limits, in UTF-16 units (it checks JS string length). */
export const REPLY_REPORT_MAX = 8_000;
export const REPLY_REPORT_NOTE_MAX = 500;

export interface ReplyReport {
  /** The Coach reply exactly as the bubble shows it. */
  readonly reply: string;
  readonly reason: ReplyReportReason;
  /** What the member typed; blank is no note. */
  readonly note?: string;
  /** The language on screen. */
  readonly language: Lang | string;
}

/** The request body, exactly as it goes on the wire (exported for the tests). */
export interface ReplyReportBody {
  readonly reply: string;
  readonly reason: ReplyReportReason;
  readonly note?: string;
  readonly locale: 'en' | 'is';
}

/** What the server answered: the report's id and when it was stored, read softly (the sheet shows neither). */
export interface ReplyReportReceipt {
  readonly id: string | null;
  readonly createdAt: string | null;
}

/**
 * The body: the reply trimmed and cut to the server's limit without splitting
 * a character, the note likewise and left out when blank. Null when the
 * reply has no words left (the bubble never offers a report then).
 */
export function replyReportBody(report: ReplyReport): ReplyReportBody | null {
  const reply = truncatedToUTF16(report.reply.trim(), REPLY_REPORT_MAX).trim();
  if (reply.length === 0) return null;
  const note = truncatedToUTF16((report.note ?? '').trim(), REPLY_REPORT_NOTE_MAX).trim();
  const locale = coachLocale(report.language);
  return note.length > 0
    ? { reply, reason: report.reason, note, locale }
    : { reply, reason: report.reason, locale };
}

type CallOptions = Pick<RequestOptions, 'signal'> & {
  /** One per sheet presentation, reused on a retry (./ReplyReportSheet.tsx). */
  readonly idempotencyKey: string;
};

/** `POST /coach/reports`. Throws the client's typed errors. */
export function postReplyReport(body: ReplyReportBody, options: CallOptions): Promise<ReplyReportReceipt> {
  return apiPost<ReplyReportReceipt>(COACH_REPORTS_PATH, body, {
    idempotencyKey: options.idempotencyKey,
    signal: options.signal,
    decode: decodeReplyReportReceipt,
  });
}

/**
 * The `data` of a 201. Read softly: the report is stored once the server
 * answered 2xx, and an id or a time this build cannot read must never turn a
 * stored report into "that didn't go through" (a retry would only replay it).
 */
export function decodeReplyReportReceipt(data: unknown): ReplyReportReceipt {
  const json = typeof data === 'object' && data !== null && !Array.isArray(data) ? (data as Record<string, unknown>) : {};
  return {
    id: typeof json.id === 'string' ? json.id : null,
    createdAt: typeof json.createdAt === 'string' ? json.createdAt : null,
  };
}
