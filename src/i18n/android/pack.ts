// The shape of an Android pack: one package's Android-only copy.
//
// WHY PACKS. The iOS strings are generated (scripts/import-ios-strings.py)
// and nobody edits them. Android still needs a few words iOS never says:
// Google Play, Custom Tabs, permission rationales, the neutral line where
// iOS names Apple Health. Each package writes those in its OWN file,
// src/i18n/android/<package-id>.ts, so forty packages adding copy in the
// same weeks never edit one shared dictionary. The registry
// (src/i18n/android/index.ts) merges them over the generated tables and the
// tests refuse a key defined twice, the way iOS's LPHealthStrings.merged
// traps in DEBUG.
//
// The rules every pack keeps (src/i18n/__tests__/copyRules.test.ts):
// - every key in BOTH languages, Icelandic written natively, not word for
//   word from the English;
// - no em dash and no en dash (ranges are written "to" / "til"), no emoji;
// - the same {placeholders} in both languages (an Icelandic `.one` keeps every
//   placeholder of its `.many`, since Icelandic 21 is singular, and adds none
//   that neither English form has);
// - never a key the generated iOS tables already have (pick a new key; the
//   iOS copy is changed in iOS and regenerated, not overridden here, or,
//   when Android ships the iOS change first, in src/i18n/ahead-of-ios.json).

/** One language's strings in a pack. */
export type PackTable = Readonly<Record<string, string>>;

/** A pack: the same keys in English and Icelandic. */
export type AndroidPack = {
  readonly en: PackTable;
  readonly is: PackTable;
};

/**
 * Declare a pack.
 *
 * `K` is inferred from BOTH tables, so a key written in one language only is
 * a type error (`npx tsc`), before any test runs:
 *
 *   export default definePack({
 *     en: { 'hc.title': 'Health Connect' },
 *     is: { 'hc.title': 'Health Connect' },
 *   });
 */
export function definePack<K extends string>(pack: {
  readonly en: Readonly<Record<K, string>>;
  readonly is: Readonly<Record<K, string>>;
}): AndroidPack {
  return pack;
}
