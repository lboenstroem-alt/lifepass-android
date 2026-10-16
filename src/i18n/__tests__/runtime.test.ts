// The runtime: iOS LPStrings (lookup, interpolation, plurals) and the
// language the app speaks. Ports LocalizationPluralTests and the lookup half
// of LocalizationKeyTests.
import { act, renderHook } from '@testing-library/react-native';

import {
  currentLanguage,
  ENGLISH_RULE_PLURALS,
  fill,
  hasKey,
  lookup,
  normaliseLang,
  pluralKey,
  setCurrentLanguage,
  t,
  tp,
  translate,
  translatePlural,
  useLanguageStore,
  useT,
  type Lang,
} from '..';

// The language is shared module state; every test starts from English
// whatever ran before it (or was filtered out with -t).
beforeEach(() => setCurrentLanguage('en'));

describe('lookup (LPStrings.lookup)', () => {
  it('falls back is → en → the key, so a cell is never blank', () => {
    expect(lookup('tab.home', 'en')).toBe('Home');
    expect(lookup('tab.home', 'is')).toBe('Heim');
    expect(lookup('no.such.key', 'en')).toBe('no.such.key');
    expect(lookup('no.such.key', 'is')).toBe('no.such.key');
  });

  it('carries the packs merged over the base (testMergedDictionariesCarryThePacks)', () => {
    expect(lookup('tab.plan', 'en')).toBe('Plan');
    expect(lookup('tab.plan', 'is')).toBe('Áætlun');
    expect(lookup('health.estimate', 'is')).toBe('Áætlað');
    expect(lookup('tab.home', 'en')).toBe('Home');
  });

  it('reads English for any language it does not speak', () => {
    expect(lookup('tab.home', 'de' as Lang)).toBe('Home');
  });

  it('knows which keys exist', () => {
    expect(hasKey('tab.home')).toBe(true);
    expect(hasKey('no.such.key')).toBe(false);
    // Nothing on Object.prototype is a key.
    expect(hasKey('toString')).toBe(false);
    expect(lookup('constructor', 'is')).toBe('constructor');
  });
});

describe('interpolation', () => {
  it('fills every {name}, every time it appears, and leaves unknown ones', () => {
    expect(fill('{a} and {a}, not {b}', { a: 1 })).toBe('1 and 1, not {b}');
    expect(fill('no params')).toBe('no params');
    expect(translate('food.search.empty', 'en', { query: 'skyr' })).toBe('No matches for “skyr”');
  });
});

describe('pluralKey (LocalizationPluralTests)', () => {
  it('takes the English singular only for 1', () => {
    expect([1, 11, 21, 111, 0].map((n) => pluralKey('plan.meals', n, 'en'))).toEqual([
      'plan.meals.one',
      'plan.meals.many',
      'plan.meals.many',
      'plan.meals.many',
      'plan.meals.many',
    ]);
  });

  it('takes the Icelandic singular for 1, 21 and 101 but not 11 or 111', () => {
    expect([1, 11, 21, 111, 101, 0].map((n) => pluralKey('plan.meals', n, 'is'))).toEqual([
      'plan.meals.one',
      'plan.meals.many',
      'plan.meals.one',
      'plan.meals.many',
      'plan.meals.one',
      'plan.meals.many',
    ]);
    expect(pluralKey('x', -21, 'is')).toBe('x.one');
    expect(pluralKey('x', 31, 'is')).toBe('x.one');
  });

  it('uses the English rule for an unknown language (testUnknownLanguageUsesTheEnglishRule)', () => {
    expect(pluralKey('plan.meals', 21, 'de' as Lang)).toBe('plan.meals.many');
  });

  it('has both forms of the deleted feedback count (testTheDeletedFeedbackCountHasBothForms)', () => {
    for (const lang of ['en', 'is'] as const) {
      for (const form of ['one', 'many']) {
        const key = `bodygoals.deleted.feedback.${form}`;
        expect(lookup(key, lang)).not.toBe(key);
      }
    }
    expect(pluralKey('bodygoals.deleted.feedback', 1, 'en')).toBe('bodygoals.deleted.feedback.one');
    expect(pluralKey('bodygoals.deleted.feedback', 21, 'is')).toBe('bodygoals.deleted.feedback.one');
    expect(fill(lookup('bodygoals.deleted.feedback.many', 'en'), { count: 3 })).toBe('3 monthly feedback reports');
  });

  it('fills {count} for the form it picks', () => {
    expect(translatePlural('coach.free.left', 2, 'en')).toBe('2 free messages left this month');
    expect(translatePlural('account.pass_visits_left', 21, 'is')).toContain('21');
  });
});

describe('pairs iOS picks with the English rule (ENGLISH_RULE_PLURALS)', () => {
  it('lists the bases iOS never reads through pluralKey', () => {
    expect([...ENGLISH_RULE_PLURALS].sort()).toEqual(['account.refer_earned', 'coach.found', 'home.pass_visits']);
  });

  it('reads 21 pass visits the way iOS does, never “1”', () => {
    // HomeView / AccountView: visitsLeft == 1 ? .one : .many(count).
    const iosChoice = (count: number, lang: Lang) =>
      count === 1 ? translate('home.pass_visits.one', lang) : translate('home.pass_visits.many', lang, { count });
    expect(iosChoice(21, 'is')).toBe('21 passaheimsóknir eftir');
    expect(iosChoice(1, 'is')).toBe('1 passaheimsókn eftir');
    expect(iosChoice(31, 'en')).toBe('31 pass visits left');
    // What tp would have printed: the Icelandic singular, which has no {count}.
    const error = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(translatePlural('home.pass_visits', 21, 'is')).toBe('1 passaheimsókn eftir');
    error.mockRestore();
  });

  it('says in development when one of them goes through tp', () => {
    const error = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      for (const base of ENGLISH_RULE_PLURALS) {
        error.mockClear();
        translatePlural(base, 21, 'is');
        expect(error).toHaveBeenCalledTimes(1);
        expect(error.mock.calls[0]?.[0]).toContain(`"${base}"`);
      }
      setCurrentLanguage('is');
      error.mockClear();
      tp('account.refer_earned', 2);
      expect(error).toHaveBeenCalledTimes(1);
      // A key iOS reads through pluralKey says nothing.
      error.mockClear();
      tp('account.pass_visits_left', 21);
      translatePlural('runner.summary.sets', 21, 'is');
      expect(error).not.toHaveBeenCalled();
    } finally {
      error.mockRestore();
    }
  });

  it('lets runner.summary.sets through tp: both rules read the same in both languages', () => {
    // PlanTodayCard picks it with `sets == 1`, RunnerFormat.summary with
    // pluralKey; Icelandic "sett" is one word for both forms.
    for (const lang of ['en', 'is'] as const) {
      for (let count = 0; count <= 250; count += 1) {
        const englishRule = translate(count === 1 ? 'runner.summary.sets.one' : 'runner.summary.sets.many', lang, { count });
        if (translatePlural('runner.summary.sets', count, lang) !== englishRule) {
          throw new Error(`runner.summary.sets ${count} (${lang}) differs between the rules`);
        }
      }
    }
  });
});

describe('the current language', () => {
  it('drives t() and tp() for code outside React', () => {
    setCurrentLanguage('is');
    expect(currentLanguage()).toBe('is');
    expect(t('tab.home')).toBe('Heim');
    expect(tp('account.pass_visits_left', 21)).toBe(translatePlural('account.pass_visits_left', 21, 'is'));
    setCurrentLanguage('en');
    expect(t('tab.home')).toBe('Home');
  });

  it('reduces any code to the two languages the app speaks', () => {
    expect(normaliseLang('is')).toBe('is');
    expect(normaliseLang('IS-is')).toBe('is');
    expect(normaliseLang('en-GB')).toBe('en');
    expect(normaliseLang('de')).toBe('en');
    expect(normaliseLang(null)).toBe('en');
    expect(normaliseLang(undefined)).toBe('en');
  });
});

describe('useT', () => {
  it('re-renders in the new language and keeps its functions until then', async () => {
    const { result } = await renderHook(() => useT());
    const first = result.current;
    expect(first.language).toBe('en');
    expect(first.t('tab.home')).toBe('Home');

    await act(() => useLanguageStore.getState().setLanguage('en'));
    expect(result.current).toBe(first);

    await act(() => setCurrentLanguage('is'));
    expect(result.current.language).toBe('is');
    expect(result.current.t('tab.home')).toBe('Heim');
    expect(result.current.tp('account.pass_visits_left', 21)).toBe('21 heimsókn eftir');
    expect(result.current).not.toBe(first);
  });
});
