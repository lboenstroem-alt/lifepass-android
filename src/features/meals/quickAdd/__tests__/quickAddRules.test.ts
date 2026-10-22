/**
 * Quick add's rules (iOS QuickAddSheet): calories 1 to 5,000, macros 0 to
 * 500 or nothing, the item it makes, and when the button saves at once.
 */
import { MealCaptureModel } from '../../capture/captureModel';
import { quickAddItem, quickAddKcal, quickAddMacro, savesAtOnce } from '../quickAddRules';
import { draftFromChoice } from '../../types/draftFactory';
import { choice } from '../../capture/__tests__/mealFixtures';

// expo-font (behind @expo/vector-icons) imports expo-asset, which npm left
// nested under expo/ (as the UI kit's tests do).
jest.mock('expo-asset', () => jest.requireActual('expo/node_modules/expo-asset'), { virtual: true });

describe('Quick add', () => {
  it('takes 1 to 5,000 kcal, with a comma or a dot', () => {
    expect(quickAddKcal('0')).toBeNull();
    expect(quickAddKcal('1')).toBe(1);
    expect(quickAddKcal('5000')).toBe(5000);
    expect(quickAddKcal('5001')).toBeNull();
    expect(quickAddKcal('320,5')).toBe(320.5);
    expect(quickAddKcal('')).toBeNull();
  });

  it('a macro is 0 to 500 g, else not known', () => {
    expect(quickAddMacro('0')).toBe(0);
    expect(quickAddMacro('500')).toBe(500);
    expect(quickAddMacro('501')).toBeNull();
    expect(quickAddMacro('')).toBeNull();
    expect(quickAddMacro('x')).toBeNull();
  });

  it('makes a quick_add item of one serving with no grams, named "Quick add" when left blank', () => {
    const item = quickAddItem({ kcal: 420, protein: '30', carbs: '', fat: '12,5', name: '  ', defaultName: 'Quick add', servingLabel: '1 serving' });
    expect(item).toMatchObject({ source: 'quick_add', basis: 'member', label: 'Quick add', amount: 1 });
    expect(item.serving).toEqual({ unit: 'serving', label: '1 serving', grams: null });
    expect(item.perServing).toEqual({ kcal: 420, proteinG: 30, carbsG: null, fatG: 12.5 });
    expect(quickAddItem({ kcal: 100, protein: '', carbs: '', fat: '', name: 'Kleina', defaultName: 'Quick add', servingLabel: '1 serving' }).label).toBe('Kleina');
  });

  it('saves at once only from a meal page with an empty tray, never from an editor page', () => {
    const page = new MealCaptureModel({ origin: 'scanTab', mode: 'search', slot: { kind: 'auto' }, date: '2026-10-21' });
    expect(savesAtOnce({ kind: 'capture', model: page }, 0)).toBe(true);
    page.add([draftFromChoice(choice())], 'search');
    expect(savesAtOnce({ kind: 'capture', model: page }, 1)).toBe(false);
    const editor = new MealCaptureModel({ origin: 'editor', mode: 'search', slot: { kind: 'auto' }, date: '2026-10-21' });
    expect(savesAtOnce({ kind: 'capture', model: editor }, 0)).toBe(false);
    expect(savesAtOnce({ kind: 'meal', onAdd: () => undefined }, 0)).toBe(false);
  });
});
