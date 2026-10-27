/**
 * Create account (auth route `SignUp`): the Android port of iOS `SignUpView`
 * and `AuthViewModel.signUp`.
 *
 * Title and subtitle, Continue with Google and Apple ABOVE the form with the
 * "or" below them (AUTH-2's slot), then Full name, Email, Password (at least
 * 12, with the eye button), the optional nationality (prefilled from the
 * email's country domain until the member picks one), the marketing switch
 * (off), the required Terms checkbox with its links, the error line, Create
 * account (dimmed and refused until Terms is ticked), and "Already have an
 * account? Sign in".
 *
 * Checks in iOS's order (./validation.ts). The request sends exactly iOS's
 * metadata with `signup_source: 'android'` and the language these screens
 * speak (src/supabase/services/auth.ts). With email confirmation on there
 * is no session: a "Check your email" alert, whose OK goes to Log in (iOS).
 * The link in the email opens the app signed in (./authCallback.ts). Should
 * a browser refuse to hand that link to the app, the alert's Android-only
 * "I've confirmed, sign me in" signs in with what the member just typed.
 * A session straight away (confirmation off) signs in at once.
 *
 * iOS keeps ONE `isLoading` for the screen, so the two ways in block each
 * other: while Create (or the alert's sign-in) runs the provider buttons are
 * disabled and dimmed (their `disabled`), and while a provider sign-in runs
 * Create says "Creating…" and takes no press (`useSocialSignInBusy`).
 */
import { Ionicons } from '@expo/vector-icons';
import { useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import AuthField from '../../../components/AuthField';
import { Dialog, LPText, PrimaryButton } from '../../../components/ui';
import { useT } from '../../../i18n';
import { track } from '../../../lib/analytics';
import { useBusyGuard } from '../../../navigation/guards';
import type { AuthStackScreenProps } from '../../../navigation/types';
import { useAppStore } from '../../../stores/appStore';
import { signIn, signUp } from '../../../supabase/services/auth';
import { colors } from '../../../theme';
import { nationalityFromEmail, normalizeNationality } from '../../../utils/nationality';
import { MarketingToggle, NationalityPicker, TermsRow } from '../components/SignUpControls';
import { useSocialSignInBusy } from '../social';
import SocialSignInButtons from '../SocialSignInButtons';
import { useLoginOnLinkError } from '../useLoginOnLinkError';
import { humaniseSignInError, humaniseSignUpError, signUpProblem } from '../validation';

export default function SignUpScreen({ navigation }: AuthStackScreenProps<'SignUp'>) {
  const { t, language } = useT();
  const insets = useSafeAreaInsets();
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  /** ISO alpha-2, or '' when unset. */
  const [nationality, setNationality] = useState('');
  const [nationalityTouched, setNationalityTouched] = useState(false);
  const [marketingOptIn, setMarketingOptIn] = useState(false);
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [confirmingSignIn, setConfirmingSignIn] = useState(false);
  const [checkEmailFor, setCheckEmailFor] = useState<string | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  /**
   * To Log in: back to it when the member came from there, else in place of
   * this screen (iOS swaps the onboarding stage, or pops to Log in).
   */
  const toLogin = () => navigation.popTo('Login');

  useLoginOnLinkError(toLogin);

  function editEmail(value: string) {
    setEmail(value);
    // Prefilled from the email's country domain until the member picks one (iOS, the website).
    if (!nationalityTouched) setNationality(nationalityFromEmail(value) ?? '');
  }

  function pickNationality(code: string) {
    setNationalityTouched(true);
    setNationality(code);
  }

  /** This screen's own email request is on its way. */
  const emailBusy = creating || confirmingSignIn;
  // A Google or Apple sign-in of the block above; with `emailBusy`, iOS's one `isLoading`.
  const socialBusy = useSocialSignInBusy();
  const busy = emailBusy || socialBusy;
  // Back waits for Create to answer: leaving mid-request would lose the check-your-email alert.
  useBusyGuard(creating);

  async function create() {
    if (busy) return;
    const problem = signUpProblem({ fullName, email, password, acceptedTerms });
    if (problem) {
      setError(t(problem));
      return;
    }
    const trimmedEmail = email.trim();
    setCreating(true);
    setError(null);
    try {
      // The key is left out when unset; the password is sent as typed.
      const normalizedNationality = normalizeNationality(nationality);
      const result = await signUp(
        trimmedEmail,
        password,
        fullName.trim(),
        normalizedNationality ?? undefined,
        marketingOptIn,
        language,
      );
      // iOS's event: whether a nationality was given and the marketing choice, never the values typed.
      track('user_signed_up', {
        has_nationality: normalizedNationality !== null,
        marketing_opt_in: marketingOptIn,
        ...(result.session ? {} : { email_confirmation_required: true }),
      });
      if (result.session) {
        await useAppStore.getState().handleSignIn(result.session.user.id, { session: result.session });
      } else if (mounted.current) {
        setCheckEmailFor(trimmedEmail);
      }
    } catch (failure) {
      if (mounted.current) setError(humaniseSignUpError(failure));
    } finally {
      if (mounted.current) setCreating(false);
    }
  }

  /** The Android fallback on the check-your-email alert: sign in with what was just typed. */
  async function signInAfterConfirming() {
    if (busy) return;
    setConfirmingSignIn(true);
    setError(null);
    try {
      const session = await signIn(email.trim(), password);
      await useAppStore.getState().handleSignIn(session.user.id, { session });
    } catch (failure) {
      if (mounted.current) setError(humaniseSignInError(failure));
    } finally {
      if (mounted.current) setConfirmingSignIn(false);
    }
  }

  const ctaTitle = confirmingSignIn
    ? t('auth.signing_in')
    : creating || socialBusy
      ? t('auth.creating')
      : t('auth.create');

  return (
    <View style={styles.page}>
      <View style={[styles.topBar, { paddingTop: insets.top + 4 }]}>
        <Pressable
          onPress={() => navigation.goBack()}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={t('common.back')}
          style={styles.backButton}
          testID="auth.signup.back"
        >
          <Ionicons name="chevron-back" size={22} color={colors.paper} />
        </Pressable>
      </View>

      {/* Edge to edge, the window never shrinks for the keyboard: pad above it instead. */}
      <KeyboardAvoidingView style={styles.flex} behavior="padding">
        <ScrollView
          contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 32 }]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.header}>
            <LPText serif size={28} tracking={-0.6} color={colors.paper} align="center" accessibilityRole="header">
              {t('auth.create')}
            </LPText>
            <LPText size={14} color={colors.paper3} align="center">
              {t('auth.subtitle')}
            </LPText>
          </View>

          <SocialSignInButtons divider="below" disabled={emailBusy} />

          <View style={styles.fields}>
            <AuthField
              placeholder={t('auth.full_name')}
              value={fullName}
              onChangeText={setFullName}
              autoCapitalize="words"
              autoComplete="name"
              textContentType="name"
              testID="auth.signup.name"
            />
            <AuthField
              placeholder={t('auth.email')}
              value={email}
              onChangeText={editEmail}
              keyboardType="email-address"
              autoComplete="email"
              textContentType="emailAddress"
              testID="auth.signup.email"
            />
            <AuthField
              placeholder={t('auth.password_create')}
              value={password}
              onChangeText={setPassword}
              secure
              revealable
              autoComplete="new-password"
              textContentType="newPassword"
              testID="auth.signup.password"
            />
            <NationalityPicker value={nationality} onPick={pickNationality} />
          </View>

          <View style={styles.consents}>
            <MarketingToggle value={marketingOptIn} onChange={setMarketingOptIn} />
            <TermsRow checked={acceptedTerms} onChange={setAcceptedTerms} />
          </View>

          {error ? (
            <LPText size={13} color={colors.destructive} align="center" accessibilityLiveRegion="polite" testID="auth.signup.error">
              {error}
            </LPText>
          ) : null}

          <PrimaryButton
            title={ctaTitle}
            onPress={() => void create()}
            disabled={busy || !acceptedTerms}
            testID="auth.signup.create"
          />

          <View style={styles.signInRow}>
            <LPText size={13} color={colors.paper3}>
              {t('auth.have_account')}
            </LPText>
            <Pressable onPress={toLogin} hitSlop={10} accessibilityRole="button" testID="auth.signup.signIn">
              <LPText size={13} weight="semibold" color={colors.accentText}>
                {t('auth.signin')}
              </LPText>
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>

      <Dialog
        visible={checkEmailFor !== null}
        onClose={() => setCheckEmailFor(null)}
        title={t('auth.check_email')}
        message={t('auth.check_email_body', { email: checkEmailFor ?? '' })}
        buttons={[
          {
            label: t('auth.android.confirmed_sign_in'),
            onPress: () => void signInAfterConfirming(),
            testID: 'auth.signup.checkEmail.signIn',
          },
          { label: t('common.ok'), role: 'cancel', onPress: toLogin, testID: 'auth.signup.checkEmail.ok' },
        ]}
        testID="auth.signup.checkEmail"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.ink },
  flex: { flex: 1 },
  topBar: { paddingHorizontal: 8, paddingBottom: 4, backgroundColor: colors.ink },
  backButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  scroll: { paddingHorizontal: 24, gap: 24, paddingTop: 16 },
  header: { gap: 8, alignItems: 'center' },
  fields: { gap: 14 },
  consents: { gap: 12 },
  signInRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', flexWrap: 'wrap', gap: 4 },
});
