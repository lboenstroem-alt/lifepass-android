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
//   - Home writes two things to the phone, both keyed per member, saying only
//     what the member did, and both stay at sign-out as iOS keeps them: the
//     one-time Profile pointer's keys (`nav.profileHint.<profileId>.
//     profileOpened`, written through src/navigation/profile.ts: the member
//     has found Profile), and the offers card's No thanks
//     (`offers.card.<profileId>.dismissed`, ./offersCard/storage.ts: the
//     member does not want to be asked; the account keeps it too). What the
//     card answered this session lives in Home, which unmounts at sign-out;
//   - the weather is Reykjavík's, not the member's.
export {};
