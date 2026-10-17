/**
 * The metadata a Google or Apple sign-in may add: iOS SocialSignInTests'
 * metadata cases (LifePassTests/APIClientAuthTests.swift, 2.5.4), the same
 * vectors, with `signup_source` `android` (owner decision D2).
 */
import { ANDROID_SIGNUP_SOURCE, isBlankMetadataValue, missingSocialMetadata } from '../socialMetadata';

describe('the metadata a provider sign-in adds', () => {
  it('a brand-new account gets the name it was given, the language, the source and marketing off', () => {
    const data = missingSocialMetadata(
      { email: 'x@privaterelay.appleid.com', sub: '001.abc' },
      'Anna Jónsdóttir',
      'is',
    );
    expect(data).toEqual({
      full_name: 'Anna Jónsdóttir',
      locale: 'is',
      signup_source: 'android',
      marketing_opt_in: false,
    });
  });

  it('a new Google account (Google brings its own name) gets the language, the source and marketing off', () => {
    const data = missingSocialMetadata(
      { full_name: 'Jón Jónsson', name: 'Jón Jónsson', email: 'jon@gmail.com', email_verified: true },
      null,
      'en',
    );
    expect(data).toEqual({ locale: 'en', signup_source: 'android', marketing_opt_in: false });
  });

  it('AN EXISTING ACCOUNT LINKED BY EMAIL keeps everything it has, its consent above all', () => {
    const existing = {
      full_name: 'Anna J.',
      locale: 'en',
      signup_source: 'auth',
      marketing_opt_in: true,
    };
    expect(missingSocialMetadata(existing, 'Anna Jónsdóttir', 'is')).toEqual({});
    // An iPhone account keeps its iOS source; a consent of "no" stays "no".
    expect(
      missingSocialMetadata({ ...existing, signup_source: 'ios', marketing_opt_in: false }, null, 'is'),
    ).toEqual({});
  });

  it('a key that is there at all is kept, even when it is null (iOS `== nil`)', () => {
    expect(missingSocialMetadata({ signup_source: null, marketing_opt_in: null, locale: 'is' }, null, 'en')).toEqual(
      {},
    );
  });

  it('writes no name when none was sent or one is there', () => {
    expect(
      missingSocialMetadata({ full_name: 'Jón Jónsson', name: 'Jón Jónsson' }, null, 'en').full_name,
    ).toBeUndefined();
    expect(missingSocialMetadata({ full_name: '  ' }, '  ', 'en').full_name).toBeUndefined();
    expect(missingSocialMetadata({ full_name: null }, 'Anna', 'en').full_name).toBe('Anna');
    expect(missingSocialMetadata({ full_name: '   ' }, ' Anna ', 'en').full_name).toBe('Anna');
  });

  it('writes a language only when the account has none, and only Icelandic or English', () => {
    expect(missingSocialMetadata({}, null, 'de').locale).toBeUndefined();
    expect(missingSocialMetadata({ locale: ' ' }, null, 'is').locale).toBe('is');
    expect(missingSocialMetadata({ locale: 'en' }, null, 'is').locale).toBeUndefined();
  });

  it('copes with an account that has no metadata at all', () => {
    expect(missingSocialMetadata(null, null, 'en')).toEqual({
      locale: 'en',
      signup_source: 'android',
      marketing_opt_in: false,
    });
    expect(missingSocialMetadata(undefined, null, 'is').locale).toBe('is');
  });

  it('blank means absent, null or only whitespace', () => {
    expect(isBlankMetadataValue(undefined)).toBe(true);
    expect(isBlankMetadataValue(null)).toBe(true);
    expect(isBlankMetadataValue(' \n')).toBe(true);
    expect(isBlankMetadataValue('Anna')).toBe(false);
    expect(isBlankMetadataValue(false)).toBe(false);
    expect(isBlankMetadataValue(0)).toBe(false);
  });

  it('the app signs accounts up as android (D2)', () => {
    expect(ANDROID_SIGNUP_SOURCE).toBe('android');
  });
});
