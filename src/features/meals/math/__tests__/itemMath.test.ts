/**
 * The item math, rule by rule, against the SAME case table as the server's
 * `meals.test.ts` (`computeItemNutrients`): the port of iOS
 * `MealItemRuleTests` (LifePassTests/MealItemMathTests.swift), case for case
 * and vector for vector.
 *
 * The editor shows a number the moment a member changes an amount, and the
 * server recomputes it on save. If the two disagree the number changes under
 * the member's hand for no reason they can see.
 */
import {
  GRAMS_SERVING,
  draftInput,
  encodePerServing,
  encodeServing,
  namedServing,
  newLocalId,
  type ItemEstimate,
  type MealItemDraft,
  type MealServing,
  type NutrientOverrides,
  type Per100g,
  type PerServing,
} from '../../types';
import {
  autoSlot,
  changingAmount,
  changingServing,
  clampedAmount,
  computeItem,
  convertAmount,
  defaultServingLabel,
  displayedItem,
  effectiveBasis,
  fieldAmount,
  gramsFor,
  isEstimateItem,
  kcalMid,
  loggedAtFor,
  macroMismatchKcal,
  mealTotals,
  resettingValue,
  servingMenu,
  settingGramsOnServingOnlyItem,
  settingValue,
  stepFor,
  type MealItemResult,
} from '..';

const STORED_ID = '11111111-1111-4111-8111-111111111111';

/** The server fixture's `item()`: 100 g of a 200 kcal per 100 g food. */
function item(options: {
  source?: string;
  basis?: string;
  serving?: MealServing;
  amount?: number;
  per100g?: Per100g | null;
  perServing?: PerServing | null;
  estimate?: ItemEstimate | null;
  overrides?: NutrientOverrides | null;
  foodId?: string | null;
  stored?: boolean;
} = {}): MealItemDraft {
  const serving = options.serving ?? GRAMS_SERVING;
  const amount = options.amount ?? 100;
  const overrides = options.overrides ?? null;
  const stored = options.stored ?? false;
  return {
    localId: newLocalId(),
    storedId: stored ? STORED_ID : null,
    source: options.source ?? 'usda',
    basis: options.basis ?? 'database',
    label: 'Test food',
    brand: null,
    foodId: options.foodId ?? null,
    barcode: null,
    off: null,
    offSummary: null,
    choiceKey: null,
    serving,
    amount,
    servingOptions: [GRAMS_SERVING],
    per100g: options.per100g === undefined ? { kcal: 200, proteinG: 10, carbsG: 20, fatG: 8 } : options.per100g,
    perServing: options.perServing ?? null,
    estimate: options.estimate ?? null,
    overrides,
    confidence: null,
    confirmed: true,
    liquid: false,
    displaysGrams: false,
    storedServing: stored ? serving : null,
    storedAmount: stored ? amount : null,
    storedOverrides: stored ? overrides : null,
    storedNutrients: null,
  };
}

const kcalOnly = (kcal: number): NutrientOverrides => ({ kcal, proteinG: null, carbsG: null, fatG: null });

const estimate: ItemEstimate = { grams: 150, kcalLow: 210, kcalHigh: 390, proteinG: 9, carbsG: 30, fatG: 12 };

function computed(draft: MealItemDraft): MealItemResult {
  const result = computeItem(draft);
  if (!result) throw new Error('expected a number');
  return result;
}

describe('grams', () => {
  it('are the amount, or the serving times the amount (testGramsAreTheAmountOrTheServingTimesTheAmount)', () => {
    expect(gramsFor(GRAMS_SERVING, 165)).toBe(165);
    expect(gramsFor(namedServing('1 tub', 170), 1.5)).toBe(255);
    expect(gramsFor(namedServing('1 portion', null), 2)).toBeNull();
  });
});

describe('rule 2, per 100 g', () => {
  it('at the grams counted (testRule2Per100gAtTheGramsCounted)', () => {
    expect(computed(item({ amount: 250 }))).toEqual({
      kcalLow: 500,
      kcalHigh: 500,
      proteinG: 25,
      carbsG: 50,
      fatG: 20,
      grams: 250,
      macrosComplete: true,
    });
  });

  it('through a serving with grams (testRule2ThroughAServingWithGrams)', () => {
    const result = computed(item({ serving: namedServing('1 tub', 170), amount: 2 }));
    expect(result.grams).toBe(340);
    expect(result.kcalLow).toBe(680);
  });
});

describe('rule 3, per serving', () => {
  it('counted in servings with an unknown macro as zero (testRule3PerServingCountedInServingsWithAnUnknownMacroAsZero)', () => {
    const result = computed(
      item({
        source: 'quick_add',
        basis: 'member',
        serving: namedServing('1 portion', null),
        amount: 2,
        per100g: null,
        perServing: { kcal: 250, proteinG: null, carbsG: null, fatG: null },
      }),
    );
    expect(result.kcalLow).toBe(500);
    expect(result.kcalHigh).toBe(500);
    expect(result.proteinG).toBe(0);
    expect(result.grams).toBeNull();
    expect(result.macrosComplete).toBe(false);
  });
});

describe('rule 1, overrides', () => {
  it('an override wins per field and only for that field (testRule1AnOverrideWinsPerFieldAndOnlyForThatField)', () => {
    const result = computed(item({ basis: 'member', amount: 200, overrides: kcalOnly(3) }));
    // 3 kcal per gram, 200 grams; the macros still come from per 100 g.
    expect(result.kcalLow).toBe(600);
    expect(result.proteinG).toBe(20);
  });

  it('an override on a serving is per serving (testRule1AnOverrideOnAServingIsPerServing)', () => {
    const result = computed(item({ basis: 'member', serving: namedServing('1 bowl', 200), amount: 1.5, overrides: kcalOnly(400) }));
    expect(result.kcalLow).toBe(600);
  });

  it('typed calories are stored per unit and scale (testTypedCaloriesAreStoredPerUnitAndScale)', () => {
    const typed = settingValue(item({ amount: 180 }), 'kcal', 250);
    expect(computed(typed).kcalLow).toBe(250);
    expect(effectiveBasis(typed)).toBe('member');
    expect(typed.confirmed).toBe(true);
    const doubled = changingAmount(typed, 360);
    expect(computed(doubled).kcalLow).toBe(500);
    const reset = resettingValue(doubled, 'kcal');
    expect(reset.overrides).toBeNull();
    expect(computed(reset).kcalLow).toBe(720);
  });

  it('a typed macro does not confirm the item; typed calories do', () => {
    const unconfirmed = { ...item(), confirmed: false };
    expect(settingValue(unconfirmed, 'protein', 12).confirmed).toBe(false);
    expect(settingValue(unconfirmed, 'kcal', 120).confirmed).toBe(true);
    // Negative typing is floored at 0.
    expect(settingValue(item(), 'fat', -5).overrides?.fatG).toBe(0);
  });
});

describe('rule 4, estimates', () => {
  it('an untouched estimate keeps its own range (testRule4AnUntouchedEstimateKeepsItsOwnRange)', () => {
    const result = computed(item({ source: 'model', basis: 'estimate', amount: 150, per100g: null, estimate, stored: true }));
    expect(result.kcalLow).toBe(210);
    expect(result.kcalHigh).toBe(390);
    expect(result.proteinG).toBe(9);
  });

  it('a changed amount scales the range and the macros (testRule4AChangedAmountScalesTheRangeAndTheMacros)', () => {
    let changed = item({ source: 'model', basis: 'estimate', amount: 150, per100g: null, estimate, stored: true });
    changed = changingAmount(changed, 300);
    const result = computed(changed);
    expect(result.kcalLow).toBe(420);
    expect(result.kcalHigh).toBe(780);
    expect(result.proteinG).toBe(18);
    // An unmatched photo item stays an estimate.
    expect(isEstimateItem(changed)).toBe(true);
  });

  it('the basis picks the rule, so a matched estimate is still a range (testTheBasisPicksTheRuleSoAMatchedEstimateIsStillARange)', () => {
    const matched = item({
      source: 'usda',
      basis: 'estimate',
      amount: 100,
      estimate: { grams: 100, kcalLow: 140, kcalHigh: 260, proteinG: 10, carbsG: 4, fatG: 8 },
      foodId: 'cheese-gouda-type',
      stored: true,
    });
    const result = computed(matched);
    expect(result.kcalLow).not.toBe(result.kcalHigh);
    // Once the member changes the amount it is a real portion of a known food.
    const changed = changingAmount(matched, 120);
    expect(effectiveBasis(changed)).toBe('database');
    const point = computed(changed);
    expect(point.kcalLow).toBe(point.kcalHigh);
    expect(point.kcalLow).toBe(240);
  });
});

describe('rule 5 and rounding', () => {
  it('a serving with no grams on a library item has no number (testRule5AServingWithNoGramsOnALibraryItemHasNoNumber)', () => {
    expect(computeItem(item({ serving: namedServing('1 portion', null), amount: 1 }))).toBeNull();
    // ... and the screens show zero rather than nothing.
    expect(displayedItem(item({ serving: namedServing('1 portion', null), amount: 1 })).kcalLow).toBe(0);
  });

  it('kcal is whole and macros are to a tenth (testRoundingIsKcalWholeAndMacrosToATenth)', () => {
    const result = computed(item({ amount: 33, per100g: { kcal: 63.4, proteinG: 10.55, carbsG: 4.21, fatG: 0.23 } }));
    expect(result.kcalLow).toBe(21);
    expect(result.proteinG).toBe(3.5);
  });

  it('a half rounds away from zero, as Swift does', () => {
    // 2.5 kcal: JavaScript's Math.round would agree here, but 0.25 g of
    // protein at a tenth must be 0.3 and a midpoint of 0.5 must be 1.
    expect(computed(item({ amount: 1, per100g: { kcal: 250, proteinG: 25, carbsG: 0, fatG: 0 } })).kcalLow).toBe(3);
    expect(kcalMid({ kcalLow: 0, kcalHigh: 1 })).toBe(1);
  });
});

describe('a meal (6.1)', () => {
  it('keeps the estimate apart from the point values (testMealTotalsKeepTheEstimateApartFromThePointValues)', () => {
    const labelled = item({ source: 'off', basis: 'label', amount: 170, per100g: { kcal: 63, proteinG: 10.5, carbsG: 4.2, fatG: 0.2 } });
    const typed = item({
      source: 'quick_add',
      basis: 'member',
      serving: namedServing('1 portion', null),
      amount: 1,
      per100g: null,
      perServing: { kcal: 250, proteinG: null, carbsG: null, fatG: null },
    });
    const estimated = item({ source: 'model', basis: 'estimate', amount: 150, per100g: null, estimate, stored: true });
    const totals = mealTotals([labelled, typed, estimated]);
    expect(totals.pointKcal).toBe(107 + 250);
    expect(totals.memberEnteredKcal).toBe(250);
    expect(totals.estimateKcalLow).toBe(210);
    expect(totals.estimateKcalHigh).toBe(390);
    expect(totals.kcalLow).toBe(357 + 210);
    expect(totals.kcalHigh).toBe(357 + 390);
    expect(totals.macrosComplete).toBe(false);
    // Meal macros are whole grams.
    expect(mealTotals([labelled]).proteinG).toBe(18);
  });

  it('an untouched stored item shows the server numbers, a changed one the local mirror', () => {
    const stored: MealItemDraft = {
      ...item({ amount: 100, stored: true }),
      storedNutrients: { kcalLow: 199, kcalHigh: 199, proteinG: 9.9, carbsG: null, fatG: 8, grams: 100, macrosComplete: false },
    };
    expect(displayedItem(stored)).toEqual({ kcalLow: 199, kcalHigh: 199, proteinG: 9.9, carbsG: 0, fatG: 8, grams: 100, macrosComplete: false });
    expect(displayedItem(changingAmount(stored, 150)).kcalLow).toBe(300);
  });
});

describe('changing the serving keeps the grams (16.4)', () => {
  it('testChangingTheServingKeepsTheGramWeight', () => {
    const cup = namedServing('1 cup (170 g)', 170);
    const start = item({ serving: cup, amount: 1 });
    const inGrams = changingServing(start, GRAMS_SERVING);
    expect(inGrams.amount).toBe(170);
    const hundred = changingServing(inGrams, namedServing('100 g', 100));
    expect(hundred.amount).toBeCloseTo(1.7, 3);
    expect(computeItem(hundred)?.kcalLow).toBe(computeItem(start)?.kcalLow);
  });

  it('without a weight on either side the amount stays', () => {
    expect(convertAmount(2, namedServing('1 portion', null), GRAMS_SERVING)).toBe(2);
    expect(convertAmount(2, namedServing('1 tub', 170), namedServing('1 portion', null))).toBe(2);
  });

  it('grams on a per-serving-only item are sent as servings (testGramsOnAPerServingOnlyItemAreSentAsServings)', () => {
    const bar = namedServing('1 bar', 45);
    const created = item({
      source: 'member',
      basis: 'member',
      serving: bar,
      amount: 1,
      per100g: null,
      perServing: { kcal: 198, proteinG: 4, carbsG: 26, fatG: 8 },
    });
    const shown = settingGramsOnServingOnlyItem(created, 60);
    expect(shown.serving).toEqual(bar);
    expect(shown.amount).toBeCloseTo(1.33, 4);
    expect(shown.displaysGrams).toBe(true);
    expect(fieldAmount(shown)).toBe(60);
    const input = draftInput(shown);
    expect(input.serving.unit).toBe('serving');
    expect(input.amount).toBeCloseTo(1.33, 4);
    expect(computed(shown).kcalLow).toBe(263);
    // Without serving grams there is no grams option at all.
    const noGrams = item({
      source: 'member',
      basis: 'member',
      serving: namedServing('1 bowl', null),
      amount: 1,
      per100g: null,
      perServing: { kcal: 300, proteinG: null, carbsG: null, fatG: null },
    });
    expect(servingMenu(noGrams, 'en').some((option) => option.unit === 'g')).toBe(false);
  });

  it('the serving menu offers grams and 100 g last (testTheServingMenuOffersGramsAndOneHundredGramsLast)', () => {
    const skyr = item({ serving: namedServing('1 cup (170 g)', 170), amount: 1 });
    const menu = servingMenu(skyr, 'en');
    expect(menu[menu.length - 1]).toEqual(GRAMS_SERVING);
    expect(menu).toContainEqual(namedServing('100 g', 100));
    expect(menu[0]).toEqual(namedServing('1 cup (170 g)', 170));
  });

  it('a liquid offers 100 ml, and 1 dl for an Icelandic reader', () => {
    const milk = { ...item({ serving: GRAMS_SERVING, amount: 250 }), liquid: true };
    expect(servingMenu(milk, 'en')).toEqual([namedServing('100 ml', 100), GRAMS_SERVING]);
    expect(servingMenu(milk, 'is')).toEqual([namedServing('100 ml', 100), namedServing('1 dl', 100), GRAMS_SERVING]);
  });

  it('the stepper moves 10 g or half a serving', () => {
    expect(stepFor(item())).toBe(10);
    expect(stepFor(item({ serving: namedServing('1 tub', 170), amount: 1 }))).toBe(0.5);
  });

  it('an amount is clamped to the server ranges, to two decimals', () => {
    expect(clampedAmount(0, GRAMS_SERVING)).toBe(0.1);
    expect(clampedAmount(9000, GRAMS_SERVING)).toBe(5000);
    expect(clampedAmount(70, namedServing('1 tub', 170))).toBe(50);
    expect(clampedAmount(1.005 + 0.0001, namedServing('1 tub', 170))).toBe(1.01);
  });
});

describe('what goes on the wire', () => {
  it('a new library item sends its foodId and no numbers (testANewLibraryItemSendsItsFoodIdAndNoNumbers)', () => {
    const library = { ...item({ foodId: 'skyr-plain' }), source: 'lifepass_estimate' };
    const input = draftInput(library);
    expect(input.foodId).toBe('skyr-plain');
    expect(input.per100g).toBeNull();
    expect(input.perServing).toBeNull();
    expect(input.off).toBeNull();
    expect(input.id).toBeNull();
  });

  it('a stored item resends its overrides and no snapshot (testAStoredItemResendsItsOverridesAndNoSnapshot)', () => {
    let stored: MealItemDraft = {
      ...item({ basis: 'member', amount: 200, overrides: kcalOnly(3), foodId: 'skyr-plain', stored: true }),
      source: 'lifepass_estimate',
    };
    stored = changingAmount(stored, 250);
    const input = draftInput(stored);
    expect(input.id).toBe(STORED_ID);
    expect(input.overrides?.kcal).toBe(3);
    expect(input.per100g).toBeNull();
    expect(input.off).toBeNull();
    expect(input.foodId).toBe('skyr-plain');
  });

  it('a serving encodes grams as null, and grams as the unit alone (testAServingEncodesGramsAsNullAndGramsAsTheUnitAlone)', () => {
    expect(JSON.stringify(sortKeys(encodeServing(namedServing('1 portion', null))))).toBe('{"grams":null,"label":"1 portion","unit":"serving"}');
    expect(JSON.stringify(encodeServing(GRAMS_SERVING))).toBe('{"unit":"g"}');
    expect(JSON.stringify(sortKeys(encodePerServing({ kcal: 250, proteinG: null, carbsG: 3, fatG: null })))).toBe(
      '{"carbsG":3,"fatG":null,"kcal":250,"proteinG":null}',
    );
  });
});

describe('the slot rule (12.3)', () => {
  it('follows the clock (testTheAutoSlotFollowsTheClock)', () => {
    const at = (hour: number, minute: number) => new Date(Date.UTC(2026, 8, 22, hour, minute));
    expect(autoSlot(at(4, 0), 'utc')).toBe('breakfast');
    expect(autoSlot(at(10, 29), 'utc')).toBe('breakfast');
    expect(autoSlot(at(10, 30), 'utc')).toBe('lunch');
    expect(autoSlot(at(14, 29), 'utc')).toBe('lunch');
    expect(autoSlot(at(14, 30), 'utc')).toBe('snack');
    expect(autoSlot(at(17, 0), 'utc')).toBe('dinner');
    expect(autoSlot(at(21, 29), 'utc')).toBe('dinner');
    expect(autoSlot(at(21, 30), 'utc')).toBe('snack');
    expect(autoSlot(at(3, 59), 'utc')).toBe('snack');
  });
});

describe('the macro hint', () => {
  it('needs both 25 percent and 50 kcal (testTheMacroHintNeedsBothTwentyFivePercentAndFiftyKcal)', () => {
    const result = (kcal: number, proteinG: number, carbsG: number, fatG: number): MealItemResult => ({
      kcalLow: kcal,
      kcalHigh: kcal,
      proteinG,
      carbsG,
      fatG,
      grams: 100,
      macrosComplete: true,
    });
    expect(macroMismatchKcal(result(200, 10, 20, 8.9))).toBeNull();
    expect(macroMismatchKcal(result(500, 10, 20, 8))).toBe(192);
    // 80 against 40 is 100 percent off but only 40 kcal.
    expect(macroMismatchKcal(result(40, 10, 10, 0))).toBeNull();
  });
});

describe('when a meal was eaten', () => {
  it('is now for today, and the same time of day on another date', () => {
    const now = new Date(Date.UTC(2026, 9, 17, 12, 34, 56, 789));
    expect(loggedAtFor('2026-10-17', now)).toBe(now);
    expect(loggedAtFor('2026-10-15', now).toISOString()).toBe('2026-10-15T12:34:00.000Z');
    expect(loggedAtFor('not-a-day', now)).toBe(now);
  });

  it('labels an Open Food Facts serving weight it has no words for', () => {
    expect(defaultServingLabel(30)).toBe('30 g');
    expect(defaultServingLabel(30.25)).toBe('30.2 g');
    expect(defaultServingLabel(12.5)).toBe('12.5 g');
  });
});

function sortKeys(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, value[key]]));
}
