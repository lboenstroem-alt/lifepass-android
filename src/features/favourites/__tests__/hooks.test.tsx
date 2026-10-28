/**
 * The contract hooks over the real store and the stubbed API: every screen
 * reads one store, and the venue page's heart behaves as iOS's does.
 */
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Pressable, Text, View } from 'react-native';
import { api, Reply } from '@test/server';

import { stubApiClientPerTest } from '../../../api/testing';
import { DialogHost, dismissAllDialogs } from '../../../components/ui/Dialog';
import { setCurrentLanguage } from '../../../i18n';
import { favouritesStore, useFavourite, useFavourites } from '..';

stubApiClientPerTest();

const A = 'aaaaaaaa-0000-4000-8000-000000000001';

const favRow = (venueId: string, name: string) => ({
  id: `11111111-1111-4111-8111-${venueId.slice(-12)}`,
  venueId,
  slug: name.toLowerCase(),
  name,
  description: '',
  city: 'Reykjavík',
  address: '',
  inBundle: true,
  imageUrl: null,
  categories: [],
  createdAt: '2026-10-02T14:00:00.000Z',
});

let server: string[] = [];

beforeEach(() => {
  server = [];
  api.on('GET', '/favourites', () => Reply.ok({ venues: server.map((id) => favRow(id, 'Laugar')), activities: [] }));
  api.on('POST', '/favourites', (request) => {
    const { venueId } = request.body as { venueId: string };
    if (!server.includes(venueId)) server.push(venueId);
    return Reply.ok({ ok: true });
  });
  api.on('DELETE', '/favourites', (request) => {
    server = server.filter((id) => id !== request.query.venueId);
    return Reply.ok({ ok: true });
  });
});

afterEach(async () => {
  await act(async () => dismissAllDialogs());
  favouritesStore.getState().reset();
});

function Heart({ venueId, testID, refresh }: { venueId: string; testID: string; refresh?: boolean }) {
  const heart = useFavourite(venueId, { refresh });
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{ selected: heart.isFavourite }}
      onPress={() => void heart.toggle()}
    >
      <Text>{heart.isFavourite ? 'saved' : 'not saved'}</Text>
    </Pressable>
  );
}

function SavedList() {
  const saved = useFavourites();
  return <Text testID="saved-list">{saved.venues.map((v) => v.name).join(',') || 'none'}</Text>;
}

const settle = () => act(async () => new Promise<void>((resolve) => setImmediate(resolve)));

it('a heart on one screen is already right on every other (one store)', async () => {
  await render(
    <View>
      <Heart venueId={A} testID="venue-heart" />
      <Heart venueId={A.toUpperCase()} testID="coach-heart" />
      <SavedList />
    </View>,
  );
  await settle();
  expect(screen.getByTestId('coach-heart')).toHaveTextContent('not saved');

  await fireEvent.press(screen.getByTestId('venue-heart'));
  expect(screen.getByTestId('coach-heart')).toHaveTextContent('saved');
  await settle();
  // The add read the list again, so the new row reached Saved.
  expect(screen.getByTestId('saved-list')).toHaveTextContent('Laugar');
  expect(server).toEqual([A]);

  await fireEvent.press(screen.getByTestId('coach-heart'));
  await settle();
  expect(screen.getByTestId('venue-heart')).toHaveTextContent('not saved');
  expect(screen.getByTestId('saved-list')).toHaveTextContent('none');
  expect(server).toEqual([]);
});

it('reads the list when a heart appears, joining a read on its way', async () => {
  server = [A];
  await render(
    <View>
      <Heart venueId={A} testID="one" />
      <Heart venueId={A} testID="two" />
    </View>,
  );
  await settle();
  expect(screen.getByTestId('one')).toHaveTextContent('saved');
  expect(api.sentAll('/favourites', 'GET')).toHaveLength(1);
});

it('a heart that mounts later reads nothing once the list is loaded (a lazy Coach carousel)', async () => {
  server = [A];
  const first = await render(<Heart venueId={A} testID="card-1" />);
  await settle();
  await first.unmount();
  await render(<Heart venueId={A} testID="card-2" />);
  await settle();
  expect(screen.getByTestId('card-2')).toHaveTextContent('saved');
  expect(api.sentAll('/favourites', 'GET')).toHaveLength(1);
});

it('the venue page (refresh) reads the list again every time it mounts, as iOS does', async () => {
  const first = await render(<Heart venueId={A} testID="page" refresh />);
  await settle();
  expect(screen.getByTestId('page')).toHaveTextContent('not saved');
  await first.unmount();
  // Saved elsewhere (the website) between two visits.
  server = [A];
  await render(<Heart venueId={A} testID="page" refresh />);
  await settle();
  expect(screen.getByTestId('page')).toHaveTextContent('saved');
  expect(api.sentAll('/favourites', 'GET')).toHaveLength(2);
});

it.each([
  ['en', 'Heads up', 'Could not update your favourites. Please try again.'],
  ['is', 'Athugaðu', 'Ekki tókst að uppfæra uppáhaldið þitt. Reyndu aftur.'],
] as const)('a failed save flips back and raises the alert (%s)', async (lang, title, message) => {
  setCurrentLanguage(lang);
  api.on('POST', '/favourites', Reply.delayed(30, Reply.problem(500, 'internal_error')));
  await render(
    <View>
      <Heart venueId={A} testID="venue-heart" />
      <DialogHost />
    </View>,
  );
  await settle();
  await fireEvent.press(screen.getByTestId('venue-heart'));
  expect(screen.getByTestId('venue-heart')).toHaveTextContent('saved');
  await act(async () => new Promise<void>((resolve) => setTimeout(resolve, 60)));
  await settle();
  expect(screen.getByTestId('venue-heart')).toHaveTextContent('not saved');
  expect(screen.getByText(title)).toBeOnTheScreen();
  expect(screen.getByText(message)).toBeOnTheScreen();
});

it('a double tap while the save is in flight sends one request', async () => {
  await render(<Heart venueId={A} testID="venue-heart" />);
  await settle();
  api.on('POST', '/favourites', () => {
    server.push(A);
    return Reply.delayed(50, Reply.ok({ ok: true }));
  });
  await fireEvent.press(screen.getByTestId('venue-heart'));
  await fireEvent.press(screen.getByTestId('venue-heart'));
  await act(async () => new Promise<void>((resolve) => setTimeout(resolve, 80)));
  await settle();
  expect(api.sentAll('/favourites', 'POST')).toHaveLength(1);
  expect(screen.getByTestId('venue-heart')).toHaveTextContent('saved');
});
