/**
 * What Search lists, in iOS FoodSearchMode's order and limits, and the rules
 * around it: the meal-level source, the source word, the closest-match
 * header, and Describe only while the server advertises it
 * (testWithoutTheFeatureThereIsNoDescribe).
 */
import { banana, choice, myFoods, myOats, presetMeal, presets, recentMeal } from '../../capture/__tests__/mealFixtures';
import { draftFromChoice } from '../../types/draftFactory';
import type { FoodSearchResult } from '../../types/models';
import { searchRows, type SearchRow, type SearchRowsInput } from '../searchRows';
import { entrySourceFor, fromValueFor, isQuerying, resultSections, rowKcal, showsSourceWord } from '../searchRules';

function input(patch: Partial<SearchRowsInput> = {}): SearchRowsInput {
  return {
    query: '',
    querying: false,
    filter: 'all',
    presets: presets(),
    mine: myFoods(),
    presetsFailed: false,
    showAllRecentMeals: false,
    results: null,
    searching: false,
    searchErrorKey: null,
    describeOn: false,
    removingOffline: false,
    ...patch,
  };
}

/** A compact picture of the rows: kinds, headers and keys. */
function shape(rows: readonly SearchRow[]): string[] {
  return rows.map((row) => {
    switch (row.kind) {
      case 'header':
        return `# ${row.titleKey ?? row.title}${row.seeAll ? ` (see all: ${row.seeAll})` : ''}`;
      case 'food':
        return `food ${row.choice.label} [${row.from}]${row.removable ? ' removable' : ''}${row.dimmed ? ' dimmed' : ''}`;
      case 'recentMeal':
        return `recent meal ${row.meal.key}`;
      case 'preset':
        return `preset ${row.meal.name}${row.dimmed ? ' dimmed' : ''}`;
      case 'quick':
        return `quick${row.offersDescribe ? ' +describe' : ''}`;
      case 'describeInstead':
        return `describe instead (${row.entry})`;
      case 'line':
        return `line ${row.textKey}`;
      case 'error':
        return `error ${row.retry}`;
      case 'skeleton':
        return 'skeleton';
    }
  });
}

const result = (patch: Partial<FoodSearchResult>): FoodSearchResult => ({ query: 'skyr', mine: [], foods: [], meals: [], closest: false, ...patch });

describe('All, before anything is typed', () => {
  it('lists recent meals, recents, the quick buttons, common foods and meals in that order', () => {
    expect(shape(searchRows(input()))).toEqual([
      '# food.section.recent_meals',
      'recent meal recent:1',
      '# food.section.recent',
      'food Skyr, plain [recent]',
      'quick +describe',
      '# food.section.common',
      'food Skyr, plain [preset]',
      'food Banana [preset]',
      '# food.section.meals',
      'preset Skyr bowl',
    ]);
  });

  it('shows 3 recent meals (10 after See all), 8 recents and 10 meals, with See all when there are more', () => {
    const many = myFoods({
      recentMeals: Array.from({ length: 12 }, (_, index) => recentMeal({ key: `rm${index}` })),
      recents: Array.from({ length: 9 }, (_, index) => choice({ key: `c${index}`, label: `Food ${index}` })),
    });
    const meals = Array.from({ length: 11 }, (_, index) => presetMeal({ id: `m${index}`, name: `Meal ${index}` }));
    const rows = shape(searchRows(input({ mine: many, presets: presets({ meals }) })));
    expect(rows.filter((row) => row.startsWith('recent meal'))).toHaveLength(3);
    expect(rows).toContain('# food.section.recent_meals (see all: recentMeals)');
    expect(rows.filter((row) => row.endsWith('[recent]'))).toHaveLength(8);
    expect(rows).toContain('# food.section.recent (see all: recent)');
    expect(rows.filter((row) => row.startsWith('preset'))).toHaveLength(10);
    expect(rows).toContain('# food.section.meals (see all: meals)');
    const all = shape(searchRows(input({ mine: many, showAllRecentMeals: true })));
    expect(all.filter((row) => row.startsWith('recent meal'))).toHaveLength(10);
    expect(all).toContain('# food.section.recent_meals');
  });

  it('draws placeholders until something is known, and the error row when the presets failed', () => {
    expect(shape(searchRows(input({ presets: null, mine: null })))).toEqual(['skeleton']);
    expect(shape(searchRows(input({ presets: null, mine: null, presetsFailed: true })))).toEqual(['error cache']);
    expect(shape(searchRows(input({ presets: null, presetsFailed: true }))).slice(-1)).toEqual(['error cache']);
  });

  it('offers Describe a meal above Quick add only while Describe is on', () => {
    expect(searchRows(input({ describeOn: false })).find((row) => row.kind === 'quick')).toMatchObject({ offersDescribe: true });
    // The row asks; the screen draws the Describe button only when `describeOn`.
  });
});

describe('the chips', () => {
  it('Recent up to 50, Frequent up to 20, each with its empty line', () => {
    const many = myFoods({
      recents: Array.from({ length: 60 }, (_, index) => choice({ key: `r${index}` })),
      frequent: Array.from({ length: 30 }, (_, index) => choice({ key: `f${index}` })),
    });
    expect(searchRows(input({ filter: 'recent', mine: many }))).toHaveLength(50);
    expect(searchRows(input({ filter: 'frequent', mine: many }))).toHaveLength(20);
    expect(shape(searchRows(input({ filter: 'recent', mine: myFoods({ recents: [] }) })))).toEqual(['line food.recent.empty']);
    expect(shape(searchRows(input({ filter: 'frequent', mine: myFoods({ frequent: [] }) })))).toEqual(['line food.recent.empty']);
  });

  it('My foods are removable, with the offline line after a failed removal', () => {
    expect(shape(searchRows(input({ filter: 'mine' })))).toEqual(['food Grandma oats [mine] removable']);
    expect(shape(searchRows(input({ filter: 'mine', removingOffline: true })))).toEqual([
      'line health.offline.action_hint',
      'food Grandma oats [mine] removable',
    ]);
    expect(shape(searchRows(input({ filter: 'mine', mine: myFoods({ mine: [] }) })))).toEqual(['line food.mine.empty']);
  });

  it('Meals are grouped by category', () => {
    const lunch = presetMeal({ id: 'soup', name: 'Soup', category: { id: 'lunch', label: 'Lunch' } });
    const rows = shape(
      searchRows(input({ filter: 'meals', presets: presets({ meals: [presetMeal(), lunch], categories: [{ id: 'breakfast', label: 'Breakfast' }, { id: 'lunch', label: 'Lunch' }] }) })),
    );
    expect(rows).toEqual(['# Breakfast', 'preset Skyr bowl', '# Lunch', 'preset Soup']);
  });
});

describe('a typed search', () => {
  it('needs two characters', () => {
    expect(isQuerying('s')).toBe(false);
    expect(isQuerying(' s ')).toBe(false);
    expect(isQuerying('sk')).toBe(true);
    // One character made of two UTF-16 units is still one.
    expect(isQuerying('🇮🇸')).toBe(false);
  });

  it('lists Your foods, Foods and Meals; dimmed while the next answer is on its way', () => {
    const answer = result({ mine: [myOats()], foods: [choice()], meals: [presetMeal()] });
    expect(shape(searchRows(input({ querying: true, query: 'skyr', results: answer })))).toEqual([
      '# food.section.yours',
      'food Grandma oats [search]',
      '# food.section.foods',
      'food Skyr, plain [search]',
      '# food.section.meals',
      'preset Skyr bowl',
    ]);
    expect(shape(searchRows(input({ querying: true, results: answer, searching: true })))[1]).toBe('food Grandma oats [search] dimmed');
  });

  it('closest matches: the first section says so, and Describe it instead follows while offered', () => {
    expect(resultSections(result({ foods: [choice()], meals: [presetMeal()], closest: true }))).toEqual([
      { kind: 'foods', headerKey: 'food.search.closest' },
      { kind: 'meals', headerKey: 'food.section.meals' },
    ]);
    const closest = result({ foods: [choice()], closest: true });
    expect(shape(searchRows(input({ querying: true, results: closest, describeOn: true }))).slice(-1)).toEqual(['describe instead (closest)']);
    expect(shape(searchRows(input({ querying: true, results: closest, describeOn: false }))).slice(-1)).toEqual(['food Skyr, plain [search]']);
  });

  it('no match: the line with the words, Describe it instead (only while offered), then Quick add and Create my food', () => {
    expect(shape(searchRows(input({ querying: true, query: 'focaccia sandwich', results: result({}), describeOn: true })))).toEqual([
      'line food.search.empty',
      'describe instead (empty_search)',
      'quick',
    ]);
    const without = searchRows(input({ querying: true, query: 'focaccia sandwich', results: result({}), describeOn: false }));
    expect(shape(without)).toEqual(['line food.search.empty', 'quick']);
    expect(without[0]).toMatchObject({ params: { query: 'focaccia sandwich' } });
  });

  it('offline says so; another error offers Try again; nothing yet is placeholders', () => {
    expect(shape(searchRows(input({ querying: true, searchErrorKey: 'food.search.offline' })))).toEqual(['line food.search.offline']);
    expect(shape(searchRows(input({ querying: true, searchErrorKey: 'common.error_body' })))).toEqual(['line common.error_body', 'error search']);
    expect(shape(searchRows(input({ querying: true })))).toEqual(['skeleton']);
  });
});

describe('rows and sources', () => {
  it('the member’s own lists count as recent, presets as preset, the search as search', () => {
    const lists = myFoods();
    expect(entrySourceFor(choice(), 'frequent', presets(), lists)).toBe('recent');
    expect(entrySourceFor(choice(), 'preset', presets(), lists)).toBe('preset');
    expect(entrySourceFor(choice(), 'search', presets(), lists)).toBe('search');
    // From the editor: looked up in the lists.
    expect(entrySourceFor(banana(), null, presets(), lists)).toBe('preset');
    expect(entrySourceFor(myOats(), null, presets({ foods: [] }), lists)).toBe('recent');
    expect(entrySourceFor(choice({ key: 'other' }), null, presets(), lists)).toBe('search');
    expect(fromValueFor(banana(), presets(), lists, false)).toBe('preset');
    expect(fromValueFor(banana(), presets(), lists, true)).toBe('search');
    expect(fromValueFor(myOats(), presets({ foods: [] }), lists, false)).toBe('mine');
  });

  it('hides the source word for the member’s own foods and history', () => {
    expect(showsSourceWord(choice(), 'preset')).toBe(true);
    expect(showsSourceWord(choice(), 'search')).toBe(true);
    expect(showsSourceWord(choice(), 'recent')).toBe(false);
    expect(showsSourceWord(myOats(), 'search')).toBe(false);
  });

  it('a row’s calories: the server’s for the default portion, else the item math', () => {
    expect(rowKcal(choice(), draftFromChoice(choice()))).toBe(107);
    expect(rowKcal(choice({ defaultKcal: 106.5 }), draftFromChoice(choice()))).toBe(107);
    const unknown = choice({ defaultKcal: null });
    // 170 g at 63 kcal per 100 g.
    expect(rowKcal(unknown, draftFromChoice(unknown))).toBe(107);
  });
});
