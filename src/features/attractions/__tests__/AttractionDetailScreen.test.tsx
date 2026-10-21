/**
 * A sight's card on screen (iOS AttractionDetailView and AttractionDetailSheet):
 * the hero and credit, the badge, the travel line for every way a place is
 * reached, the facts, the route, the walk links, getting there with the
 * bathing box and Directions, the soak with its money copy, nearby sights,
 * the sources, the failed state, Done and the pushes, in English and
 * Icelandic.
 */
import { act, configure, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import { api, Reply } from '@test/server';
import { Linking } from 'react-native';

import { stubApiClientPerTest } from '../../../api/testing';
import { dismissAllDialogs } from '../../../components/ui';
import { setCurrentLanguage, translate } from '../../../i18n';
import AttractionDetailScreen, { pushedFromSight, sightRunLength } from '../AttractionDetailScreen';
import { detailJson } from './fixtures';

// The icons' font loader needs expo-asset, which Jest only finds under expo.
jest.mock('expo-asset', () => jest.requireActual('expo/node_modules/expo-asset'), { virtual: true });

stubApiClientPerTest();

configure({ asyncUtilTimeout: 10_000 });
jest.setTimeout(60_000);

const en = (key: string, params?: Record<string, string | number>) => translate(key, 'en', params);
const is = (key: string, params?: Record<string, string | number>) => translate(key, 'is', params);

type Listener = () => void;
type Route = { key: string; name: string };

function fakeNavigation(routes: Route[] = [{ key: 'HomeMain-1', name: 'HomeMain' }, { key: 'AttractionDetail-1', name: 'AttractionDetail' }]) {
  const listeners = new Map<string, Listener[]>();
  let focused = true;
  const parent = { canGoBack: jest.fn(() => true), goBack: jest.fn() };
  return {
    navigate: jest.fn(),
    push: jest.fn(),
    pop: jest.fn(),
    goBack: jest.fn(),
    getParent: jest.fn(() => parent),
    parent,
    getState: jest.fn(() => ({ routes })),
    isFocused: jest.fn(() => focused),
    addListener: jest.fn((event: string, listener: Listener) => {
      listeners.set(event, [...(listeners.get(event) ?? []), listener]);
      return () => listeners.set(event, (listeners.get(event) ?? []).filter((l) => l !== listener));
    }),
    emit(event: 'focus' | 'blur') {
      focused = event === 'focus';
      for (const listener of listeners.get(event) ?? []) listener();
    },
  };
}

let navigation: ReturnType<typeof fakeNavigation>;
let openURL: jest.SpyInstance;

function serve(overrides: Record<string, unknown> = {}) {
  api.on('GET', '/attractions/by-slug/:slug', (request) =>
    Reply.ok(detailJson({ slug: request.params.slug, ...overrides })),
  );
}

async function renderCard({ slug = 'seljalandsfoss', key = 'AttractionDetail-1' } = {}) {
  await render(
    <AttractionDetailScreen
      navigation={navigation as never}
      route={{ key, name: 'AttractionDetail', params: { slug } } as never}
    />,
  );
  await waitFor(() => expect(screen.queryByTestId('attraction.loading')).toBeNull());
}

beforeEach(() => {
  setCurrentLanguage('en');
  navigation = fakeNavigation();
  openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
});

afterEach(async () => {
  openURL.mockRestore();
  await act(async () => {
    setCurrentLanguage('en');
    dismissAllDialogs();
  });
});

describe('a top-pick waterfall reached by road', () => {
  it('draws the card top to bottom in the iOS order', async () => {
    serve();
    await renderCard();

    expect(api.sent('/attractions/by-slug/seljalandsfoss').query).toEqual({ locale: 'en' });
    expect(screen.getByRole('image', { name: 'Seljalandsfoss, Iceland' })).toBeOnTheScreen();
    expect(screen.getByTestId('attraction.credit')).toHaveTextContent('Photo: Zoran · CC BY-SA 3.0');
    expect(screen.getByTestId('attraction.top_pick')).toHaveTextContent('TOP PICK');
    expect(screen.getByTestId('attraction.kicker')).toHaveTextContent('WATERFALL · SOUTH ICELAND');
    expect(screen.getByRole('header', { name: 'Seljalandsfoss' })).toBeOnTheScreen();
    expect(screen.queryByTestId('attraction.local_name')).toBeNull();
    expect(screen.getByTestId('attraction.travel.drive')).toHaveTextContent('1 h 58 min drive from Reykjavík · 128 km');
    expect(screen.queryByTestId('attraction.travel.nearest_road')).toBeNull();
    expect(screen.getByText('A waterfall you can walk behind.')).toBeOnTheScreen();

    const facts = within(screen.getByTestId('attraction.facts'));
    expect(facts.getByText('HEIGHT')).toBeOnTheScreen();
    expect(facts.getByText('65 m')).toBeOnTheScreen();
    expect(facts.getByText('NEAREST TOWN')).toBeOnTheScreen();
    expect(facts.getByText('Hvolsvöllur')).toBeOnTheScreen();
    expect(facts.queryByText('DISTANCE')).toBeNull();

    expect(screen.queryByTestId('attraction.route')).toBeNull();
    expect(screen.queryByTestId('attraction.walk_destination')).toBeNull();
    expect(screen.queryByTestId('attraction.related_trails')).toBeNull();

    expect(screen.getByTestId('attraction.access_rule')).toHaveTextContent(/Driving off-road is illegal/);
    expect(screen.getByRole('button', { name: 'Directions' })).toBeOnTheScreen();

    const soak = within(screen.getByTestId('attraction.soak'));
    expect(soak.getByText('AFTER THIS')).toBeOnTheScreen();
    expect(soak.getByText('Soak here afterwards')).toBeOnTheScreen();
    expect(soak.getByText('ON THE WAY BACK')).toBeOnTheScreen();
    expect(screen.getByTestId('attraction.pairing.laugaskard.price')).toHaveTextContent('Included on any LifePass');
    expect(screen.getByTestId('attraction.pairing.sky-lagoon.price')).toHaveTextContent('ISK 10,100 per visit with LifePass');
    expect(soak.getByText('50 min drive')).toBeOnTheScreen();

    const nearby = within(screen.getByTestId('attraction.nearby'));
    expect(nearby.getByText('Distances in a straight line, not by road.')).toBeOnTheScreen();
    expect(nearby.getByText('Gljufrafoss')).toBeOnTheScreen();
    expect(screen.getByTestId('attraction.nearby.gljufrabui.credit')).toHaveTextContent('Photo: Pjt56 · CC BY-SA 4.0');
    expect(screen.getByTestId('attraction.nearby.gljufrabui.distance')).toHaveTextContent('656 m');
    // A credit without its licence: the ring, and no credit line.
    expect(screen.getByTestId('attraction.nearby.drifandi.ring', { includeHiddenElements: true })).toBeOnTheScreen();
    expect(screen.queryByTestId('attraction.nearby.drifandi.credit')).toBeNull();
    expect(screen.getByTestId('attraction.nearby.drifandi.distance')).toHaveTextContent('1.6 km');

    const sources = within(screen.getByTestId('attraction.sources'));
    expect(sources.getByText('SOURCES')).toBeOnTheScreen();
    expect(sources.getByText('Place data © OpenStreetMap contributors, ODbL 1.0.')).toBeOnTheScreen();
    expect(sources.getByRole('link', { name: 'Wikimedia Commons (CC BY-SA 3.0)' })).toBeOnTheScreen();
    // An http source link is not a button.
    expect(sources.queryByText(/OpenStreetMap \(ODbL\)/)).toBeNull();
  });

  it('opens the licence and the sources over https', async () => {
    serve();
    await renderCard();
    await fireEvent.press(screen.getByRole('link', { name: 'Photo: Zoran · CC BY-SA 3.0' }));
    expect(openURL).toHaveBeenCalledWith('https://creativecommons.org/licenses/by-sa/3.0');
    await fireEvent.press(screen.getByRole('link', { name: 'Wikimedia Commons (CC BY-SA 3.0)' }));
    expect(openURL).toHaveBeenCalledWith('https://commons.wikimedia.org/wiki/File:Seljalandsfoss.jpg');
  });

  it('pushes a soak venue and a nearby sight on the same stack', async () => {
    serve();
    await renderCard();
    await fireEvent.press(screen.getByTestId('attraction.pairing.sky-lagoon'));
    expect(navigation.push).toHaveBeenCalledWith('VenueDetail', { slug: 'sky-lagoon' });
    await fireEvent.press(screen.getByTestId('attraction.nearby.gljufrabui'));
    expect(navigation.push).toHaveBeenCalledWith('AttractionDetail', { slug: 'gljufrabui' });
  });
});

describe('in Icelandic', () => {
  it('asks in Icelandic and words the card in Icelandic', async () => {
    setCurrentLanguage('is');
    serve({ name: 'Seljalandsfoss', localName: 'Seljalandsfoss', kindLabel: 'Foss', regionLabel: 'Suðurland' });
    await renderCard();
    expect(api.sent('/attractions/by-slug/seljalandsfoss').query).toEqual({ locale: 'is' });
    expect(screen.getByRole('image', { name: 'Seljalandsfoss, Ísland' })).toBeOnTheScreen();
    expect(screen.getByTestId('attraction.credit')).toHaveTextContent('Mynd: Zoran · CC BY-SA 3.0');
    expect(screen.getByTestId('attraction.top_pick')).toHaveTextContent('HÁPUNKTUR');
    expect(screen.getByTestId('attraction.kicker')).toHaveTextContent('FOSS · SUÐURLAND');
    expect(screen.getByTestId('attraction.travel.drive')).toHaveTextContent('1 klst 58 mín akstur frá Reykjavík · 128 km');
    expect(screen.getByText(is('attraction.soak_title'))).toBeOnTheScreen();
    expect(screen.getByTestId('attraction.pairing.laugaskard.price')).toHaveTextContent('Innifalið í öllum LifePass');
    expect(screen.getByTestId('attraction.pairing.sky-lagoon.price')).toHaveTextContent('ISK 10,100 á heimsókn með LifePass');
    expect(screen.getByText('Gljúfrabúi')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: is('attraction.directions') })).toBeOnTheScreen();
  });

  it('shows the Icelandic name under a localised one', async () => {
    serve({ name: 'Thingvellir', localName: 'Þingvellir' });
    await renderCard();
    expect(screen.getByTestId('attraction.local_name')).toHaveTextContent('Þingvellir');
  });
});

describe('how a place is reached', () => {
  it('says Ferry from Landeyjahöfn, never the drive, and keeps the Heimaey soak', async () => {
    serve({ roadAccess: 'ferry', ferryPort: 'Landeyjahöfn', ferryOnly: true });
    await renderCard();
    expect(screen.getByTestId('attraction.travel.access')).toHaveTextContent('Ferry from Landeyjahöfn');
    expect(screen.queryByTestId('attraction.travel.drive')).toBeNull();
    expect(screen.getByTestId('attraction.soak')).toBeOnTheScreen();
  });

  it('says Reached by ferry for another port, and lists no soak', async () => {
    serve({ roadAccess: 'ferry', ferryPort: null });
    await renderCard();
    expect(screen.getByTestId('attraction.travel.access')).toHaveTextContent('Reached by ferry');
    expect(screen.queryByTestId('attraction.soak')).toBeNull();
  });

  it('says offshore and lists no soak', async () => {
    serve({ roadAccess: 'offshore' });
    await renderCard();
    expect(screen.getByTestId('attraction.travel.access')).toHaveTextContent('Offshore. No road or ferry goes there.');
    expect(screen.queryByTestId('attraction.travel.drive')).toBeNull();
    expect(screen.queryByTestId('attraction.soak')).toBeNull();
  });

  it('says nothing for a value this build does not know, and lists no soak', async () => {
    serve({ roadAccess: 'hovercraft' });
    await renderCard();
    expect(screen.queryByTestId('attraction.travel.access')).toBeNull();
    expect(screen.queryByTestId('attraction.travel.drive')).toBeNull();
    expect(screen.queryByTestId('attraction.soak')).toBeNull();
  });

  it('notes the nearest road past a kilometre, with a decimal comma in Icelandic', async () => {
    serve({ nearestRoadM: 1000 });
    await renderCard();
    expect(screen.queryByTestId('attraction.travel.nearest_road')).toBeNull();

    await act(async () => setCurrentLanguage('is'));
    serve({ nearestRoadM: 2440, driveFromReykjavik: null });
    await renderCard({ slug: 'glymur' });
    expect(screen.getByTestId('attraction.travel.nearest_road')).toHaveTextContent('Næsti vegur er í um 2,4 km fjarlægð.');
    expect(screen.queryByTestId('attraction.travel.drive')).toBeNull();
  });
});

describe('getting there', () => {
  it('shows an unverified bathing verdict as a warning, the 4x4 sentence and the parking fee', async () => {
    serve({
      bathing: { level: 'unverified', text: 'We have not checked whether bathing is safe here.' },
      requiresFourWheelDrive: true,
      parkingFeeIsk: 10100,
      accessNotes: 'Park at the lot.',
      seasonalAccess: 'Closed in winter.',
    });
    await renderCard();
    expect(screen.getByTestId('attraction.bathing.warning')).toHaveTextContent('We have not checked whether bathing is safe here.');
    expect(screen.getByTestId('attraction.four_wheel_drive')).toHaveTextContent('A 4x4 is needed to reach this one.');
    expect(screen.getByTestId('attraction.parking_fee')).toHaveTextContent('Parking fee: ISK 10,100');
    expect(screen.getByText('Park at the lot.')).toBeOnTheScreen();
    expect(screen.getByText('Closed in winter.')).toBeOnTheScreen();
  });

  it('shows a safe verdict plainly, and no fee of zero', async () => {
    serve({ bathing: { level: 'safe', text: 'Bathing is allowed.' }, parkingFeeIsk: 0 });
    await renderCard();
    expect(screen.getByTestId('attraction.bathing')).toHaveTextContent('Bathing is allowed.');
    expect(screen.queryByTestId('attraction.bathing.warning')).toBeNull();
    expect(screen.queryByTestId('attraction.parking_fee')).toBeNull();
  });

  it('offers Google Maps and another app, and falls back to Google when no app takes the pin', async () => {
    serve();
    await renderCard();
    await fireEvent.press(screen.getByRole('button', { name: 'Directions' }));
    await fireEvent.press(await screen.findByTestId('attraction.directions.google'));
    await waitFor(() =>
      expect(openURL).toHaveBeenCalledWith('https://www.google.com/maps/dir/?api=1&destination=63.615452,-19.988276'),
    );

    openURL.mockClear();
    openURL.mockImplementation(async (url: string) => {
      if (url.startsWith('geo:')) throw new Error('no handler');
      return true;
    });
    await fireEvent.press(screen.getByRole('button', { name: 'Directions' }));
    expect(await screen.findByText(en('attraction.android.maps_other'))).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('attraction.directions.other'));
    await waitFor(() => expect(openURL).toHaveBeenCalledTimes(2));
    expect(openURL.mock.calls[0][0]).toBe('geo:63.615452,-19.988276?q=63.615452,-19.988276(Seljalandsfoss)');
    expect(openURL.mock.calls[1][0]).toContain('https://www.google.com/maps/dir/');
  });
});

describe('pictures', () => {
  it('shows a plate whole and credits it as a map, a non-https licence as plain text', async () => {
    serve({
      images: [
        {
          src: '/api/v1/attractions/plate/seljalandsfoss',
          altEn: 'Map of Iceland',
          credit: 'LifePass',
          license: 'CC BY 4.0',
          licenseUrl: 'http://creativecommons.org/licenses/by/4.0',
          isMapPlate: true,
        },
      ],
    });
    await renderCard();
    expect(screen.getByTestId('attraction.hero.plate')).toBeOnTheScreen();
    expect(screen.getByTestId('attraction.credit')).toHaveTextContent('Map: LifePass · CC BY 4.0');
    expect(screen.queryByRole('link', { name: 'Map: LifePass · CC BY 4.0' })).toBeNull();
  });

  it('shows a still map of the spot when there is no picture at all', async () => {
    serve({ images: [] });
    await renderCard();
    expect(screen.getByTestId('attraction.hero.map', { includeHiddenElements: true })).toBeOnTheScreen();
    expect(screen.queryByTestId('attraction.credit')).toBeNull();
  });

  it('swaps a nearby photo that will not load for the ring, and drops its credit', async () => {
    serve();
    await renderCard();
    jest.useFakeTimers();
    try {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        await fireEvent(screen.getByTestId('attraction.nearby.gljufrabui.photo.image', { includeHiddenElements: true }), 'error', {
          nativeEvent: { error: 'HTTP 404' },
        });
        await act(async () => {
          jest.advanceTimersByTime(2_000);
        });
      }
    } finally {
      jest.useRealTimers();
    }
    await waitFor(() => expect(screen.queryByTestId('attraction.nearby.gljufrabui.credit')).toBeNull());
    expect(screen.getByTestId('attraction.nearby.gljufrabui.ring', { includeHiddenElements: true })).toBeOnTheScreen();
  });
});

describe('walks', () => {
  it('draws the route of a hike with its credit', async () => {
    serve({
      kind: 'hike',
      routeGeojson: { type: 'LineString', coordinates: [[-21.1, 64.1], [-21.0, 64.2]] },
      lengthM: 7100,
      durationMinutes: 180,
      outAndBack: true,
    });
    await renderCard();
    expect(screen.getByTestId('attraction.route.map', { includeHiddenElements: true })).toBeOnTheScreen();
    expect(screen.getByText('Route: © OpenStreetMap contributors, ODbL')).toBeOnTheScreen();
    const facts = within(screen.getByTestId('attraction.facts'));
    expect(facts.getByText('7.1 km one way')).toBeOnTheScreen();
    expect(facts.getByText('3 h there and back')).toBeOnTheScreen();
  });

  it('links a walk to its sight, and a sight to the walks that lead to it', async () => {
    serve({
      forAttraction: { slug: 'glymur', name: 'Glymur' },
      relatedTrails: [{ slug: 'glymur-trail', name: 'Glymsleið', nameEn: 'Glymur trail', lengthM: 7100, durationMinutes: 180, outAndBack: true }],
    });
    await renderCard();
    expect(within(screen.getByTestId('attraction.walk_destination')).getByText('Where the walk leads')).toBeOnTheScreen();
    const related = within(screen.getByTestId('attraction.related_trails'));
    expect(related.getByText('Walks that lead here')).toBeOnTheScreen();
    expect(related.getByText('Glymur trail')).toBeOnTheScreen();
    expect(related.getByText('7.1 km one way · 3 h there and back')).toBeOnTheScreen();

    await fireEvent.press(screen.getByTestId('attraction.trail.glymur'));
    expect(navigation.push).toHaveBeenCalledWith('AttractionDetail', { slug: 'glymur' });
    await fireEvent.press(screen.getByTestId('attraction.trail.glymur-trail'));
    expect(navigation.push).toHaveBeenCalledWith('AttractionDetail', { slug: 'glymur-trail' });
  });
});

describe('loading and failing', () => {
  it('says why it failed and tries again', async () => {
    api.on(
      'GET',
      '/attractions/by-slug/:slug',
      Reply.problem(503, 'attractions-unavailable', {}, { 'retry-after': '30' }),
    );
    await renderCard();
    expect(screen.getByTestId('attraction.failed')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeOnTheScreen();

    serve();
    await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByTestId('attraction.content')).toBeOnTheScreen();
  });

  it('reads the card again quietly on return, keeping it when that fails', async () => {
    serve();
    await renderCard();
    expect(api.sentAll('/attractions/by-slug/seljalandsfoss')).toHaveLength(1);

    api.on('GET', '/attractions/by-slug/:slug', Reply.problem(503, 'attractions-unavailable'));
    await act(async () => navigation.emit('blur'));
    await act(async () => navigation.emit('focus'));
    await waitFor(() => expect(api.sentAll('/attractions/by-slug/seljalandsfoss')).toHaveLength(2));
    expect(screen.getByTestId('attraction.content')).toBeOnTheScreen();
    expect(screen.queryByTestId('attraction.failed')).toBeNull();
  });
});

describe('Done and back', () => {
  it('finds the run of sight cards', () => {
    const routes = [
      { key: 'h', name: 'HomeMain' },
      { key: 'v', name: 'VenueDetail' },
      { key: 'a', name: 'AttractionDetail' },
      { key: 'b', name: 'AttractionDetail' },
      { key: 'c', name: 'AttractionDetail' },
    ];
    expect(sightRunLength(routes, 4)).toBe(3);
    expect(sightRunLength(routes, 2)).toBe(1);
    expect(pushedFromSight(routes, 2)).toBe(false);
    expect(pushedFromSight(routes, 3)).toBe(true);
  });

  it('closes the first card with Done, which shows alone', async () => {
    serve();
    await renderCard();
    expect(screen.queryByTestId('attraction.back')).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: 'Done' }));
    expect(navigation.pop).toHaveBeenCalledWith(1);
  });

  it('closes every card back to the opener from a pushed card, which also steps back', async () => {
    navigation = fakeNavigation([
      { key: 'ExploreMain-1', name: 'ExploreMain' },
      { key: 'AttractionDetail-1', name: 'AttractionDetail' },
      { key: 'AttractionDetail-2', name: 'AttractionDetail' },
    ]);
    serve();
    await renderCard({ slug: 'gljufrabui', key: 'AttractionDetail-2' });
    await fireEvent.press(screen.getByRole('button', { name: 'Back' }));
    expect(navigation.goBack).toHaveBeenCalledTimes(1);
    await fireEvent.press(screen.getByRole('button', { name: 'Done' }));
    expect(navigation.pop).toHaveBeenCalledWith(2);
  });

  it('closes the shared sheet when the run starts at its bottom', async () => {
    navigation = fakeNavigation([{ key: 'AttractionDetail-1', name: 'AttractionDetail' }]);
    serve();
    await renderCard();
    await fireEvent.press(screen.getByRole('button', { name: 'Done' }));
    expect(navigation.parent.goBack).toHaveBeenCalled();
    expect(navigation.pop).not.toHaveBeenCalled();
  });
});
