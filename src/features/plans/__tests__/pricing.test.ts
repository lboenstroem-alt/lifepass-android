/**
 * What a card says beside the catalogue: the terms line under the cards
 * (iOS PlansCatalogPassesTests `testTheTermsLineSaysPriceAtCheckoutOnlyWhen
 * TheCardShowsNoPrice` and `testADayPassIsNotCalledAVisitPack`), and the live
 * tier facts a membership card leads with (iOS `PlansView.featureLines`).
 */
import { lookup } from '../../../i18n';
import { tables } from '../../../i18n/tables';
import { decodePlanCatalog } from '../catalog';
import { isDayPass, planForSlug, SUBSCRIPTION_PLANS, VISITOR_PACKAGES } from '../plans';
import { cardFeatureLines, finePrintTermsKey, priceLabel, tierFacts } from '../pricing';
import { CATALOGUE_WITHOUT_POOL, catalogue, FULL_CATALOGUE, tier } from './fixtures';

const plan = (id: string) => planForSlug(id)!;
const withoutPool = decodePlanCatalog(CATALOGUE_WITHOUT_POOL);

describe('the terms line under the cards', () => {
  it('says "Price shown at checkout" only while the selected card shows no price', () => {
    const gym = plan('pass-day-gym');
    const explorer = plan('pass-explorer');
    const plus = plan('plan-plus');
    const base = plan('plan-base');

    // No catalogue yet: no card shows a price.
    expect(finePrintTermsKey(gym, null)).toBe('plans.fine.day_pass_terms');
    expect(finePrintTermsKey(explorer, null)).toBe('plans.fine.pass_terms');
    expect(finePrintTermsKey(plus, null)).toBe('plans.fine.sub_terms');
    expect(finePrintTermsKey(null, null)).toBe('plans.fine.pass_terms');

    expect(priceLabel(gym, withoutPool)).not.toBeNull();
    expect(finePrintTermsKey(gym, withoutPool)).toBe('plans.fine.day_pass_terms_priced');
    expect(finePrintTermsKey(explorer, withoutPool)).toBe('plans.fine.pass_terms_priced');
    expect(finePrintTermsKey(plus, withoutPool)).toBe('plans.fine.sub_terms_priced');
    expect(priceLabel(base, withoutPool)).toBeNull();
    expect(finePrintTermsKey(base, withoutPool)).toBe('plans.fine.sub_terms');

    for (const key of ['plans.fine.pass_terms_priced', 'plans.fine.sub_terms_priced', 'plans.fine.day_pass_terms_priced']) {
      const en = tables.en[key];
      const is = tables.is[key];
      expect(en).toBeDefined();
      expect(is).toBeDefined();
      expect(en).not.toBe(is);
      expect(en).not.toContain('checkout');
      expect(is).not.toContain('greiðslu');
    }
  });

  it('never calls a day pass a visit pack, with or without a catalogue, in both languages', () => {
    const dayPasses = VISITOR_PACKAGES.filter(isDayPass);
    const packs = VISITOR_PACKAGES.filter((p) => !isDayPass(p));
    for (const [label, read] of [
      ['catalogue failed', null],
      ['catalogue loaded', withoutPool],
    ] as const) {
      for (const p of dayPasses) {
        const key = finePrintTermsKey(p, read);
        expect([p.id, label, lookup(key, 'en').split(' · ')[0]]).toEqual([p.id, label, 'Prepaid day pass']);
        expect([p.id, label, lookup(key, 'is').split(' · ')[0]]).toEqual([p.id, label, 'Fyrirframgreiddur dagspassi']);
      }
      for (const p of packs) {
        const key = finePrintTermsKey(p, read);
        expect([p.id, label, lookup(key, 'en').split(' · ')[0]]).toEqual([p.id, label, 'Prepaid visit pack']);
        expect([p.id, label, lookup(key, 'is').split(' · ')[0]]).toEqual([p.id, label, 'Fyrirframgreiddur heimsóknapakki']);
      }
    }
    // Without a price, the day pass line still says where the price is.
    expect(lookup('plans.fine.day_pass_terms', 'en')).toBe('Prepaid day pass · Price shown at checkout');
    expect(lookup('plans.fine.day_pass_terms', 'is')).toBe('Fyrirframgreiddur dagspassi · Verð birt við greiðslu');
  });

  it('a membership is month to month: no "3-month minimum" anywhere in its terms', () => {
    for (const key of ['plans.fine.sub_terms', 'plans.fine.sub_terms_priced']) {
      expect(lookup(key, 'en')).toContain('No minimum commitment');
      expect(lookup(key, 'en')).not.toMatch(/3[- ]month/i);
      expect(lookup(key, 'is')).toContain('Engin binding');
    }
  });
});

describe('a card’s feature lines', () => {
  const full = decodePlanCatalog(FULL_CATALOGUE);

  it('a membership leads with its tier’s live facts, then the static lines', () => {
    expect(cardFeatureLines(plan('plan-plus'), full, 'en')).toEqual([
      '8 gym & studio visits a month',
      '6 pool visits a month',
      'Up to 2 check-ins a day',
      'In-bundle venues included',
      'Premium venues pay-as-you-go',
      'Cancel anytime',
    ]);
    expect(cardFeatureLines(plan('plan-base'), full, 'en').slice(0, 3)).toEqual([
      '5 gym & studio visits a month',
      '4 pool visits a month',
      'Up to 1 check-in a day',
    ]);
    expect(cardFeatureLines(plan('plan-base'), full, 'is').slice(0, 3)).toEqual([
      '5 heimsóknir í ræktir og stúdíó á mánuði',
      '4 sundheimsóknir á mánuði',
      'Allt að 1 innritun á dag',
    ]);
  });

  it('takes the Icelandic singular for 21 check-ins a day, and the plural for 11', () => {
    const odd = decodePlanCatalog(catalogue({ tiers: [tier('max', 24_900, [12, 8, 21])] }));
    expect(cardFeatureLines(plan('plan-max'), odd, 'is')[2]).toBe('Allt að 21 innritun á dag');
    expect(cardFeatureLines(plan('plan-max'), odd, 'en')[2]).toBe('Up to 21 check-ins a day');
    const eleven = decodePlanCatalog(catalogue({ tiers: [tier('max', 24_900, [12, 8, 11])] }));
    expect(cardFeatureLines(plan('plan-max'), eleven, 'is')[2]).toBe('Allt að 11 innritanir á dag');
  });

  it('without a catalogue (or without its tier) a membership leads with the generic line, never a number', () => {
    for (const read of [null, withoutPool]) {
      const lines = cardFeatureLines(plan('plan-base'), read, 'en');
      expect(lines).toEqual(['Monthly gym, studio & pool visits', 'In-bundle venues included', 'Premium venues pay-as-you-go', 'Cancel anytime']);
    }
    expect(cardFeatureLines(plan('plan-max'), null, 'is')[0]).toBe('Mánaðarlegar heimsóknir í ræktir, stúdíó og sundlaugar');
  });

  it('a pass states its own fixed counts and gets no tier facts', () => {
    expect(cardFeatureLines(plan('pass-explorer'), full, 'en')).toEqual(['3 visits', 'Valid 30 days', 'Use across in-bundle venues']);
    expect(tierFacts(plan('pass-explorer'), full)).toBeNull();
    for (const p of SUBSCRIPTION_PLANS) expect(tierFacts(p, null)).toBeNull();
  });
});
