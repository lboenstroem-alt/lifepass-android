/**
 * The sign-in, sign-up, reset and new-password rules: the checks iOS
 * `AuthViewModel` and `SetNewPasswordView` run before they call Supabase, in
 * the same ORDER (the first failing check is the one the member reads), and
 * the way they turn Supabase's errors into sentences.
 *
 * Every check answers a generated iOS key, not a sentence, so the screen
 * translates it in the language it speaks (AccountLanguageTests
 * `testSignUpValidationSpeaksTheScreensLanguage`).
 */
import { errorMessage } from '../../api/errorFormatter';
import { t } from '../../i18n';

/** The website's enforced floor, and iOS's since 2.5.x: 12 characters. */
export const MIN_PASSWORD_LENGTH = 12;

/**
 * The structural email check (iOS `isValidEmail`): trimmed, it contains "@"
 * and "." and is at least 5 long. The server does the real validation.
 */
export function isValidEmail(email: string): boolean {
  const trimmed = email.trim();
  return trimmed.includes('@') && trimmed.includes('.') && characterCount(trimmed) >= 5;
}

/**
 * Characters as a member counts them. Swift's `count` counts grapheme
 * clusters; Hermes has no `Intl.Segmenter`, so this counts code points,
 * which agrees for every letter, digit and symbol a keyboard types
 * (a surrogate pair is one character, not two).
 */
export function characterCount(text: string): number {
  return Array.from(text).length;
}

/**
 * Log in (iOS `AuthViewModel.signIn`): either field EMPTY, then the email's
 * structure. An email of spaces is not empty, so it reads as invalid, as on
 * iOS.
 */
export function signInProblem(email: string, password: string): string | null {
  if (email === '' || password === '') return 'auth.err.missing_credentials';
  if (!isValidEmail(email)) return 'auth.err.invalid_email';
  return null;
}

export interface SignUpForm {
  readonly fullName: string;
  readonly email: string;
  readonly password: string;
  readonly acceptedTerms: boolean;
}

/**
 * Create account (iOS `AuthViewModel.signUp`), in this order: a missing
 * name, email or password (name and email trimmed, the password as typed),
 * the email's structure, a password under 12, the Terms not accepted.
 */
export function signUpProblem(form: SignUpForm): string | null {
  const email = form.email.trim();
  const name = form.fullName.trim();
  if (email === '' || form.password === '' || name === '') return 'auth.err.missing_fields';
  if (!isValidEmail(email)) return 'auth.err.invalid_email';
  if (characterCount(form.password) < MIN_PASSWORD_LENGTH) return 'auth.err.password_short';
  if (!form.acceptedTerms) return 'auth.err.terms';
  return null;
}

/** The reset sheet (iOS `AuthViewModel.resetPassword`): only an empty email is refused here. */
export function resetProblem(email: string): string | null {
  return email.trim() === '' ? 'auth.err.missing_email' : null;
}

/** Set a new password (iOS `SetNewPasswordView.submit`): under 12, then a mismatch. */
export function newPasswordProblem(password: string, confirm: string): string | null {
  if (characterCount(password) < MIN_PASSWORD_LENGTH) return 'auth.err.password_short';
  if (password !== confirm) return 'auth.err.password_mismatch';
  return null;
}

/** What an error says about itself, lower-cased (iOS `localizedDescription.lowercased()`). */
function rawMessage(error: unknown): string {
  if (error instanceof Error) return error.message.toLowerCase();
  if (typeof error === 'string') return error.toLowerCase();
  return '';
}

/**
 * The two sign-in errors members actually hit get their own sentence: an
 * unconfirmed email (they signed up but have not tapped the link) and wrong
 * credentials. Anything else reads as the error formatter says (iOS
 * `humaniseSignInError`).
 */
export function humaniseSignInError(error: unknown): string {
  const raw = rawMessage(error);
  if (raw.includes('email not confirmed') || raw.includes('not confirmed')) return t('auth.err.unconfirmed');
  if (raw.includes('invalid') && raw.includes('credentials')) return t('auth.err.bad_credentials');
  return errorMessage(error);
}

/**
 * Sign-up's one special case, Supabase's email rate limit (the website's
 * `friendlyAuthError`, iOS `humaniseSignUpError`); anything else reads as the
 * error formatter says.
 */
export function humaniseSignUpError(error: unknown): string {
  if (rawMessage(error).includes('rate')) return t('auth.err.rate_limited');
  return errorMessage(error);
}
