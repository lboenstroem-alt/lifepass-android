// The first build's walk-in call, kept only for the first build's check-in
// screen (src/screens/checkin/CheckInScreen.tsx) until CHECKIN-1 replaces it
// with the Scan tab, which runs the whole walk-in through
// src/features/checkin/walkin (preview, consent, guests, pay, refusals).
// QA-1 deletes this file with that screen.
//
// It now rides the parity service (src/features/checkin/walkin/service.ts),
// so it sends what iOS sends (lower-case ids, the long timeout) and reads the
// answer the same way; its own result shape is unchanged.
import { newIdempotencyKey } from '../../api/idempotency';
import { confirmWalkIn } from '../../features/checkin/walkin/service';

// ─── Errors ───────────────────────────────────────────────────────────────────

export type CheckInErrorCode = 'invalid_qr' | 'unknown';

export class CheckInError extends Error {
  code: CheckInErrorCode;
  constructor(code: CheckInErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = 'CheckInError';
  }
}

// ─── Result ───────────────────────────────────────────────────────────────────

/** @deprecated The first build's shape; the walk-in flow reads `WalkInResult` from the parity service. */
export type WalkInResult = {
  checkInId: string;
  venueName: string;
  activityName?: string;
  checkedInAt?: string;
  /** Cap lane the visit counted against (network | pool | surcharge | …). */
  countedAgainst?: string;
};

/**
 * @deprecated `POST /check-ins/walk-in` for the first build's screen. A
 * charge answers `402 charge_consent_required`; the caller re-sends with
 * consent under the SAME key.
 */
export async function walkInCheckIn(
  venueId: string,
  opts?: {
    acceptCharge?: boolean;
    acceptedChargeAmountIsk?: number;
    idempotencyKey?: string;
  },
): Promise<WalkInResult> {
  if (!venueId) {
    throw new CheckInError('invalid_qr', 'Invalid QR code. Please scan a LifePass venue QR code.');
  }
  const result = await confirmWalkIn(
    {
      venueId,
      activityId: null,
      acceptCharge: opts?.acceptCharge === true,
      acceptedChargeAmountIsk: opts?.acceptedChargeAmountIsk ?? null,
    },
    opts?.idempotencyKey ?? newIdempotencyKey(),
  );
  return {
    checkInId: result.checkInId,
    venueName: result.venue?.name ?? 'Venue',
    activityName: result.activity?.name,
    checkedInAt: result.checkedInAt?.toISOString(),
    countedAgainst: result.countedAgainst ?? undefined,
  };
}
