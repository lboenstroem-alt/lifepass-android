// Android-only copy for BOOK-2: Group party and premium rung picker.
//
// Owned by BOOK-2 (plan 3.0.3). Only words iOS never says go here; every
// iOS string comes from the generated tables through t()/tp(). The rules for
// a pack are in ./pack.ts.
//
// iOS draws the party stepper's minus and plus as bare symbols, which
// VoiceOver names on its own. TalkBack reads an icon-only button as
// "unlabelled", so Android gives the two buttons words of their own.
import { definePack } from './pack';

export default definePack({
  en: {
    'book2.party.fewer': 'One person fewer',
    'book2.party.more': 'One person more',
  },
  is: {
    'book2.party.fewer': 'Fækka um einn',
    'book2.party.more': 'Fjölga um einn',
  },
});
