/**
 * A place's heart on screen (API 0.45.0), over the app's one favourites store
 * and the stub server: drawn from the saved set read once with
 * `include=attractions` in the app's language, flipped at once by a press,
 * flipped back with the contract's words when the server refuses, and named
 * for TalkBack by the place, a name that never changes with the state.
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { View } from 'react-native';
import { api, Reply } from '@test/server';

import { stubApiClientPerTest } from '../../../api/testing';
import { DialogHost, dismissAllDialogs } from '../../../components/ui/Dialog';
import { setCurrentLanguage } from '../../../i18n';
import { favouritesStore } from '../../favourites';
import SightHeart from '../SightHeart';

jest.mock('expo-asset', () => jest.requireActual('expo/node_modules/expo-asset'), { virtual: true });

stubApiClientPerTest();

const place = (slug: string, name: string) => ({
  id: `fav-${slug}`,
  attractionId: '33333333-3333-4333-8333-333333333333',
  slug,
  name,
  localName: name,
  kind: 'waterfall',
  kindLabel: 'Waterfall',
  region: 'south',
  regionLabel: 'South Iceland',
  lengthM: null,
  durationMinutes: null,
  difficulty: null,
  difficultyLabel: null,
  outAndBack: false,
  imageUrl: 'https://www.lifepass.is/api/v1/attractions/plate/skogafoss',
  imageAlt: name,
  imageIsMapPlate: true,
  imageCredit: null,
  imageLicense: null,
  createdAt: '2026-10-27T12:00:00.000Z',
});

/** The server's saved places, which the writes change as the real API does. */
let saved: string[] = [];

function serve({ refuseSave = false } = {}) {
  api.on('GET', '/favourites', () =>
    Reply.ok({ venues: [], activities: [], attractions: saved.map((slug) => place(slug, slug === 'skogafoss' ? 'Skógafoss' : slug)) }),
  );
  api.on('POST', '/favourites', (request) => {
    if (refuseSave) return Reply.problem(404, 'favourite_target_not_found');
    saved = [(request.body as { attractionSlug: string }).attractionSlug, ...saved];
    return Reply.ok({ ok: true });
  });
  api.on('DELETE', '/favourites', (request) => {
    saved = saved.filter((slug) => slug !== request.query.attractionSlug);
    return Reply.ok({ ok: true });
  });
}

async function renderHeart(name = 'Skógafoss') {
  await render(
    <View>
      <SightHeart slug="skogafoss" name={name} testID="heart" />
      <DialogHost />
    </View>,
  );
  await act(async () => new Promise<void>((resolve) => setImmediate(resolve)));
}

beforeEach(() => {
  setCurrentLanguage('en');
  saved = [];
  favouritesStore.getState().reset();
});

afterEach(async () => {
  await act(async () => dismissAllDialogs());
  favouritesStore.getState().reset();
});

it('reads the saved set once, in the app language, and draws an unsaved place outlined', async () => {
  serve();
  await renderHeart();
  const heart = screen.getByTestId('heart');
  expect(heart.props.accessibilityRole).toBe('togglebutton');
  expect(heart.props.accessibilityLabel).toBe('Save Skógafoss to favourites');
  expect(heart.props.accessibilityState).toMatchObject({ checked: false });
  expect(screen.getByTestId('heart.outline')).toBeOnTheScreen();
  const reads = api.sentAll('/favourites', 'GET');
  expect(reads).toHaveLength(1);
  expect(reads[0]!.query).toEqual({ include: 'attractions', locale: 'en' });
});

it('a saved place is filled, and the name it is said by does not change', async () => {
  saved = ['skogafoss'];
  serve();
  await renderHeart();
  const heart = screen.getByTestId('heart');
  expect(heart.props.accessibilityState).toMatchObject({ checked: true });
  expect(heart.props.accessibilityLabel).toBe('Save Skógafoss to favourites');
  expect(screen.getByTestId('heart.filled')).toBeOnTheScreen();
});

it('a press saves the place at once, by its slug, and a second press removes it', async () => {
  serve();
  await renderHeart();
  await fireEvent.press(screen.getByTestId('heart'));
  expect(screen.getByTestId('heart').props.accessibilityState).toMatchObject({ checked: true });
  await waitFor(() => expect(api.sentAll('/favourites', 'POST')).toHaveLength(1));
  expect(api.sent('/favourites', 'POST').body).toEqual({ attractionSlug: 'skogafoss' });
  await waitFor(() => expect(favouritesStore.getState().isAttractionToggling('skogafoss')).toBe(false));
  await fireEvent.press(screen.getByTestId('heart'));
  expect(screen.getByTestId('heart').props.accessibilityState).toMatchObject({ checked: false });
  await waitFor(() => expect(api.sentAll('/favourites', 'DELETE')).toHaveLength(1));
  expect(api.sent('/favourites', 'DELETE').query).toEqual({ attractionSlug: 'skogafoss' });
});

it('a refused save puts the heart back and says so', async () => {
  serve({ refuseSave: true });
  await renderHeart();
  await fireEvent.press(screen.getByTestId('heart'));
  expect(await screen.findByText('Could not save favourite. Please try again.')).toBeOnTheScreen();
  expect(screen.getByTestId('heart').props.accessibilityState).toMatchObject({ checked: false });
});

it('in Icelandic the name stands after the words, never declined', async () => {
  setCurrentLanguage('is');
  serve();
  await renderHeart('Skógafoss');
  expect(screen.getByTestId('heart').props.accessibilityLabel).toBe('Vista í uppáhalds: Skógafoss');
  expect(api.sent('/favourites', 'GET').query).toEqual({ include: 'attractions', locale: 'is' });
});
