/**
 * What the onboarding says and shows, kept apart from the screen so the copy
 * rules are tests (iOS OnboardingFlow.swift, OnboardingUITests).
 *
 * THE LANGUAGE IS THE PHONE'S (iOS `tOnboarding`): nobody is signed in, so
 * there is no account language, and an Icelandic phone gets Icelandic
 * onboarding. The app store agrees while signed out (it follows the device),
 * which is what carries the same language on into sign-up.
 *
 * The headline and slide titles mark their italic run in the string
 * (`*on one pass.*`); line breaks travel in the string too. F1's MarkupText
 * draws the runs (iOS `OnboardingMarkup`).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import { deviceLanguage, lookup, type Lang } from '../../i18n';

/** The splash, then slides 1 to 3 (iOS `OnboardingFlow.Stage`, less its Log in and Sign up stages). */
export type OnboardingStage = 'splash' | 1 | 2 | 3;

/** iOS `@AppStorage("hasSeenOnboarding")`: informational; the splash always shows. */
export const HAS_SEEN_ONBOARDING_KEY = 'hasSeenOnboarding';

/** The splash photo (the same Unsplash lagoon iOS loads). */
export const SPLASH_PHOTO =
  'https://images.unsplash.com/photo-1506905925346-21bda4d32df4?auto=format&fit=crop&w=1400&q=80';

/** Each slide's photo, as iOS picks them. */
export const SLIDE_PHOTOS: Readonly<Record<1 | 2 | 3, string>> = {
  1: 'https://images.unsplash.com/photo-1604537466158-719b1972feb8?auto=format&fit=crop&w=1400&q=80',
  2: 'https://images.unsplash.com/photo-1610552050890-fe99536c2615?auto=format&fit=crop&w=1400&q=80',
  3: 'https://images.unsplash.com/photo-1570197788417-0e82375c9371?auto=format&fit=crop&w=1400&q=80',
};

/** The splash headline's sizes and tracking, largest first: the largest that fits is drawn (iOS `ViewThatFits`). */
export const HEADLINE_STEPS: readonly { readonly size: number; readonly tracking: number }[] = [
  { size: 48, tracking: -1.8 },
  { size: 40, tracking: -1.4 },
  { size: 34, tracking: -1.0 },
];

/** A slide title's sizes and tracking, largest first (iOS `ViewThatFits`). */
export const TITLE_STEPS: readonly { readonly size: number; readonly tracking: number }[] = [
  { size: 40, tracking: -1.2 },
  { size: 32, tracking: -1 },
  { size: 26, tracking: -0.8 },
];

/** iOS `tOnboarding`: a key in the phone's language. */
export function tOnboarding(key: string, lang: Lang = deviceLanguage()): string {
  return lookup(key, lang);
}

export interface SlideCopy {
  readonly kicker: string;
  /** With its `*italic*` run and `\n` breaks. */
  readonly title: string;
  readonly body: string;
  readonly photo: string;
  readonly isLast: boolean;
}

/** A slide's words in `lang`. Any index past the third reads as the third, as on iOS. */
export function slideCopy(index: number, lang: Lang = deviceLanguage()): SlideCopy {
  const slide: 1 | 2 | 3 = index === 1 || index === 2 ? index : 3;
  const key = `onboard.slide${slide}`;
  return {
    kicker: tOnboarding(`${key}.kicker`, lang),
    title: tOnboarding(`${key}.title`, lang),
    body: tOnboarding(`${key}.body`, lang),
    photo: SLIDE_PHOTOS[slide],
    isLast: slide === 3,
  };
}

/** The stage Next leads to; null after the last slide (then sign-up). */
export function nextStage(stage: OnboardingStage): OnboardingStage | null {
  if (stage === 'splash') return 1;
  return stage < 3 ? ((stage + 1) as OnboardingStage) : null;
}

/** The stage back leads to; null on the splash (leave the screen as the system does). */
export function previousStage(stage: OnboardingStage): OnboardingStage | null {
  if (stage === 'splash') return null;
  return stage === 1 ? 'splash' : ((stage - 1) as OnboardingStage);
}

/** Records that the member has been through (or past) onboarding. Best effort. */
export function markOnboardingSeen(): void {
  void AsyncStorage.setItem(HAS_SEEN_ONBOARDING_KEY, 'true').catch(() => undefined);
}
