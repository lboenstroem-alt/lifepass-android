/**
 * The onboarding a signed-out phone shows, in the PHONE's language: the
 * RNTL port of iOS OnboardingUITests. Walks splash > slide 1 > 2 > 3 and
 * reads every piece of copy back, in English and in Icelandic, with none of
 * the other language and none of the retired copy ("cancel anytime after
 * three months"). Then where each button goes, back, and the jump to Log in
 * for a failed auth link.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, screen } from '@testing-library/react-native';
import { DeviceEventEmitter } from 'react-native';

import { bottomSheetMock } from '../../../components/ui/testing/bottomSheetMock';
import { lookup, markupPlain, type Lang } from '../../../i18n';
import { freshStorePerTest, phoneLanguage } from '../../../stores/__tests__/storeHarness';
import { resetAppStoreForTests, useAppStore } from '../../../stores/appStore';
import { HAS_SEEN_ONBOARDING_KEY, slideCopy } from '../onboarding';
import { authStack, currentAuthRoute, renderAuth } from './authHarness';

jest.mock('@gorhom/bottom-sheet', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('../../../components/ui/testing/bottomSheetMock').bottomSheetModule,
);
jest.mock('expo-asset', () => jest.requireActual('expo/node_modules/expo-asset'), { virtual: true });

freshStorePerTest();
beforeEach(() => bottomSheetMock.reset());

/** What each screen must say (OnboardingUITests.Words), read from the tables. */
function words(lang: Lang) {
  const k = (key: string) => lookup(key, lang);
  return {
    getStarted: k('onboard.get_started'),
    haveAccount: k('onboard.have_account_cta'),
    kicker: k('onboard.iceland_pass').toUpperCase(),
    headline: markupPlain(k('onboard.splash_headline')),
    splashBody: k('onboard.splash_body'),
    next: k('common.next'),
    skip: k('common.skip'),
    choosePlan: k('onboard.choose_plan'),
    decideLater: k('onboard.decide_later'),
    slides: [1, 2, 3].map((n) => {
      const copy = slideCopy(n, lang);
      return { kicker: copy.kicker.toUpperCase(), title: markupPlain(copy.title), body: copy.body };
    }),
  };
}

/** The iOS UI test's own vectors, so a regenerated table that drifts is caught here too. */
const IOS_ENGLISH = {
  headline: 'The stillness\nof Iceland,\non one pass.',
  kickers: ['01 — FORTY VENUES', '02 — ONE PLAN, MANY VENUES', '03 — ONE CODE, EVERY DOOR'],
  titles: ['Lagoons, studios,\nsaunas, gyms — one tap away.', 'Pay for how\nyou actually show up.', 'Scan in.\nNo queue at the desk.'],
  bodyFragments: ['Every partner, one pass.', 'Cancel anytime.', 'every partner — just scan in.'],
};
const IOS_ICELANDIC = {
  headline: 'Kyrrð Íslands,\ná einu korti.',
  kickers: ['01 · FJÖRUTÍU STAÐIR', '02 · EIN ÁSKRIFT, MARGIR STAÐIR', '03 · EINN KÓÐI, ALLAR DYR'],
  titles: ['Lón, stúdíó,\nsánur, ræktir.\nEin snerting.', 'Borgaðu eftir því\nhversu oft þú mætir.', 'Skannaðu þig inn.\nEngin röð í afgreiðslu.'],
  bodyFragments: ['Allir staðir, eitt kort.', 'Uppsögn hvenær sem er.', 'Þú skannar þig bara inn.'],
};
/** The English as it was hardcoded must never show on an Icelandic phone. */
const ENGLISH_ONLY = ['The stillness', 'Forty venues', 'one tap away', 'One tap away', 'actually show up', 'No queue at the desk', 'Cancel anytime'];

/** All the text on screen, one string (nested runs joined). */
function shownText(): string {
  const strings: string[] = [];
  const walk = (node: unknown): void => {
    if (typeof node === 'string') strings.push(node);
    else if (Array.isArray(node)) node.forEach(walk);
    else if (node && typeof node === 'object' && 'children' in node) walk((node as { children: unknown }).children);
  };
  walk(screen.toJSON());
  return strings.join('\n');
}

function expectText(testID: string, text: string) {
  expect(screen.getByTestId(testID)).toHaveTextContent(text, { normalizer: (value) => value });
}

async function press(name: string) {
  await fireEvent.press(screen.getByRole('button', { name }));
}

async function pressBack() {
  await act(async () => {
    DeviceEventEmitter.emit('hardwareBackPress');
  });
}

async function launch(lang: Lang) {
  phoneLanguage(lang);
  resetAppStoreForTests();
  useAppStore.setState({ isLoading: false });
  await renderAuth();
}

describe.each<Lang>(['en', 'is'])('the walk on a %s phone', (lang) => {
  const w = words(lang);
  const ios = lang === 'is' ? IOS_ICELANDIC : IOS_ENGLISH;
  const other = words(lang === 'is' ? 'en' : 'is');

  it('the splash, then the three slides, every word in the phone language', async () => {
    await launch(lang);

    // Splash.
    expect(screen.getByText(w.kicker)).toBeOnTheScreen();
    expect(w.headline).toBe(ios.headline);
    expectText('onboarding.headline', ios.headline);
    expect(screen.getByRole('header', { name: ios.headline })).toBeOnTheScreen();
    expect(screen.getByText(w.splashBody)).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: w.getStarted })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: w.haveAccount })).toBeOnTheScreen();
    expect(shownText()).toContain(w.splashBody);
    expect(shownText()).not.toContain(other.headline.split('\n')[0]!);
    if (lang === 'is') for (const fragment of ENGLISH_ONLY) expect(shownText()).not.toContain(fragment);

    await press(w.getStarted);

    for (const slide of [1, 2, 3] as const) {
      const copy = w.slides[slide - 1]!;
      expect(screen.getByTestId(`onboarding.slide${slide}`)).toBeOnTheScreen();
      expect(copy.kicker).toBe(ios.kickers[slide - 1]);
      expect(screen.getByText(copy.kicker)).toBeOnTheScreen();
      expect(copy.title).toBe(ios.titles[slide - 1]);
      expectText('onboarding.title', copy.title);
      expect(copy.body).toContain(ios.bodyFragments[slide - 1]);
      expect(screen.getByText(copy.body)).toBeOnTheScreen();
      expect(screen.getByRole('button', { name: w.skip })).toBeOnTheScreen();
      expect(shownText()).not.toContain(other.slides[slide - 1]!.kicker);
      if (lang === 'is') for (const fragment of ENGLISH_ONLY) expect(shownText()).not.toContain(fragment);
      expect(shownText()).not.toMatch(/three months|þrjá mánuði/i);
      if (slide < 3) {
        expect(screen.queryByRole('button', { name: w.choosePlan })).toBeNull();
        await press(w.next);
      } else {
        expect(screen.getByRole('button', { name: w.choosePlan })).toBeOnTheScreen();
        expect(screen.getByRole('button', { name: w.decideLater })).toBeOnTheScreen();
        expect(screen.queryByRole('button', { name: w.next })).toBeNull();
      }
    }
  });

  it('Skip opens Sign up, which goes on in the same language', async () => {
    await launch(lang);
    await press(w.getStarted);
    await press(w.skip);
    expect(currentAuthRoute()).toBe('SignUp');
    expect(screen.getByRole('header', { name: lookup('auth.create', lang) })).toBeOnTheScreen();
    expect(screen.getByText(lookup('auth.subtitle', lang))).toBeOnTheScreen();
  });
});

describe('where the buttons go', () => {
  beforeEach(() => launch('en'));
  const w = words('en');

  it('"I already have an account" opens Log in, and remembers onboarding was seen', async () => {
    await press(w.haveAccount);
    expect(currentAuthRoute()).toBe('Login');
    expect(await AsyncStorage.getItem(HAS_SEEN_ONBOARDING_KEY)).toBe('true');
  });

  it('Choose a plan and I\'ll decide later both open Sign up', async () => {
    await press(w.getStarted);
    await press(w.next);
    await press(w.next);
    await press(w.choosePlan);
    expect(authStack()).toEqual(['Onboarding', 'SignUp']);

    await pressBack();
    expect(currentAuthRoute()).toBe('Onboarding');
    await press(w.decideLater);
    expect(currentAuthRoute()).toBe('SignUp');
  });

  it('back walks the slides to the splash: the chevron and the hardware key', async () => {
    await press(w.getStarted);
    await press(w.next);
    expect(screen.getByTestId('onboarding.slide2')).toBeOnTheScreen();
    await pressBack();
    expect(screen.getByTestId('onboarding.slide1')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: lookup('common.back', 'en') }));
    expect(screen.getByTestId('onboarding.splash')).toBeOnTheScreen();
    expect(currentAuthRoute()).toBe('Onboarding');
  });
});

describe('a failed auth link', () => {
  it('jumps from the splash to Log in, where its banner is', async () => {
    await launch('en');
    await act(async () => {
      useAppStore.getState().setDeepLinkError(lookup('auth.deeplink_err_confirm', 'en'));
    });
    expect(currentAuthRoute()).toBe('Login');
    expect(screen.getByText(lookup('auth.deeplink_err_confirm', 'en'))).toBeOnTheScreen();
  });

  it('that failed before the screens were up opens them on Log in', async () => {
    phoneLanguage('en');
    resetAppStoreForTests();
    useAppStore.setState({ isLoading: false, deepLinkError: lookup('auth.deeplink_err_recovery', 'en') });
    await renderAuth();
    expect(currentAuthRoute()).toBe('Login');
    expect(screen.getByText(lookup('auth.deeplink_err_recovery', 'en'))).toBeOnTheScreen();
  });

  it('jumps from Sign up to Log in in its place', async () => {
    await launch('en');
    await press(words('en').getStarted);
    await press(words('en').skip);
    await act(async () => {
      useAppStore.getState().setDeepLinkError(lookup('auth.deeplink_err_confirm', 'en'));
    });
    expect(authStack()).toEqual(['Onboarding', 'Login']);
  });

  it('does not trap the member on Log in once they go back', async () => {
    await launch('en');
    await act(async () => {
      useAppStore.getState().setDeepLinkError(lookup('auth.deeplink_err_confirm', 'en'));
    });
    await pressBack();
    expect(currentAuthRoute()).toBe('Onboarding');
    expect(screen.getByTestId('onboarding.splash')).toBeOnTheScreen();
  });
});
