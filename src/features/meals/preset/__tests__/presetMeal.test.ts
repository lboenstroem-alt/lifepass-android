/**
 * A preset meal's servings (iOS PresetMealSheet): 0.5 to 4 in halves, each
 * ingredient at its recipe grams times the servings, rounded, at least 1 g.
 */
import { presetMeal } from '../../capture/__tests__/mealFixtures';
import { presetItems, stepServings } from '../presetRules';

describe('a preset meal', () => {
  it('steps servings by halves between 0.5 and 4', () => {
    expect(stepServings(1, 1)).toBe(1.5);
    expect(stepServings(0.5, -1)).toBe(0.5);
    expect(stepServings(4, 1)).toBe(4);
    expect(stepServings(1, -1)).toBe(0.5);
  });

  it('multiplies each ingredient’s grams, rounded half away from zero, never under 1 g', () => {
    const meal = presetMeal({
      ingredients: [
        { ...presetMeal().ingredients[0]!, grams: 170 },
        { ...presetMeal().ingredients[1]!, grams: 59 },
        { ...presetMeal().ingredients[1]!, foodId: 'salt', grams: 1 },
      ],
    });
    expect(presetItems(meal, 1.5).map((item) => item.amount)).toEqual([255, 89, 2]);
    expect(presetItems(meal, 0.5).map((item) => item.amount)).toEqual([85, 30, 1]);
    const [first] = presetItems(meal, 2);
    expect(first).toMatchObject({ basis: 'database', serving: { unit: 'g', label: null, grams: null }, foodId: 'skyr-plain', choiceKey: 'food:skyr-plain' });
  });
});
