// Android-only copy for LIB-1: Profile (Library): bookings, cancel, saved.
//
// Owned by LIB-1 (plan 3.0.3). Only words iOS never says go here; every
// iOS string comes from the generated tables through t()/tp(). The rules for
// a pack are in ./pack.ts.
//
// - lib1.a11y.*  what TalkBack says for the hearts on the Saved lists, where
//   iOS draws an SF Symbol that VoiceOver reads by its image name: the
//   suggestion's heart (save) and, Android only (owner decision D4), the
//   saved row's heart (unsave).
import { definePack } from './pack';

export default definePack({
  en: {
    'lib1.a11y.save_venue': 'Save {name}',
    'lib1.a11y.unsave_venue': 'Remove {name} from saved',
  },
  is: {
    'lib1.a11y.save_venue': 'Vista {name}',
    'lib1.a11y.unsave_venue': 'Fjarlægja {name} úr vistuðu',
  },
});
