/**
 * Home's Outside card (iOS HomeOutsideCard with HomeView's loading and pick
 * rules): hidden without top picks, the heading and distances only with a
 * granted fix around Iceland, the ODbL credit, a failed refresh that keeps
 * the card, the language re-read, the return re-read, and the taps.
 */
import { NavigationContext } from '@react-navigation/native';
import { act, configure, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import { api, Reply } from '@test/server';
import type { ReactElement } from 'react';

import { stubApiClientPerTest } from '../../../api/testing';
import { setCurrentLanguage } from '../../../i18n';
import { locationStore } from '../../../stores/locationStore';
import HomeOutsideCard from '../HomeOutsideCard';
import { attractionMarkersStore, loadAttractionMarkers, resetAttractionMarkers } from '../markersStore';
import { AKUREYRI, LONDON, markerJson, REYKJAVIK } from './fixtures';

jest.mock('expo-asset', () => jest.requireActual('expo/node_modules/expo-asset'), { virtual: true });

stubApiClientPerTest({ token: null });

configure({ asyncUtilTimeout: 10_000 });
jest.setTimeout(60_000);

const FEED = [
  markerJson('seljalandsfoss', { name: 'Seljalandsfoss', region: 'south', rankScore: 94, coordinates: { latitude: 63.6155, longitude: -19.9883 } }),
  markerJson('skogafoss', { name: 'Skógafoss', region: 'south', rankScore: 93, coordinates: { latitude: 63.5321, longitude: -19.5114 } }),
  markerJson('godafoss', { name: 'Goðafoss', region: 'north', rankScore: 90, coordinates: { latitude: 65.6828, longitude: -17.5502 } }),
  markerJson('glymur', { name: 'Glymur', kind: 'hike', region: 'west', rankScore: 80, coordinates: { latitude: 64.3913, longitude: -21.2513 } }),
  markerJson('gljufrabui', { name: 'Gljúfrabúi', nameEn: 'Gljufrafoss', region: 'south', tier: 'notable', rankScore: 99 }),
  markerJson('tjornin', { name: 'Tjörnin', region: 'capital', tier: 'standard' }),
];

function serveFeed(feed: object[] = FEED) {
  api.on('GET', '/attractions', (request) =>
    Reply.ok({ attractions: feed, locale: request.query.locale, attribution: 'ODbL' }),
  );
}

const onOpenSight = jest.fn();
const onSeeAllOnMap = jest.fn();

async function renderCard(wrap: (card: ReactElement) => ReactElement = (card) => card) {
  await render(wrap(<HomeOutsideCard onOpenSight={onOpenSight} onSeeAllOnMap={onSeeAllOnMap} />));
}

function grantFix(position: { latitude: number; longitude: number } | null, permission: 'granted' | 'denied' = 'granted') {
  locationStore.setState({
    permission,
    permissionKnown: true,
    currentLocation: position ? { ...position, accuracy: 20, timestamp: Date.now() } : null,
  });
}

const sentFeeds = () => api.sentAll('/attractions');

beforeEach(() => {
  setCurrentLanguage('en');
  resetAttractionMarkers();
  grantFix(null, 'denied');
});

afterEach(async () => {
  await act(async () => {
    setCurrentLanguage('en');
    locationStore.setState({ permission: 'undetermined', permissionKnown: false, currentLocation: null });
  });
});

describe('the picks', () => {
  it('without a fix: top picks only, one region at a time, around Iceland, no distances', async () => {
    serveFeed();
    await renderCard();
    expect(await screen.findByTestId('home.outside')).toBeOnTheScreen();
    expect(api.sent('/attractions').query).toEqual({ locale: 'en' });

    expect(screen.getByText('OUTSIDE')).toBeOnTheScreen();
    expect(screen.getByRole('header', { name: 'Top picks around Iceland' })).toBeOnTheScreen();
    const rows = screen.getAllByTestId(/^home\.outside\.pick\./).map((row) => row.props.testID);
    // South's best, then north's, then west's, before south's second.
    expect(rows).toEqual([
      'home.outside.pick.seljalandsfoss',
      'home.outside.pick.godafoss',
      'home.outside.pick.glymur',
      'home.outside.pick.skogafoss',
    ]);
    const first = within(screen.getByTestId('home.outside.pick.seljalandsfoss'));
    expect(first.getByText('Seljalandsfoss')).toBeOnTheScreen();
    expect(first.getByText('Waterfall · South Iceland')).toBeOnTheScreen();
    expect(within(screen.getByTestId('home.outside.pick.glymur')).getByText('Hike · West Iceland')).toBeOnTheScreen();
    expect(screen.queryByTestId(/^home\.outside\.distance\./)).toBeNull();
    expect(screen.queryByTestId('home.outside.straight_line')).toBeNull();
    expect(screen.getByTestId('home.outside.credit')).toHaveTextContent('Place data © OpenStreetMap contributors, ODbL');
    expect(screen.getByRole('button', { name: 'See all on the map' })).toBeOnTheScreen();
  });

  it('with a granted fix in Iceland: near you, nearest first, straight-line distances with a point', async () => {
    grantFix(REYKJAVIK);
    serveFeed();
    await renderCard();
    expect(await screen.findByRole('header', { name: 'Top picks near you' })).toBeOnTheScreen();
    const rows = screen.getAllByTestId(/^home\.outside\.pick\./).map((row) => row.props.testID);
    expect(rows[0]).toBe('home.outside.pick.glymur');
    expect(screen.getByTestId('home.outside.distance.glymur')).toHaveTextContent(/^\d+ km$/);
    expect(screen.getByTestId('home.outside.distance.seljalandsfoss')).toHaveTextContent(/^\d+ km$/);
    expect(screen.getByTestId('home.outside.straight_line')).toHaveTextContent('Distances in a straight line, not by road.');

    // Close by: metres, then tenths of a kilometre, with a point in Icelandic too.
    await act(async () => {
      setCurrentLanguage('is');
      grantFix({ latitude: 63.6175, longitude: -19.9883 });
    });
    expect(await screen.findByTestId('home.outside.distance.seljalandsfoss')).toHaveTextContent('222 m');
    await act(async () => grantFix({ latitude: 63.6155, longitude: -20.07 }));
    expect(screen.getByTestId('home.outside.distance.seljalandsfoss')).toHaveTextContent('4.0 km');
  });

  it('a fix from Akureyri puts the north first', async () => {
    grantFix(AKUREYRI);
    serveFeed();
    await renderCard();
    await screen.findByTestId('home.outside');
    expect(screen.getAllByTestId(/^home\.outside\.pick\./)[0].props.testID).toBe('home.outside.pick.godafoss');
  });

  it('a fix from London is not "near you": the country-wide picks', async () => {
    grantFix(LONDON);
    serveFeed();
    await renderCard();
    expect(await screen.findByRole('header', { name: 'Top picks around Iceland' })).toBeOnTheScreen();
    expect(screen.queryByTestId(/^home\.outside\.distance\./)).toBeNull();
  });

  it('a fix kept from before permission was taken away is not an origin', async () => {
    grantFix(REYKJAVIK, 'denied');
    serveFeed();
    await renderCard();
    expect(await screen.findByRole('header', { name: 'Top picks around Iceland' })).toBeOnTheScreen();
  });

  it('is hidden when the feed has no top picks (an older server)', async () => {
    serveFeed(FEED.map((marker) => ({ ...marker, tier: undefined })));
    await renderCard();
    await waitFor(() => expect(sentFeeds()).toHaveLength(1));
    await act(async () => undefined);
    expect(screen.queryByTestId('home.outside')).toBeNull();
  });

  it('is hidden while nothing has loaded, and when the first read fails', async () => {
    api.on('GET', '/attractions', Reply.problem(503, 'attractions-unavailable', {}, { 'retry-after': '30' }));
    await renderCard();
    await waitFor(() => expect(sentFeeds()).toHaveLength(1));
    await act(async () => undefined);
    expect(screen.queryByTestId('home.outside')).toBeNull();
  });
});

describe('reading again', () => {
  it('a failed refresh keeps the picks on screen', async () => {
    serveFeed();
    await renderCard();
    await screen.findByTestId('home.outside');

    api.on('GET', '/attractions', Reply.problem(503, 'attractions-unavailable'));
    const result = await loadAttractionMarkers('en');
    expect(result.ok).toBe(false);
    expect(screen.getByTestId('home.outside.pick.seljalandsfoss')).toBeOnTheScreen();
  });

  it('re-reads in the new language when the language changes', async () => {
    serveFeed();
    await renderCard();
    await screen.findByTestId('home.outside');
    await act(async () => setCurrentLanguage('is'));
    await waitFor(() => expect(sentFeeds()).toHaveLength(2));
    expect(sentFeeds()[1].query).toEqual({ locale: 'is' });
    expect(await screen.findByRole('header', { name: 'Hápunktar um allt land' })).toBeOnTheScreen();
    expect(screen.getByText('ÚTI')).toBeOnTheScreen();
    expect(within(screen.getByTestId('home.outside.pick.godafoss')).getByText('Foss · Norðurland')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Sjá allt á kortinu' })).toBeOnTheScreen();
  });

  it('re-reads whenever Home comes back to the front, never on the first arrival', async () => {
    const listeners = new Map<string, () => void>();
    const navigation = {
      isFocused: () => true,
      addListener: (event: string, listener: () => void) => {
        listeners.set(event, listener);
        return () => listeners.delete(event);
      },
    };
    serveFeed();
    await renderCard((card) => <NavigationContext.Provider value={navigation as never}>{card}</NavigationContext.Provider>);
    await screen.findByTestId('home.outside');
    expect(sentFeeds()).toHaveLength(1);
    await act(async () => listeners.get('focus')?.());
    expect(sentFeeds()).toHaveLength(1);
    await act(async () => {
      listeners.get('blur')?.();
      listeners.get('focus')?.();
    });
    await waitFor(() => expect(sentFeeds()).toHaveLength(2));
  });
});

describe('the shared feed', () => {
  it('two readers at once make one request', async () => {
    serveFeed();
    const [a, b] = await Promise.all([loadAttractionMarkers('en'), loadAttractionMarkers('en')]);
    expect(a.ok && b.ok).toBe(true);
    expect(sentFeeds()).toHaveLength(1);
  });

  it('only the latest language lands', async () => {
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    api.on('GET', '/attractions', async (request) => {
      if (request.query.locale === 'en') await held;
      return Reply.ok({ attractions: [markerJson(`from-${request.query.locale}`)], attribution: 'ODbL' });
    });
    const english = loadAttractionMarkers('en');
    await loadAttractionMarkers('is');
    release();
    await english;
    expect(attractionMarkersStore.getState().locale).toBe('is');
    expect(attractionMarkersStore.getState().page?.attractions[0].slug).toBe('from-is');
  });
});

describe('taps', () => {
  it('opens a sight and the map', async () => {
    serveFeed();
    await renderCard();
    await screen.findByTestId('home.outside');
    await fireEvent.press(screen.getByTestId('home.outside.pick.godafoss'));
    expect(onOpenSight).toHaveBeenCalledWith('godafoss');
    await fireEvent.press(screen.getByRole('button', { name: 'See all on the map' }));
    expect(onSeeAllOnMap).toHaveBeenCalledTimes(1);
  });

  it('names each row to TalkBack with its kind, region and distance', async () => {
    grantFix(REYKJAVIK);
    serveFeed();
    await renderCard();
    await screen.findByTestId('home.outside');
    const label = screen.getByTestId('home.outside.pick.glymur').props.accessibilityLabel as string;
    expect(label).toMatch(/^Glymur, Hike · West Iceland, \d+ km$/);
  });
});
