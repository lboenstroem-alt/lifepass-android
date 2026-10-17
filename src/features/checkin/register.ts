// Session hooks for the Scan tab, check-in links and the walk-in flow: what this phone must forget when the member
// signs out, claim when they sign in, or flush when the app comes back.
//
// Pre-created by F3 (plan 3.0, rule 7); CHECKIN-1 fills it in. Imported once at
// startup by src/app/registrations.ts, so a hook registered here is in place
// before any sign-in or sign-out can happen. The helpers and their rules are
// in src/app/signOut.ts, for example:
//
//   import { registerSignOutCleaner } from '../../app/signOut';
//
//   registerSignOutCleaner('checkin.cache', async ({ memberId }) => {
//     await AsyncStorage.removeItem(`checkin.cache.${memberId}`);
//   });
//
// Nothing is registered yet.
export {};
