// Session hooks for Profile (bookings and saved): what this phone must forget when the member
// signs out, claim when they sign in, or flush when the app comes back.
//
// Pre-created by F3 (plan 3.0, rule 7); LIB-1 fills it in. Imported once at
// startup by src/app/registrations.ts, so a hook registered here is in place
// before any sign-in or sign-out can happen. The helpers and their rules are
// in src/app/signOut.ts, for example:
//
//   import { registerSignOutCleaner } from '../../app/signOut';
//
//   registerSignOutCleaner('library.cache', async ({ memberId }) => {
//     await AsyncStorage.removeItem(`library.cache.${memberId}`);
//   });
//
// Nothing is registered yet.
export {};
