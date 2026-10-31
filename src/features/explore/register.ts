// Session hooks for Explore: what this phone must forget when the member
// signs out.
//
// Imported once at startup by src/app/registrations.ts, so the cleaner is in
// place before any sign-in or sign-out can happen (src/app/signOut.ts).
//
// Explore's venue list holds prices resolved for the member who asked (a
// member or pass price), so it goes with them, along with a search still on
// its way; the next member's list is their own. The Map/List emphasis
// (`explore.mapToggleHinted`) stays: it is about the phone, not the account
// (iOS @AppStorage).
import { registerSignOutCleaner } from '../../app/signOut';
import { exploreVenues } from './exploreVenues';

registerSignOutCleaner('explore.venues', () => exploreVenues.reset());
