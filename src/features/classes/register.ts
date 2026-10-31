// Session hooks for classes discovery: what this phone must forget when the member
// signs out, claim when they sign in, or flush when the app comes back.
//
// Pre-created by F3 (plan 3.0, rule 7); imported once at startup by
// src/app/registrations.ts.
//
// CLASS-1 registers nothing, on purpose: the feed keeps nothing on the phone.
// Its filters and classes live in memory for one visit (they reset per visit,
// as on iOS), the feed is the same for every member (`GET /classes` is public
// and nothing in it is caller-specific), and the member's position is read
// from the location store, never stored here.
export {};
