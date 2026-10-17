/**
 * The sign-up nationality helpers (iOS Services/Nationality.swift, itself the
 * website's apps/web/src/lib/nationality.ts): the email-domain guess, the
 * normalisation, and the menu's order.
 */
import { COUNTRY_OPTIONS, nationalityFromEmail, nationalityLabel, normalizeNationality } from '../nationality';

describe('nationalityFromEmail', () => {
  it.each([
    ['member@example.is', 'IS'],
    ['member@example.co.uk', 'GB'],
    ['member@mail.example.de', 'DE'],
    ['Member@Example.IS', 'IS'],
    ['member@example.is ', 'IS'],
    ['a@b@example.se', 'SE'],
  ])('%s guesses %s', (email, code) => {
    expect(nationalityFromEmail(email)).toBe(code);
  });

  it.each([
    'member@gmail.com',
    'member@example.org',
    'member@example.is.',
    'member@',
    'member',
    '',
    'member@example.constructor',
    'member@example.__proto__',
    'member@example.tostring',
  ])('%s guesses nothing', (email) => {
    expect(nationalityFromEmail(email)).toBeNull();
  });
});

describe('normalizeNationality', () => {
  it.each([
    [' is ', 'IS'],
    ['gb', 'GB'],
    ['De', 'DE'],
  ])('%j is %s', (value, code) => {
    expect(normalizeNationality(value)).toBe(code);
  });

  it.each(['', '  ', 'I', 'ISL', 'I5', 'Ís', '1S'])('%j is no code', (value) => {
    expect(normalizeNationality(value)).toBeNull();
  });
});

describe('the menu', () => {
  it('has Iceland first, then the rest alphabetically by name', () => {
    expect(COUNTRY_OPTIONS[0]).toEqual({ code: 'IS', label: 'Iceland' });
    const rest = COUNTRY_OPTIONS.slice(1).map((option) => option.label);
    expect(rest).toEqual([...rest].sort((a, b) => a.localeCompare(b, 'en')));
    expect(COUNTRY_OPTIONS).toHaveLength(35);
  });

  it('offers every country the email guess can give', () => {
    const codes = new Set(COUNTRY_OPTIONS.map((option) => option.code));
    for (const tld of ['is', 'uk', 'de', 'fr', 'es', 'it', 'nl', 'dk', 'no', 'se', 'fi', 'pl', 'ca', 'cn', 'jp', 'us', 'ie',
      'be', 'at', 'ch', 'pt', 'cz', 'gr', 'hu', 'ee', 'lv', 'lt', 'ua', 'ru', 'au', 'nz', 'in', 'br', 'mx', 'kr']) {
      const code = nationalityFromEmail(`member@example.${tld}`);
      expect(code).not.toBeNull();
      expect(codes.has(code!)).toBe(true);
    }
  });

  it('names a code by its label, and nothing for an unknown one', () => {
    expect(nationalityLabel('GB')).toBe('United Kingdom');
    expect(nationalityLabel('XX')).toBeNull();
    expect(nationalityLabel('')).toBeNull();
  });
});
