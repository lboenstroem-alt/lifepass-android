/**
 * The signed-out entry (auth route `Onboarding`): the Android port of iOS
 * `OnboardingFlow`'s splash and three slides (Views/Onboarding/OnboardingFlow.swift).
 *
 *   Splash ── Get started ──▶ slide 1 ▶ 2 ▶ 3 ── Choose a plan / I'll decide later / Skip ──▶ Sign up
 *          └─ I already have an account ─────────────────────────────────────────────────▶ Log in
 *
 * The splash always shows to a signed-out phone; the slides only after "Get
 * started", so a returning member is one tap from Log in. Back (the chevron
 * or the hardware key) on slide 1 returns to the splash; on the splash the
 * hardware key leaves as usual. Log in and Sign up are the stack's own
 * routes here, where iOS swaps stages: Sign up's "Sign in" link and the
 * check-your-email OK replace Sign up with Log in, as the stage switch does.
 *
 * Every word is the PHONE's language (./onboarding.ts). No permission is
 * asked here (iOS PERMISSION_PROMPTS.md: never at launch).
 *
 * A failed auth link jumps to Log in, where its banner is (./useLoginOnLinkError.ts).
 *
 * THE LOOK (iOS 2.5.6, light): the photo fills the screen edge to edge under
 * a scrim that fades DOWN to paper, and the copy is ink on that paper. The
 * slides' top chrome (progress, back, Skip) stays white with a soft shadow,
 * readable on any photo. The headline and titles take the largest size that
 * fits (48, 40, 34 and 40, 32, 26, as `ViewThatFits`), and at the largest
 * text sizes the copy scrolls rather than run off the screen.
 */
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  Animated,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
  type LayoutChangeEvent,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Kicker, LPText, PrimaryButton } from '../../../components/ui';
import { useReduceMotion } from '../../../hooks/useReduceMotion';
import { deviceLanguage, markupPlain, MarkupText, useLanguageStore, type Lang } from '../../../i18n';
import { useHardwareBack } from '../../../navigation/guards';
import type { AuthStackScreenProps } from '../../../navigation/types';
import { colors, fonts, serif } from '../../../theme';
import {
  HEADLINE_STEPS,
  markOnboardingSeen,
  nextStage,
  previousStage,
  slideCopy,
  SPLASH_PHOTO,
  TITLE_STEPS,
  tOnboarding,
  type OnboardingStage,
} from '../onboarding';
import { useLoginOnLinkError } from '../useLoginOnLinkError';

/** iOS `Color.lpInk` (#F8F6F1) at an opacity: the scrims fade to paper. */
const paperWash = (opacity: number) => `rgba(248,246,241,${opacity})`;

/** The italic run in Fraunces' own italic face (no synthetic slant on top). */
const SERIF_ITALIC = { fontFamily: fonts.serifItalic, fontStyle: 'normal' } as const;

/**
 * The phone's language, re-read whenever the app's language changes (the app
 * store re-reads the device on every return to the foreground).
 */
function useOnboardingLanguage(): Lang {
  useLanguageStore((s) => s.language);
  return deviceLanguage();
}

/**
 * The largest of `steps` sizes whose content fits the viewport: starts at the
 * first and steps down while the content is taller (iOS `ViewThatFits(in:
 * .vertical)`). Starts again from the largest when `resetKey` changes.
 */
function useFitStep(stepCount: number, resetKey: string) {
  const [step, setStep] = useState(0);
  const viewport = useRef(0);
  const content = useRef(0);

  useEffect(() => {
    setStep(0);
  }, [resetKey]);

  const check = useCallback(() => {
    if (viewport.current <= 0 || content.current <= viewport.current + 0.5) return;
    setStep((current) => Math.min(current + 1, stepCount - 1));
  }, [stepCount]);

  return {
    step,
    onViewport: (event: LayoutChangeEvent) => {
      viewport.current = event.nativeEvent.layout.height;
      check();
    },
    /** `padding` is the scroll content's own vertical padding, outside the measured column. */
    onContent: (event: LayoutChangeEvent, padding: number) => {
      content.current = event.nativeEvent.layout.height + padding;
      check();
    },
  };
}

/** The photo behind a stage, edge to edge, with a paper gradient while it loads (iOS `HeroBackdrop`). */
function HeroBackdrop({ photo, scrim }: { readonly photo: string; readonly scrim: ReactNode }) {
  return (
    <View style={StyleSheet.absoluteFill} accessible={false} importantForAccessibility="no-hide-descendants">
      <LinearGradient colors={[colors.ink3, colors.ink2]} style={StyleSheet.absoluteFill} />
      <Image source={{ uri: photo }} style={StyleSheet.absoluteFill} resizeMode="cover" />
      {scrim}
    </View>
  );
}

export default function OnboardingScreen({ navigation }: AuthStackScreenProps<'Onboarding'>) {
  const [stage, setStage] = useState<OnboardingStage>('splash');
  const lang = useOnboardingLanguage();
  const reduceMotion = useReduceMotion();
  const fade = useRef(new Animated.Value(1)).current;

  // A new stage fades in (iOS `withAnimation(.easeInOut(duration: 0.3))`).
  const goTo = useCallback(
    (next: OnboardingStage) => {
      setStage(next);
      if (reduceMotion) return;
      fade.setValue(0);
      Animated.timing(fade, { toValue: 1, duration: 300, useNativeDriver: true }).start();
    },
    [fade, reduceMotion],
  );

  const toLogin = useCallback(() => {
    markOnboardingSeen();
    navigation.navigate('Login');
  }, [navigation]);

  const toSignUp = useCallback(() => {
    markOnboardingSeen();
    navigation.navigate('SignUp');
  }, [navigation]);

  useLoginOnLinkError(toLogin, { onMount: true });

  const back = useCallback(() => {
    const previous = previousStage(stage);
    if (previous !== null) goTo(previous);
  }, [goTo, stage]);

  // The hardware key walks back through the slides; on the splash it is the system's.
  useHardwareBack(() => {
    back();
    return true;
  }, stage !== 'splash');

  return (
    <View style={styles.root}>
      <Animated.View style={[styles.page, { opacity: fade }]}>
        {stage === 'splash' ? (
          <Splash lang={lang} onGetStarted={() => goTo(1)} onLogin={toLogin} />
        ) : (
          <Slide
            index={stage}
            lang={lang}
            onNext={() => {
              const next = nextStage(stage);
              if (next === null) toSignUp();
              else goTo(next);
            }}
            onSkip={toSignUp}
            onBack={back}
          />
        )}
      </Animated.View>
    </View>
  );
}

// ─── Splash ─────────────────────────────────────────────────────────

function Splash({
  lang,
  onGetStarted,
  onLogin,
}: {
  readonly lang: Lang;
  readonly onGetStarted: () => void;
  readonly onLogin: () => void;
}) {
  const insets = useSafeAreaInsets();
  const window = useWindowDimensions();
  const headline = tOnboarding('onboard.splash_headline', lang);
  const paddingTop = Math.max(insets.top + 60, 100);
  const paddingBottom = Math.max(insets.bottom + 16, 32);
  const fit = useFitStep(HEADLINE_STEPS.length, `${lang}:${window.width}x${window.height}:${window.fontScale}`);
  const size = HEADLINE_STEPS[fit.step]!;

  return (
    <View style={styles.page} testID="onboarding.splash">
      <HeroBackdrop
        photo={SPLASH_PHOTO}
        scrim={
          <LinearGradient
            colors={[paperWash(0.25), paperWash(0.55), paperWash(0.95)]}
            locations={[0, 0.45, 1]}
            style={StyleSheet.absoluteFill}
          />
        }
      />
      <ScrollView
        style={styles.page}
        contentContainerStyle={[styles.bottomColumn, { paddingTop, paddingBottom }]}
        onLayout={fit.onViewport}
        showsVerticalScrollIndicator={false}
        bounces={false}
        overScrollMode="never"
        testID="onboarding.splash.scroll"
      >
        <View
          style={styles.splashColumn}
          onLayout={(event) => fit.onContent(event, paddingTop + paddingBottom)}
          testID="onboarding.splash.column"
        >
          <Kicker text={tOnboarding('onboard.iceland_pass', lang)} color={colors.paper2} />
          <MarkupText
            style={[
              serif(size.size),
              styles.headline,
              { letterSpacing: size.tracking, lineHeight: Math.round(size.size * 1.12) },
            ]}
            italicStyle={SERIF_ITALIC}
            accessibilityRole="header"
            accessibilityLabel={markupPlain(headline)}
            testID="onboarding.headline"
          >
            {headline}
          </MarkupText>
          <LPText size={15} color={colors.paper2} style={styles.splashBody}>
            {tOnboarding('onboard.splash_body', lang)}
          </LPText>
          <View style={styles.splashActions}>
            <PrimaryButton title={tOnboarding('onboard.get_started', lang)} onPress={onGetStarted} testID="onboarding.getStarted" />
            <Pressable
              onPress={onLogin}
              accessibilityRole="button"
              style={({ pressed }) => [styles.linkButton, pressed && styles.pressed]}
              testID="onboarding.haveAccount"
            >
              <LPText size={14} color={colors.paper2} align="center">
                {tOnboarding('onboard.have_account_cta', lang)}
              </LPText>
            </Pressable>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

// ─── Slides ─────────────────────────────────────────────────────────

/** White chrome over the photo, with iOS's soft shadow (`.shadow(color: .black.opacity(0.35), radius: 3, y: 1)`). */
const CHROME_SHADOW = {
  textShadowColor: 'rgba(0,0,0,0.35)',
  textShadowOffset: { width: 0, height: 1 },
  textShadowRadius: 3,
} as const;

function Slide({
  index,
  lang,
  onNext,
  onSkip,
  onBack,
}: {
  readonly index: 1 | 2 | 3;
  readonly lang: Lang;
  readonly onNext: () => void;
  readonly onSkip: () => void;
  readonly onBack: () => void;
}) {
  const insets = useSafeAreaInsets();
  const window = useWindowDimensions();
  const copy = slideCopy(index, lang);
  const paddingBottom = Math.max(insets.bottom + 16, 32);
  const fit = useFitStep(TITLE_STEPS.length, `${index}:${lang}:${window.width}x${window.height}:${window.fontScale}`);
  const size = TITLE_STEPS[fit.step]!;

  return (
    <View style={styles.page} testID={`onboarding.slide${index}`}>
      <HeroBackdrop
        photo={copy.photo}
        scrim={
          <LinearGradient
            colors={[paperWash(0.1), paperWash(0.95)]}
            locations={[0.25, 0.95]}
            style={StyleSheet.absoluteFill}
          />
        }
      />

      {/* Progress, back and Skip. */}
      <View style={[styles.chrome, { paddingTop: Math.max(insets.top + 12, 50) }]}>
        <View style={styles.progress} accessible={false} importantForAccessibility="no-hide-descendants">
          {[1, 2, 3].map((step) => (
            <View key={step} style={[styles.progressBar, step <= index && styles.progressBarDone]} />
          ))}
        </View>
        <View style={styles.chromeRow}>
          <Pressable
            onPress={onBack}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={tOnboarding('common.back', lang)}
            style={styles.backButton}
            testID="onboarding.back"
          >
            <Ionicons name="chevron-back" size={16} color="#FFFFFF" style={CHROME_SHADOW} />
          </Pressable>
          <Pressable onPress={onSkip} hitSlop={10} accessibilityRole="button" style={styles.skipButton} testID="onboarding.skip">
            <LPText size={13} color="#FFFFFF" style={CHROME_SHADOW}>
              {tOnboarding('common.skip', lang)}
            </LPText>
          </Pressable>
        </View>
      </View>

      {/* The copy and its actions, at the bottom. */}
      <ScrollView
        style={styles.page}
        contentContainerStyle={[styles.bottomColumn, { paddingBottom }]}
        onLayout={fit.onViewport}
        showsVerticalScrollIndicator={false}
        bounces={false}
        overScrollMode="never"
        testID="onboarding.slide.scroll"
      >
        <View
          style={styles.slideColumn}
          onLayout={(event) => fit.onContent(event, paddingBottom)}
          testID="onboarding.slide.column"
        >
          <Kicker text={copy.kicker} color={colors.paper2} testID="onboarding.kicker" />
          <MarkupText
            style={[
              serif(size.size),
              styles.headline,
              { letterSpacing: size.tracking, lineHeight: Math.round(size.size * 1.12) },
            ]}
            italicStyle={SERIF_ITALIC}
            accessibilityRole="header"
            accessibilityLabel={markupPlain(copy.title)}
            testID="onboarding.title"
          >
            {copy.title}
          </MarkupText>
          <LPText size={14} color={colors.paper2} style={styles.slideBody}>
            {copy.body}
          </LPText>
          {copy.isLast ? (
            <View style={styles.lastActions}>
              <PrimaryButton title={tOnboarding('onboard.choose_plan', lang)} onPress={onNext} testID="onboarding.choosePlan" />
              <Pressable
                onPress={onSkip}
                accessibilityRole="button"
                style={({ pressed }) => [styles.linkButton, pressed && styles.pressed]}
                testID="onboarding.decideLater"
              >
                <LPText size={14} color={colors.paper2} align="center">
                  {tOnboarding('onboard.decide_later', lang)}
                </LPText>
              </Pressable>
            </View>
          ) : (
            <View style={styles.nextRow}>
              <View style={styles.dots} accessible={false} importantForAccessibility="no-hide-descendants">
                {[1, 2, 3].map((step) => (
                  <View key={step} style={[styles.dot, step === index && styles.dotActive]} />
                ))}
              </View>
              <PrimaryButton title={tOnboarding('common.next', lang)} onPress={onNext} block={false} testID="onboarding.next" />
            </View>
          )}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.ink },
  page: { flex: 1 },
  bottomColumn: { flexGrow: 1, justifyContent: 'flex-end', paddingHorizontal: 28 },
  splashColumn: { gap: 18 },
  headline: { color: colors.paper },
  splashBody: { lineHeight: 21 },
  splashActions: { gap: 4, marginTop: 6 },
  linkButton: { paddingVertical: 12, minHeight: 44, justifyContent: 'center' },
  pressed: { opacity: 0.6 },

  chrome: { paddingBottom: 4 },
  progress: { flexDirection: 'row', gap: 4, paddingHorizontal: 28 },
  progressBar: { flex: 1, height: 2, borderRadius: 1, backgroundColor: 'rgba(255,255,255,0.4)' },
  progressBarDone: { backgroundColor: '#FFFFFF' },
  chromeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    marginTop: 4,
  },
  backButton: { padding: 10, minWidth: 44, minHeight: 44, justifyContent: 'center' },
  skipButton: { paddingRight: 20, paddingLeft: 10, minHeight: 44, justifyContent: 'center' },

  slideColumn: { gap: 16 },
  slideBody: { lineHeight: 20 },
  lastActions: { marginTop: 8 },
  nextRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 },
  dots: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  dot: { width: 5, height: 5, borderRadius: 2.5, backgroundColor: colors.paper3 },
  dotActive: { width: 20, backgroundColor: colors.paper },
});
