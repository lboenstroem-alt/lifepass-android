/**
 * "Report this reply" on the Coach's own replies (Android only, COACH-7):
 * the call (./api.ts), how a failure reads (./outcome.ts) and the sheet
 * (./ReplyReportSheet.tsx). The chat offers it on every bubble the store
 * marks as the model's words (`isReportableReply`, ../store/messages.ts).
 */
export {
  COACH_REPORTS_PATH,
  postReplyReport,
  REPLY_REPORT_MAX,
  REPLY_REPORT_NOTE_MAX,
  REPLY_REPORT_REASONS,
  replyReportBody,
  type ReplyReport,
  type ReplyReportBody,
  type ReplyReportReason,
  type ReplyReportReceipt,
} from './api';
export { replyReportFailure, type ReplyReportFailure } from './outcome';
export { default as ReplyReportSheet, replyReportReasonKey } from './ReplyReportSheet';
export type { ReplyReportSheetProps, SendReplyReport } from './ReplyReportSheet';
