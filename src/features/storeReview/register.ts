/**
 * The Google Play rating ask's session hook: the check-in moment (the member
 * left a check-in's success screen, reported through
 * src/checkin/checkInFacts). The visit rating's moment (a 4 or 5 star
 * thank-you closed) is asked by src/features/visitRating itself. Loaded at
 * startup with every feature's register file (src/app/registrations.ts).
 *
 * Nothing is wiped at sign-out: when this phone last asked is kept per
 * account, so signing out and in never makes the app ask again sooner.
 */
import { onCheckInProofClosed } from '../../checkin/checkInFacts';

import { askForStoreReview } from './storeReview';

onCheckInProofClosed('storeReview', ({ lifetimeCheckIns }) => {
  void askForStoreReview({ kind: 'checkIn', lifetimeCheckIns });
});
