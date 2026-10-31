/**
 * The plan and pass cards' copy (iOS LocalizationKeyTests
 * `testThePlanCardCopyExistsInBothLanguages`, and the Plan model the
 * PlansCatalogPassesTests read): every subtitle, feature line and day pass
 * name is a key in BOTH languages and translated, so an Icelandic screen
 * never shows "The regular", "6 visits" or "One day, one visit" in English;
 * the product names read the same in both, as on lifepass.is.
 */
import { lookup, translate } from '../../../i18n';
import { tables } from '../../../i18n/tables';
import {
  ALL_PLANS,
  continueName,
  copyKeys,
  displayName,
  fallbackVisitorPasses,
  featureLines,
  featureText,
  isDayPass,
  OFF_SALE_SLUGS,
  planForSlug,
  SUBSCRIPTION_PLANS,
  subtitle,
  VISITOR_PACKAGES,
} from '../plans';

const plan = (id: string) => {
  const found = planForSlug(id);
  if (!found) throw new Error(`no plan ${id}`);
  return found;
};

const DASHES = /[–—]/;

describe('the plan card copy', () => {
  it('every key exists in both languages, is translated and has no dash', () => {
    const keys = new Set(ALL_PLANS.flatMap(copyKeys));
    expect(keys.size).toBeGreaterThan(0);
    for (const key of keys) {
      expect([key, tables.en[key] !== undefined]).toEqual([key, true]);
      expect([key, tables.is[key] !== undefined]).toEqual([key, true]);
      for (const value of [tables.en[key], tables.is[key]]) {
        expect([key, DASHES.test(value)]).toEqual([key, false]);
      }
      // A day pass's English name is the same with "Continue with".
      if (key.endsWith('.with')) continue;
      expect([key, tables.en[key] !== tables.is[key]]).toEqual([key, true]);
    }
  });

  it('every card reads its own language, with no placeholder left', () => {
    for (const p of ALL_PLANS) {
      const en = featureLines(p, 'en');
      const is = featureLines(p, 'is');
      expect(en.length).toBe(is.length);
      en.forEach((english, i) => {
        expect([p.id, english]).not.toEqual([p.id, is[i]]);
        expect(is[i]).not.toContain('{');
      });
      expect(subtitle(p, 'en')).not.toBe(subtitle(p, 'is'));
      expect(subtitle(p, 'is')).not.toBe(p.subtitleKey);
      // The English cards read exactly as before.
      expect(displayName(p, 'en')).toBe(p.name);
    }
  });

  it('reads the shipped English and the Icelandic for it', () => {
    expect(subtitle(plan('plan-plus'), 'en')).toBe('The regular');
    expect(subtitle(plan('plan-plus'), 'is')).toBe('Fastagesturinn');
    expect(featureLines(plan('plan-base'), 'en')).toEqual([
      'In-bundle venues included',
      'Premium venues pay-as-you-go',
      'Cancel anytime',
    ]);
    expect(featureLines(plan('plan-base'), 'is')).toEqual([
      'Staðir í pakkanum innifaldir',
      'Premium-staðir greiddir hverju sinni',
      'Uppsögn hvenær sem er',
    ]);
    expect(featureLines(plan('plan-max'), 'en')[0]).toBe('Premium venues at member prices when out of visits');
    expect(subtitle(plan('pass-adventurer'), 'en')).toBe('A proper stay');
    expect(featureLines(plan('pass-adventurer'), 'en')).toEqual(['6 visits', 'Valid 60 days', 'Use across in-bundle venues']);
    expect(featureLines(plan('pass-adventurer'), 'is')).toEqual([
      '6 heimsóknir',
      '60 daga gildistími',
      'Nýtist á öllum stöðum í pakkanum',
    ]);
    expect(subtitle(plan('pass-day-gym'), 'en')).toBe('One day, one visit');
    expect(subtitle(plan('pass-day-gym'), 'is')).toBe('Einn dagur, ein heimsókn');
    expect(featureLines(plan('pass-day-gym'), 'en')).toEqual(['1 visit', 'Valid same day', 'Any gym or fitness club']);
    expect(featureLines(plan('pass-day-gym'), 'is')).toEqual([
      '1 heimsókn',
      'Gildir sama dag',
      'Hvaða rækt eða líkamsræktarstöð sem er',
    ]);
    expect(featureLines(plan('pass-day-studio'), 'en').at(-1)).toBe('Boutique studios: yoga, Pilates & more');
    expect(featureLines(plan('pass-day-pool'), 'is').at(-1)).toBe('Almenningssundlaugar');
  });

  it('names day passes by category in Icelandic, and "Continue with" takes the dative', () => {
    expect(displayName(plan('pass-day-gym'), 'en')).toBe('Gym Day Pass');
    expect(displayName(plan('pass-day-gym'), 'is')).toBe('Rækt dagspassi');
    expect(displayName(plan('pass-day-studio'), 'is')).toBe('Stúdíó dagspassi');
    expect(displayName(plan('pass-day-pool'), 'is')).toBe('Sundlaug dagspassi');
    expect(continueName(plan('pass-day-gym'), 'is')).toBe('Rækt dagspassa');
    expect(translate('plans.continue', 'is', { name: continueName(plan('pass-day-studio'), 'is') })).toBe(
      'Áfram með Stúdíó dagspassa',
    );
    expect(continueName(plan('pass-day-gym'), 'en')).toBe('Gym Day Pass');
    expect(displayName(plan('pass-explorer'), 'is')).toBe('Explorer');
    expect(continueName(plan('plan-max'), 'is')).toBe('Max');
  });

  it('counts lines with Icelandic number agreement (21 heimsókn, 11 heimsóknir)', () => {
    expect(featureText({ kind: 'visits', count: 21 }, 'is')).toBe('21 heimsókn');
    expect(featureText({ kind: 'visits', count: 11 }, 'is')).toBe('11 heimsóknir');
    expect(featureText({ kind: 'visits', count: 1 }, 'en')).toBe('1 visit');
    expect(featureText({ kind: 'visits', count: 21 }, 'en')).toBe('21 visits');
    expect(featureText({ kind: 'validDays', days: 90 }, 'en')).toBe('Valid 90 days');
    expect(featureText({ kind: 'validDays', days: 1 }, 'en')).toBe('Valid 1 day');
    expect(featureText({ kind: 'validDays', days: 31 }, 'is')).toBe('31 dags gildistími');
  });

  it('never says "3 months" or a minimum commitment on any card', () => {
    for (const p of ALL_PLANS) {
      for (const lang of ['en', 'is'] as const) {
        for (const text of [subtitle(p, lang), ...featureLines(p, lang)]) {
          expect(text).not.toMatch(/3[- ]month|3 mánuð|minimum/i);
        }
      }
    }
    expect(lookup('plans.fine.sub_terms', 'en')).toContain('No minimum commitment');
  });
});

describe('the plan list', () => {
  it('sells three memberships, Plus the popular one', () => {
    expect(SUBSCRIPTION_PLANS.map((p) => p.id)).toEqual(['plan-base', 'plan-plus', 'plan-max']);
    expect(SUBSCRIPTION_PLANS.filter((p) => p.isPopular).map((p) => p.id)).toEqual(['plan-plus']);
  });

  it('lists packs before day passes, Adventurer the popular one', () => {
    expect(VISITOR_PACKAGES.map((p) => p.id)).toEqual([
      'pass-explorer',
      'pass-adventurer',
      'pass-local',
      'pass-day-gym',
      'pass-day-studio',
      'pass-day-pool',
    ]);
    expect(VISITOR_PACKAGES.filter((p) => p.isPopular).map((p) => p.id)).toEqual(['pass-adventurer']);
  });

  it('tells a day pass from a pack (testADayPassIsNotCalledAVisitPack, the model half)', () => {
    expect(VISITOR_PACKAGES.filter(isDayPass).map((p) => p.id)).toEqual(['pass-day-gym', 'pass-day-studio', 'pass-day-pool']);
    expect(VISITOR_PACKAGES.filter((p) => !isDayPass(p)).map((p) => p.id)).toEqual([
      'pass-explorer',
      'pass-adventurer',
      'pass-local',
    ]);
    expect(SUBSCRIPTION_PLANS.some(isDayPass)).toBe(false);
  });

  it('knows the Pool Day Pass is off sale and leaves it out without a catalogue', () => {
    expect([...OFF_SALE_SLUGS]).toEqual(['pass-day-pool']);
    expect(fallbackVisitorPasses().map((p) => p.id)).toEqual([
      'pass-explorer',
      'pass-adventurer',
      'pass-local',
      'pass-day-gym',
      'pass-day-studio',
    ]);
  });
});
