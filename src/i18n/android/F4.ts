// Android-only copy for F4: Navigation shell, routes, slots, intents, deep links, notification routing, back guards.
//
// Owned by F4 (plan 3.0.3). Only words iOS never says go here; every
// iOS string comes from the generated tables through t()/tp(). The rules for
// a pack are in ./pack.ts.
import { definePack } from './pack';

export default definePack({
  en: {
    // A screen whose package has not landed yet, in DEVELOPMENT builds only
    // (src/navigation/stubs.tsx). A release build shows nothing there, and
    // REL-1 checks that no such screen ships.
    'nav.stub.not_in_build': 'Not in this build yet',
  },
  is: {
    'nav.stub.not_in_build': 'Ekki komið í þessa útgáfu',
  },
});
