/**
 * The pool picker (iOS PlanVenuePickerSheet): `GET /venues?category=Pool&limit=40`
 * on every opening, the skeleton, the error with Try again, nearest first with
 * the distance when the member granted a fix, the catalogue's order and the
 * city otherwise, and a tap handing the slug over.
 */
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { api, Reply } from '@test/server';

import { stubApiClientPerTest } from '../../../../api/testing';
import { UiKitProvider } from '../../../../components/ui';
import { bottomSheetMock } from '../../../../components/ui/testing/bottomSheetMock';
import { restoreTestFontScale, setTestFontScale } from '../../../../hooks/testing';
import { setCurrentLanguage, translate } from '../../../../i18n';
import { locationStore } from '../../../../stores/locationStore';
import { settle } from '../../__tests__/planFixtures';
import PlanVenuePickerSheet from '../PlanVenuePickerSheet';

jest.mock('@gorhom/bottom-sheet', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('../../../../components/ui/testing/bottomSheetMock').bottomSheetModule,
);
jest.mock('expo-asset', () => jest.requireActual('expo/node_modules/expo-asset'), { virtual: true });

stubApiClientPerTest();

const en = (key: string) => translate(key, 'en');

const pools = {
  data: [
    {
      id: '11111111-1111-4111-8111-111111111111',
      slug: 'laugardalslaug',
      name: 'Laugardalslaug',
      city: 'Reykjavík',
      coordinates: { latitude: 64.1414, longitude: -21.8771 },
    },
    {
      id: '22222222-2222-4222-8222-222222222222',
      slug: 'sundholl',
      name: 'Sundhöllin',
      city: 'Reykjavík',
      coordinates: { latitude: 64.1449, longitude: -21.9238 },
    },
    { id: '33333333-3333-4333-8333-333333333333', slug: 'salalaug', name: 'Salalaug', city: 'Kópavogur' },
  ],
  pagination: { nextCursor: null, hasMore: false, limit: 40 },
};

const HARPA = { latitude: 64.1502, longitude: -21.9327, accuracy: 30, timestamp: Date.now() };

async function renderPicker(onOpenVenue = jest.fn()) {
  await render(
    <UiKitProvider>
      <PlanVenuePickerSheet visible onClose={jest.fn()} onOpenVenue={onOpenVenue} />
    </UiKitProvider>,
  );
  await act(async () => settle());
  return onOpenVenue;
}

const names = () => screen.getAllByRole('button').map((button) => button.props.accessibilityLabel as string).filter(Boolean);

beforeEach(() => {
  bottomSheetMock.reset();
  setTestFontScale(1);
  locationStore.setState({ permission: 'undetermined', currentLocation: null });
});

afterEach(async () => {
  restoreTestFontScale();
  setCurrentLanguage('en');
  locationStore.setState({ permission: 'undetermined', currentLocation: null });
  await settle();
});

it('asks for the pools, 40 at most', async () => {
  api.on('GET', '/venues', Reply.ok(pools));
  await renderPicker();
  expect(api.sent('/venues', 'GET').query).toMatchObject({ category: 'Pool', limit: '40' });
  expect(screen.getByRole('header', { name: en('plan.swim.find_pool') })).toBeOnTheScreen();
});

it("keeps the catalogue's order and shows the city without a fix", async () => {
  api.on('GET', '/venues', Reply.ok(pools));
  await renderPicker();
  expect(names().filter((name) => name.includes(','))).toEqual([
    'Laugardalslaug, Reykjavík',
    'Sundhöllin, Reykjavík',
    'Salalaug, Kópavogur',
  ]);
});

it('a fix the member did not grant is no fix', async () => {
  locationStore.setState({ permission: 'denied', currentLocation: HARPA });
  api.on('GET', '/venues', Reply.ok(pools));
  await renderPicker();
  expect(screen.getByRole('button', { name: 'Laugardalslaug, Reykjavík' })).toBeOnTheScreen();
});

it('is nearest first with the distance when the member granted a fix', async () => {
  locationStore.setState({ permission: 'granted', currentLocation: HARPA });
  setCurrentLanguage('is');
  api.on('GET', '/venues', Reply.ok(pools));
  await renderPicker();
  expect(names().filter((name) => name.includes(','))).toEqual(['Sundhöllin, 0,7 km', 'Laugardalslaug, 2,9 km', 'Salalaug, Kópavogur']);
});

it('a tap hands the slug over', async () => {
  api.on('GET', '/venues', Reply.ok(pools));
  const onOpenVenue = await renderPicker();
  await fireEvent.press(screen.getByRole('button', { name: 'Sundhöllin, Reykjavík' }));
  expect(onOpenVenue).toHaveBeenCalledWith('sundholl');
});

it('a failed read offers Try again, which reads again', async () => {
  api.on('GET', '/venues', Reply.problem(503, 'unavailable'));
  await renderPicker();
  expect(screen.getByText(en('common.error_body'))).toBeOnTheScreen();
  api.on('GET', '/venues', Reply.ok(pools));
  await fireEvent.press(screen.getByRole('button', { name: en('health.retry') }));
  await act(async () => settle());
  expect(screen.getByRole('button', { name: 'Salalaug, Kópavogur' })).toBeOnTheScreen();
  expect(api.sentAll('/venues', 'GET')).toHaveLength(2);
});
