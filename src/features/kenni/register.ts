// Session hooks for Kenni eID: what this phone must forget when the member
// signs out. Imported once at startup by src/app/registrations.ts, so every
// hook is in place before any sign-in or sign-out can happen.
//
// - An open sheet request is forgotten, without calling its opener
//   (./sheetRequests.ts registers that cleaner when it loads; importing it
//   here loads it at startup, not first when the tabs mount).
// - A parked redirect that came without its tab (./callbackLink.ts), and the
//   in-flight record that would let one be completed (./roundTrip.ts): both
//   are the member's (the state is bound to their profile).
// - Nothing else is stored per member. `kennitalaPromptDismissed` is per
//   PHONE, as on iOS (the nudge fires at most once per device), and is F3's
//   (src/stores/appStore.ts); a sign-out clears the armed nudge itself.
import './sheetRequests';
import './callbackLink';
import './roundTrip';

export {};
