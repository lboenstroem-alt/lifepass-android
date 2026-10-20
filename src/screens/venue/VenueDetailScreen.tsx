// The first build's venue page lived here; it is now
// src/features/venue/VenueDetailScreen.tsx (VENUE-1, plan 3.0.1), which loads
// by slug through the API and reads no Supabase table.
//
// This path stays only because the app shell's tests still mock it by this
// name (src/app/__tests__/appRoot.test.tsx and
// src/navigation/__tests__/rootModals.test.tsx); QA-1 deletes it with the
// other legacy paths.
export { default } from '../../features/venue/VenueDetailScreen';
