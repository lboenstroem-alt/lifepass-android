// The Android pack registry (src/i18n/android): one pack per package, all of
// them merged, and no key defined twice. The iOS twin is LocalizationKeyTests'
// testNoHealthKeyCollidesWithAPreReleaseKey and testNoKeyIsDefinedByTwoPacks,
// which guard LPHealthStrings.merged.
import fs from 'fs';
import path from 'path';

import { androidPacks, definePack } from '../android';
import { generatedTables, IOS_SOURCE, mergeTables, tables } from '../tables';
import { androidDictionaries, hasDash, hasEmoji, LANGS, placeholders } from './dictionaries';

/**
 * Every package with copy of its own: the foundation after F1 (F2 to F8) and
 * every feature package in plan section 4. Health Connect (HC-1, HC-2) is not
 * built (owner decision), so it has no pack.
 */
const PACKAGE_IDS = [
  'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8',
  'AUTH-1', 'AUTH-2', 'AUTH-3', 'HOME-1', 'EXPL-1', 'VENUE-1', 'VENUE-2', 'CHECKIN-1', 'CHECKIN-2',
  'BOOK-1', 'CLASS-1', 'PLANS-1', 'ACCT-1', 'ACCT-2', 'ACCT-3', 'ACCT-4', 'COACH-1', 'PLAN-1',
  'EXPL-2', 'BOOK-2', 'CLASS-2', 'LIB-1', 'PLANS-2', 'COACH-2', 'PLAN-2', 'PLAN-4', 'PLAN-5',
  'BODY-1', 'BODY-2', 'RUN-1', 'MEAL-1', 'ATTR-1', 'FEED-1',
  'PLAN-3', 'RUN-2', 'RUN-3', 'MEAL-2', 'MEAL-3', 'MEAL-4', 'MEAL-5', 'COACH-3', 'COACH-4', 'COACH-5',
  'ATTR-2', 'NOTIF-1', 'NOTIF-2',
  'QA-1', 'REL-1',
];

const PACK_DIR = path.join(__dirname, '..', 'android');

describe('the registry', () => {
  it('registers one pack per package, in plan order', () => {
    expect(androidPacks.map((p) => p.id)).toEqual(PACKAGE_IDS);
  });

  it('has a file for every registered pack and registers every pack file', () => {
    const files = fs
      .readdirSync(PACK_DIR)
      .filter((file) => file.endsWith('.ts') && file !== 'index.ts' && file !== 'pack.ts')
      .map((file) => file.replace(/\.ts$/, ''))
      .sort();
    expect(files).toEqual([...PACKAGE_IDS].sort());
  });

  it('gives no Health Connect package a pack', () => {
    expect(androidPacks.some((p) => p.id.startsWith('HC-'))).toBe(false);
  });
});

describe('merging the packs over the generated tables', () => {
  const generated = { en: { 'tab.home': 'Home' }, is: { 'tab.home': 'Heim' } };

  it('adds each pack’s keys in both languages', () => {
    const merged = mergeTables(generated, [
      { id: 'HOME-1', pack: definePack({ en: { 'home.android': 'Android' }, is: { 'home.android': 'Android-sími' } }) },
    ]);
    expect(merged.conflicts).toEqual([]);
    expect(merged.en).toEqual({ 'tab.home': 'Home', 'home.android': 'Android' });
    expect(merged.is).toEqual({ 'tab.home': 'Heim', 'home.android': 'Android-sími' });
  });

  it('reports a pack key the iOS tables already have, and lets the pack win as iOS does in release', () => {
    const merged = mergeTables(generated, [
      { id: 'HOME-1', pack: definePack({ en: { 'tab.home': 'Start' }, is: { 'tab.home': 'Byrja' } }) },
    ]);
    expect(merged.conflicts).toEqual([
      { lang: 'en', key: 'tab.home', first: IOS_SOURCE, second: 'HOME-1' },
      { lang: 'is', key: 'tab.home', first: IOS_SOURCE, second: 'HOME-1' },
    ]);
    expect(merged.en['tab.home']).toBe('Start');
  });

  it('reports a key two packs define', () => {
    const merged = mergeTables(generated, [
      { id: 'MEAL-2', pack: definePack({ en: { 'meal.x': 'A' }, is: { 'meal.x': 'A' } }) },
      { id: 'MEAL-3', pack: definePack({ en: { 'meal.x': 'B' }, is: { 'meal.x': 'B' } }) },
    ]);
    expect(merged.conflicts.map((c) => [c.key, c.first, c.second])).toEqual([
      ['meal.x', 'MEAL-2', 'MEAL-3'],
      ['meal.x', 'MEAL-2', 'MEAL-3'],
    ]);
  });

  it('has no conflict in the tables the app ships', () => {
    expect(tables.conflicts).toEqual([]);
  });

  it('ships every generated key unchanged', () => {
    for (const lang of LANGS) {
      for (const [key, value] of Object.entries(generatedTables[lang])) {
        if (tables[lang][key] !== value) throw new Error(`${key} (${lang}) changed in the merge`);
      }
    }
  });
});

describe('every Android pack keeps the copy rules', () => {
  it.each(androidDictionaries.map((d) => [d.name, d] as const))('%s', (_name, pack) => {
    // Every key in both languages (definePack also refuses this at compile time).
    expect(Object.keys(pack.is).sort()).toEqual(Object.keys(pack.en).sort());
    for (const lang of LANGS) {
      for (const [key, value] of Object.entries(pack[lang])) {
        const label = `${pack.name} ${key} (${lang}): ${value}`;
        expect([label, value.trim().length > 0]).toEqual([label, true]);
        expect([label, hasDash(value)]).toEqual([label, false]);
        expect([label, hasEmoji(value)]).toEqual([label, false]);
      }
    }
    for (const key of Object.keys(pack.en)) {
      expect([key, placeholders(pack.is[key] ?? '')]).toEqual([key, placeholders(pack.en[key]!)]);
    }
  });
});
