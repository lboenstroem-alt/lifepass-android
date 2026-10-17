/**
 * The greeting (iOS `HomeView.greeting` / `firstName`): the key by hour, at
 * every boundary, and the first name from the profile, never the email.
 */
import { translate } from '../../../i18n';
import { avatarInitial, firstNameOf, greetingKey } from '../greeting';
import { passVisitsText, soonestPass } from '../passChip';

describe('greetingKey', () => {
  it.each([
    [0, 'greeting.night'],
    [4, 'greeting.night'], // 4:59
    [5, 'greeting.morning'], // 5:00
    [11, 'greeting.morning'], // 11:59
    [12, 'greeting.afternoon'], // 12:00
    [16, 'greeting.afternoon'], // 16:59
    [17, 'greeting.evening'], // 17:00
    [21, 'greeting.evening'], // 21:59
    [22, 'greeting.night'], // 22:00
    [23, 'greeting.night'],
  ])('at %i:xx says %s', (hour, key) => {
    expect(greetingKey(hour)).toBe(key);
  });

  it('the night greeting is "Still awake", never "Good night"', () => {
    expect(translate(greetingKey(23), 'en')).toBe('Still awake');
    expect(translate(greetingKey(2), 'is')).toBe('Enn á fótum');
    expect(translate(greetingKey(9), 'is')).toBe('Góðan daginn');
  });
});

describe('firstNameOf', () => {
  it('is the first word of the full name', () => {
    expect(firstNameOf('Lucas Bönström')).toBe('Lucas');
    expect(firstNameOf('  Guðrún  Jónsdóttir')).toBe('Guðrún');
    expect(firstNameOf('Lucas')).toBe('Lucas');
  });

  it('is null with no name, so Home says "there" / "þú" (never the email)', () => {
    expect(firstNameOf(null)).toBeNull();
    expect(firstNameOf(undefined)).toBeNull();
    expect(firstNameOf('')).toBeNull();
    expect(firstNameOf('   ')).toBeNull();
    expect(translate('home.name_fallback', 'en')).toBe('there');
    expect(translate('home.name_fallback', 'is')).toBe('þú');
  });

  it('the avatar letter is the first character, upper case', () => {
    expect(avatarInitial('lucas')).toBe('L');
    expect(avatarInitial('þú')).toBe('Þ');
    expect(avatarInitial('Ægir')).toBe('Æ');
    expect(avatarInitial('')).toBe('');
  });
});

describe('the pass chip', () => {
  const pass = (id: string, visitsLeft: number, expiresAt: string) => ({
    id,
    type: 'explorer',
    visitsLeft,
    expiresAt: new Date(expiresAt),
  });

  it('no passes: no chip', () => {
    expect(soonestPass([])).toBeNull();
  });

  it('two passes: the one expiring first', () => {
    const later = pass('later', 5, '2026-11-30T00:00:00Z');
    const sooner = pass('sooner', 2, '2026-10-30T00:00:00Z');
    expect(soonestPass([later, sooner])).toBe(sooner);
    expect(soonestPass([sooner, later])).toBe(sooner);
  });

  it('equal expiries keep the first, as Swift min(by:) does', () => {
    const a = pass('a', 1, '2026-10-30T00:00:00Z');
    const b = pass('b', 2, '2026-10-30T00:00:00Z');
    expect(soonestPass([a, b])).toBe(a);
  });

  it('visitsLeft 1 uses the .one string; anything else uses .many with the count (iOS == 1, not the plural rule)', () => {
    const en = (key: string, params?: Readonly<Record<string, string | number>>) => translate(key, 'en', params);
    const is = (key: string, params?: Readonly<Record<string, string | number>>) => translate(key, 'is', params);
    expect(passVisitsText({ visitsLeft: 1 }, en)).toBe('1 pass visit left');
    expect(passVisitsText({ visitsLeft: 5 }, en)).toBe('5 pass visits left');
    expect(passVisitsText({ visitsLeft: 1 }, is)).toBe('1 passaheimsókn eftir');
    expect(passVisitsText({ visitsLeft: 21 }, is)).toBe('21 passaheimsóknir eftir');
  });
});
