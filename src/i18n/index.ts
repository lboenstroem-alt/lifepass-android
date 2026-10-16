// LifePass translation layer: a port of the iOS LPStrings (Localization.swift).
//
// Language follows the member's ACCOUNT preference (profiles.locale), not the
// device, so a tourist with an English phone can still read LifePass in
// Icelandic and vice versa. Before any account language is known (onboarding,
// sign-in, sign-up) the device language decides, reduced to the two the app
// speaks.
//
// The tables are generated from the iOS sources by
// scripts/import-ios-strings.py — never retype iOS copy by hand.
//
//   t('tab.home')                         // "Home" / "Heim"
//   t('checkin.credits_left', { count })  // "{count} credits remaining"
//   tp('account.pass_visits_left', 21)    // Icelandic singular for 21
import { getLocales } from 'expo-localization';
import { create } from 'zustand';

import en from './strings.en.json';
import is from './strings.is.json';

export type Lang = 'en' | 'is';

const tables: Record<Lang, Record<string, string>> = { en, is };

/** The phone's own language, reduced to the two the app speaks. */
export function deviceLanguage(): Lang {
  const first = getLocales()[0]?.languageCode ?? '';
  return first.startsWith('is') ? 'is' : 'en';
}

export function normaliseLang(value: string | null | undefined): Lang {
  return value?.toLowerCase().startsWith('is') ? 'is' : 'en';
}

type LanguageState = { language: Lang; setLanguage: (lang: Lang) => void };

/** The language on screen right now. React code subscribes with `useT()`. */
export const useLanguageStore = create<LanguageState>((set) => ({
  language: deviceLanguage(),
  setLanguage: (language) => set({ language }),
}));

export function currentLanguage(): Lang {
  return useLanguageStore.getState().language;
}

export function setCurrentLanguage(lang: Lang): void {
  if (useLanguageStore.getState().language !== lang) {
    useLanguageStore.getState().setLanguage(lang);
  }
}

export type Params = Record<string, string | number>;

/** Look up a key: is → en → the key itself, so a cell is never blank. */
export function lookup(key: string, lang: Lang): string {
  if (lang === 'is') {
    const translated = tables.is[key];
    if (translated) return translated;
  }
  return tables.en[key] ?? key;
}

function fill(template: string, params?: Params): string {
  if (!params) return template;
  let result = template;
  for (const [name, value] of Object.entries(params)) {
    result = result.split(`{${name}}`).join(String(value));
  }
  return result;
}

/**
 * `.one` or `.many` for a count. Icelandic takes the singular for 1, 21, 31,
 * 101 … but not 11 or 111, which is why every Icelandic `.one` value keeps
 * its `{count}` placeholder.
 */
export function pluralKey(base: string, count: number, lang: Lang): string {
  const n = Math.abs(Math.trunc(count));
  const singular = lang === 'is' ? n % 10 === 1 && n % 100 !== 11 : n === 1;
  return `${base}.${singular ? 'one' : 'many'}`;
}

/** Translate in an explicit language. */
export function translate(key: string, lang: Lang, params?: Params): string {
  return fill(lookup(key, lang), params);
}

/** Translate in the current language (for code outside React). */
export function t(key: string, params?: Params): string {
  return translate(key, currentLanguage(), params);
}

/** Plural-aware translate; `{count}` is filled automatically. */
export function tp(base: string, count: number, params?: Params): string {
  const lang = currentLanguage();
  return translate(pluralKey(base, count, lang), lang, { count, ...params });
}

/** Hook: re-renders when the language changes. */
export function useT() {
  const language = useLanguageStore((s) => s.language);
  return {
    language,
    t: (key: string, params?: Params) => translate(key, language, params),
    tp: (base: string, count: number, params?: Params) =>
      translate(pluralKey(base, count, language), language, { count, ...params }),
  };
}
