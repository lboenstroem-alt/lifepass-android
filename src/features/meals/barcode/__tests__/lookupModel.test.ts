/**
 * One barcode, two lookups (iOS BarcodeLookupModel, ios-ux.md 12.5): the
 * server's answer wins, a product shows at once, "nothing" waits for the
 * server, the sheet opens after three seconds, and a stale answer changes
 * nothing.
 */
import { setAnalyticsObserver } from '../../../../lib/analytics';
import { setMealApi } from '../../api/mealApi';
import { fakeMealApi } from '../../api/testing';
import { choice } from '../../capture/__tests__/mealFixtures';
import { setFoodFacts, type FoodFactsLookup } from '../../offClient/client';
import type { OFFLookupOutcome } from '../../offClient/parse';
import type { BarcodeLookupResult, OFFSnapshot } from '../../types/models';
import { BarcodeLookupModel, BARCODE_EARLY_OPEN_MS } from '../lookupModel';

const CODE = '5690527282050';

const snapshot: OFFSnapshot = {
  barcode: CODE,
  productName: 'Skyr vanilla',
  productNameLang: 'other',
  brand: 'Ísey',
  per100g: { kcal: 76, proteinG: 9.6, carbsG: 8.1, fatG: 0.2, fibreG: null, sugarsG: null, saturatedFatG: null, saltG: null },
  energyFromKj: false,
  servingLabel: '200 g',
  servingQuantityG: 200,
  retrievedAt: '2026-10-22T10:00:00.000Z',
};

interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

let server: Deferred<BarcodeLookupResult>[];
let off: Deferred<OFFLookupOutcome>[];
let events: [string, Record<string, unknown>][];

beforeEach(() => {
  server = [];
  off = [];
  events = [];
  setMealApi(
    fakeMealApi({
      barcode: jest.fn(() => {
        const next = deferred<BarcodeLookupResult>();
        server.push(next);
        return next.promise;
      }),
    }),
  );
  const lookup: FoodFactsLookup = {
    lookup: jest.fn(() => {
      const next = deferred<OFFLookupOutcome>();
      off.push(next);
      return next.promise;
    }),
  };
  setFoodFacts(lookup);
  setAnalyticsObserver((event, params) => events.push([event, { ...params }]));
});

afterEach(() => {
  setMealApi(null);
  setFoodFacts(null);
  setAnalyticsObserver(null);
  jest.useRealTimers();
});

async function settle(): Promise<void> {
  for (let index = 0; index < 5; index += 1) await Promise.resolve();
}

describe('the two lookups', () => {
  it('asks both at once, and says the code was scanned', async () => {
    const model = new BarcodeLookupModel();
    model.start(CODE, 'camera', 'en');
    expect(server).toHaveLength(1);
    expect(off).toHaveLength(1);
    expect(model.state).toMatchObject({ code: CODE, isLooking: true, sheetShown: false, result: null });
    expect(events).toContainEqual(['barcode_scanned', { source: 'camera' }]);
  });

  it('lets the member own food win over Open Food Facts', async () => {
    const model = new BarcodeLookupModel();
    model.start(CODE, 'camera', 'en');
    server[0]!.resolve({ food: choice(), origin: 'mine' });
    await settle();
    off[0]!.resolve({ kind: 'found', snapshot, liquid: false });
    await settle();
    expect(model.state.result).toEqual({ kind: 'choice', food: choice(), origin: 'mine' });
    expect(model.state.sheetShown).toBe(true);
    expect(events).toContainEqual(['barcode_result', { outcome: 'mine_found' }]);
  });

  it('replaces a product already shown when the server answers with a label row', async () => {
    const model = new BarcodeLookupModel();
    model.start(CODE, 'camera', 'en');
    off[0]!.resolve({ kind: 'found', snapshot, liquid: true });
    await settle();
    expect(model.state.result).toEqual({ kind: 'product', snapshot, liquid: true });
    expect(events).toContainEqual(['barcode_result', { outcome: 'off_found' }]);
    server[0]!.resolve({ food: choice(), origin: 'library' });
    await settle();
    expect(model.state.result?.kind).toBe('choice');
    expect(events).toContainEqual(['barcode_result', { outcome: 'label_found' }]);
  });

  it.each([
    [{ kind: 'notFound' } as OFFLookupOutcome, { kind: 'notFound' }, 'not_found'],
    [{ kind: 'noNutrition', name: 'Harðfiskur', brand: 'Eyjabiti' } as OFFLookupOutcome, { kind: 'noNutrition', name: 'Harðfiskur', brand: 'Eyjabiti' }, 'no_nutrition'],
    [{ kind: 'failed' } as OFFLookupOutcome, { kind: 'failed' }, 'lookup_failed'],
  ])('waits for the server before saying %o', async (outcome, result, word) => {
    const model = new BarcodeLookupModel();
    model.start(CODE, 'typed', 'en');
    off[0]!.resolve(outcome);
    await settle();
    expect(model.state.result).toBeNull();
    expect(model.state.isLooking).toBe(true);
    server[0]!.resolve({ food: null, origin: null });
    await settle();
    expect(model.state.result).toEqual(result);
    expect(model.state.isLooking).toBe(false);
    expect(events).toContainEqual(['barcode_result', { outcome: word }]);
  });

  it('reads a failed server lookup as no answer', async () => {
    const model = new BarcodeLookupModel();
    model.start(CODE, 'camera', 'en');
    server[0]!.reject(new Error('offline'));
    off[0]!.resolve({ kind: 'notFound' });
    await settle();
    expect(model.state.result).toEqual({ kind: 'notFound' });
  });
});

describe('the sheet', () => {
  it('opens looking after three seconds with neither answer', async () => {
    jest.useFakeTimers();
    const model = new BarcodeLookupModel();
    model.start(CODE, 'camera', 'en');
    jest.advanceTimersByTime(BARCODE_EARLY_OPEN_MS - 1);
    expect(model.state.sheetShown).toBe(false);
    jest.advanceTimersByTime(1);
    expect(model.state).toMatchObject({ sheetShown: true, result: { kind: 'looking' }, isLooking: true });
    expect(events).toContainEqual(['barcode_result', { outcome: 'early_open' }]);
  });

  it('does not open early once an answer is in', async () => {
    jest.useFakeTimers();
    const model = new BarcodeLookupModel();
    model.start(CODE, 'camera', 'en');
    off[0]!.resolve({ kind: 'found', snapshot, liquid: false });
    await settle();
    jest.advanceTimersByTime(BARCODE_EARLY_OPEN_MS);
    expect(events.filter(([, params]) => params.outcome === 'early_open')).toHaveLength(0);
  });

  it('ignores answers for a lookup that has gone', async () => {
    const model = new BarcodeLookupModel();
    model.start(CODE, 'camera', 'en');
    model.reset();
    server[0]!.resolve({ food: choice(), origin: 'mine' });
    off[0]!.resolve({ kind: 'found', snapshot, liquid: false });
    await settle();
    expect(model.state).toMatchObject({ code: null, result: null, sheetShown: false, isLooking: false });
  });

  it('ignores the first code answers once a second code is read', async () => {
    const model = new BarcodeLookupModel();
    model.start(CODE, 'camera', 'en');
    model.start('96385074', 'camera', 'en');
    server[0]!.resolve({ food: choice(), origin: 'mine' });
    await settle();
    expect(model.state.result).toBeNull();
    expect(model.state.code).toBe('96385074');
  });

  it('Try again keeps the sheet up, looking, and asks both again', async () => {
    const model = new BarcodeLookupModel();
    model.start(CODE, 'camera', 'en');
    off[0]!.resolve({ kind: 'failed' });
    server[0]!.resolve({ food: null, origin: null });
    await settle();
    expect(model.state.result).toEqual({ kind: 'failed' });
    model.retry('en');
    expect(model.state).toMatchObject({ sheetShown: true, result: { kind: 'looking' }, code: CODE });
    expect(server).toHaveLength(2);
    expect(off).toHaveLength(2);
  });
});
