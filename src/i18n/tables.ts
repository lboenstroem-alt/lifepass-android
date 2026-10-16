// The two dictionaries the app reads: the generated iOS tables with every
// package's Android pack merged on top.
//
// The generated tables (strings.{en,is}.json) are iOS's LPStrings.en and
// LPStrings.is, already merged from the base dictionaries and the health
// packs by scripts/import-ios-strings.py, which refuses a duplicate the way
// the iOS DEBUG build traps on one. The Android packs (./android) go on top
// here with the same rule: a key defined twice is a mistake. In development
// it is logged as an error (a red box on the device); in a member's hands the
// last pack simply wins, as on iOS, because a wrong word beats a crash. The
// tests (__tests__/packs.test.ts) fail on any conflict, so none ships.
import { androidPacks, type RegisteredPack } from './android';
import generatedEn from './strings.en.json';
import generatedIs from './strings.is.json';

export type Lang = 'en' | 'is';

export type Table = Readonly<Record<string, string>>;

/** A key that more than one source defines. */
export type Conflict = {
  readonly lang: Lang;
  readonly key: string;
  /** Who had it first: 'ios' (the generated tables) or a package id. */
  readonly first: string;
  /** The pack that defined it again. */
  readonly second: string;
};

export type MergedTables = {
  readonly en: Table;
  readonly is: Table;
  readonly conflicts: readonly Conflict[];
};

/** Where the generated tables' keys come from, in conflict reports. */
export const IOS_SOURCE = 'ios';

/**
 * Merge Android packs over the generated tables, recording every key that is
 * defined twice (by two packs, or by a pack and the iOS tables).
 */
export function mergeTables(
  generated: { readonly en: Table; readonly is: Table },
  packs: readonly RegisteredPack[],
): MergedTables {
  const conflicts: Conflict[] = [];
  const merge = (lang: Lang): Table => {
    // No prototype: a key like "toString" must read as missing, not as
    // Object.prototype's function.
    const result: Record<string, string> = Object.assign(Object.create(null) as Record<string, string>, generated[lang]);
    const owner = new Map<string, string>(Object.keys(generated[lang]).map((key) => [key, IOS_SOURCE]));
    for (const { id, pack } of packs) {
      for (const [key, value] of Object.entries(pack[lang])) {
        const first = owner.get(key);
        if (first !== undefined) conflicts.push({ lang, key, first, second: id });
        owner.set(key, id);
        result[key] = value;
      }
    }
    return result;
  };
  return { en: merge('en'), is: merge('is'), conflicts };
}

/** The generated iOS tables alone (LPStrings.en / LPStrings.is). */
export const generatedTables: { readonly en: Table; readonly is: Table } = {
  en: generatedEn,
  is: generatedIs,
};

/** The tables `t()` reads. */
export const tables: MergedTables = mergeTables(generatedTables, androidPacks);

if (__DEV__) {
  for (const { lang, key, first, second } of tables.conflicts) {
    console.error(
      `i18n: "${key}" (${lang}) is defined by both ${first} and ${second}; ` +
        'pick another key in the Android pack (src/i18n/android/pack.ts).',
    );
  }
}

/** The keys the generated iOS tables define, for typed call sites. */
export type GeneratedKey = keyof typeof generatedEn;
