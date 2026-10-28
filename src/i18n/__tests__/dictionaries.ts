// The dictionaries the copy-rule tests walk, rebuilt the way iOS keeps them:
// the base dictionary, the health packs (LPHealthStrings.packsEN/IS) and, on
// Android, every package's Android pack. Values come from the merged tables;
// which dictionary owns a key comes from strings.manifest.json, written by
// scripts/import-ios-strings.py next to the tables.
import { androidPacks } from '../android';
import manifest from '../strings.manifest.json';
import { generatedTables, tables, type Lang } from '../tables';

export type Dictionary = {
  /** 'base', an iOS health pack's name, or an Android package id. */
  readonly name: string;
  readonly source: 'ios' | 'android';
  readonly en: Readonly<Record<string, string>>;
  readonly is: Readonly<Record<string, string>>;
};

export const LANGS: readonly Lang[] = ['en', 'is'];

/** The keys a pack may deliberately replace in the base (iOS intentionalOverrides). */
export const intentionalOverrides: ReadonlySet<string> = new Set(manifest.intentionalOverrides);

function iosDictionary(entry: (typeof manifest.dictionaries)[number]): Dictionary {
  const pick = (lang: Lang, only: readonly string[]) => {
    const values: Record<string, string> = {};
    for (const key of [...entry.keys, ...only]) {
      // The base's own value of an overridden key is not shipped (the pack's
      // is); leave it out rather than test a value no member sees.
      if (entry.name === 'base' && intentionalOverrides.has(key)) continue;
      const value = generatedTables[lang][key];
      if (value !== undefined) values[key] = value;
    }
    return values;
  };
  return { name: entry.name, source: 'ios', en: pick('en', entry.enOnly), is: pick('is', entry.isOnly) };
}

/** iOS's base dictionaries (LPStrings.baseEN / baseIS). */
export const baseDictionary: Dictionary = iosDictionary(manifest.dictionaries.find((d) => d.name === 'base')!);

/** iOS's health packs, in merge order (LPHealthStrings.packsEN / packsIS). */
export const healthPacks: readonly Dictionary[] = manifest.dictionaries
  .filter((d) => d.name !== 'base')
  .map(iosDictionary);

/** Every package's Android pack, in registry order. */
export const androidDictionaries: readonly Dictionary[] = androidPacks.map(({ id, pack }) => ({
  name: id,
  source: 'android',
  en: pack.en,
  is: pack.is,
}));

/**
 * The packs the iOS "health string" rules walk, plus the Android packs, which
 * keep the same rules (no dash, no emoji, both languages).
 */
export const rulePacks: readonly Dictionary[] = [...healthPacks, ...androidDictionaries];

/** iOS `LPStrings.preReleaseKeys`: every base key. */
export const preReleaseKeys: ReadonlySet<string> = new Set([
  ...manifest.dictionaries.find((d) => d.name === 'base')!.keys,
]);

/** Every health pack merged, first pack winning (the iOS tests' reduce). */
export function mergedHealth(lang: Lang): Readonly<Record<string, string>> {
  const result: Record<string, string> = {};
  for (const pack of healthPacks) {
    for (const [key, value] of Object.entries(pack[lang])) {
      if (!(key in result)) result[key] = value;
    }
  }
  return result;
}

/** The tables the app reads (LPStrings.en / LPStrings.is, plus the Android packs). */
export const app = tables;

/** Each value of a dictionary with a label for failure messages: "key (en)". */
export function valuesOf(dictionary: Dictionary): { label: string; key: string; lang: Lang; value: string }[] {
  return LANGS.flatMap((lang) =>
    Object.entries(dictionary[lang]).map(([key, value]) => ({ label: `${dictionary.name} ${key} (${lang})`, key, lang, value })),
  );
}

export const EM_DASH = '—';
export const EN_DASH = '–';

export function hasDash(value: string): boolean {
  return value.includes(EM_DASH) || value.includes(EN_DASH);
}

/** Swift's `unicodeScalars.contains { $0.properties.isEmojiPresentation }`. */
export function hasEmoji(value: string): boolean {
  return /\p{Emoji_Presentation}/u.test(value);
}

/** The `{name}` placeholders in a value, sorted. */
export function placeholders(value: string): string[] {
  return (value.match(/\{[A-Za-z_][A-Za-z0-9_]*\}/g) ?? []).sort();
}
