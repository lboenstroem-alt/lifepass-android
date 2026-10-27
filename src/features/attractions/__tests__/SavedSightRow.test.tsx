/**
 * A saved place's row on Favourites' "Hikes & sights" (API 0.45.0): the
 * sights' picture rules (a plate shown whole and never credited, a photo
 * only with its author and licence printed in full, else the ring), the
 * server's kind and region words, a walk's figures as the card writes them,
 * the row opening the place, and the remove button named for the place.
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { setCurrentLanguage, translate } from '../../../i18n';
import type { FavouriteAttraction } from '../../favourites';
import SavedSightRow, { savedSightFacts, savedSightKindRegion, savedSightPicture } from '../SavedSightRow';

jest.mock('expo-asset', () => jest.requireActual('expo/node_modules/expo-asset'), { virtual: true });

function place(overrides: Partial<FavouriteAttraction> = {}): FavouriteAttraction {
  return {
    id: 'fav-1',
    attractionId: '33333333-3333-4333-8333-333333333333',
    slug: 'skogafoss',
    name: 'Skógafoss',
    localName: 'Skógafoss',
    kind: 'waterfall',
    kindLabel: 'Waterfall',
    region: 'south',
    regionLabel: 'South Iceland',
    lengthM: null,
    durationMinutes: null,
    difficulty: null,
    difficultyLabel: null,
    outAndBack: false,
    imageUrl: 'https://upload.example/skogafoss-640.jpg',
    imageAlt: 'Skógafoss',
    imageIsMapPlate: false,
    imageCredit: 'Jane Doe',
    imageLicense: 'CC BY-SA 4.0',
    createdAt: new Date('2026-10-27T12:00:00Z'),
    ...overrides,
  };
}

const en = (key: string, params?: Readonly<Record<string, string | number>>) => translate(key, 'en', params);

beforeEach(() => setCurrentLanguage('en'));

describe('the picture', () => {
  it('a photo shows only with its author and its licence', () => {
    expect(savedSightPicture(place())).toEqual({
      kind: 'photo',
      uri: 'https://upload.example/skogafoss-640.jpg',
      credit: 'Jane Doe',
      license: 'CC BY-SA 4.0',
    });
    expect(savedSightPicture(place({ imageLicense: null }))).toEqual({ kind: 'ring' });
    expect(savedSightPicture(place({ imageCredit: null }))).toEqual({ kind: 'ring' });
  });

  it('the plate is a map: shown, never as a photo, whatever credit rides with it', () => {
    const plate = savedSightPicture(
      place({ imageIsMapPlate: true, imageCredit: 'Jane Doe', imageLicense: 'CC BY-SA 4.0', imageUrl: '/api/v1/attractions/plate/skogafoss' }),
    );
    // A path is resolved against the API's own host.
    expect(plate).toEqual({ kind: 'plate', uri: expect.stringMatching(/^https:\/\/[^/]+\/api\/v1\/attractions\/plate\/skogafoss$/) });
  });

  it('no picture at all is the ring', () => {
    expect(savedSightPicture(place({ imageUrl: null }))).toEqual({ kind: 'ring' });
  });
});

describe('the words', () => {
  it('"Waterfall · South Iceland", the server’s own words, either alone when the other is missing', () => {
    expect(savedSightKindRegion(place())).toBe('Waterfall · South Iceland');
    expect(savedSightKindRegion(place({ regionLabel: null }))).toBe('Waterfall');
    expect(savedSightKindRegion(place({ kindLabel: null, regionLabel: null }))).toBeNull();
  });

  it('a walk’s figures as the sight card writes them, one way and there and back', () => {
    expect(savedSightFacts(place({ kind: 'hike', lengthM: 7100, durationMinutes: 180, outAndBack: true }), en)).toBe(
      '7.1 km one way · 3 h there and back',
    );
    expect(savedSightFacts(place({ lengthM: 850, durationMinutes: null }), en)).toBe('850 m');
    expect(savedSightFacts(place(), en)).toBeNull();
  });
});

describe('on screen', () => {
  it('a photo prints its credit in full, and TalkBack reads the row with it', async () => {
    await render(<SavedSightRow place={place({ lengthM: 7100, durationMinutes: 180, outAndBack: true })} onOpen={jest.fn()} onRemove={jest.fn()} />);
    const credit = screen.getByTestId('saved.sight.skogafoss.credit');
    expect(credit).toHaveTextContent('Photo: Jane Doe · CC BY-SA 4.0', { exact: true });
    expect(credit.props.numberOfLines).toBeUndefined();
    expect(screen.getByTestId('saved.sight.skogafoss.photo', { includeHiddenElements: true })).toBeOnTheScreen();
    expect(screen.getByTestId('saved.sight.skogafoss.open').props.accessibilityLabel).toBe(
      'Skógafoss, Waterfall · South Iceland, 7.1 km one way · 3 h there and back, Photo: Jane Doe · CC BY-SA 4.0',
    );
  });

  it('a plate is shown whole and never credited', async () => {
    await render(
      <SavedSightRow
        place={place({ imageIsMapPlate: true, imageCredit: null, imageLicense: null, imageUrl: 'https://www.lifepass.is/api/v1/attractions/plate/skogafoss' })}
        onOpen={jest.fn()}
        onRemove={jest.fn()}
      />,
    );
    expect(screen.getByTestId('saved.sight.skogafoss.plate', { includeHiddenElements: true })).toBeOnTheScreen();
    expect(screen.queryByTestId('saved.sight.skogafoss.credit')).toBeNull();
    expect(screen.queryByText(/Photo/)).toBeNull();
  });

  it('a photo without its licence is the ring, with no credit', async () => {
    await render(<SavedSightRow place={place({ imageLicense: null, kind: 'hike' })} onOpen={jest.fn()} onRemove={jest.fn()} />);
    expect(screen.getByTestId('saved.sight.skogafoss.ring', { includeHiddenElements: true })).toBeOnTheScreen();
    expect(screen.queryByTestId('saved.sight.skogafoss.credit')).toBeNull();
  });

  it('a photo that will not load becomes the ring and drops its credit', async () => {
    await render(<SavedSightRow place={place()} onOpen={jest.fn()} onRemove={jest.fn()} />);
    jest.useFakeTimers();
    try {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        await fireEvent(screen.getByTestId('saved.sight.skogafoss.photo.image', { includeHiddenElements: true }), 'error', {
          nativeEvent: { error: 'HTTP 404' },
        });
        await act(async () => {
          jest.advanceTimersByTime(2_000);
        });
      }
    } finally {
      jest.useRealTimers();
    }
    await waitFor(() => expect(screen.queryByTestId('saved.sight.skogafoss.credit')).toBeNull());
    expect(screen.getByTestId('saved.sight.skogafoss.ring', { includeHiddenElements: true })).toBeOnTheScreen();
  });

  it('the row opens the place; the remove button is named for it, in both languages', async () => {
    const onOpen = jest.fn();
    const onRemove = jest.fn();
    await render(<SavedSightRow place={place()} onOpen={onOpen} onRemove={onRemove} />);
    await fireEvent.press(screen.getByTestId('saved.sight.skogafoss.open'));
    expect(onOpen).toHaveBeenCalledTimes(1);
    const remove = screen.getByTestId('saved.sight.skogafoss.remove');
    expect(remove.props.accessibilityLabel).toBe('Remove Skógafoss from favourites');
    await fireEvent.press(remove);
    expect(onRemove).toHaveBeenCalledTimes(1);
    await act(async () => setCurrentLanguage('is'));
    expect(screen.getByTestId('saved.sight.skogafoss.remove').props.accessibilityLabel).toBe('Fjarlægja úr uppáhalds: Skógafoss');
  });
});
