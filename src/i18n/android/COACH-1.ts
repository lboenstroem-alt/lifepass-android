// Android-only copy for COACH-1: Coach chat core (shell, chat, free tier, persistence, voice, entries).
//
// Owned by COACH-1 (plan 3.0.3). Only words iOS never says go here; every
// iOS string comes from the generated tables through t()/tp(). The rules for
// a pack are in ./pack.ts.
//
// - `coach.android.a11y.*`: what TalkBack says for controls iOS draws as bare
//   SF Symbols, which VoiceOver names from the symbol (the burger, a card's
//   heart, the category strip's chevrons). Android icons have no such names.
// - `coach.android.voice_unavailable`: a phone with no speech recognition
//   service at all (iOS always has one), so the mic never sits there dead.
import { definePack } from './pack';

export default definePack({
  en: {
    'coach.android.a11y.menu': 'Open menu',
    'coach.android.a11y.favourite': 'Save to favourites',
    'coach.android.a11y.strip_back': 'Earlier categories',
    'coach.android.a11y.strip_more': 'More categories',
    'coach.android.voice_unavailable': "Voice input isn't available on this phone.",
  },
  is: {
    'coach.android.a11y.menu': 'Opna valmynd',
    'coach.android.a11y.favourite': 'Vista í uppáhald',
    'coach.android.a11y.strip_back': 'Fyrri flokkar',
    'coach.android.a11y.strip_more': 'Fleiri flokkar',
    'coach.android.voice_unavailable': 'Talinnsláttur er ekki í boði í þessum síma.',
  },
});
