// Android-only copy for VENUE-1: Venue page by slug.
//
// Owned by VENUE-1 (plan 3.0.3). Only words iOS never says go here; every
// iOS string comes from the generated tables through t()/tp(). The rules for
// a pack are in ./pack.ts.
//
// - `venue.page.maps_other`: the directions dialog's second answer. iOS
//   offers Apple Maps beside Google Maps; Android has no Apple Maps, so the
//   second answer hands the venue to whichever maps app the member uses
//   (a `geo:` link, plan 5.6).
// - `venue.page.a11y_*`: what TalkBack says for the hero's round buttons.
//   iOS draws them as bare SF Symbols, which VoiceOver names from the symbol
//   ("Back", "Love", "Share"); Android icons have no such names.
import { definePack } from './pack';

export default definePack({
  en: {
    'venue.page.maps_other': 'Open in another app',
    'venue.page.a11y_favourite': 'Save to favourites',
    'venue.page.a11y_share': 'Share',
  },
  is: {
    'venue.page.maps_other': 'Opna í öðru forriti',
    'venue.page.a11y_favourite': 'Vista í uppáhald',
    'venue.page.a11y_share': 'Deila',
  },
});
