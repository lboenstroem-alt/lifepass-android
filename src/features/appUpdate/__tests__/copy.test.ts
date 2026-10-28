// The update prompt's words are iOS's (LifePass 2/Services/Localization.swift,
// `update.*`, from 3.1.0). Android still reads them from its own pack
// (src/i18n/android/UPDATE-1.ts, `appupdate.*`), written before the tables had
// iOS's keys. This holds each pack word to the iOS word it repeats, in both
// languages, so a change on one side shows here until the pack's duplicates
// are deleted and the host reads the iOS keys.
import UPDATE_1 from '../../../i18n/android/UPDATE-1';
import { generatedTables, type Lang } from '../../../i18n/tables';

/** Android pack key -> the iOS key with the same words. */
const SAME_WORDS: readonly (readonly [string, string])[] = [
  ['appupdate.available.title', 'update.available_title'],
  ['appupdate.available.body', 'update.available_body'],
  ['appupdate.update', 'update.cta'],
  ['appupdate.not_now', 'update.not_now'],
  ['appupdate.required.title', 'update.required_title'],
  ['appupdate.required.body', 'update.required_body'],
];

const LANGS: readonly Lang[] = ['en', 'is'];

describe('the update prompt copy', () => {
  it.each(LANGS)('says what iOS says (%s)', (lang) => {
    for (const [android, ios] of SAME_WORDS) {
      expect([android, UPDATE_1[lang][android]]).toEqual([android, generatedTables[lang][ios]]);
    }
  });

  it('keeps only the Google Play line as Android-only words', () => {
    const repeated = new Set(SAME_WORDS.map(([android]) => android));
    for (const lang of LANGS) {
      expect(Object.keys(UPDATE_1[lang]).filter((key) => !repeated.has(key))).toEqual(['appupdate.store_failed']);
    }
  });
});
