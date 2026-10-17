// Session hooks for the venue page: what this phone must forget when the member
// signs out, claim when they sign in, or flush when the app comes back.
//
// Pre-created by F3 (plan 3.0, rule 7); imported once at startup by
// src/app/registrations.ts. The helpers and their rules are in
// src/app/signOut.ts.
//
// VENUE-1 registers nothing, on purpose: the venue page keeps no state outside
// the screen that shows it. Its venue, prices (resolved for the member who
// asked), classes and reviews live in the screen's own state and go with it
// when sign-out unmounts the signed-in app; nothing is written to storage.
// The favourite heart reads the shared favourites store, whose owner (VENUE-2)
// registers its own cleaner. The reviews (src/features/venue/reviews/**) are
// VENUE-2's too.
export {};
