// Session hooks for sights and trails: what this phone must forget when the member
// signs out, claim when they sign in, or flush when the app comes back.
//
// Pre-created by F3 (plan 3.0, rule 7); ATTR-1 owns it. Imported once at
// startup by src/app/registrations.ts.
//
// Nothing to register. The sights are public, anonymous data, the same for
// every caller: the marker feed (./markersStore.ts) is held in memory only,
// as on iOS, holds nothing about the member, and is never written to the
// phone's storage. The card reads its sight afresh each time it opens.
export {};
