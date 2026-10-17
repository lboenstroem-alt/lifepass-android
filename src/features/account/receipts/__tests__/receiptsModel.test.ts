/**
 * Account › Receipts, against `GET /purchases`: the port of iOS
 * ReceiptsTests (LifePassTests/ReceiptsTests.swift), same cases and vectors,
 * through the real API client against the stub server.
 *
 * The rule: only a successful empty answer is "No purchases yet"; a 404 (the
 * route is not deployed yet), an offline phone or a server error send the
 * member to the website's purchase history instead of claiming there is none.
 */
import { api, Reply } from '@test/server';

import { stubApiClientPerTest } from '../../../../api/testing';
import { lookup } from '../../../../i18n';
import { receiptStatusKey, ReceiptsViewModel, WEB_PURCHASES_URL, type ReceiptsState } from '../receiptsModel';

stubApiClientPerTest();

/** Recorded from the contract (`contracts/purchases.md`), ids in both cases. */
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

const secondPage = {
  data: [
    {
      id: '7a1c2b3d-0000-4000-8000-000000000009',
      productSlug: 'gift-explorer',
      productName: 'Explorer gift',
      productType: 'a_type_from_the_future',
      amountIsk: 0,
      status: 'fulfilled',
      createdAt: '2026-07-02T12:00:00Z',
      fulfilledAt: '2026-07-02T12:00:01Z',
    },
  ],
  pagination: { nextCursor: null, hasMore: false, limit: 20 },
};

let viewModel: ReceiptsViewModel;

beforeEach(() => {
  viewModel = new ReceiptsViewModel();
});

afterEach(() => {
  viewModel.dispose();
});

function rows(state: ReceiptsState) {
  if (state.kind !== 'loaded') throw new Error(`expected loaded, got ${state.kind}`);
  return state.purchases;
}

it('the orders are listed and paged with the server cursor', async () => {
  api.on('GET', '/purchases', (request) => Reply.ok(request.query.cursor === undefined ? firstPage : secondPage));
  await viewModel.load();

  const shown = rows(viewModel.state);
  expect(shown.map((p) => p.productSlug)).toEqual(['plan-plus', 'pass-day-gym']);
  expect(shown[0]!.status).toBe('fulfilled');
  expect(shown[1]!.id).toBe('0b7d4a62-3c9e-4f1a-a2d5-6e8f9c1b2a34');
  expect(viewModel.hasMore).toBe(true);
  expect(api.requests[0]!.query.limit).toBe('20');

  await viewModel.loadMore();

  expect(api.requests.at(-1)!.query.cursor).toBe('eyJjIjoxfQ'); // sent back unchanged
  const all = rows(viewModel.state);
  expect(all).toHaveLength(3);
  expect(all[2]!.productType).toBe('a_type_from_the_future'); // an unknown type still decodes
  expect(viewModel.hasMore).toBe(false);
});

it('a not-yet-deployed route sends the member to the website', async () => {
  api.on('GET', '/purchases', Reply.problem(404, 'not_found'));
  await viewModel.load();
  expect(viewModel.state).toEqual({ kind: 'unavailable' });
  expect(WEB_PURCHASES_URL).toBe('https://www.lifepass.is/purchases');

  // An edge 404 with no problem body means the same.
  api.on('GET', '/purchases', Reply.raw(404, '<html>Not found</html>'));
  await viewModel.load();
  expect(viewModel.state).toEqual({ kind: 'unavailable' });
});

it('a failed read is never "no purchases"', async () => {
  api.on('GET', '/purchases', Reply.fail());
  await viewModel.load();
  expect(viewModel.state).toEqual({ kind: 'failed' });

  api.on('GET', '/purchases', Reply.problem(500, 'internal_error'));
  await viewModel.load();
  expect(viewModel.state).toEqual({ kind: 'failed' });

  // A body the app cannot read, too.
  api.on('GET', '/purchases', Reply.ok({ data: [{ id: 'x' }], pagination: { hasMore: false } }));
  await viewModel.load();
  expect(viewModel.state).toEqual({ kind: 'failed' });
});

it('only a successful empty answer is empty', async () => {
  api.on('GET', '/purchases', Reply.ok({ data: [], pagination: { nextCursor: null, hasMore: false, limit: 20 } }));
  await viewModel.load();
  expect(viewModel.state).toEqual({ kind: 'loaded', purchases: [] });
  expect(lookup('receipts.empty', 'en')).toBe('No purchases yet.');
});

it('a stale cursor starts again from the top', async () => {
  let calls = 0;
  api.on('GET', '/purchases', (request) => {
    calls += 1;
    if (request.query.cursor !== undefined) return Reply.problem(400, 'invalid-cursor');
    return Reply.ok(firstPage);
  });
  await viewModel.load();
  await viewModel.loadMore();
  expect(rows(viewModel.state)).toHaveLength(2);
  expect(calls).toBe(3); // first page, refused cursor, first page again
});

it('status lines', () => {
  expect(receiptStatusKey('fulfilled')).toBe('receipts.status.paid');
  expect(receiptStatusKey('paid')).toBe('receipts.status.paid');
  expect(receiptStatusKey('pending')).toBe('receipts.status.pending');
  expect(receiptStatusKey('cancelled')).toBe('receipts.status.cancelled');
  expect(receiptStatusKey('refunded')).toBe('receipts.status.refunded');
  expect(receiptStatusKey('disputed')).toBeNull(); // no guess for a status the app does not know
  expect(lookup('receipts.status.pending', 'is')).toBe('Ógreitt');
});

describe('beyond the iOS cases', () => {
  it('any other failure while loading more keeps the list and the button', async () => {
    api.on('GET', '/purchases', (request) =>
      request.query.cursor === undefined ? Reply.ok(firstPage) : Reply.problem(503, 'unavailable'),
    );
    await viewModel.load();
    await viewModel.loadMore();
    expect(rows(viewModel.state)).toHaveLength(2);
    expect(viewModel.hasMore).toBe(true);
    expect(viewModel.isLoadingMore).toBe(false);
  });

  it('rows already shown are not repeated', async () => {
    const overlapping = { ...secondPage, data: [firstPage.data[1], ...secondPage.data] };
    api.on('GET', '/purchases', (request) => Reply.ok(request.query.cursor === undefined ? firstPage : overlapping));
    await viewModel.load();
    await viewModel.loadMore();
    expect(rows(viewModel.state).map((p) => p.productSlug)).toEqual(['plan-plus', 'pass-day-gym', 'gift-explorer']);
  });

  it('more without a cursor is not more', async () => {
    api.on('GET', '/purchases', Reply.ok({ ...firstPage, pagination: { nextCursor: null, hasMore: true, limit: 20 } }));
    await viewModel.load();
    expect(viewModel.hasMore).toBe(false);
  });

  it('a pull to refresh keeps the list on screen while it reloads', async () => {
    api.on('GET', '/purchases', Reply.ok(firstPage));
    await viewModel.load();
    const states: string[] = [];
    viewModel.subscribe(() => states.push(viewModel.state.kind));
    await viewModel.load();
    expect(states).not.toContain('loading');
    expect(rows(viewModel.state)).toHaveLength(2);
  });

  it('a first load shows the spinner, and a retry after a failure shows it again', async () => {
    expect(viewModel.state).toEqual({ kind: 'loading' });
    api.on('GET', '/purchases', Reply.fail());
    await viewModel.load();
    const states: string[] = [];
    viewModel.subscribe(() => states.push(viewModel.state.kind));
    api.on('GET', '/purchases', Reply.ok(firstPage));
    await viewModel.load();
    expect(states).toEqual(['loading', 'loaded']);
  });

  it('a page that answers after the screen closed changes nothing', async () => {
    let answer: (() => void) | null = null;
    api.on(
      'GET',
      '/purchases',
      () =>
        new Promise((resolve) => {
          answer = () => resolve(Reply.ok(firstPage));
        }),
    );
    const loading = viewModel.load();
    await new Promise((resolve) => setTimeout(resolve, 20));
    viewModel.dispose();
    (answer as (() => void) | null)?.();
    await loading;
    expect(viewModel.state).toEqual({ kind: 'loading' });
  });
});
