/**
 * "How was your visit?" (B1, API 0.46.0): about an hour after a check-in,
 * now and then, the app asks for the visit's stars (the server decides when).
 *
 *   <VisitRatingCard />        Home, under the hero: the ask that is due
 *   <VisitRatingSheetHost />   the tabs shell, once: the sheet and its thank-you
 *
 * The rest (./register.ts) runs by itself: a check-in's ask becomes one
 * local notification, a tap opens the sheet (src/app/notificationRouter.ts,
 * route `visit.rating`), and a sign-out forgets everything. The store and
 * its helpers are exported for tests and for the screens above.
 */
export { default as VisitRatingCard } from './VisitRatingCard';
export { default as VisitRatingSheetHost } from './VisitRatingSheet';
export { default as StarRating, adjustedStars, tappedStars } from './StarRating';
export {
  answerInput,
  canSend,
  clampStars,
  createVisitRatingStore,
  defaultVisitRatingDeps,
  INITIAL_VISIT_RATING_STATE,
  visitRatingStore,
  type SheetPhase,
  type StarRow,
  type VisitRatingActions,
  type VisitRatingDeps,
  type VisitRatingSheetState,
  type VisitRatingState,
  type VisitRatingStore,
} from './store';
export {
  cancelAllVisitRatingNotifications,
  cancelVisitRatingNotification,
  removeLapsedVisitRatingNotifications,
  scheduleVisitRatingNotification,
  VISIT_RATING_NOTIFICATION_PREFIX,
  VISIT_RATING_ROUTE,
  visitRatingNotificationContent,
  visitRatingNotificationId,
  type VisitRatingNotificationDeps,
} from './notifications';
export { useVisitRating, visitRatingActions } from './useVisitRating';
