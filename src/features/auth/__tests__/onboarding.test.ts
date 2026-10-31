/**
 * The onboarding's words and order (iOS OnboardingFlow): the phone's
 * language, the slides' copy and photos, where Next and back lead, and the
 * retired product rule that must never come back.
 */
import { lookup, markupRuns, type Lang } from '../../../i18n';
import { freshStorePerTest, phoneLanguage } from '../../../stores/__tests__/storeHarness';
import en from '../../../i18n/strings.en.json';
import is from '../../../i18n/strings.is.json';
import { nextStage, previousStage, SLIDE_PHOTOS, slideCopy, tOnboarding } from '../onboarding';

const TABLES: Record<Lang, Record<string, string>> = { en, is };

freshStorePerTest();

describe('the language', () => {
  it('is the phone language, whatever the app last spoke', () => {
    phoneLanguage('is');
    expect(tOnboarding('onboard.get_started')).toBe('Byrja');
    phoneLanguage('en');
    expect(tOnboarding('onboard.get_started')).toBe('Get started');
  });
});

describe('the slides', () => {
  it('read their own kicker, title and body, and show their own photo', () => {
    for (const lang of ['en', 'is'] as const) {
      for (const n of [1, 2, 3]) {
        const copy = slideCopy(n, lang);
        expect(copy.kicker).toBe(lookup(`onboard.slide${n}.kicker`, lang));
        expect(copy.title).toBe(lookup(`onboard.slide${n}.title`, lang));
        expect(copy.body).toBe(lookup(`onboard.slide${n}.body`, lang));
        expect(copy.photo).toBe(SLIDE_PHOTOS[n as 1 | 2 | 3]);
        expect(copy.isLast).toBe(n === 3);
      }
    }
  });

  it('reads any index past the third as the third, as iOS does', () => {
    expect(slideCopy(4, 'en')).toEqual(slideCopy(3, 'en'));
    expect(slideCopy(0, 'en')).toEqual(slideCopy(3, 'en'));
  });

  it('each title and the headline turn on exactly one italic run', () => {
    for (const lang of ['en', 'is'] as const) {
      for (const key of ['onboard.splash_headline', 'onboard.slide1.title', 'onboard.slide2.title', 'onboard.slide3.title']) {
        expect(markupRuns(lookup(key, lang)).filter((run) => run.italic)).toHaveLength(1);
      }
    }
  });
});

describe('the order', () => {
  it('Next: splash, 1, 2, 3, then sign-up', () => {
    expect(nextStage('splash')).toBe(1);
    expect(nextStage(1)).toBe(2);
    expect(nextStage(2)).toBe(3);
    expect(nextStage(3)).toBeNull();
  });

  it('back: 3, 2, 1, the splash, then the system', () => {
    expect(previousStage(3)).toBe(2);
    expect(previousStage(2)).toBe(1);
    expect(previousStage(1)).toBe('splash');
    expect(previousStage('splash')).toBeNull();
  });
});

describe('the retired copy', () => {
  it('no onboarding or sign-up string promises a three-month minimum, in either language', () => {
    for (const lang of ['en', 'is'] as const) {
      for (const [key, value] of Object.entries(TABLES[lang])) {
        if (!key.startsWith('onboard.') && !key.startsWith('auth.')) continue;
        expect(`${key}: ${value}`).not.toMatch(/three months|3 months|þrjá mánuði|3 mánuði/i);
      }
    }
  });
});
