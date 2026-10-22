/**
 * Photo mode (MEAL-3): the meal page's `PhotoMode` slot, the scan
 * coordinator that outlives the page, and the photo error cards.
 */
export { default as PhotoCaptureMode, photoErrorForEncoding, setPhotoEncoderForTests, TipCard, type PhotoPhase } from './PhotoCaptureMode';
export {
  cancelMealScan,
  isKeptGoing,
  keepGoingWithScan,
  noteScansLeft,
  resetMealScanCoordinator,
  scanMealPhoto,
  scansLeftToday,
  SCAN_CANCEL_WINDOW_MS,
  SCAN_READY_TOAST_MS,
  useScansLeftToday,
  type MealScanOutcome,
} from './scanCoordinator';
export {
  photoErrorActionKey,
  photoErrorActions,
  photoErrorCopyKey,
  photoErrorFor,
  photoErrorOutcome,
  showsRetryCost,
  type MealPhotoError,
  type PhotoErrorAction,
} from './photoErrors';
export { photoGuideRect } from './guideLayout';
