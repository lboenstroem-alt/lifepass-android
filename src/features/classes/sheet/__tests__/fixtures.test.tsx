/**
 * The development fixture `classSheet=<variant>` (iOS
 * `-LPScreenshotClassSheet`): the sheet opens once in the variant's state,
 * makes no request, and a tap on Confirm never reaches the server. Variants
 * iOS runs against its in-process stub (`refusal`, `classpay`) open nothing.
 */
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { api } from '@test/server';

import { stubApiClientPerTest } from '../../../../api/testing';
import { bottomSheetMock } from '../../../../components/ui/testing/bottomSheetMock';
import { restoreTestFontScale, setTestFontScale } from '../../../../hooks/testing';
import { lookup, setCurrentLanguage } from '../../../../i18n';
import ClassSheetHost from '../ClassSheetHost';
import { resetClassSheetFixtureForTests } from '../fixtures';
import { resetClassSheetRequestsForTests } from '../requests';
import { fakePages, flush, type FakePages } from './sheetHarness';

jest.mock('@gorhom/bottom-sheet', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('../../../../components/ui/testing/bottomSheetMock').bottomSheetModule,
);
jest.mock('expo-asset', () => jest.requireActual('expo/node_modules/expo-asset'), { virtual: true });

let mockFixture: string | null = null;
jest.mock('../../../../dev/fixtures', () => ({
  ...jest.requireActual('../../../../dev/fixtures'),
  fixtureArg: (key: string) => (key === 'classSheet' ? mockFixture : null),
}));

const en = (key: string) => lookup(key, 'en');

stubApiClientPerTest();

beforeEach(() => {
  setCurrentLanguage('en');
  setTestFontScale(1);
  bottomSheetMock.reset();
  resetClassSheetRequestsForTests();
  mockFixture = null;
  resetClassSheetFixtureForTests();
});
afterEach(() => restoreTestFontScale());

async function renderHost(pages?: FakePages): Promise<void> {
  await render(<ClassSheetHost pages={pages} />);
  await flush();
}

it('included: the session ready, nothing to pay, and Confirm sends nothing', async () => {
  mockFixture = 'included';
  await renderHost();
  expect(screen.getByText('Yoga Flow')).toBeOnTheScreen();
  expect(screen.getByText('Hress')).toBeOnTheScreen();
  expect(screen.getByText('Sigrún Jónsdóttir')).toBeOnTheScreen();
  expect(screen.getByText('5 spots left')).toBeOnTheScreen();
  expect(screen.getByTestId('booking.disclosure')).toBeOnTheScreen();
  expect(screen.queryByTestId('classsheet.price')).toBeNull();
  expect(api.requests).toHaveLength(0);

  await fireEvent.press(screen.getByTestId('classsheet.confirm'));
  await flush();
  expect(api.requests).toHaveLength(0);
  expect(screen.getByText(en('booking.err.title'))).toBeOnTheScreen();
});

it('surcharge: the amount above Confirm', async () => {
  mockFixture = 'surcharge';
  await renderHost();
  expect(screen.getByTestId('classsheet.price').props.accessibilityLabel).toBe('ISK 1,990 charged when you confirm');
  expect(api.requests).toHaveLength(0);
});

it('full: the class is full, no Confirm, and See other times opens the venue', async () => {
  mockFixture = 'full';
  const pages = fakePages();
  await renderHost(pages);
  expect(screen.getByText(en('booking.class.err_full'))).toBeOnTheScreen();
  expect(screen.queryByTestId('classsheet.confirm')).toBeNull();
  await fireEvent.press(screen.getByTestId('classsheet.other_times'));
  // The venues not loaded: its page, by slug.
  expect(pages.opened).toEqual([{ name: 'VenueDetail', params: { slug: 'hress' } }]);
  expect(api.requests).toHaveLength(0);
});

it('full, with the venues loaded: See other times opens the full flow on its day', async () => {
  mockFixture = 'full';
  const pages = fakePages({ hress: 'venue-hress' });
  await renderHost(pages);
  await fireEvent.press(screen.getByTestId('classsheet.other_times'));
  expect(pages.opened).toEqual([
    {
      name: 'BookingFlow',
      params: expect.objectContaining({ venueId: 'venue-hress', activity: expect.objectContaining({ name: 'Hress' }) }),
    },
  ]);
  expect(api.requests).toHaveLength(0);
});

it('noplan: the membership refusal with its plans step', async () => {
  mockFixture = 'noplan';
  await renderHost();
  expect(screen.getByText(en('booking.err.no_plan'))).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: en('booking.err.view_plans') })).toBeOnTheScreen();
  expect(screen.queryByTestId('classsheet.confirm')).toBeNull();
});

it.each(['refusal', 'classpay', 'anything'])('%s opens nothing', async (variant) => {
  mockFixture = variant;
  await renderHost();
  expect(screen.queryByTestId('classsheet.header')).toBeNull();
  expect(api.requests).toHaveLength(0);
});

it('opens once per run, and closes like any sheet', async () => {
  mockFixture = 'included';
  const first = await render(<ClassSheetHost />);
  await flush();
  await fireEvent.press(screen.getByTestId('classsheet.close'));
  await flush();
  expect(screen.queryByTestId('classsheet.header')).toBeNull();
  await act(async () => first.unmount());
  await render(<ClassSheetHost />);
  await flush();
  expect(screen.queryByTestId('classsheet.header')).toBeNull();
});
