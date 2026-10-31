// Session hooks for the Home tab: what this phone must forget when the member
// signs out, claim when they sign in, or flush when the app comes back.
//
// Pre-created by F3 (plan 3.0, rule 7); imported once at startup by
// src/app/registrations.ts.
//
// HOME REGISTERS NOTHING, on purpose:
//   - everything Home shows about the member (the upcoming booking, the
//     profile's name, pass and proof) lives in the screen or in stores that
//     clean up after themselves (the app store, the shared venue list), and
//     the signed-in tabs, Home with them, unmount at sign-out;
//   - Home writes nothing to the phone of its own. The one-time Profile
//     pointer's keys (`nav.profileHint.<profileId>.profileOpened`, written
//     through src/navigation/profile.ts) say only that a member has found
//     Profile, are keyed per member, and stay at sign-out as iOS keeps them;
//   - the weather is Reykjavík's, not the member's.
export {};
