/**
 * The capture page's tray (iOS MealTraySnapshot and MealTrayStore): picked
 * items survive a phone call for a day, per member, and nothing older or
 * empty is offered back.
 */
import { fileSystemState } from '@test/mocks/expoFileSystem';

import * as localStore from '../../../../health/localStore';
import { draftFromChoice, quickAddDraft, type FoodChoice, type MealItemDraft } from '../../types';
import { clearTray, isTrayFresh, MEAL_TRAY_LIFETIME_MS, restoreTray, saveTray, type MealTraySnapshot } from '../trayStore';

const MEMBER = '8c2c1b36-2a7e-4b1f-9e0e-2f1c4f0a9c11';
const OTHER = '3c4c1b36-2a7e-4b1f-9e0e-2f1c4f0a9c22';
const HOUR = 60 * 60 * 1000;

const skyr: FoodChoice = {
  key: 'usda:skyr',
  source: 'matvaretabellen',
  basis: 'database',
  label: 'Skyr, plain',
  brand: null,
  foodId: 'food-skyr',
  barcode: null,
  servingOptions: [{ unit: 'serving', label: '1 dós', grams: 170 }],
  defaultServing: { unit: 'serving', label: '1 dós', grams: 170 },
  defaultAmount: 1,
  defaultKcal: 107,
  per100g: { kcal: 63, proteinG: 11, carbsG: 4, fatG: 0.2 },
  perServing: null,
  off: null,
  offAttribution: null,
  liquid: false,
  lastUsedAt: null,
  useCount: null,
};

function items(): MealItemDraft[] {
  return [
    draftFromChoice(skyr),
    quickAddDraft({ label: 'Soup', kcal: 320, protein: null, carbs: 30, fat: null, servingLabel: '1 serving' }),
  ];
}

function snapshot(savedAt: Date, overrides: Partial<MealTraySnapshot> = {}): MealTraySnapshot {
  return { items: items(), slot: 'lunch', date: '2026-10-18', source: 'search', savedAt, ...overrides };
}

afterEach(async () => {
  await localStore.settled();
});

describe('the tray', () => {
  it('comes back within a day exactly as it was picked, explicit nulls and all', async () => {
    // Whole seconds: the file keeps an instant as Swift's `.iso8601` does.
    const savedAt = new Date(Date.UTC(2026, 9, 18, 12, 0, 0));
    const picked = snapshot(savedAt);
    await expect(saveTray(picked, MEMBER)).resolves.toBe(true);
    const back = await restoreTray(MEMBER, new Date(savedAt.getTime() + 23 * HOUR));
    expect(back).toEqual(picked);
    expect(back?.items[1]?.perServing).toEqual({ kcal: 320, proteinG: null, carbsG: 30, fatG: null });
  });

  it('is deleted rather than offered once it is a day old', async () => {
    const savedAt = new Date(Date.UTC(2026, 9, 17, 12, 0, 0));
    await saveTray(snapshot(savedAt), MEMBER);
    expect(await restoreTray(MEMBER, new Date(savedAt.getTime() + MEAL_TRAY_LIFETIME_MS))).toBeNull();
    await localStore.settled();
    expect(fileSystemState.read(`health/${MEMBER}/tray.json`)).toBeNull();
  });

  it('is deleted rather than offered when it holds nothing', async () => {
    const now = new Date();
    await saveTray(snapshot(now, { items: [] }), MEMBER);
    expect(await restoreTray(MEMBER, now)).toBeNull();
    await localStore.settled();
    expect(fileSystemState.read(`health/${MEMBER}/tray.json`)).toBeNull();
  });

  it('belongs to one member', async () => {
    const now = new Date();
    await saveTray(snapshot(now), MEMBER);
    expect(await restoreTray(OTHER, now)).toBeNull();
    expect(await restoreTray(MEMBER, now)).not.toBeNull();
  });

  it('is gone after a save or a discard clears it', async () => {
    const now = new Date();
    await saveTray(snapshot(now), MEMBER);
    void clearTray(MEMBER);
    expect(await restoreTray(MEMBER, now)).toBeNull();
  });

  it('loses only an item that no longer reads, never the whole tray', async () => {
    const now = new Date();
    await saveTray(snapshot(now), MEMBER);
    await localStore.settled();
    const path = `health/${MEMBER}/tray.json`;
    const json = JSON.parse(fileSystemState.read(path) ?? '{}') as { items: unknown[] };
    json.items.unshift({ label: 'from an older build' });
    fileSystemState.seed(path, JSON.stringify(json));
    const back = await restoreTray(MEMBER, now);
    expect(back?.items.map((item) => item.label)).toEqual(['Skyr, plain', 'Soup']);
  });

  it('a file that is not a tray at all is simply not one', async () => {
    fileSystemState.seed(`health/${MEMBER}/tray.json`, JSON.stringify({ items: 'nope' }));
    expect(await restoreTray(MEMBER)).toBeNull();
  });

  it('is fresh for just under a day', () => {
    const savedAt = new Date(Date.UTC(2026, 9, 18, 8, 0, 0));
    expect(isTrayFresh({ savedAt }, new Date(savedAt.getTime() + MEAL_TRAY_LIFETIME_MS - 1))).toBe(true);
    expect(isTrayFresh({ savedAt }, new Date(savedAt.getTime() + MEAL_TRAY_LIFETIME_MS))).toBe(false);
  });
});
