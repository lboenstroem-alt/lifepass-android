/* eslint lifepass/no-literal-copy: "error" */
/**
 * SHIM for the screens written before the refusal table (the legacy booking
 * and check-in screens). It answers from `MemberRefusal` (./refusals), in the
 * language on screen; BOOK-1 and CHECKIN-1/2 replace those screens and their
 * calls, and QA-1 deletes this file.
 *
 * A gate refusal is a row the booking preview alone may block on (iOS
 * `BookingViewModel.gateRefusal(forCode:)`: plan, trial and pause gates,
 * caps, already booked, a time that is gone or full, a price the venue never
 * set). Null for everything else (429, 5xx, `invalid_*`, an unknown code, a
 * money state), and the caller shows the error's own message, which is the
 * table's copy for every code the table knows.
 */
import { t } from '../i18n';

import { specificRefusal, type RefusalContext, type RefusalCta } from './refusals';

export type GateRefusal = {
  title: string;
  message: string;
  /** Membership-shaped: the fix is a plan, so offer "View plans". */
  needsMembership: boolean;
  /** The row's one next step, for screens that can take it. */
  cta: RefusalCta | null;
};

/**
 * `context` is where the member is: `checkIn` at the scanner, where the
 * table's check-in rows ("it resets at midnight") and the scanner's alert
 * title (iOS CheckInView: `common.error_title`) apply instead of the
 * booking ones.
 */
export function gateRefusalFor(
  code: string | undefined,
  reason?: string | null,
  status = 409,
  context: RefusalContext = 'general',
): GateRefusal | null {
  if (!code) return null;
  const row = specificRefusal(code, reason, status, context);
  if (!row || !row.blocksAtPreview) return null;
  return {
    title: t(context === 'checkIn' ? 'common.error_title' : 'booking.err.title'),
    message: t(row.messageKey),
    needsMembership: row.cta === 'seePlans',
    cta: row.cta,
  };
}
