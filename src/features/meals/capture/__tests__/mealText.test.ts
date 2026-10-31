/**
 * The words every meal row shares (iOS MealText, MealDateText, the tray
 * bar's summary), the date dialog's range (30 days for Photo, a year
 * otherwise), and which modes this build can draw.
 */
import { translate, translatePlural, type Lang, type Params } from '../../../../i18n';
import { addServerDays, todayServerDay } from '../../../../i18n/format';
import { draftFromChoice, quickAddDraft } from '../../types/draftFactory';
import { clampDay, datePickerRange } from '../datePicker';
import { availableModes, openingMode } from '../MealCaptureScreen';
import { amountLine, relativeDay, sourceWord, traySummary } from '../mealText';
import { choice, myOats } from './mealFixtures';

// expo-font (behind @expo/vector-icons) imports expo-asset, which npm left
// nested under expo/ (as the UI kit's tests do).
jest.mock('expo-asset', () => jest.requireActual('expo/node_modules/expo-asset'), { virtual: true });

const tFor = (lang: Lang) => (key: string, params?: Params) => translate(key, lang, params);
const tpFor = (lang: Lang) => (base: string, count: number, params?: Params) => translatePlural(base, count, lang, params);
const en = tFor('en');
const TODAY = todayServerDay();

describe('the amount line', () => {
  it('names a serving, multiplies it, and writes grams for a gram item', () => {
    const skyr = draftFromChoice(choice());
    expect(amountLine(skyr, 'en', en)).toBe('1 cup');
    expect(amountLine({ ...skyr, amount: 2 }, 'en', en)).toBe('2 x 1 cup');
    expect(amountLine({ ...skyr, amount: 1.5 }, 'is', tFor('is'))).toBe('1,5 x 1 cup');
    expect(amountLine(draftFromChoice(myOats()), 'en', en)).toBe('100 g');
    expect(amountLine({ ...draftFromChoice(myOats()), liquid: true, amount: 250 }, 'en', en)).toBe('250 ml');
  });

  it('a quick add without a label reads "1 serving"', () => {
    const quick = quickAddDraft({ label: 'Soup', kcal: 300, protein: null, carbs: null, fat: null, servingLabel: '1 serving' });
    expect(amountLine(quick, 'en', en)).toBe('1 serving');
    expect(amountLine({ ...quick, serving: { unit: 'serving', label: null, grams: null } }, 'is', tFor('is'))).toBe('1 skammtur');
  });
});

describe('words', () => {
  it('the source words', () => {
    expect(sourceWord('usda', en)).toBe('USDA');
    expect(sourceWord('lifepass_label', en)).toBe('From the label');
    expect(sourceWord('off', en)).toBe('Open Food Facts');
    expect(sourceWord('member', en)).toBe('Your food');
    expect(sourceWord('something', en)).toBe('Estimate');
  });

  it('Today, Yesterday, or the short day', () => {
    expect(relativeDay(TODAY, 'en', en)).toBe('Today');
    expect(relativeDay(addServerDays(TODAY, -1)!, 'is', tFor('is'))).toBe('Í gær');
    expect(relativeDay('2026-09-17', 'en', en, '2026-10-21')).toMatch(/17 Sep/);
  });

  it('the tray summary: one or many, a range written with the word', () => {
    expect(traySummary({ kcalLow: 420, kcalHigh: 420 }, 1, 'en', en, tpFor('en'))).toBe('1 item · 420 kcal');
    expect(traySummary({ kcalLow: 1380, kcalHigh: 1520 }, 3, 'en', en, tpFor('en'))).toBe('3 items · 1,380 to 1,520 kcal');
    expect(traySummary({ kcalLow: 380, kcalHigh: 520 }, 3, 'is', tFor('is'), tpFor('is'))).toBe('3 vörur · 380 til 520 kcal');
  });
});

describe('the date dialog', () => {
  it('reaches back 30 days in Photo and a year otherwise, never past today', () => {
    expect(datePickerRange(false, '2026-10-21')).toEqual({ first: '2026-09-21', last: '2026-10-21' });
    expect(datePickerRange(true, '2026-10-21')).toEqual({ first: '2025-10-21', last: '2026-10-21' });
    const range = datePickerRange(false, '2026-10-21');
    expect(clampDay('2026-01-01', range)).toBe('2026-09-21');
    expect(clampDay('2026-12-01', range)).toBe('2026-10-21');
    expect(clampDay('2026-10-01', range)).toBe('2026-10-01');
  });
});

describe('the modes this build draws', () => {
  // Photo and Barcode are MEAL-3's, wired into ../slots.ts.
  it('opens in the mode asked for, and offers all three', () => {
    expect(openingMode('photo')).toBe('photo');
    expect(openingMode('barcode')).toBe('barcode');
    expect(openingMode(undefined)).toBe('search');
    expect(availableModes(TODAY)).toEqual(['photo', 'barcode', 'search']);
  });

  it('offers no Photo for a day older than 30 days (OP-32 takes no older)', () => {
    const older = new Date(Date.parse(`${TODAY}T12:00:00Z`) - 31 * 86_400_000).toISOString().slice(0, 10);
    expect(availableModes(older, TODAY)).toEqual(['barcode', 'search']);
  });
});
