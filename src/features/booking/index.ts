/**
 * The booking core's public surface (BOOK-1), for the class sheet (CLASS-2)
 * and anything else that books: one session per screen, the confirm step's
 * charge section, the outcome dialogs, and the copy behind them.
 *
 *   const store = useNewBookingSession();
 *   await store.getState().prepare(occurrence);      // the class sheet
 *   const steps = useBookingRefusalSteps(store, { onOtherTimes });
 *   <BookingChargeSection store={store} offers={steps.offers} onStep={steps.take} />
 *   <BookingOutcomeHost store={store} onClose={close} offers={steps.offers} onStep={steps.take} />
 *
 * The flow itself is the `BookingFlow` route (./BookingFlowScreen.tsx).
 */
export {
  bookingInProgress,
  buildInput,
  canConfirmOccurrence,
  classRefusal,
  confirmChargeIsk,
  createBookingSession,
  DECLINED_ATTEMPT_CODES,
  disclosedPriceIsk,
  GATEWAY_GAVE_UP_STATUSES,
  gateRefusalForCode,
  groupBookable,
  guestAgeBandsForRequest,
  hasSelection,
  needsMembership,
  occurrenceEnd,
  occurrenceStart,
  occurrenceStatusFor,
  PRICE_MOVED_CODES,
  rechecksAfterStep,
  refusalGoesInline,
  selectedStart,
  selectedVisitChoice,
  selectedVisitOption,
  showsAgeBands,
  usesClasses,
  visitChoiceOptions,
  type BookingActivity,
  type BookingOccurrence,
  type BookingSession,
  type BookingSessionActions,
  type BookingSessionDeps,
  type BookingSessionState,
  type BookingSessionStore,
  type BookingStep,
  type BookingVenue,
  type CreateBookingSessionOptions,
  type GateRefusal,
  type OccurrenceSnapshot,
  type OccurrenceStatus,
} from './bookingSession';
export { bandLabelKey, bookingCopy, isNotOpenReason, type BookingCopy, type ConsentContext } from './bookingCopy';
export {
  bookingScreenTakes,
  useBooking,
  useBookingRefusalSteps,
  useNewBookingSession,
  type BookingRefusalStepOptions,
} from './useBookingSession';
export {
  default as BookingChargeSection,
  BookingDisclosureNote,
  BookingGateRefusalPanel,
} from './components/BookingChargeSection';
export { default as BookingOutcomeHost, outcomeDialog } from './components/BookingOutcomeHost';
