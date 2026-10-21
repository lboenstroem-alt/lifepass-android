/**
 * The Receipts page as the member sees it (iOS ReceiptsView): every state of
 * ./receiptsModel drawn, the links it opens, and the language.
 */
import { fireEvent, screen } from '@testing-library/react-native';
import { api, Reply } from '@test/server';
import { Linking } from 'react-native';

import { stubApiClientPerTest } from '../../../../api/testing';
import { setCurrentLanguage } from '../../../../i18n';
import { currentRoute, renderPushed, settle } from '../../billing/__tests__/screenHarness';
import ReceiptsScreen from '../ReceiptsScreen';

// expo-font (behind @expo/vector-icons) imports expo-asset, which npm left
// nested under expo/; the kit's own tests point Jest at it the same way.
jest.mock('expo-asset', () => jest.requireActual('expo/node_modules/expo-asset'), { virtual: true });

stubApiClientPerTest();

const plus = {
  id: '5f0c2a6e-8a51-4e0b-9d7e-2b9a1f3c4d10',
  productSlug: 'plan-plus',
  productName: 'Plus',
  productType: 'subscription',
  amountIsk: 14900,
  status: 'fulfilled',
  createdAt: '2026-09-01T10:14:03.512Z',
  fulfilledAt: '2026-09-01T10:14:09.101Z',
};
const dayPass = {
  id: '0b7d4a62-3c9e-4f1a-a2d5-6e8f9c1b2a34',
  productSlug: 'pass-day-gym',
  productName: 'Gym day pass',
  productType: 'pass',
  amountIsk: 3490,
  status: 'pending',
  createdAt: '2026-08-20T08:02:44.000Z',
  fulfilledAt: null,
};
const gift = {
  id: '7a1c2b3d-0000-4000-8000-000000000009',
  productSlug: 'gift-explorer',
  productName: 'Explorer gift',
  productType: 'pass',
  amountIsk: 0,
  status: 'disputed',
  createdAt: '2026-07-02T12:00:00Z',
  fulfilledAt: null,
};

function page(data: object[], nextCursor: string | null = null) {
  return { data, pagination: { nextCursor, hasMore: nextCursor !== null, limit: 20 } };
}

let openURL: jest.SpyInstance;

beforeEach(() => {
  openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
});

async function show() {
  await renderPushed('Receipts', ReceiptsScreen);
  await settle();
}

it('lists the orders: amount or Free, greyed when not paid, the status line only when known', async () => {
  api.on('GET', '/purchases', Reply.ok(page([plus, dayPass, gift])));
  await show();

  expect(screen.getByText('Receipts')).toBeTruthy();
  expect(screen.getByText('Plus')).toBeTruthy();
  expect(screen.getByText('1 September 2026')).toBeTruthy();
  expect(screen.getByText('ISK 14,900')).toBeTruthy();
  expect(screen.getByText('Paid')).toBeTruthy();
  expect(screen.getByText('ISK 3,490')).toBeTruthy();
  expect(screen.getByText('Not paid')).toBeTruthy();
  expect(screen.getByText('Free')).toBeTruthy();
  // `disputed` is a status this build does not know: no line at all.
  expect(screen.queryByText('disputed')).toBeNull();
  expect(screen.getByText('ISK 3,490')).toHaveStyle({ color: 'rgba(25,28,36,0.48)' });
  expect(screen.getByText('ISK 14,900')).toHaveStyle({ color: '#191C24' });

  expect(screen.getByText(/Monthly plan renewals are not listed here/)).toBeTruthy();
  expect(screen.getByText('Need a copy by email?')).toBeTruthy();
  expect(screen.queryByTestId('receipts.loadMore')).toBeNull();
});

it('"Show more" loads the next page under the server cursor', async () => {
  api.on('GET', '/purchases', (request) =>
    Reply.ok(request.query.cursor === undefined ? page([plus], 'eyJjIjoxfQ') : page([dayPass])),
  );
  await show();
  expect(screen.queryByText('Gym day pass')).toBeNull();

  await fireEvent.press(screen.getByRole('button', { name: 'Show more' }));
  await settle();

  expect(api.requests.at(-1)!.query.cursor).toBe('eyJjIjoxfQ');
  expect(screen.getByText('Gym day pass')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Show more' })).toBeNull();
});

it('a successful empty answer says "No purchases yet." with the help footer', async () => {
  api.on('GET', '/purchases', Reply.ok(page([])));
  await show();
  expect(screen.getByText('No purchases yet.')).toBeTruthy();
  expect(screen.getByText('Contact Contact@sport-a.com')).toBeTruthy();
  expect(screen.queryByText(/Monthly plan renewals/)).toBeNull();
});

it('a 404 sends the member to the website, with no retry', async () => {
  api.on('GET', '/purchases', Reply.raw(404, '<html>Not found</html>'));
  await show();
  expect(screen.getByText('Your purchase history is on the website for now.')).toBeTruthy();
  expect(screen.queryByText('No purchases yet.')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();

  await fireEvent.press(screen.getByRole('link', { name: 'See your purchases on lifepass.is' }));
  expect(openURL).toHaveBeenCalledWith('https://www.lifepass.is/purchases');
});

it('a failure says so, links the website, and Try again reads again', async () => {
  api.on('GET', '/purchases', Reply.problem(500, 'internal_error'));
  await show();
  expect(screen.getByText("We couldn't load your purchases here. They are all on the website.")).toBeTruthy();
  expect(screen.getByRole('link', { name: 'See your purchases on lifepass.is' })).toBeTruthy();
  expect(screen.queryByText('No purchases yet.')).toBeNull();

  api.on('GET', '/purchases', Reply.ok(page([plus])));
  await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
  await settle();
  expect(screen.getByText('Plus')).toBeTruthy();
});

it('the contact link writes to the merchant mailbox', async () => {
  api.on('GET', '/purchases', Reply.ok(page([plus])));
  await show();
  await fireEvent.press(screen.getByRole('link', { name: 'Contact Contact@sport-a.com' }));
  expect(openURL).toHaveBeenCalledWith('mailto:Contact@sport-a.com');
});

it('a phone with nothing to open a link with stays on the page', async () => {
  openURL.mockRejectedValue(new Error('no activity'));
  api.on('GET', '/purchases', Reply.ok(page([])));
  await show();
  await fireEvent.press(screen.getByRole('link', { name: 'Contact Contact@sport-a.com' }));
  await settle();
  expect(currentRoute()).toBe('Receipts');
});

it('back returns to the page underneath', async () => {
  api.on('GET', '/purchases', Reply.ok(page([plus])));
  await show();
  await fireEvent.press(screen.getByRole('button', { name: 'Back' }));
  expect(currentRoute()).toBe('Start');
});

it('speaks Icelandic: title, date, status and amount words', async () => {
  setCurrentLanguage('is');
  api.on('GET', '/purchases', Reply.ok(page([dayPass, { ...gift, status: 'refunded' }])));
  await show();
  expect(screen.getByText('Kvittanir')).toBeTruthy();
  expect(screen.getByText('20. ágúst 2026')).toBeTruthy();
  expect(screen.getByText('Ógreitt')).toBeTruthy();
  expect(screen.getByText('Endurgreitt')).toBeTruthy();
  expect(screen.getByText('Frítt')).toBeTruthy();
  // The price reads the web's way in both languages.
  expect(screen.getByText('ISK 3,490')).toBeTruthy();
});
