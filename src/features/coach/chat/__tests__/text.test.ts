/**
 * The Coach's server counts text in UTF-16 units (JS string length): 4,000
 * per chat turn. iOS `CoachText.truncatedToUTF16` cuts under a limit without
 * ever splitting a character; a plain `slice` would cut an emoji (a surrogate
 * pair) or a flag in half and send the server a lone surrogate.
 */
import { characterCount, prefixCharacters, truncatedToUTF16 } from '../text';

/** True when `text` holds a high surrogate with no low one after it, or the reverse. */
function hasLoneSurrogate(text: string): boolean {
  for (let index = 0; index < text.length; index += 1) {
    const unit = text.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = text.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      return true;
    }
  }
  return false;
}

describe('truncatedToUTF16', () => {
  it('leaves text at or under the limit as it is', () => {
    expect(truncatedToUTF16('Sundlaug í kvöld?', 3_900)).toBe('Sundlaug í kvöld?');
    const exact = 'a'.repeat(3_900);
    expect(truncatedToUTF16(exact, 3_900)).toBe(exact);
  });

  it('never goes over the limit', () => {
    const long = 'Laugardalslaug '.repeat(400);
    const cut = truncatedToUTF16(long, 3_900);
    expect(cut.length).toBeLessThanOrEqual(3_900);
    expect(cut.length).toBe(3_900);
    expect(long.startsWith(cut)).toBe(true);
  });

  it('never splits an emoji: it stops before the one that would pass the limit', () => {
    // 3,899 units, then a two-unit emoji: taking it would make 3,901.
    const text = `${'a'.repeat(3_899)}🏊‍♀️ and more`;
    const cut = truncatedToUTF16(text, 3_900);
    expect(cut).toBe('a'.repeat(3_899));
    expect(hasLoneSurrogate(cut)).toBe(false);
  });

  it('keeps a whole flag or family when it fits, and drops it whole when it does not', () => {
    const flag = '🇮🇸'; // four UTF-16 units, one character
    expect(truncatedToUTF16(`ab${flag}cd`, 6)).toBe(`ab${flag}`);
    expect(truncatedToUTF16(`ab${flag}cd`, 5)).toBe('ab');
    const family = '👨‍👩‍👧';
    const cut = truncatedToUTF16(`x${family}`.repeat(3), 10);
    expect(cut.length).toBeLessThanOrEqual(10);
    expect(hasLoneSurrogate(cut)).toBe(false);
  });

  it('counts accented Icelandic letters as one unit each', () => {
    expect(truncatedToUTF16('þú ert æðisleg', 6)).toBe('þú ert');
  });
});

describe('characters (Swift `String.count` and `prefix`)', () => {
  it('counts what a reader sees as one character as one', () => {
    expect(characterCount('Bláa lónið')).toBe(10);
    expect(characterCount('🇮🇸')).toBe(1);
    expect(characterCount('é')).toBe(1);
  });

  it('takes whole characters', () => {
    expect(prefixCharacters('🇮🇸🇮🇸🇮🇸', 2)).toBe('🇮🇸🇮🇸');
    expect(prefixCharacters('abc', 10)).toBe('abc');
    expect(prefixCharacters('abc', 0)).toBe('');
  });
});
