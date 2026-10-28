// Android-only copy for MEAL-2: Meal capture page, search, presets and quick add, create food, Scan-tab entry.
//
// Owned by MEAL-2 (plan 3.0.3). Only words iOS never says go here; every
// iOS string comes from the generated tables through t()/tp(). The rules for
// a pack are in ./pack.ts.
//
// Empty on purpose: every word the meal page, Search, the preset, Quick add
// and Create my food sheets and the Scan tab's entry say is iOS's own
// (meal.*, food.*, scan.meal.*, a11y.*, common.*, health.*). The unit signs
// iOS writes as literals ("kcal", "g") are the same in both languages and
// are passed as a component's `unit`, as Body's fields do.
import { definePack } from './pack';

export default definePack({
  en: {},
  is: {},
});
