/**
 * Log in (auth route `Login`): the Android port of iOS `LoginView`.
 *
 * The paper page with an accent glow behind the wordmark, the tagline, Email
 * and Password, the error line, the banner for an auth link that failed,
 * Sign in ("Signing in…" and dimmed while it runs), Continue with Google and
 * Apple under an "or" (AUTH-2's slot), "Forgot password?" (a sheet seeded
 * with the typed email) and "Don't have an account? Sign up".
 *
 * iOS keeps ONE `isLoading` for the screen, so the two ways in block each
 * other: while the email sign-in runs the provider buttons are disabled and
 * dimmed (their `disabled`), and while a provider one runs (its page open,
 * then the exchange and the metadata write) Sign in says "Signing in…" and
 * takes no press or keyboard Go (`useSocialSignInBusy`).
 *
 * Checks before the request, in iOS's order: both fields filled, then the
 * email's structure (./validation.ts). Supabase's refusals read as iOS
 * reads them: an unconfirmed email and wrong credentials have their own
 * sentences.
 *
 * A successful sign-in runs the app store's `handleSignIn` (iOS
 * `appState.handleSignIn`: the Coach chats claimed, the language
 * re-decided, the profile read, the Kenni nudge for a fresh account), which
 * swaps these screens for the tabs. The session's own SIGNED_IN joins it.
 *
 * The screens speak the phone's language while nobody is signed in (the app
 * store's language), as iOS's `appState.t` does.
 */
import { useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import AuthField from '../../../components/AuthField';
import { LPText, PrimaryButton, Wordmark } from '../../../components/ui';
import { useT } from '../../../i18n';
import type { AuthStackScreenProps } from '../../../navigation/types';
import { useAppStore } from '../../../stores/appStore';
import { signIn } from '../../../supabase/services/auth';
import { colors } from '../../../theme';
import DeepLinkBanner from '../components/DeepLinkBanner';
import PasswordResetSheet from '../components/PasswordResetSheet';
import RustGlow from '../components/RustGlow';
import { useSocialSignInBusy } from '../social';
import SocialSignInButtons from '../SocialSignInButtons';
import { humaniseSignInError, signInProblem } from '../validation';

export default function LoginScreen({ navigation }: AuthStackScreenProps<'Login'>) {
  const { t } = useT();
  const insets = useSafeAreaInsets();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  // A Google or Apple sign-in of the block below; with `loading`, iOS's one `isLoading`.
  const socialBusy = useSocialSignInBusy();
  const busy = loading || socialBusy;
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  function editEmail(value: string) {
    setEmail(value);
    // The banner clears itself once the member starts typing (iOS `.onChange(of: email)`).
    if (useAppStore.getState().deepLinkError !== null) useAppStore.getState().setDeepLinkError(null);
  }

  async function submit() {
    if (busy) return;
    const problem = signInProblem(email, password);
    if (problem) {
      setError(t(problem));
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const session = await signIn(email.trim(), password);
      await useAppStore.getState().handleSignIn(session.user.id, { session });
    } catch (failure) {
      if (mounted.current) setError(humaniseSignInError(failure));
    } finally {
      if (mounted.current) setLoading(false);
    }
  }

  return (
    <View style={styles.page}>
      <RustGlow />
      {/* Edge to edge, the window never shrinks for the keyboard: pad above it instead. */}
      <KeyboardAvoidingView style={styles.flex} behavior="padding">
        <ScrollView
          contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 80, paddingBottom: insets.bottom + 40 }]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.brand}>
            <Wordmark height={36} />
            <LPText serif italic size={16} color={colors.paper2} align="center">
              {t('auth.tagline')}
            </LPText>
          </View>

          <View style={styles.fields}>
            <AuthField
              icon="mail-outline"
              placeholder={t('auth.email')}
              value={email}
              onChangeText={editEmail}
              keyboardType="email-address"
              autoComplete="email"
              textContentType="emailAddress"
              testID="auth.login.email"
            />
            <AuthField
              icon="lock-closed-outline"
              placeholder={t('auth.password')}
              value={password}
              onChangeText={setPassword}
              secure
              autoComplete="current-password"
              textContentType="password"
              returnKeyType="go"
              onSubmitEditing={() => void submit()}
              testID="auth.login.password"
            />
          </View>

          {error ? (
            <LPText
              size={13}
              color={colors.destructive}
              align="center"
              style={styles.error}
              accessibilityLiveRegion="polite"
              testID="auth.login.error"
            >
              {error}
            </LPText>
          ) : null}

          <DeepLinkBanner style={styles.banner} />

          <PrimaryButton
            title={busy ? t('auth.signing_in') : t('auth.signin')}
            onPress={() => void submit()}
            disabled={busy}
            style={styles.cta}
            testID="auth.login.submit"
          />

          <View style={styles.social}>
            <SocialSignInButtons divider="above" disabled={loading} />
          </View>

          <View style={styles.links}>
            <Pressable
              onPress={() => setResetOpen(true)}
              hitSlop={10}
              accessibilityRole="button"
              testID="auth.login.forgot"
            >
              <LPText size={13} color={colors.paper2}>
                {t('auth.forgot')}
              </LPText>
            </Pressable>
            <View style={styles.signUpRow}>
              <LPText size={13} color={colors.paper3}>
                {t('auth.no_account')}
              </LPText>
              <Pressable
                onPress={() => navigation.navigate('SignUp')}
                hitSlop={10}
                accessibilityRole="button"
                testID="auth.login.signUp"
              >
                <LPText size={13} weight="semibold" color={colors.accentText}>
                  {t('auth.signup')}
                </LPText>
              </Pressable>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>

      <PasswordResetSheet visible={resetOpen} initialEmail={email} onClose={() => setResetOpen(false)} />
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.ink },
  flex: { flex: 1 },
  scroll: { paddingHorizontal: 24 },
  brand: { alignItems: 'center', gap: 10, marginBottom: 48 },
  fields: { gap: 12 },
  error: { marginTop: 10 },
  banner: { marginTop: 10 },
  cta: { marginTop: 22 },
  social: { marginTop: 18 },
  links: { marginTop: 20, alignItems: 'center', gap: 16 },
  signUpRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', justifyContent: 'center', gap: 4 },
});
