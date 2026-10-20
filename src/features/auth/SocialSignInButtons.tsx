/**
 * Continue with Apple and Continue with Google, for the sign-in and sign-up
 * screens: the Android port of iOS `SocialSignInButtons(viewModel:divider:)`
 * (Views/Auth/LoginView.swift, 2.5.4). Mounted by AUTH-1: on Log in under the
 * Sign in button (divider above), on Sign up above the form (divider below).
 *
 * Draws NOTHING while no provider may show: until the settings read answers,
 * when this build has the flag off, when the server has both providers off,
 * or when the read failed (./providerSettings). Each provider the server has
 * on shows (owner decision D1 (a); iOS shows Google only beside Apple).
 *
 * The screens are light (`ink` paper), so Apple's button is the black style
 * Apple's guidelines ask for on a light background, and Google's is the white
 * one with a hairline border and the four-colour G, both 50 tall with radius
 * 12, their labels in the platform's own face as the providers ask (iOS draws
 * them in the system font too). Unlike iOS's system Apple button, Android
 * draws its own, so its label is translated like Google's.
 *
 * Under the buttons: the failure line (`auth.social_failed`; a cancel says
 * nothing), then the Terms and Privacy line with links. An account made here
 * has no Terms checkbox, so the notice sits where the tap is. While a sign-in
 * runs (a provider one, or the screen's email one passed in as `disabled`)
 * the whole block is disabled at 0.6 opacity, as iOS's one `isLoading` does.
 *
 * Each time its screen comes to the front (iOS `.task` on every appearance)
 * the block asks again which providers to show, so Log in, uncovered again
 * after Sign up, shows the buttons a later read found even when its own
 * first read failed. The screen in front also shows a failure of a sign-in
 * the router finished with no button waiting (`unreportedFailure`, after a
 * process death behind the page).
 */
import { Ionicons } from '@expo/vector-icons';
import { NavigationContext } from '@react-navigation/native';
import { useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { announce, hiddenFromAccessibility, LPText } from '../../components/ui';
import { MerchantInfo } from '../../config/merchantInfo';
import { env } from '../../config/env';
import { hasFixture } from '../../dev/fixtures';
import { MarkupText, t as translateNow, useT } from '../../i18n';
import { colors, sans } from '../../theme';
import {
  cachedSocialProviders,
  hasAnySocialProvider,
  loadSocialProviders,
  NO_SOCIAL_PROVIDERS,
  visibleSocialProviders,
  type SocialProviders,
} from './providerSettings';
import {
  resumeSocialSignIn,
  signInWithSocialProvider,
  takeUnreportedSocialFailure,
  useSocialSignInBusy,
  useSocialSignInStore,
  type SocialProvider,
} from './social';

/** Where the "or" divider goes: above the buttons (Log in) or below them (Sign up). */
export type SocialDividerPlacement = 'above' | 'below';

export interface SocialSignInButtonsProps {
  readonly divider: SocialDividerPlacement;
  /**
   * The screen's email sign-in or sign-up is running (optional; F4's slot
   * signature still holds). iOS disables and dims this block on the screen's
   * one `isLoading`, so a provider sign-in cannot start while the password
   * one is on its way; the other direction is `useSocialSignInBusy()`.
   */
  readonly disabled?: boolean;
}

/** iOS `SocialSignInButtons.buttonHeight` and `.cornerRadius`. */
export const SOCIAL_BUTTON_HEIGHT = 50;
export const SOCIAL_BUTTON_RADIUS = 12;

/** The providers' own button colours (Apple: black; Google: white). */
const APPLE_BLACK = '#000000';
const PROVIDER_WHITE = '#FFFFFF';

/**
 * Android's system sans at medium weight (Roboto Medium): the face the
 * providers' button guidelines ask for, as iOS's buttons use the system face.
 */
const SYSTEM_MEDIUM = 'sans-serif-medium';

/** What may show before the read answers: the cached answer of this app session, if any. */
function initialProviders(): SocialProviders {
  if (hasFixture('forceSocialButtons')) return { apple: true, google: true };
  if (!env.socialSignInBuildEnabled) return NO_SOCIAL_PROVIDERS;
  return visibleSocialProviders(true, cachedSocialProviders());
}

/** The terms line for what shows (iOS picks between its two; Android adds Google alone). */
function termsKey(providers: SocialProviders): string {
  if (providers.apple && providers.google) return 'auth.social_terms';
  return providers.apple ? 'auth.social_terms_apple' : 'auth.social_terms_google';
}

export default function SocialSignInButtons({ divider, disabled = false }: SocialSignInButtonsProps) {
  const { t } = useT();
  // The screen this block sits on; absent outside a navigator (tests, a preview).
  const navigation = useContext(NavigationContext);
  const [providers, setProviders] = useState<SocialProviders>(initialProviders);
  const [failed, setFailed] = useState(false);
  // `running`: a provider sign-in of ours; `busy`: that, or the email form's.
  const running = useSocialSignInBusy();
  const busy = running || disabled;
  const unreportedFailure = useSocialSignInStore((state) => state.unreportedFailure);

  /** Shows the failure line and says it to TalkBack, once, when it happens. */
  const showFailure = useCallback(() => {
    setFailed(true);
    announce(translateNow('auth.social_failed'));
  }, []);

  useEffect(() => {
    let alive = true;
    const refresh = () => {
      // A cached answer comes back at once; a read that failed is tried again.
      void loadSocialProviders().then((loaded) => {
        if (alive) setProviders(loaded);
      });
    };
    refresh();
    const stopFocus = navigation?.addListener('focus', refresh);
    // The fallback for a start from the page's return link (the router
    // finishes it first): a failure arrives as `unreportedFailure`.
    void resumeSocialSignIn();
    return () => {
      alive = false;
      stopFocus?.();
    };
  }, [navigation]);

  // A failure no button was waiting for: the screen in front shows it, once
  // its buttons show (a screen covered by another, Log in under Sign up,
  // leaves it to that one).
  const visible = hasAnySocialProvider(providers);
  useEffect(() => {
    if (!visible) return undefined;
    const takeIfInFront = () => {
      if (navigation && !navigation.isFocused()) return;
      if (takeUnreportedSocialFailure()) showFailure();
    };
    if (unreportedFailure) takeIfInFront();
    const stopFocus = navigation?.addListener('focus', takeIfInFront);
    return () => stopFocus?.();
  }, [navigation, unreportedFailure, showFailure, visible]);

  if (!visible) return null;

  const start = (provider: SocialProvider) => {
    if (busy) return;
    setFailed(false);
    void signInWithSocialProvider(provider).then((outcome) => {
      if (outcome === 'failed') showFailure();
    });
  };

  const orDivider = (
    <View style={styles.divider} {...hiddenFromAccessibility}>
      <View style={styles.dividerRule} />
      <LPText size={13} color={colors.paper2}>
        {t('auth.or_divider')}
      </LPText>
      <View style={styles.dividerRule} />
    </View>
  );

  return (
    <View style={[styles.block, busy && styles.busy]} testID="auth.social">
      {divider === 'above' && orDivider}

      {providers.apple && (
        <ProviderButton
          testID="auth.apple"
          label={t('auth.continue_apple')}
          disabled={busy}
          running={running}
          onPress={() => start('apple')}
          style={styles.apple}
          labelStyle={styles.appleLabel}
          logo={<Ionicons name="logo-apple" size={20} color={PROVIDER_WHITE} />}
        />
      )}

      {providers.google && (
        <ProviderButton
          testID="auth.google"
          label={t('auth.continue_google')}
          disabled={busy}
          running={running}
          onPress={() => start('google')}
          style={styles.google}
          labelStyle={styles.googleLabel}
          logo={<GoogleG size={18} />}
        />
      )}

      {failed && (
        // Said to TalkBack by `showFailure` once; no live region, which would say it twice.
        <LPText size={13} color={colors.destructive} align="center" testID="auth.social_failed">
          {t('auth.social_failed')}
        </LPText>
      )}

      <MarkupText style={styles.terms} linkColor={colors.accentText} testID="auth.social_terms">
        {t(termsKey(providers), { terms: MerchantInfo.termsURL, privacy: MerchantInfo.privacyURL })}
      </MarkupText>

      {divider === 'below' && orDivider}
    </View>
  );
}

interface ProviderButtonProps {
  readonly testID: string;
  readonly label: string;
  readonly disabled: boolean;
  /** A provider sign-in is on its way (TalkBack says busy; a button disabled by the email form is not). */
  readonly running: boolean;
  readonly onPress: () => void;
  readonly style: StyleProp<ViewStyle>;
  readonly labelStyle: StyleProp<TextStyle>;
  readonly logo: ReactNode;
}

function ProviderButton({ testID, label, disabled, running, onPress, style, labelStyle, logo }: ProviderButtonProps) {
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled, busy: running }}
      style={({ pressed }) => [styles.button, style, pressed && !disabled && styles.pressed]}
    >
      <View {...hiddenFromAccessibility}>{logo}</View>
      <Text style={labelStyle} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
        {label}
      </Text>
    </Pressable>
  );
}

/**
 * Google's four-colour "G" (the mark from Google's sign-in button assets),
 * drawn as vectors so it stays sharp at every density. Decorative: the label
 * says what the button does.
 */
function GoogleG({ size }: { readonly size: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 48 48">
      <Path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <Path
        fill="#4285F4"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
      />
      <Path
        fill="#FBBC05"
        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
      />
      <Path
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
      />
    </Svg>
  );
}

const styles = StyleSheet.create({
  block: { gap: 12 },
  busy: { opacity: 0.6 },
  divider: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 4 },
  dividerRule: { flex: 1, height: 1, backgroundColor: colors.line },
  button: {
    minHeight: SOCIAL_BUTTON_HEIGHT,
    borderRadius: SOCIAL_BUTTON_RADIUS,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 16,
  },
  pressed: { opacity: 0.85 },
  apple: { backgroundColor: APPLE_BLACK },
  appleLabel: { fontFamily: SYSTEM_MEDIUM, fontSize: 19, color: PROVIDER_WHITE, flexShrink: 1 },
  google: { backgroundColor: PROVIDER_WHITE, borderWidth: 1, borderColor: colors.line2 },
  googleLabel: { fontFamily: SYSTEM_MEDIUM, fontSize: 19, color: colors.paper, flexShrink: 1 },
  terms: { ...sans(12), color: colors.paper2, textAlign: 'center' },
});
