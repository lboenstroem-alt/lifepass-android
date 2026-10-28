// Android-only copy for MEAL-3: Photo scan and barcode.
//
// Owned by MEAL-3 (plan 3.0.3). Only words iOS never says go here; every
// iOS string comes from the generated tables through t()/tp(). The rules for
// a pack are in ./pack.ts.
//
// Empty on purpose: everything Photo and Barcode modes, the error cards, the
// typed sheet and the barcode result sheet say is iOS's own (meal.photo.*,
// meal.barcode.*, food.*, a11y.take_photo, health.retry, common.*). The
// example barcode in the typed field (5690000000000) is a number, not copy.
import { definePack } from './pack';

export default definePack({
  en: {},
  is: {},
});
