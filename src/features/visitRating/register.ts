/**
 * The visit rating's session hooks (loaded at startup with every feature's
 * register file, src/app/registrations.ts):
 *
 * - A CHECK-IN that reserved an ask (the walk-in's answer, or a walk-in
 *   paid on the hosted page, through src/checkin/checkInFacts): its one
 *   local notification, for a member who already allows notifications
 *   (./notifications.ts). Never after a sign-out.
 * - EVERY ACTIVATION (the first profile read of a sign-in, each return to
 *   the foreground): the card may ask the server again (once per
 *   foreground, ./store.ts), and a notification whose ask has lapsed leaves
 *   the shade.
 * - SIGN-OUT: the card, the sheet and every visit rating notification go,
 *   pending or in the shade, whatever the permission: the next member on
 *   the phone must never be asked about someone else's visit.
 */
import { registerActivationHook, registerSignOutCleaner } from '../../app/signOut';
import { onCheckInFacts } from '../../checkin/checkInFacts';
import { useAppStore } from '../../stores/appStore';

import {
  cancelAllVisitRatingNotifications,
  removeLapsedVisitRatingNotifications,
  scheduleVisitRatingNotification,
} from './notifications';
import { visitRatingStore } from './store';

onCheckInFacts('visitRating.notification', ({ ratingPrompt }) => {
  if (!ratingPrompt || !useAppStore.getState().isAuthenticated) return;
  void scheduleVisitRatingNotification(ratingPrompt);
});

registerActivationHook('visitRating', () => {
  visitRatingStore.getState().noteForeground();
  void removeLapsedVisitRatingNotifications();
});

registerSignOutCleaner('visitRating', async () => {
  visitRatingStore.getState().reset();
  await cancelAllVisitRatingNotifications();
});
