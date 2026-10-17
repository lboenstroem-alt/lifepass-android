/**
 * `GET /purchases`: the model (iOS `Purchase`, `Paginated`) and the read,
 * checked against the contract. The screen's paging rules are in
 * src/features/account/receipts/__tests__/receiptsModel.test.ts.
 */
import { expectResponseDataValid, sampleResponse } from '@test/contract';
import { api, Reply } from '@test/server';

import { DecodingError } from '../errors';
import { decodePurchasesPage, fetchPurchases, isPurchasePaid, PURCHASES_PAGE_SIZE } from '../purchases';
import { expectSentToMatchContract, stubApiClientPerTest } from '../testing';

stubApiClientPerTest();

/** Recorded from the contract (`contracts/purchases.md`), ids in both cases (iOS ReceiptsTests). */
const firstPage = {
  data: [
    {
      id: '5f0c2a6e-8a51-4e0b-9d7e-2b9a1f3c4d10',
      productSlug: 'plan-plus',
      productName: 'Plus',
      productType: 'subscription',
      amountIsk: 14900,
      status: 'fulfilled',
      createdAt: '2026-09-01T10:14:03.512Z',
      fulfilledAt: '2026-09-01T10:14:09.101Z',
    },
    {
      id: '0B7D4A62-3C9E-4F1A-A2D5-6E8F9C1B2A34',
      productSlug: 'pass-day-gym',
      productName: 'Gym day pass',
      productType: 'pass',
      amountIsk: 3490,
      status: 'pending',
      createdAt: '2026-08-20T08:02:44.000Z',
      fulfilledAt: null,
    },
  ],
  pagination: { nextCursor: 'eyJjIjoxfQ', hasMore: true, limit: 20 },
};

describe('a page of purchases', () => {
  it('decodes, ids lower case, dates as instants', () => {
    const page = decodePurchasesPage(firstPage);
    expect(page.data.map((p) => p.productSlug)).toEqual(['plan-plus', 'pass-day-gym']);
    expect(page.data[1]!.id).toBe('0b7d4a62-3c9e-4f1a-a2d5-6e8f9c1b2a34');
    expect(page.data[0]!.createdAt.toISOString()).toBe('2026-09-01T10:14:03.512Z');
    expect(page.data[1]!.fulfilledAt).toBeNull();
    expect(page.pagination).toEqual({ nextCursor: 'eyJjIjoxfQ', hasMore: true, limit: 20 });
  });

  it('an unknown product type or status still decodes, kept raw', () => {
    const page = decodePurchasesPage({
      data: [{ ...firstPage.data[0], productType: 'a_type_from_the_future', status: 'disputed' }],
      pagination: { nextCursor: null, hasMore: false },
    });
    expect(page.data[0]!.productType).toBe('a_type_from_the_future');
    expect(page.data[0]!.status).toBe('disputed');
    expect(page.pagination.limit).toBeNull();
  });

  it('only paid and fulfilled are paid: a started checkout is not a receipt', () => {
    expect(isPurchasePaid({ status: 'paid' })).toBe(true);
    expect(isPurchasePaid({ status: 'fulfilled' })).toBe(true);
    for (const status of ['pending', 'cancelled', 'refunded', 'disputed']) {
      expect(isPurchasePaid({ status })).toBe(false);
    }
  });

  it('a row the app cannot read fails the page rather than dropping it', () => {
    expect(() => decodePurchasesPage({ ...firstPage, data: [{ ...firstPage.data[0], id: 'order-1' }] })).toThrow();
    expect(() => decodePurchasesPage({ ...firstPage, data: [{ ...firstPage.data[0], amountIsk: '14900' }] })).toThrow();
    expect(() => decodePurchasesPage({ ...firstPage, data: [{ ...firstPage.data[0], createdAt: 'yesterday' }] })).toThrow();
    expect(() => decodePurchasesPage({ data: [], pagination: {} })).toThrow();
    expect(() => decodePurchasesPage([])).toThrow();
  });

  it("the contract's own example decodes, and ours is the contract's shape", () => {
    expect(() => decodePurchasesPage(sampleResponse('GET', '/purchases', 200, 'full'))).not.toThrow();
    expectResponseDataValid('GET', '/purchases', 200, firstPage);
  });
});

describe('the read', () => {
  it('asks for 20 and sends the cursor back unchanged', async () => {
    api.on('GET', '/purchases', Reply.ok(firstPage));
    await fetchPurchases();
    const first = expectSentToMatchContract('GET', '/purchases');
    expect(first.query).toEqual({ limit: String(PURCHASES_PAGE_SIZE) });

    await fetchPurchases({ cursor: 'eyJjIjoxfQ' });
    const second = expectSentToMatchContract('GET', '/purchases');
    expect(second.query).toEqual({ limit: '20', cursor: 'eyJjIjoxfQ' });
  });

  it('an unreadable page is a decoding error', async () => {
    api.on('GET', '/purchases', Reply.ok({ data: 'none' }));
    await expect(fetchPurchases()).rejects.toBeInstanceOf(DecodingError);
  });
});
