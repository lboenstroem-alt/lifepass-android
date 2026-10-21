/**
 * The checks iOS `AuthViewModel` and `SetNewPasswordView` run before they
 * call Supabase, in their order, and how Supabase's refusals read. Ports
 * AccountLanguageTests `testSignUpValidationSpeaksTheScreensLanguage`.
 */
import { AuthApiError, AuthRetryableFetchError } from '@supabase/supabase-js';

import { lookup, setCurrentLanguage, t } from '../../../i18n';
import {
  characterCount,
  humaniseSignInError,
  humaniseSignUpError,
  isValidEmail,
  MIN_PASSWORD_LENGTH,
  newPasswordProblem,
  resetProblem,
  signInProblem,
  signUpProblem,
} from '../validation';

const TWELVE = 'abcdefghijkl';

describe('the email check (iOS isValidEmail)', () => {
  it.each([
    ['member@example.is', true],
    ['a@b.c', true],
    ['  member@example.is  ', true],
    ['member.example.is', false],
    ['member@example', false],
    ['a@.i', false],
    ['', false],
    ['     ', false],
  ])('%p is %p', (email, valid) => {
    expect(isValidEmail(email)).toBe(valid);
  });
});

describe('Log in', () => {
  it('asks for both fields first, the email structure second', () => {
    expect(signInProblem('', '')).toBe('auth.err.missing_credentials');
    expect(signInProblem('member@example.is', '')).toBe('auth.err.missing_credentials');
    expect(signInProblem('', 'password')).toBe('auth.err.missing_credentials');
    expect(signInProblem('member', 'password')).toBe('auth.err.invalid_email');
    expect(signInProblem('member@example.is', 'password')).toBeNull();
  });

  it('reads an email of spaces as filled in but invalid, as iOS does', () => {
    expect(signInProblem('   ', 'password')).toBe('auth.err.invalid_email');
  });
});

describe('Create account, in iOS order', () => {
  const valid = { fullName: 'Jón Jónsson', email: 'member@example.is', password: TWELVE, acceptedTerms: true };

  it('passes a complete form', () => {
    expect(signUpProblem(valid)).toBeNull();
  });

  it('asks for name, email and password before anything else', () => {
    expect(signUpProblem({ ...valid, fullName: '   ', email: 'bad', password: 'x', acceptedTerms: false })).toBe(
      'auth.err.missing_fields',
    );
    expect(signUpProblem({ ...valid, email: '  ' })).toBe('auth.err.missing_fields');
    expect(signUpProblem({ ...valid, password: '' })).toBe('auth.err.missing_fields');
  });

  it('then the email, then the 12-character floor, then the Terms', () => {
    expect(signUpProblem({ ...valid, email: 'member', password: 'x', acceptedTerms: false })).toBe('auth.err.invalid_email');
    expect(signUpProblem({ ...valid, password: 'abcdefghijk', acceptedTerms: false })).toBe('auth.err.password_short');
    expect(signUpProblem({ ...valid, acceptedTerms: false })).toBe('auth.err.terms');
  });

  it('counts a password of exactly 12 as long enough, spaces included (it is sent as typed)', () => {
    expect(MIN_PASSWORD_LENGTH).toBe(12);
    expect(signUpProblem({ ...valid, password: '          ab' })).toBeNull();
    expect(signUpProblem({ ...valid, password: 'abcdefghijk' })).toBe('auth.err.password_short');
  });

  it('counts characters, not UTF-16 units', () => {
    expect(characterCount('😀😀😀😀😀😀')).toBe(6);
    expect(signUpProblem({ ...valid, password: '😀😀😀😀😀😀' })).toBe('auth.err.password_short');
  });

  it('speaks the screen language (AccountLanguageTests)', () => {
    setCurrentLanguage('is');
    expect(t(signUpProblem({ ...valid, password: 'short' })!)).toBe(lookup('auth.err.password_short', 'is'));
    expect(t(signInProblem('', '')!)).toBe('Sláðu inn netfang og lykilorð.');
  });
});

describe('the reset sheet and the new password', () => {
  it('refuses only an empty email', () => {
    expect(resetProblem('')).toBe('auth.err.missing_email');
    expect(resetProblem('   ')).toBe('auth.err.missing_email');
    expect(resetProblem('member')).toBeNull();
  });

  it('asks for 12 characters, then the same twice', () => {
    expect(newPasswordProblem('short', 'short')).toBe('auth.err.password_short');
    expect(newPasswordProblem('abcdefghijk', 'different')).toBe('auth.err.password_short');
    expect(newPasswordProblem(TWELVE, `${TWELVE}x`)).toBe('auth.err.password_mismatch');
    expect(newPasswordProblem(TWELVE, TWELVE)).toBeNull();
  });
});

describe('what a refused sign-in says', () => {
  it('an unconfirmed email asks the member to tap the link', () => {
    expect(humaniseSignInError(new AuthApiError('Email not confirmed', 400, 'email_not_confirmed'))).toBe(
      t('auth.err.unconfirmed'),
    );
  });

  it('wrong credentials point at Forgot password', () => {
    expect(humaniseSignInError(new AuthApiError('Invalid login credentials', 400, 'invalid_credentials'))).toBe(
      t('auth.err.bad_credentials'),
    );
  });

  it('in Icelandic on an Icelandic screen', () => {
    setCurrentLanguage('is');
    expect(humaniseSignInError(new AuthApiError('Invalid login credentials', 400, undefined))).toBe(
      lookup('auth.err.bad_credentials', 'is'),
    );
  });

  it('anything else reads as the error formatter says', () => {
    expect(humaniseSignInError(new AuthApiError('User is banned', 400, undefined))).toBe('User is banned');
    expect(humaniseSignInError(new AuthRetryableFetchError('Failed to fetch', 0))).toBe(t('error.network'));
    expect(humaniseSignInError(new Error('TypeError: something internal'))).toBe(t('error.generic'));
  });
});

describe('what a refused sign-up says', () => {
  it('the email rate limit has its own sentence', () => {
    expect(humaniseSignUpError(new AuthApiError('email rate limit exceeded', 429, 'over_email_send_rate_limit'))).toBe(
      t('auth.err.rate_limited'),
    );
  });

  it('anything else reads as the error formatter says', () => {
    expect(humaniseSignUpError(new AuthApiError('Signups not allowed for this instance', 422, undefined))).toBe(
      'Signups not allowed for this instance',
    );
  });
});
