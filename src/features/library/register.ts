// Session hooks for Profile (bookings and saved): what this phone must forget when the member
// signs out, claim when they sign in, or flush when the app comes back.
//
// Pre-created by F3 (plan 3.0, rule 7); LIB-1 fills it in. Imported once at
// startup by src/app/registrations.ts.
//
// NOTHING TO REGISTER, on purpose:
//   - My bookings' lists and cancel keys live in a store per Profile screen
//     (./bookings/myBookings.ts), as iOS keeps them in each LibraryView's
//     view model: they go with the screen, and the signed-in navigator that
//     holds it goes at sign-out.
//   - The saved venues and classes are the one favourites store, which
//     VENUE-2 resets at sign-out (src/features/favourites/register.ts).
//   - The suggestions' venue list is held by the screen or sheet showing it.
// Nothing is written to the phone's storage.
export {};
