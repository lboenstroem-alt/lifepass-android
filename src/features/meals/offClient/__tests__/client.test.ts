/**
 * OP-41 from the phone (iOS FoodFactsService and
 * OpenFoodFactsDecodeTests.testTheRequestSaysWhatItWantsAndNothingMore):
 * the request carries the barcode in the path, the field list, and a
 * User-Agent naming the app, nothing else about the member; answers stay
 * in memory, failures are never kept. The network is a fake: nothing here
 * reaches Open Food Facts.
 */
import { FoodFactsService, OFF_CACHE_LIMIT, OFF_FIELDS, OFF_TIMEOUT_MS, offProductUrl, offUserAgent } from '../client';

const PRODUCT = '{"status":1,"product":{"product_name":"Skyr","nutriments":{"energy-kcal_100g":62}}}';

function fakeFetch(answer: (url: string) => { status: number; body?: string } | Error) {
  const calls: { url: string; init: RequestInit }[] = [];
  const impl = jest.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const result = answer(url);
    if (result instanceof Error) throw result;
    return { status: result.status, text: async () => result.body ?? '' };
  });
  return { impl, calls };
}

describe('the request', () => {
  it('says what it wants and nothing more', () => {
    const url = new URL(offProductUrl('5690527282050'));
    expect(url.host).toBe('world.openfoodfacts.org');
    expect(url.pathname).toBe('/api/v2/product/5690527282050.json');
    expect([...url.searchParams.keys()]).toEqual(['fields']);
    expect(url.searchParams.get('fields')).toBe(OFF_FIELDS);
    expect(offUserAgent('2.5.6')).toBe('LifePass-Android/2.5.6 (support@lifepass.is)');
    expect(offUserAgent(null)).toBe('LifePass-Android/0 (support@lifepass.is)');
  });

  it('names the app version it sends, and carries no cookie', async () => {
    const { impl, calls } = fakeFetch(() => ({ status: 200, body: PRODUCT }));
    await new FoodFactsService(impl).lookup('5690527282050', 'en');
    expect(calls).toHaveLength(1);
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers['User-Agent']).toMatch(/^LifePass-Android\/.+ \(support@lifepass\.is\)$/);
    expect(headers.Accept).toBe('application/json');
    expect(Object.keys(headers).sort()).toEqual(['Accept', 'Cache-Control', 'User-Agent']);
    expect(calls[0]!.init.credentials).toBe('omit');
    expect(calls[0]!.url).toBe(offProductUrl('5690527282050'));
  });
});

describe('the answers', () => {
  it('decodes a product, and keeps it for the session', async () => {
    const { impl } = fakeFetch(() => ({ status: 200, body: PRODUCT }));
    const service = new FoodFactsService(impl);
    const first = await service.lookup('5690527282050', 'en');
    expect(first.kind).toBe('found');
    expect(await service.lookup('5690527282050', 'en')).toBe(first);
    expect(impl).toHaveBeenCalledTimes(1);
    // The language is part of the key: the name follows it.
    await service.lookup('5690527282050', 'is');
    expect(impl).toHaveBeenCalledTimes(2);
  });

  it('reads 404 as not found and keeps that too', async () => {
    const { impl } = fakeFetch(() => ({ status: 404, body: '{"status":0}' }));
    const service = new FoodFactsService(impl);
    expect(await service.lookup('96385074', 'en')).toEqual({ kind: 'notFound' });
    await service.lookup('96385074', 'en');
    expect(impl).toHaveBeenCalledTimes(1);
  });

  it('never keeps a failure: a 429, a 5xx or no network', async () => {
    for (const answer of [{ status: 429 }, { status: 503 }, new TypeError('Network request failed')]) {
      const { impl } = fakeFetch(() => answer);
      const service = new FoodFactsService(impl);
      expect(await service.lookup('5690527282050', 'en')).toEqual({ kind: 'failed' });
      await service.lookup('5690527282050', 'en');
      expect(impl).toHaveBeenCalledTimes(2);
      expect(service.cachedCount).toBe(0);
    }
  });

  it('gives up after eight seconds', async () => {
    jest.useFakeTimers();
    try {
      const impl = jest.fn(
        (_url: string, init: RequestInit) =>
          new Promise<never>((_resolve, reject) => {
            init.signal?.addEventListener('abort', () => reject(new Error('aborted')));
          }),
      );
      const pending = new FoodFactsService(impl).lookup('5690527282050', 'en');
      jest.advanceTimersByTime(OFF_TIMEOUT_MS);
      expect(await pending).toEqual({ kind: 'failed' });
    } finally {
      jest.useRealTimers();
    }
  });

  it('asks nothing for a code that cannot be one', async () => {
    const { impl } = fakeFetch(() => ({ status: 200, body: PRODUCT }));
    const service = new FoodFactsService(impl);
    expect(await service.lookup('12345', 'en')).toEqual({ kind: 'notFound' });
    expect(await service.lookup('../../x/y', 'en')).toEqual({ kind: 'notFound' });
    expect(impl).not.toHaveBeenCalled();
  });

  it(`keeps the last ${OFF_CACHE_LIMIT} answers, the least recently used going first`, async () => {
    const { impl } = fakeFetch(() => ({ status: 200, body: PRODUCT }));
    const service = new FoodFactsService(impl);
    const code = (index: number) => String(10_000_000 + index);
    for (let index = 0; index < OFF_CACHE_LIMIT; index += 1) await service.lookup(code(index), 'en');
    // The first is used again, so the second is now the oldest.
    await service.lookup(code(0), 'en');
    await service.lookup(code(OFF_CACHE_LIMIT), 'en');
    expect(service.cachedCount).toBe(OFF_CACHE_LIMIT);
    const before = impl.mock.calls.length;
    await service.lookup(code(0), 'en');
    expect(impl.mock.calls.length).toBe(before);
    await service.lookup(code(1), 'en');
    expect(impl.mock.calls.length).toBe(before + 1);
  });

  it('forgets everything on clear', async () => {
    const { impl } = fakeFetch(() => ({ status: 200, body: PRODUCT }));
    const service = new FoodFactsService(impl);
    await service.lookup('5690527282050', 'en');
    service.clear();
    expect(service.cachedCount).toBe(0);
  });
});
