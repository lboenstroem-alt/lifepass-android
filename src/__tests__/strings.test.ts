import en from '../i18n/strings.en.json';
import is from '../i18n/strings.is.json';

// The tables are generated from the iOS app by scripts/import-ios-strings.py;
// these checks mirror the iOS LocalizationKeyTests / LocalizationDashTests.
describe('iOS string tables', () => {
  it('has every key in both languages', () => {
    expect(Object.keys(is).sort()).toEqual(Object.keys(en).sort());
  });

  it('keeps every {placeholder} in the Icelandic value', () => {
    const placeholders = (s: string) => (s.match(/\{[a-zA-Z_]+\}/g) ?? []).sort();
    const isTable = is as Record<string, string>;
    const mismatched = Object.entries(en as Record<string, string>).filter(
      ([key, value]) => placeholders(value).some((p) => !isTable[key].includes(p)),
    );
    expect(mismatched.map(([key]) => key)).toEqual([]);
  });
});
