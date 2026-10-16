// The copy rules, as iOS keeps them: unit tests over the EN and IS
// dictionaries. Ports LocalizationDashTests, LocalizationKeyTests (with
// Release254LocalizationTests) and LocalizationClaimsTests one for one,
// over the generated iOS tables AND every Android pack.
//
// The assertions iOS makes through a model the owning package ports
// (MemberRefusal.allRows, DiscountCode.Problem, Plan.all,
// FeedbackActionButton, MerchantInfo) are left to that package; every
// assertion on the words themselves is here.
import { ENGLISH_RULE_PLURALS, lookup, translate } from '..';
import { markupPlain, markupRuns } from '../markup';
import {
  app,
  baseDictionary,
  EM_DASH,
  EN_DASH,
  hasDash,
  hasEmoji,
  healthPacks,
  intentionalOverrides,
  LANGS,
  mergedHealth,
  placeholders,
  preReleaseKeys,
  rulePacks,
  valuesOf,
} from './dictionaries';

const en = app.en;
const is = app.is;

/** Fail with every offender listed, not just the first. */
function expectNone(offenders: string[]): void {
  expect(offenders).toEqual([]);
}

/** Every key exists in both tables, is translated, and has no dash or emoji. */
function expectCleanAndTranslated(keys: readonly string[], options: { translated?: boolean } = {}): void {
  const problems: string[] = [];
  for (const key of keys) {
    if (en[key] === undefined) problems.push(`${key} has no English`);
    if (is[key] === undefined) problems.push(`${key} has no Icelandic`);
    if ((options.translated ?? true) && en[key] === is[key]) problems.push(`${key} is not translated`);
    for (const lang of LANGS) {
      const value = app[lang][key] ?? '';
      if (hasDash(value)) problems.push(`dash in ${key} (${lang}): ${value}`);
      if (hasEmoji(value)) problems.push(`emoji in ${key} (${lang})`);
    }
  }
  expectNone(problems);
}

/** Each key keeps its placeholders in both languages. */
function expectPlaceholders(table: [string, string[]][]): void {
  const problems: string[] = [];
  for (const [key, wanted] of table) {
    for (const lang of LANGS) {
      const value = lookup(key, lang);
      for (const placeholder of wanted) {
        if (!value.includes(placeholder)) problems.push(`${lang} ${key} lost ${placeholder}`);
      }
    }
  }
  expectNone(problems);
}

/** A word character as ICU (NSRegularExpression) counts one: any letter, mark, digit or _. */
const WORD = String.raw`[\p{L}\p{M}\p{Nd}_]`;

/**
 * An NSRegularExpression pattern, case-insensitive, as JavaScript: ICU's \b,
 * \w and \d know every script, JavaScript's only ASCII (without this,
 * "\bmissa" would match inside "ámissa").
 */
function icu(pattern: string, flags = 'iu'): RegExp {
  const source = pattern
    .replace(/\\b/g, `(?:(?<=${WORD})(?!${WORD})|(?<!${WORD})(?=${WORD}))`)
    .replace(/\\w/g, WORD)
    .replace(/\\d/g, String.raw`\p{Nd}`);
  return new RegExp(source, flags);
}

// MARK: - LocalizationDashTests

describe('LocalizationDashTests', () => {
  it('has no em or en dash in any health or Android string (testNoDashesInAnyHealthString)', () => {
    expectNone(rulePacks.flatMap(valuesOf).filter((v) => hasDash(v.value)).map((v) => `${v.label}: ${v.value}`));
  });

  it('has no emoji in any health or Android string (testNoEmoji)', () => {
    expectNone(rulePacks.flatMap(valuesOf).filter((v) => hasEmoji(v.value)).map((v) => v.label));
  });

  it('has every key in both languages (testEveryKeyExistsInBothLanguages)', () => {
    for (const pack of rulePacks) {
      const english = Object.keys(pack.en);
      const icelandic = Object.keys(pack.is);
      expect([pack.name, english.filter((k) => !(k in pack.is))]).toEqual([pack.name, []]);
      expect([pack.name, icelandic.filter((k) => !(k in pack.en))]).toEqual([pack.name, []]);
    }
    expect(Object.keys(is).sort()).toEqual(Object.keys(en).sort());
  });

  describe('onboarding', () => {
    const onboarding = (table: Readonly<Record<string, string>>) =>
      Object.fromEntries(Object.entries(table).filter(([key]) => key.startsWith('onboard.')));
    const onboardingEN = onboarding(en);
    const onboardingIS = onboarding(is);
    const onboardingStrings = [
      ...Object.entries(onboardingEN).map(([key, value]) => ({ key: `${key} (en)`, value })),
      ...Object.entries(onboardingIS).map(([key, value]) => ({ key: `${key} (is)`, value })),
    ];
    const SCREEN_KEYS = [
      'onboard.splash_headline',
      'onboard.slide1.kicker', 'onboard.slide1.title', 'onboard.slide1.body',
      'onboard.slide2.kicker', 'onboard.slide2.title', 'onboard.slide2.body',
      'onboard.slide3.kicker', 'onboard.slide3.title', 'onboard.slide3.body',
    ];
    // The shipped English onboarding was written with an em dash before the
    // rule existed; keeping it pixel-identical outranks the rule, in English
    // only, for exactly these keys (see the iOS test for the history).
    const SHIPPED_ENGLISH_WITH_AN_EM_DASH = new Set([
      'onboard.slide1.kicker', 'onboard.slide2.kicker', 'onboard.slide3.kicker',
      'onboard.slide1.title', 'onboard.slide3.body',
    ]);

    it('has no dash outside the shipped English (testNoDashesInAnyOnboardingString)', () => {
      const problems: string[] = [];
      for (const [key, value] of Object.entries(onboardingEN)) {
        if (!SHIPPED_ENGLISH_WITH_AN_EM_DASH.has(key) && hasDash(value)) problems.push(`${key} (en): ${value}`);
      }
      for (const [key, value] of Object.entries(onboardingIS)) {
        if (hasDash(value)) problems.push(`${key} (is): ${value}`);
      }
      for (const key of SHIPPED_ENGLISH_WITH_AN_EM_DASH) {
        if (!onboardingEN[key]?.includes(EM_DASH)) problems.push(`${key} (en) is exempt but carries no em dash`);
      }
      expectNone(problems);
    });

    it('is the shipped English copy (testTheEnglishOnboardingCopyIsTheCopyAtFourNineSevenZero)', () => {
      const shipped: Record<string, string> = {
        'onboard.splash_headline': 'The stillness\nof Iceland,\n*on one pass.*',
        'onboard.slide1.kicker': '01 — Forty venues',
        'onboard.slide1.title': 'Lagoons, studios,\nsaunas, gyms — *one tap away.*',
        'onboard.slide1.body': 'From Sky Lagoon to the basement mats at Mjölnir. Every partner, one pass.',
        'onboard.slide2.kicker': '02 — One plan, many venues',
        'onboard.slide2.title': 'Pay for how\nyou *actually* show up.',
        'onboard.slide2.body':
          'Pick a plan with a monthly allowance of gym, studio and pool visits. Premium spots are pay-as-you-go. Cancel anytime.',
        'onboard.slide3.kicker': '03 — One code, every door',
        'onboard.slide3.title': 'Scan in.\n*No queue at the desk.*',
        'onboard.slide3.body':
          'Your personal QR works at every partner — just scan in. In-plan venues are covered by your monthly allowance; premium spots add a small surcharge.',
      };
      expect(Object.keys(shipped).sort()).toEqual([...SCREEN_KEYS].sort());
      for (const [key, value] of Object.entries(shipped)) expect([key, lookup(key, 'en')]).toEqual([key, value]);
    });

    it('has no emoji (testNoEmojiInAnyOnboardingString)', () => {
      expectNone(onboardingStrings.filter((s) => hasEmoji(s.value)).map((s) => s.key));
    });

    it('has every key in both languages (testEveryOnboardingKeyExistsInBothLanguages)', () => {
      expect(Object.keys(onboardingIS).sort()).toEqual(Object.keys(onboardingEN).sort());
    });

    it('writes the splash and every slide in Icelandic (testTheSplashAndEverySlideAreWrittenInIcelandic)', () => {
      for (const key of SCREEN_KEYS) {
        expect(lookup(key, 'en')).not.toBe(key);
        expect(lookup(key, 'is')).not.toBe('');
        expect([key, lookup(key, 'is')]).not.toEqual([key, lookup(key, 'en')]);
      }
      expect(lookup('onboard.splash_headline', 'is')).toBe('Kyrrð Íslands,\n*á einu korti.*');
      expect(lookup('onboard.splash_headline', 'en')).toBe('The stillness\nof Iceland,\n*on one pass.*');
    });

    it('pairs its italic marks and draws none (testOnboardingItalicMarksArePairedAndDrawNothing)', () => {
      const problems: string[] = [];
      for (const { key, value } of onboardingStrings) {
        const marks = [...value].filter((c) => c === '*').length;
        if (marks !== 0 && marks !== 2) problems.push(`${key} carries ${marks} italic marks`);
        if (value.includes('**')) problems.push(`${key} has an empty italic run`);
        if (markupPlain(value).includes('*')) problems.push(`${key} would draw an asterisk`);
      }
      for (const key of SCREEN_KEYS.filter((k) => k.endsWith('headline') || k.endsWith('title'))) {
        for (const lang of LANGS) {
          const italicRuns = markupRuns(lookup(key, lang)).filter((run) => run.italic).length;
          if (italicRuns !== 1) problems.push(`${key} (${lang}) has ${italicRuns} italic runs`);
        }
      }
      expectNone(problems);
    });
  });

  it('keeps the map ring strings clean and in both languages (testTheMapRingStringsAreCleanAndInBothLanguages)', () => {
    const mapEN = Object.keys(en).filter((k) => k.startsWith('map.'));
    const mapIS = Object.keys(is).filter((k) => k.startsWith('map.'));
    expect(mapEN.length).toBeGreaterThanOrEqual(24);
    expect(mapIS.sort()).toEqual(mapEN.sort());
    const problems: string[] = [];
    for (const key of mapEN) {
      for (const lang of LANGS) {
        const value = app[lang][key]!;
        if (!value) problems.push(`${key} (${lang}) is empty`);
        if (hasDash(value)) problems.push(`dash in ${key} (${lang})`);
        if (hasEmoji(value)) problems.push(`emoji in ${key} (${lang})`);
        if (value.includes('→')) problems.push(`an arrow character in ${key} (${lang}): the chevron is a symbol`);
      }
      if (en[key] === is[key]) problems.push(`${key} is not translated`);
    }
    expectNone(problems);
  });

  it('keeps every refusal string clean and translated (testTheRefusalStringsAreCleanAndInBothLanguages)', () => {
    // F2 adds the keys its MemberRefusal table reuses (MemberRefusal.allRows).
    const keys = Object.keys(en).filter((k) => k.startsWith('refusal.'));
    expect(keys.length).toBeGreaterThanOrEqual(55);
    expectCleanAndTranslated([...keys, 'error.refusal_fallback']);
  });

  it('keeps the card-less class pay strings clean and never calls the no-plan price a surcharge (testTheClassPayStringsAreCleanAndInBothLanguages)', () => {
    expectCleanAndTranslated([
      'booking.pay.refunded_class_body',
      'consent.surcharge_premium_no_plan',
      'booking.pay.not_paid_title',
      'booking.pay.not_paid_body',
      'consent.disclosure.topup_monthly_exhausted',
    ]);
    const noPlan = LANGS.map((lang) => lookup('consent.surcharge_premium_no_plan', lang).toLowerCase());
    expect(noPlan[0]).not.toContain('surcharge');
    expect(noPlan[1]).not.toContain('álag');
    expect(noPlan.every((v) => v.includes('{price}'))).toBe(true);
    const outOfVisits = LANGS.map((lang) => lookup('consent.disclosure.topup_monthly_exhausted', lang).toLowerCase());
    expect(outOfVisits[0]).not.toContain('surcharge');
    expect(outOfVisits[0]).not.toContain('beyond your plan');
    expect(outOfVisits[1]).not.toContain('álag');
    expect(outOfVisits[1]).not.toContain('umfram');
    expect(outOfVisits.every((v) => v.includes('{price}'))).toBe(true);
  });

  it('reads the studio surcharge right for every plan (testTheStudioSurchargeReadsRightForEveryPlan)', () => {
    const key = 'consent.surcharge_boutique_overflow';
    const english = lookup(key, 'en');
    const icelandic = lookup(key, 'is');
    expect(is[key]).toBeDefined();
    expect(english).toBe(
      'This studio visit uses 1 of your monthly visits plus the {price} surcharge, charged when you confirm.',
    );
    expect(english).not.toContain('a {price}');
    expect(english.toLowerCase()).not.toContain('used your included');
    expect(icelandic).not.toContain('nýtt innifaldar');
    expect(icelandic).toContain('{price} álags');
    expect(icelandic).toContain('mánaðarheimsókn');
    expect(hasDash(english) || hasDash(icelandic)).toBe(false);
    const shown = translate(key, 'en', { price: 'ISK 5,772' });
    expect(shown).toContain('plus the ISK 5,772 surcharge');
    expect(shown).not.toContain('a ISK');
  });

  it('never puts “a” before a price in English (testNoEnglishStringSaysAISK)', () => {
    expectNone(
      Object.entries(en)
        .filter(([, value]) => icu(String.raw`\b[Aa] \{(price|total|amount)\}`, 'u').test(value))
        .map(([key, value]) => `${key}: ${value}`),
    );
    for (const key of ['consent.surcharge', 'consent.surcharge_premium_pass_visit', 'consent.surcharge_premium_subscriber_visit']) {
      const value = lookup(key, 'en');
      expect([key, value.includes('a surcharge of {price}')]).toEqual([key, true]);
      expect([key, value.includes(EM_DASH) || value.includes(EN_DASH)]).toEqual([key, false]);
    }
  });
});

// MARK: - LocalizationKeyTests

describe('LocalizationKeyTests', () => {
  it('lets no health key collide with a pre-release key but the override (testNoHealthKeyCollidesWithAPreReleaseKey)', () => {
    const problems: string[] = [];
    for (const pack of healthPacks) {
      for (const key of Object.keys(pack.en)) {
        if (preReleaseKeys.has(key) && !intentionalOverrides.has(key)) problems.push(`${pack.name} redefines ${key}`);
      }
    }
    expectNone(problems);
    expect([...intentionalOverrides]).toEqual(['coach.greeting']);
  });

  it('lets no two packs define one key (testNoKeyIsDefinedByTwoPacks)', () => {
    const owner = new Map<string, string>();
    const problems: string[] = [];
    for (const pack of rulePacks) {
      for (const key of Object.keys(pack.en)) {
        const existing = owner.get(key);
        if (existing) problems.push(`${key} is defined by both ${existing} and ${pack.name}`);
        owner.set(key, pack.name);
      }
    }
    expectNone(problems);
  });

  it('keeps the charge alert’s copy and the health consent namespace free (testTheChargeAlertKeepsItsCopyAndTheConsentNamespaceIsFree)', () => {
    expect(lookup('consent.title', 'en')).toBe('Confirm charge');
    expect([...preReleaseKeys].filter((k) => k.startsWith('healthconsent.'))).toEqual([]);
  });

  /** Keys a health feature added: in both packs, translated, and new. */
  function expectNewHealthKeys(keys: readonly string[]): void {
    const english = mergedHealth('en');
    const icelandic = mergedHealth('is');
    const problems: string[] = [];
    for (const key of keys) {
      if (english[key] === undefined) problems.push(`missing English ${key}`);
      if (icelandic[key] === undefined) problems.push(`missing Icelandic ${key}`);
      if (english[key] === icelandic[key]) problems.push(`${key} is not translated`);
      if (preReleaseKeys.has(key)) problems.push(`${key} collides with a shipped key`);
    }
    expectNone(problems);
  }

  it('has every monthly feedback key in both languages (testTheMonthlyFeedbackKeysExistInBothLanguages)', () => {
    expectNewHealthKeys([
      'feedback.card.kicker', 'feedback.card.new', 'feedback.card.open', 'feedback.card.history',
      'feedback.card.row_sub', 'feedback.note.kicker', 'feedback.note.dismiss', 'feedback.intro.kicker',
      'feedback.intro.title', 'feedback.intro.body', 'feedback.intro.body_no_food', 'feedback.intro.first',
      'feedback.intro.choose', 'feedback.intro.ok', 'feedback.offer.kicker', 'feedback.offer.title',
      'feedback.offer.body', 'feedback.offer.on', 'feedback.offer.not_now', 'feedback.offer.done',
      'feedback.detail.title', 'feedback.detail.note_title', 'feedback.detail.settings',
      'feedback.detail.history', 'feedback.detail.not_found', 'feedback.detail.pending',
      'feedback.history.title', 'feedback.history.empty', 'feedback.history.more',
      'feedback.action.change_days', 'feedback.action.log_meal',
      'notif.feedback.monthly.title', 'notif.feedback.monthly.body',
      'notif.feedback.note.title', 'notif.feedback.note.body', 'program.refused.feedback_food_off',
      'bodygoals.sec.feedback', 'bodygoals.fb_monthly', 'bodygoals.fb_monthly_sub', 'bodygoals.fb_note',
      'bodygoals.fb_note_sub', 'bodygoals.fb_food', 'bodygoals.fb_food_sub', 'bodygoals.fb_food_offer',
      'bodygoals.fb_past', 'bodygoals.fb_footer', 'bodygoals.fb_err', 'bodygoals.deleted.feedback.one',
      'bodygoals.deleted.feedback.many',
    ]);
    // The one key both languages write the same way: a label and a value.
    expect(mergedHealth('en')['feedback.a11y.metric']).toBe('{label}: {value}');
    expect(mergedHealth('is')['feedback.a11y.metric']).toBe('{label}: {value}');
    // Feedback's Adjust my plan button reuses the Coach chip's words.
    expect(en['coach.chip.adjust_plan']).toBeDefined();
  });

  it('has every target weight and Adjust key in both languages (testTheTargetWeightAndAdjustKeysExistInBothLanguages)', () => {
    expectNewHealthKeys([
      'target.field', 'target.field_hint', 'target.err.range', 'target.err.needs_weight',
      'target.err.lose_direction', 'target.err.gain_direction', 'target.err.bmi_low', 'target.err.bmi_high',
      'target.err.server', 'target.reached_prefill_note', 'target.sheet.title', 'target.sheet.why',
      'target.sheet.for_goal', 'target.sheet.needs_goal', 'target.sheet.save', 'target.sheet.use',
      'target.sheet.remove', 'target.sheet.remove_title', 'target.privacy', 'target.line', 'target.line_eta',
      'target.eta_note', 'target.reached.title', 'target.reached.body', 'target.reached.line',
      'target.reached.cta', 'target.unhealthy.body', 'target.unhealthy.short',
      'program.body.added_target', 'program.refused.target_bmi_low', 'program.refused.target_bmi_high',
      'program.chip.change_target', 'coach.chip.adjust_plan', 'program.active_exists_adjust',
      'program.chip.start_new', 'program.make_new.replaces_saved', 'program.make_new.replaces_running',
      'program.adjust.title', 'program.adjust.now', 'program.adjust.opt.goal', 'program.adjust.opt.goal_only',
      'program.adjust.opt.days', 'program.adjust.opt.weekdays', 'program.adjust.opt.length',
      'program.adjust.opt.new_plan', 'program.adjust.opt.cancel', 'program.adjust.cancelled',
      'program.adjust.q.goal', 'program.adjust.same_goal', 'program.adjust.q.safety',
      'program.adjust.safety.no', 'program.adjust.safety.yes', 'program.adjust.safety_stop',
      'program.adjust.q.target', 'program.adjust.target.set', 'program.adjust.target.keep',
      'program.adjust.target.none', 'program.adjust.q.days', 'program.adjust.q.weekdays',
      'program.adjust.q.length', 'program.adjust.confirm', 'program.adjust.line.goal',
      'program.adjust.line.days', 'program.adjust.line.weekdays', 'program.adjust.line.length',
      'program.adjust.line.target', 'program.adjust.line.target_none', 'program.adjust.confirm_note',
      'program.adjust.replaces_saved', 'program.adjust.show', 'program.adjust.change_more',
      'program.adjust.building', 'program.adjust.confirm_target', 'program.adjust.confirm_target_remove',
      'program.adjust.save_target', 'program.adjust.target_saved', 'program.adjust.target_removed',
      'program.adjust.days_saved', 'program.adjust.err.limit', 'program.adjust.err.changed',
      'program.adjust.nothing', 'program.revision.kicker', 'program.revision.start',
      'program.revision.switch.title', 'program.revision.switch.body', 'program.revision.switch.confirm',
      'program.revision.stale', 'history.plan.revised',
      'bodygoals.target', 'bodygoals.target_add', 'bodygoals.chart.target', 'bodygoals.chart.a11y_target',
    ]);
  });

  it('has every class sheet key in both languages, placeholders intact (testTheClassSheetKeysExistInBothLanguages)', () => {
    const keys = [
      'classsheet.title', 'classsheet.checking', 'classsheet.gone', 'classsheet.unavailable',
      'classsheet.other_times', 'classsheet.row_hint', 'classsheet.summary_a11y',
      'classsheet.confirm_a11y', 'classsheet.load_error', 'classsheet.price_line', 'common.close',
      'booking.class.err_passed', 'booking.class.err_full', 'booking.class.err_not_open',
    ];
    const problems = keys.filter((k) => en[k] === undefined || is[k] === undefined || en[k] === is[k]);
    expectNone(problems);
    expectPlaceholders([
      ['classsheet.summary_a11y', ['{name}', '{venue}', '{when}']],
      ['classsheet.confirm_a11y', ['{name}', '{when}']],
      ['classsheet.price_line', ['{price}']],
    ]);
  });

  it('has every discount code key in both languages (testTheDiscountCodeKeysExistInBothLanguages)', () => {
    // PLANS-2 adds: every DiscountCode.Problem reads one of these keys.
    const keys = [
      'plans.promo.label', 'plans.promo.placeholder', 'plans.promo.hint', 'plans.promo.hint_pass',
      'plans.promo.clear', 'plans.promo.err.invalid', 'plans.promo.err.expired',
      'plans.promo.err.product', 'plans.promo.err.memberships', 'plans.promo.err.format',
    ];
    expectNone(keys.filter((k) => en[k] === undefined || is[k] === undefined || en[k] === is[k]));
  });

  it('speaks of eID, in the website’s words, on the plans screen and in the Kenni sheet (testTheEidAndPassOffSaleKeysExistInBothLanguages)', () => {
    const keys = [
      'plans.eid.required', 'plans.eid.no_id_hint', 'plans.eid.see_passes',
      'plans.err.not_on_sale', 'plans.passes.none', 'plans.kenni_step',
      'kenni.title', 'kenni.body', 'kenni.onboarding_body', 'kenni.cta', 'kenni.retry',
      'kenni.passes_note', 'kenni.see_passes', 'kenni.support',
      'kenni.sign_in_other', 'kenni.sign_in_other_hint',
      'kenni.err.cancelled', 'kenni.err.expired', 'kenni.err.failed', 'kenni.err.linked',
      'kenni.err.server', 'kenni.err.offline', 'kenni.err.start',
    ];
    const problems: string[] = [];
    for (const key of keys) {
      if (en[key] === undefined || is[key] === undefined || en[key] === is[key]) problems.push(`${key} missing or untranslated`);
      for (const value of [en[key] ?? '', is[key] ?? '']) {
        if (value.includes('Kenni.is')) problems.push(`${key} still names Kenni.is`);
        if (hasDash(value)) problems.push(`${key} has a dash`);
      }
    }
    expectNone(problems);
    expect(en['plans.eid.required']).toBe('Requires Icelandic electronic ID (rafræn skilríki).');
    expect(is['plans.eid.required']).toBe('Krefst rafrænna skilríkja.');
    expect(en['plans.eid.no_id_hint']).toBe("No Icelandic eID? Visitor passes don't need one.");
    expect(is['plans.eid.no_id_hint']).toBe('Ekki með íslensk rafræn skilríki? Gestapassar þurfa þau ekki.');
    expect(en['plans.eid.see_passes']).toBe('See visitor passes');
    expect(is['plans.eid.see_passes']).toBe('Skoða gestapassa');
    expect(en['kenni.retry']).toBe('Try again with eID');
    expect(is['kenni.retry']).toBe('Reyna aftur með rafrænum skilríkjum');
    expect(en['kenni.sign_in_other']).toBe('Sign in with another account');
    expect(is['kenni.sign_in_other']).toBe('Skrá inn með öðrum aðgangi');
    expect(en['kenni.support']).toBe('Contact support');
    expect(is['kenni.support']).toBe('Hafa samband við okkur');
    expect(en['kenni.err.start']).toBe(
      "We couldn't start the eID check. Try again, or choose a visitor pass, which doesn't need eID.",
    );
    expect(is['kenni.err.start']).toBe(
      'Ekki tókst að hefja auðkenninguna. Reyndu aftur eða veldu gestapassa, sem þarf ekki rafræn skilríki.',
    );
    for (const key of ['kenni.err.cancelled', 'kenni.err.expired', 'kenni.err.failed', 'kenni.err.server', 'kenni.err.offline', 'kenni.err.start']) {
      expect([key, en[key]?.includes('eID check')]).toEqual([key, true]);
      expect([key, en[key]?.includes('identity verification')]).toEqual([key, false]);
    }
    expect(en['plans.err.not_on_sale']).toBe("This pass isn't on sale right now. Passes you already have still work.");
    expect(is['plans.err.not_on_sale']).toBe('Þessi passi er ekki til sölu eins og er. Passar sem þú átt nú þegar gilda áfram.');
  });

  it('has every walk-in coverage key in both languages, placeholders intact (testTheWalkInCoverageKeysExistInBothLanguages)', () => {
    expectCleanAndTranslated(
      [
        'checkin.cover.eyebrow', 'checkin.cover.pass', 'checkin.cover.visits.one',
        'checkin.cover.visits.many', 'checkin.cover.left', 'checkin.cover.left_none',
        'checkin.cover.subscription', 'checkin.cover.subscription_plain', 'checkin.cover.free',
        'checkin.cover.pass_name.day', 'checkin.cover.pass_name.explorer',
        'checkin.cover.pass_name.adventurer', 'checkin.cover.pass_name.local',
        'checkin.cover.pass_name.lagoon_duo', 'checkin.cover.pass_name.other',
        'checkin.cover.check_in', 'checkin.cover.guest_toggle', 'checkin.cover.guest_hint',
        'checkin.balance.label', 'checkin.balance.pass', 'checkin.balance.pass_none',
        'checkin.balance.network.one', 'checkin.balance.network.many', 'checkin.balance.network_none',
        'checkin.balance.pool.one', 'checkin.balance.pool.many', 'checkin.balance.pool_none',
        'checkin.guests.per_guest', 'checkin.guests.own_free', 'checkin.guests.own_charged',
        'checkin.guests.own_price', 'checkin.guests.a11y_add', 'checkin.guests.a11y_remove',
        'consent.guests_only', 'consent.guests_extra', 'consent.dropin_guests_button',
        'account.pass_visits_left.one', 'account.pass_visits_left.many',
        'account.pass_valid_until', 'account.pass_valid_until_line',
        'usage.pass.day', 'usage.pass.explorer', 'usage.pass.adventurer', 'usage.pass.local',
        'usage.pass.other',
      ].filter(Boolean),
    );
    expect(en['usage.pass.lagoon_duo']).toBe('Lagoon Duo');
    expect(is['usage.pass.lagoon_duo']).toBe('Lagoon Duo');
    expectPlaceholders([
      ['checkin.cover.pass', ['{pass}', '{visits}', '{left}']],
      ['checkin.cover.subscription', ['{tier}', '{left}']],
      ['checkin.cover.subscription_plain', ['{tier}']],
      ['checkin.cover.visits.one', ['{count}']],
      ['checkin.cover.visits.many', ['{count}']],
      ['checkin.cover.left', ['{count}']],
      ['checkin.balance.pass', ['{left}', '{visits}', '{pass}']],
      ['checkin.balance.pass_none', ['{pass}']],
      ['checkin.balance.network.one', ['{count}']],
      ['checkin.balance.network.many', ['{count}']],
      ['checkin.balance.pool.one', ['{count}']],
      ['checkin.balance.pool.many', ['{count}']],
      ['checkin.guests.own_price', ['{price}']],
      ['checkin.guests.a11y_add', ['{band}']],
      ['checkin.guests.a11y_remove', ['{band}']],
      ['consent.guests_only', ['{price}']],
      ['consent.guests_extra', ['{guests}', '{total}']],
      ['consent.dropin_guests_button', ['{price}']],
      ['account.pass_visits_left.one', ['{count}']],
      ['account.pass_visits_left.many', ['{count}']],
      ['account.pass_valid_until', ['{date}']],
      ['account.pass_valid_until_line', ['{date}']],
    ]);
    // The web's words for the step, with the app's colon for the web's dash.
    expect(en['checkin.cover.check_in']).toBe('Check in, no charge');
    expect(is['checkin.cover.check_in']).toBe('Skrá inn, ekkert gjald');
    expect(en['checkin.cover.guest_toggle']).toBe('Bringing a guest?');
    expect(is['checkin.cover.guest_toggle']).toBe('Ertu með gest?');
    // A guest price is per GUEST, never "per person".
    expect(en['checkin.guests.per_person']).toBeUndefined();
    expect(en['checkin.guests.per_guest']).toBe('per guest');
    expect(is['checkin.guests.per_guest']).toBe('á hvern gest');
    // Passes are passes, not packs.
    for (const key of ['usage.pass.explorer', 'usage.pass.adventurer', 'usage.pass.local']) {
      expect([key, en[key]?.includes('pack')]).toEqual([key, false]);
      expect([key, is[key]?.includes('pakki')]).toEqual([key, false]);
    }
  });

  it('says what eID verifying stores, in the website’s words (testTheEidDataNoteIsTheWebsitesInBothLanguages)', () => {
    expectCleanAndTranslated(['kenni.data_note', 'kenni.privacy_link']);
    expect(en['kenni.data_note']).toBe(
      'Verifying saves your kennitala to your LifePass account. We use it to confirm who you are ' +
        'and to prevent duplicate or shared memberships, and Kling needs it to set up your payment ' +
        'agreement.',
    );
    expect(is['kenni.data_note']).toBe(
      'Við staðfestingu vistast kennitalan á LifePass-aðganginum þínum. Við notum hana til að ' +
        'staðfesta hver þú ert og koma í veg fyrir tvöfaldar eða samnýttar áskriftir, og Kling ' +
        'þarf hana til að stofna greiðslusamninginn.',
    );
    expect(en['kenni.privacy_link']).toBe('Privacy policy');
    expect(is['kenni.privacy_link']).toBe('Persónuverndarstefna');
  });
});

describe('Release254LocalizationTests', () => {
  const KEYS = [
    'auth.continue_apple', 'auth.continue_google', 'auth.or_divider',
    'auth.social_terms', 'auth.social_terms_apple', 'auth.social_failed',
    'explore.show_list', 'explore.show_map', 'explore.hint_list', 'explore.hint_map',
    'venue.scan_short', 'venue.walkin_heading', 'venue.walkin_body', 'kenni.err.linked',
  ];

  it('has every new key in both languages, translated, without dashes or emoji (testTheNewKeysExistInBothLanguages)', () => {
    expectCleanAndTranslated(KEYS);
  });

  it('says No booking needed (testTheWalkInHeadingSaysNoBookingNeeded)', () => {
    expect(lookup('venue.walkin_heading', 'en')).toBe('No booking needed');
    expect(lookup('venue.walkin_heading', 'is')).toBe('Engin bókun nauðsynleg');
    for (const lang of LANGS) expect(lookup('venue.walkin_body', lang).toLowerCase()).not.toContain('credit');
    expect(Object.values(en).some((v) => v.includes('Drop by during opening hours'))).toBe(false);
  });

  it('links Terms and Privacy in both social terms lines (testTheSocialTermsLinkTermsAndPrivacy)', () => {
    for (const key of ['auth.social_terms', 'auth.social_terms_apple']) {
      for (const lang of LANGS) {
        const value = lookup(key, lang);
        expect([key, lang, value.includes('({terms})') && value.includes('({privacy})')]).toEqual([key, lang, true]);
      }
    }
  });
});

// MARK: - LocalizationClaimsTests

describe('LocalizationClaimsTests', () => {
  /** Copied from the web's marketing-claims.test.ts, as the iOS test is. */
  const BANNED: [string, RegExp][] = [
    ['an amount of weight loss', icu(String.raw`\b(lose|drop|shed|burn off)\s+\d+(\.\d+)?\s*(kg|kilos?|kilograms?|lbs?|pounds)\b`)],
    ['a rate of weight change', icu(String.raw`\b\d+(\.\d+)?\s*(kg|kilos?|lbs?|pounds)\s+(a|per|each|every|in a)\s+(week|month)\b`)],
    ['þyngdartap í kílóum', icu(String.raw`\b(missa|léttast um|grennast um)\s+\d+\s*(kg|kíló)`)],
    ['hraði þyngdarbreytingar', icu(String.raw`\d+\s*(kg|kíló)\w*\s+á\s+(viku|mánuði)`)],
  ];

  const PREFIXES = [
    'target.', 'program.adjust.', 'program.revision.', 'bodygoals.target',
    'bodygoals.chart.target', 'bodygoals.chart.a11y_target', 'program.refused.target_',
    'program.body.added_target', 'coach.chip.adjust_plan', 'program.active_exists_adjust',
    'program.make_new.', 'program.chip.start_new', 'program.chip.change_target', 'history.plan.revised',
  ];

  /** Numbers that WOULD trip a pattern if the copy around them were a claim. */
  const SAMPLES: Record<string, string> = {
    '{kg}': '72', '{low}': '10', '{high}': '12', '{new}': '4', '{old}': '3',
    '{weeks}': '8', '{date}': '17 Sep', '{days}': 'Mon, Wed, Fri', '{goal}': 'Lose weight',
    '{summary}': 'Lose weight, 3 days a week',
  };

  const filled = (value: string, samples: Record<string, string>) =>
    Object.entries(samples).reduce((text, [placeholder, sample]) => text.split(placeholder).join(sample), value);

  it('still catches the claims it names (testThePatternsCatchTheClaims)', () => {
    for (const example of ['Lose 5 kg with LifePass', 'about 1 kg a week', 'Þú getur léttast um 5 kg', '2 kg á viku']) {
      expect([example, BANNED.some(([, pattern]) => pattern.test(example))]).toEqual([example, true]);
    }
    // Word boundaries know Icelandic letters, as ICU's do.
    expect(icu(String.raw`\bmissa\s+\d+`).test('missa 5 kg')).toBe(true);
    expect(icu(String.raw`\bmissa\s+\d+`).test('ámissa 5 kg')).toBe(false);
    expect(icu(String.raw`slæm\w*`).exec('slæmþ vika')?.[0]).toBe('slæmþ');
  });

  it('makes no weight claim in any target or Adjust string (testNoNewStringMakesAWeightClaim)', () => {
    let checked = 0;
    const problems: string[] = [];
    for (const pack of rulePacks) {
      for (const { label, key, value } of valuesOf(pack)) {
        if (!PREFIXES.some((prefix) => key.startsWith(prefix))) continue;
        checked += 1;
        const text = filled(value, SAMPLES);
        for (const [name, pattern] of BANNED) if (pattern.test(text)) problems.push(`${label} reads as ${name}: ${text}`);
        const lower = text.toLowerCase();
        if (lower.includes('kg per week') || lower.includes('kg a week')) problems.push(`${label}: ${text}`);
        if (lower.includes('á viku') && text.includes('kg')) problems.push(`${label}: ${text}`);
      }
    }
    expectNone(problems);
    expect(checked).toBeGreaterThan(150);
  });

  const FEEDBACK_PATTERNS: [string, RegExp][] = [
    ['a weight or kcal figure', icu(String.raw`\d+([.,]\d+)?\s*(kg|kíló|kcal|hitaeining)`)],
    ['eat less', icu(String.raw`\b(eat less|eating less|cut (back|down)|smaller portions|skip (a )?meals?|reduce (your )?(calories|portions|food))\b`)],
    ['borða minna', icu(String.raw`(borða minna|minni skammt|sleppa máltíð|skera niður|minnka (hitaeiningar|skammta|matinn))`)],
    ['shaming', icu(String.raw`\b(fail\w*|lazy|bad|disappoint\w*|should have|cheat\w*|guilt\w*|blame\w*)\b`)],
    ['skömm', icu(String.raw`(mistókst|lat(ur|ir|ar)|slæm\w*|vonbrigð\w*|hefðir átt|svindl\w*|samviskubit\w*)`)],
  ];

  const FEEDBACK_PREFIXES = [
    'feedback.', 'notif.feedback.', 'bodygoals.fb_', 'bodygoals.sec.feedback',
    'bodygoals.deleted.feedback', 'program.refused.feedback_food_off',
  ];

  const FEEDBACK_SAMPLES = { '{date}': '1 October', '{label}': 'Average steps a day', '{value}': '7,412', '{count}': '21' };

  it('makes no claim and never asks to eat less in any feedback string (testNoFeedbackStringMakesAClaimOrAsksToEatLess)', () => {
    let checked = 0;
    const problems: string[] = [];
    for (const pack of rulePacks) {
      for (const { label, key, value } of valuesOf(pack)) {
        if (!FEEDBACK_PREFIXES.some((prefix) => key.startsWith(prefix))) continue;
        checked += 1;
        const text = filled(value, FEEDBACK_SAMPLES);
        if (text.includes('{')) problems.push(`${label} has a placeholder the app does not fill: ${text}`);
        for (const [name, pattern] of [...BANNED, ...FEEDBACK_PATTERNS]) {
          if (pattern.test(text)) problems.push(`${label} reads as ${name}: ${text}`);
        }
      }
    }
    expectNone(problems);
    expect(checked).toBeGreaterThan(90);
    for (const example of ['Try to eat less at night', 'Þú ættir að borða minna', 'That was a bad week', '8 kg', '1.800 kcal']) {
      expect([example, FEEDBACK_PATTERNS.some(([, pattern]) => pattern.test(example))]).toEqual([example, true]);
    }
  });

  it('writes the estimate as a range of weeks (testTheEstimateIsARangeOfWeeks)', () => {
    expect(filled(lookup('target.line_eta', 'en'), SAMPLES)).toBe('Target 72 kg · about 10 to 12 weeks at this pace');
    expect(filled(lookup('target.line_eta', 'is'), SAMPLES)).toContain('um 10 til 12 vikur');
  });
});

// MARK: - The website's words

describe('the website’s words, word for word', () => {
  it('refuses a discount code as the owner wrote it (PlansDiscountCodeTests.testTheRefusalCopyInBothLanguages)', () => {
    const copy: [string, string, string][] = [
      [
        'plans.promo.err.invalid',
        "We don't recognise this code. Check it, or clear it to pay the full price.",
        'Við þekkjum ekki þennan kóða. Athugaðu hann eða hreinsaðu hann til að greiða fullt verð.',
      ],
      [
        'plans.promo.err.expired',
        'This code has expired. Clear it to pay the full price.',
        'Þessi kóði er útrunninn. Hreinsaðu hann til að greiða fullt verð.',
      ],
      ['plans.promo.err.product', "This code can't be used for this pass.", 'Ekki er hægt að nota þennan kóða fyrir þennan passa.'],
      [
        'plans.promo.err.memberships',
        'This code is for passes only, not memberships.',
        'Þessi kóði gildir aðeins fyrir passa, ekki áskriftir.',
      ],
      ['plans.promo.err.format', 'Codes use letters, numbers, - and _ only.', 'Kóðar innihalda aðeins bókstafi, tölustafi, - og _.'],
    ];
    for (const [key, english, icelandic] of copy) {
      expect([key, lookup(key, 'en'), lookup(key, 'is')]).toEqual([key, english, icelandic]);
    }
  });

  it('says the eID step’s sentences (KenniVerificationTests.testTheSentencesAreTheWebsWords)', () => {
    const copy: [string, string, string][] = [
      [
        'kenni.err.linked',
        'You already have a LifePass account. Sign in with the email you used before. If you chose Hide My Email with Apple, use your original email instead. Need help? Contact support@lifepass.is.',
        'Þú ert nú þegar með LifePass-aðgang. Skráðu þig inn með netfanginu sem þú notaðir áður. Ef þú valdir „Fela netfang“ hjá Apple skaltu nota upprunalega netfangið. Þarftu aðstoð? Hafðu samband við support@lifepass.is.',
      ],
      [
        'kenni.err.cancelled',
        'You cancelled the eID check, so nothing was verified. A membership needs a verified kennitala.',
        'Þú hættir við auðkenninguna og því var ekkert staðfest. Áskrift krefst staðfestrar kennitölu.',
      ],
      [
        'kenni.err.expired',
        'The eID check took too long and expired. Try again; it takes about a minute.',
        'Auðkenningin tók of langan tíma og rann út. Reyndu aftur; það tekur um mínútu.',
      ],
      [
        'kenni.err.failed',
        "We couldn't finish the eID check, and nothing was charged. Try again, or choose a visitor pass, which doesn't need eID.",
        'Ekki tókst að ljúka auðkenningunni og ekkert var gjaldfært. Reyndu aftur eða veldu gestapassa, sem þarf ekki rafræn skilríki.',
      ],
    ];
    for (const [key, english, icelandic] of copy) {
      expect([key, lookup(key, 'en'), lookup(key, 'is')]).toEqual([key, english, icelandic]);
    }
    // Every failure has its own sentence (testEveryFailureHasASentenceInBothLanguages).
    expectCleanAndTranslated([
      'kenni.err.cancelled', 'kenni.err.expired', 'kenni.err.linked', 'kenni.err.server',
      'kenni.err.offline', 'kenni.err.start', 'kenni.err.failed',
    ]);
  });
});

// MARK: - The base dictionary and the whole table

describe('the whole table', () => {
  it('keeps the base dictionary’s keys in both languages', () => {
    expect(Object.keys(baseDictionary.is).sort()).toEqual(Object.keys(baseDictionary.en).sort());
  });

  it('keeps every placeholder of each English value in the Icelandic one, Android packs included', () => {
    expectNone(
      Object.entries(en)
        .filter(([key, value]) => placeholders(value).some((p) => !(is[key] ?? '').includes(p)))
        .map(([key]) => key),
    );
  });

  // An Icelandic `.one` without its `.many`'s {count} is only right where iOS
  // picks the pair with the English rule (count == 1), never with pluralKey:
  // through tp an Icelandic 21 takes the singular and would print "1".
  it('keeps every Icelandic singular that drops its plural’s placeholder on the English-rule list', () => {
    const dropping = Object.keys(is)
      .filter((key) => key.endsWith('.one'))
      .map((key) => key.slice(0, -'.one'.length))
      .filter((base) => {
        const one = is[`${base}.one`] ?? '';
        const many = is[`${base}.many`];
        return many !== undefined && placeholders(many).some((p) => !one.includes(p));
      })
      .sort();
    expect(dropping).toEqual(['account.refer_earned', 'home.pass_visits']);
    expectNone(dropping.filter((base) => !ENGLISH_RULE_PLURALS.includes(base)));
  });
});
