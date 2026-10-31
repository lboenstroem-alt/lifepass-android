/**
 * "Report review": Android only, by owner decision D5 (Google Play's policy
 * for user-generated content asks every app that shows members' reviews to
 * let a member report one; iOS 2.5.6 has no report action yet).
 *
 * The flow, from the "..." button on a review card on the reviews page:
 *   1. an action sheet asks why, with the API's five reasons and Cancel;
 *   2. picking a reason sends `POST /venues/{venueId}/reviews/{reviewId}/report`
 *      at once (the pick is the member's explicit act; there is no second
 *      confirm);
 *   3. a toast thanks them; a repeat report is accepted by the server and
 *      says so ("You've already reported this review");
 *   4. a failure raises the "Heads up" alert in the formatter's words (or "You
 *      can't report your own review" for `review_report_own`, which the page
 *      prevents anyway by never offering it on the member's own review).
 * The review stays published either way; the report puts it in front of the
 * LifePass team. A second pick for a review whose report is still on its
 * way is ignored.
 */
import { errorMessage, isCancellation, isProblem } from '../../../api';
import { showDialog } from '../../../components/ui/Dialog';
import { showToast } from '../../../components/ui/Toast';
import { t } from '../../../i18n';
import { REPORT_REASONS, reportVenueReview, type ReviewReportReason, type ReviewReportResult } from './api';

export interface ReportDeps {
  readonly send?: (venueId: string, reviewId: string, reason: ReviewReportReason) => Promise<ReviewReportResult>;
  readonly toast?: (message: string) => void;
  readonly alert?: (message: string) => void;
}

const inFlight = new Set<string>();

/** The copy key of a reason's button. */
export function reportReasonKey(reason: ReviewReportReason): string {
  return `venue2.report.reason.${reason}`;
}

/** Asks why, then reports (step 1). */
export function openReportReview(venueId: string, reviewId: string, deps: ReportDeps = {}): void {
  showDialog({
    presentation: 'actionSheet',
    titleVisibility: 'visible',
    title: t('venue2.report.title'),
    buttons: [
      ...REPORT_REASONS.map((reason) => ({
        label: t(reportReasonKey(reason)),
        onPress: () => {
          void sendReviewReport(venueId, reviewId, reason, deps);
        },
        testID: `report-reason-${reason}`,
      })),
      { label: t('common.cancel'), role: 'cancel' as const },
    ],
    testID: 'report-review-sheet',
  });
}

/**
 * Sends the report and tells the member (steps 2 to 4). Resolves with what
 * happened: `sent`, `already`, `failed`, or `ignored` (one already on its way).
 */
export async function sendReviewReport(
  venueId: string,
  reviewId: string,
  reason: ReviewReportReason,
  deps: ReportDeps = {},
): Promise<'sent' | 'already' | 'failed' | 'ignored'> {
  const id = reviewId.toLowerCase();
  if (inFlight.has(id)) return 'ignored';
  inFlight.add(id);
  const send = deps.send ?? reportVenueReview;
  const toast = deps.toast ?? ((message: string) => showToast(message));
  const alert =
    deps.alert ??
    ((message: string) => showDialog({ title: t('common.heads_up'), message, buttons: [{ label: t('common.ok') }] }));
  try {
    const { alreadyReported } = await send(venueId, id, reason);
    toast(t(alreadyReported ? 'venue2.report.already' : 'venue2.report.sent'));
    return alreadyReported ? 'already' : 'sent';
  } catch (error) {
    if (!isCancellation(error)) {
      alert(isProblem(error, 'review_report_own') ? t('venue2.report.own') : errorMessage(error));
    }
    return 'failed';
  } finally {
    inFlight.delete(id);
  }
}
