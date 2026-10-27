/**
 * Home's Outside card (iOS HomeOutsideCard with HomeView's loading and pick
 * rules): hidden without top picks, the heading and distances only with a
 * granted fix around Iceland, the ODbL credit, a failed refresh that keeps
 * the card, the language re-read, the re-read at every Home read (a focus, a
 * pull to refresh), and the taps.
 */
import { act, configure, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react-native';
import { api, Reply } from '@test/server';

import { stubApiClientPerTest } from '../../../api/testing';
import { setCurrentLanguage } from '../../../i18n';
import { locationStore } from '../../../stores/locationStore';
import HomeOutsideCard from '../HomeOutsideCard';
import { attractionMarkersStore, loadAttractionMarkers, resetAttractionMarkers, useAttractionMarkers } from '../markersStore';
import { AKUREYRI, LONDON, markerJson, REYKJAVIK } from './fixtures';

jest.mock('expo-asset', () => jest.requireActual('expo/node_modules/expo-asset'), { virtual: true });

// Home's reads (HOME-1's `useOnHomeRead`, published by ../../home): Home
// signals at each focus and each pull to refresh. Signalling is Home's alone
// and not exported, so the card's side is driven here, with the contract's
// rules: the latest callback runs once per read, never at mount by itself.
const mockHomeReaders = new Set<{ current: () => void }>();
jest.mock('../../home', () => {
  const { useEffect: mockUseEffect, useRef: mockUseRef } = jest.requireActual<typeof import('react')>('react');
  return {
    useOnHomeRead: (onRead: () => void) => {
      const latest = mockUseRef(onRead);
      latest.current = onRead;
      mockUseEffect(() => {
        mockHomeReaders.add(latest);
        return () => {
          mockHomeReaders.delete(latest);
        };
      }, [latest]);
    },
  };
});

/** Home reads again (a focus or a pull to refresh). */
async function homeReads() {
  await act(async () => {
    mockHomeReaders.forEach((reader) => reader.current());
  });
}

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

async function renderCard() {
  await render(<HomeOutsideCard onOpenSight={onOpenSight} onSeeAllOnMap={onSeeAllOnMap} />);
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

  it("Home's first focus joins the read the card started: one request", async () => {
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    api.on('GET', '/attractions', async (request) => {
      await held;
      return Reply.ok({ attractions: FEED, locale: request.query.locale, attribution: 'ODbL' });
    });
    await renderCard();
    await homeReads();
    release();
    await screen.findByTestId('home.outside');
    expect(sentFeeds()).toHaveLength(1);
  });

  it('re-reads at every Home read (each focus, each pull), and a failed pull keeps the picks', async () => {
    serveFeed();
    await renderCard();
    await screen.findByTestId('home.outside');
    expect(sentFeeds()).toHaveLength(1);

    // A pull brings the feed as it is now: Skógafoss has gone from it.
    serveFeed(FEED.filter((marker) => marker.slug !== 'skogafoss'));
    await homeReads();
    await waitFor(() => expect(screen.queryByTestId('home.outside.pick.skogafoss')).toBeNull());
    expect(sentFeeds()).toHaveLength(2);
    expect(sentFeeds()[1].query).toEqual({ locale: 'en' });

    api.on('GET', '/attractions', Reply.problem(503, 'attractions-unavailable'));
    await homeReads();
    await waitFor(() => expect(sentFeeds()).toHaveLength(3));
    // Wait the failed read out (joining it, or failing once more).
    await act(async () => {
      await loadAttractionMarkers('en');
    });
    expect(screen.getAllByTestId(/^home\.outside\.pick\./).map((row) => row.props.testID)).toEqual([
      'home.outside.pick.seljalandsfoss',
      'home.outside.pick.godafoss',
      'home.outside.pick.glymur',
    ]);
  });

  it('a pull after a failed first read brings the card in', async () => {
    api.on('GET', '/attractions', Reply.problem(503, 'attractions-unavailable', {}, { 'retry-after': '30' }));
    await renderCard();
    await waitFor(() => expect(sentFeeds()).toHaveLength(1));
    await act(async () => {
      await loadAttractionMarkers('en');
    });
    expect(screen.queryByTestId('home.outside')).toBeNull();

    serveFeed();
    await homeReads();
    expect(await screen.findByTestId('home.outside')).toBeOnTheScreen();
  });

  it('a Home read asks in the language of the moment', async () => {
    serveFeed();
    await renderCard();
    await screen.findByTestId('home.outside');
    await act(async () => setCurrentLanguage('is'));
    await waitFor(() => expect(attractionMarkersStore.getState().locale).toBe('is'));
    const before = sentFeeds().length;
    await homeReads();
    await waitFor(() => expect(sentFeeds()).toHaveLength(before + 1));
    expect(sentFeeds()[before].query).toEqual({ locale: 'is' });
  });
});

describe('the shared feed', () => {
  it('a read that brings back the same feed changes nothing for its readers', async () => {
    serveFeed();
    await loadAttractionMarkers('en');
    const { result } = await renderHook(() => useAttractionMarkers());
    const first = result.current;
    expect(first).toHaveLength(FEED.length);

    const again = await loadAttractionMarkers('en');
    expect(sentFeeds()).toHaveLength(2);
    expect(result.current).toBe(first);
    expect(again.ok && again.page.attractions).toBe(first);

    // One field moved: the new feed lands.
    serveFeed(FEED.map((marker, index) => (index === 0 ? { ...marker, rankScore: 10 } : marker)));
    await act(async () => {
      await loadAttractionMarkers('en');
    });
    expect(result.current).not.toBe(first);
    expect(result.current[0].rankScore).toBe(10);
  });

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

  it('each pick has its own heart beside the row (API 0.45.0), named for the place, not a part of the row', async () => {
    serveFeed();
    await renderCard();
    await screen.findByTestId('home.outside');
    const heart = screen.getByTestId('home.outside.heart.glymur');
    expect(heart.props.accessibilityRole).toBe('togglebutton');
    expect(heart.props.accessibilityLabel).toBe('Save Glymur to favourites');
    expect(within(screen.getByTestId('home.outside.pick.glymur')).queryByTestId('home.outside.heart.glymur')).toBeNull();
    expect(screen.getAllByTestId(/^home\.outside\.heart\.[a-z-]+$/)).toHaveLength(4);
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
