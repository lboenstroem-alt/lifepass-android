// @f4-stub (plan 3.0.3): the staff-facing check-in proof, filled by CHECKIN-1; used by CHECKIN-2 (success after pay).
//
// iOS `CheckInProofDisplay`: when, where, the member's short name (already
// shortened by the server, "Lucas B."), the class or the caller's word for a
// walk-in, the confirmation code, the guest party, the visits left, a hint
// for reception, and the check mark (the live screen's pulsing one, or the
// re-offered proof's still seal).
// Keep the default export and its props; replace the body (and this marker).
// Renders nothing until CHECKIN-1 lands.
import type { ReactNode } from 'react';

import type { CheckInParty } from '../../../api/profile';

export interface CheckInProofDisplayProps {
  /** When the check-in happened, as the server recorded it. */
  readonly checkedInAt: Date;
  readonly venueName: string | null;
  /** Already shortened by the server; null shows no name. */
  readonly memberShortName: string | null;
  /** The booked class, or the caller's own word for a plain walk-in; null prints nothing. */
  readonly activityName: string | null;
  /** The short confirmation code, on screens that hold a check-in id. */
  readonly confirmationCode: string | null;
  /** The guest party this scan admitted. */
  readonly party: CheckInParty | null;
  /** What the pass or month has left after this visit (the live success screen only). */
  readonly balance?: string | null;
  /** "Show this screen to the staff at reception", where it is wanted. */
  readonly hint: string | null;
  /** The check mark. */
  readonly mark: ReactNode;
}

export default function CheckInProofDisplay(_props: CheckInProofDisplayProps) {
  return null;
}
