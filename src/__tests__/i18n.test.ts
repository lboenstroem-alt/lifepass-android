import { lookup, pluralKey, setCurrentLanguage, t, tp, translate } from '../i18n';

describe('i18n runtime (iOS LPStrings port)', () => {
  it('takes the Icelandic singular for 1, 21 and 101 but not 11 or 111', () => {
    expect([1, 21, 101, 11, 111, 2].map((n) => pluralKey('x', n, 'is'))).toEqual([
      'x.one', 'x.one', 'x.one', 'x.many', 'x.many', 'x.many',
    ]);
    expect([1, 21].map((n) => pluralKey('x', n, 'en'))).toEqual(['x.one', 'x.many']);
  });

  it('falls back is → en → key', () => {
    expect(lookup('tab.home', 'is')).toBe('Heim');
    expect(lookup('no.such.key', 'is')).toBe('no.such.key');
  });

  it('fills placeholders and follows the current language', () => {
    expect(translate('food.search.empty', 'en', { query: 'skyr' })).toBe('No matches for “skyr”');
    setCurrentLanguage('is');
    expect(t('tab.home')).toBe('Heim');
    expect(tp('account.pass_visits_left', 21)).toContain('21');
    setCurrentLanguage('en');
    expect(t('tab.home')).toBe('Home');
  });
});
