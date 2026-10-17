// Session hooks for the workout runner: what this phone must forget when the member
// signs out, claim when they sign in, or flush when the app comes back.
//
// Pre-created by F3 (plan 3.0, rule 7); RUN-1 fills it in. Imported once at
// startup by src/app/registrations.ts, so a hook registered here is in place
// before any sign-in or sign-out can happen. The helpers and their rules are
// in src/app/signOut.ts, for example:
//
//   import { registerSignOutCleaner } from '../../app/signOut';
//
//   registerSignOutCleaner('runner.cache', async ({ memberId }) => {
//     await AsyncStorage.removeItem(`runner.cache.${memberId}`);
//   });
//
// Nothing is registered yet.
export {};
