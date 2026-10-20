/**
 * The venue page on screen (iOS VenueDetailView): the hero, the meta row,
 * the content states and their floating bars, hours, "Getting there" with
 * Directions, the inline reviews, share, the heart, and the load-failed and
 * "Heads up" states, in English and Icelandic.
 */
import { act, configure, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import { api, Reply } from '@test/server';
import { Linking, ScrollView, Share } from 'react-native';

import { stubApiClientPerTest } from '../../../api/testing';
import { dismissAllDialogs } from '../../../components/ui';
import { restoreTestFontScale, setTestFontScale } from '../../../hooks/testing';
import { setCurrentLanguage, translate } from '../../../i18n';
import { resetVenuesStore } from '../../../stores/venuesStore';
import VenueDetailScreen from '../VenueDetailScreen';
import { CLASSES, previewJson, REVIEW_A, REVIEW_B, REVIEW_C, reviewsJson, VENUE_ID, VENUE_SLUG, venueJson } from './fixtures';

// The icons' font loader needs expo-asset, which Jest only finds under expo.
jest.mock('expo-asset', () => jest.requireActual('expo/node_modules/expo-asset'), { virtual: true });

// The shared favourites store is VENUE-2's: the page only reads one heart and toggles it.
const mockToggle = jest.fn(async () => undefined);
const mockFavourite = { isFavourite: false };
jest.mock('../../favourites', () => ({
  useFavourite: () => ({ isFavourite: mockFavourite.isFavourite, loading: false, toggle: mockToggle }),
}));

stubApiClientPerTest();

// The whole page renders in every test. On a busy machine (many suites in
// parallel) one render can outlast RNTL's 1 s wait and Jest's 5 s test limit,
// which failed these tests with nothing wrong in the page. Slack for both, for
// this file only; a real failure still fails, just later.
configure({ asyncUtilTimeout: 10_000 });
jest.setTimeout(60_000);

const en =(key: string, params?: Record<string, string | number>) => translate(key, 'en', params);
const is = (key: string, params?: Record<string, string | number>) => translate(key, 'is', params);

type Listener = () => void;

function fakeNavigation() {
  const listeners = new Map<string, Listener[]>();
  let focused = true;
  return {
    navigate: jest.fn(),
    goBack: jest.fn(),
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

/** Another screen (or tab) comes in front of the page, then the member comes back. */
async function leaveAndReturn() {
  await act(async () => navigation.emit('blur'));
  await act(async () => navigation.emit('focus'));
}

let navigation: ReturnType<typeof fakeNavigation>;

function serve({
  venue = {},
  classes = CLASSES as readonly object[],
  reviews = [REVIEW_A, REVIEW_B, REVIEW_C] as object[],
}: { venue?: Record<string, unknown>; classes?: readonly object[]; reviews?: object[] } = {}) {
  api.on('GET', '/venues/by-slug/:slug', Reply.ok(venueJson(venue)));
  api.on('GET', '/check-ins/walk-in/preview', Reply.ok(previewJson(classes as never)));
  api.on('GET', `/venues/${VENUE_ID}/reviews`, Reply.ok(reviewsJson(reviews)));
}

async function renderPage(params: object = { slug: VENUE_SLUG }) {
  await render(
    <VenueDetailScreen
      navigation={navigation as never}
      route={{ key: 'VenueDetail-1', name: 'VenueDetail', params } as never}
    />,
  );
  await waitFor(() => expect(screen.queryByTestId('venue.loading')).toBeNull());
}

let openURL: jest.SpyInstance;
let share: jest.SpyInstance;

beforeEach(() => {
  setTestFontScale(1);
  navigation = fakeNavigation();
  mockFavourite.isFavourite = false;
  resetVenuesStore();
  openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
  share = jest.spyOn(Share, 'share').mockResolvedValue({ action: Share.sharedAction });
});

afterEach(async () => {
  restoreTestFontScale();
  openURL.mockRestore();
  share.mockRestore();
  await act(async () => dismissAllDialogs());
});

describe('a gym with walk-ins and classes, in the plan', () => {
  it('draws the hero, the meta row, the walk-in card, the classes, hours, Getting there and the newest reviews', async () => {
    serve();
    await renderPage();

    expect(screen.getByRole('header', { name: 'Hress Reykjavík' })).toBeOnTheScreen();
    expect(screen.getByTestId('venue.kicker')).toHaveTextContent('IN YOUR PLAN');
    expect(screen.getByText('4.6')).toBeOnTheScreen();
    expect(screen.getByText('· 12 reviews')).toBeOnTheScreen();
    expect(screen.getByText(/A friendly gym with an open floor/)).toBeOnTheScreen();
    expect(screen.getByText('sauna')).toBeOnTheScreen();

    expect(screen.getByText(en('venue.walkin_heading'))).toBeOnTheScreen();
    expect(screen.getByTestId('venue.walkin.price')).toHaveTextContent('Included in your plan');
    expect(screen.getByText('2 CLASSES AVAILABLE')).toBeOnTheScreen();
    expect(screen.getByText('Hot Yoga')).toBeOnTheScreen();
    expect(screen.getByText(en('venue.view_schedule'))).toBeOnTheScreen();
    expect(screen.getByText(en('venue.choose_time'))).toBeOnTheScreen();

    expect(screen.getByTestId('venue.hours.monday')).toHaveTextContent('06:00 – 22:00');
    expect(screen.getByTestId('venue.hours.sunday')).toHaveTextContent('Closed');
    expect(screen.getByText('Laugavegur 77, 101 Reykjavík')).toBeOnTheScreen();
    expect(screen.getByText('+354 555 1234')).toBeOnTheScreen();
    expect(screen.getAllByRole('button', { name: en('venue.directions') })).toHaveLength(2);

    // The two newest of three, and "See all".
    expect(screen.getByTestId(`venue.review.${REVIEW_A.id}`)).toBeOnTheScreen();
    expect(screen.getByTestId(`venue.review.${REVIEW_B.id}`)).toBeOnTheScreen();
    expect(screen.queryByTestId(`venue.review.${REVIEW_C.id}`)).toBeNull();
    expect(screen.getByText('2 October 2026')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: en('common.see_all') })).toBeOnTheScreen();

    // The split bar (2.5.4).
    expect(screen.getByRole('button', { name: en('venue.book_a_class') })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: `${en('venue.scan_short')}, Included` })).toBeOnTheScreen();
  });

  it('"Scan QR" pushes the scanner with the way back to this venue', async () => {
    serve();
    await renderPage();
    await fireEvent.press(screen.getByTestId('venue.bar.scan'));
    expect(navigation.navigate).toHaveBeenCalledWith('ScanPushed', { fromVenueSlug: VENUE_SLUG });
  });

  it('a class row opens the booking flow for that class', async () => {
    serve();
    await renderPage();
    await fireEvent.press(screen.getByTestId(`venue.activity.${CLASSES[1]!.id}`));
    expect(navigation.navigate).toHaveBeenCalledWith('BookingFlow', {
      venueId: VENUE_ID,
      activity: { id: CLASSES[1]!.id, name: 'Spinning', provider: 'noona' },
    });
  });

  it('"Book a class" scrolls the list a tenth of the way down the screen', async () => {
    serve();
    await renderPage();
    const scrollTo = ScrollView.prototype.scrollTo as jest.Mock;
    scrollTo.mockClear();
    await fireEvent(screen.getByTestId('venue.scroll'), 'layout', { nativeEvent: { layout: { y: 0, height: 800 } } });
    await fireEvent(screen.getByTestId('venue.offers').parent!, 'layout', { nativeEvent: { layout: { y: 300 } } });
    await fireEvent(screen.getByTestId('venue.classes'), 'layout', { nativeEvent: { layout: { y: 250 } } });
    await fireEvent.press(screen.getByTestId('venue.bar.classes'));
    // Hero 420 + block 300 + list 250, less 10 % of 800.
    expect(scrollTo).toHaveBeenCalledWith({ y: 890, animated: true });

    // Large text grew the hero: the list moved down with it.
    await fireEvent(screen.getByTestId('venue.hero'), 'layout', { nativeEvent: { layout: { y: 0, height: 520 } } });
    await fireEvent.press(screen.getByTestId('venue.bar.classes'));
    expect(scrollTo).toHaveBeenLastCalledWith({ y: 990, animated: true });
  });

  it('the rating opens the reviews, and coming back reads only them again', async () => {
    serve();
    await renderPage();
    // Arriving is not a return: nothing is read twice.
    await act(async () => navigation.emit('focus'));
    expect(api.sentAll(`/venues/by-slug/${VENUE_SLUG}`)).toHaveLength(1);

    await fireEvent.press(screen.getByTestId('venue.meta.rating'));
    expect(navigation.navigate).toHaveBeenCalledWith('VenueReviews', { venueId: VENUE_ID, venueName: 'Hress Reykjavík' });

    const before = api.sentAll(`/venues/${VENUE_ID}/reviews`).length;
    api.on('GET', `/venues/${VENUE_ID}/reviews`, Reply.ok(reviewsJson([REVIEW_C])));
    await leaveAndReturn();
    await waitFor(() => expect(screen.getByTestId(`venue.review.${REVIEW_C.id}`)).toBeOnTheScreen());
    expect(api.sentAll(`/venues/${VENUE_ID}/reviews`)).toHaveLength(before + 1);
    expect(api.sentAll(`/venues/by-slug/${VENUE_SLUG}`)).toHaveLength(1);
  });

  it('coming back from a booking or the scanner reads the page again, keeping it on screen', async () => {
    serve({ venue: { inBundle: false, surchargePrice: 1990 }, classes: [] });
    await renderPage();
    expect(screen.getByTestId('venue.kicker')).toHaveTextContent('PREMIUM · FROM ISK 1,990');

    // The member bought a plan from a booking refusal: the venue is now in it.
    api.on('GET', '/venues/by-slug/:slug', Reply.delayed(50, Reply.ok(venueJson({ inBundle: true }))));
    await leaveAndReturn();
    // No spinner while it reads: the page stays where the member left it.
    expect(screen.queryByTestId('venue.loading')).toBeNull();
    expect(screen.getByRole('header', { name: 'Hress Reykjavík' })).toBeOnTheScreen();
    await waitFor(() => expect(screen.getByTestId('venue.kicker')).toHaveTextContent('IN YOUR PLAN'));
    expect(api.sentAll(`/venues/by-slug/${VENUE_SLUG}`)).toHaveLength(2);
  });

  it('back leaves the page', async () => {
    serve();
    await renderPage();
    await fireEvent.press(screen.getByRole('button', { name: en('common.back') }));
    expect(navigation.goBack).toHaveBeenCalled();
  });
});

describe('the other content states', () => {
  it('classes only: "Bookable", the first class, and Book', async () => {
    serve({ venue: { walkInsAllowed: false } });
    await renderPage();
    expect(screen.queryByText(en('venue.walkin_heading'))).toBeNull();
    const bar = screen.getByTestId('venue.bar.bookable');
    expect(within(bar).getByText('BOOKABLE')).toBeOnTheScreen();
    expect(within(bar).getByText('Hot Yoga')).toBeOnTheScreen();
    await fireEvent.press(within(bar).getByRole('button', { name: `${en('home.book')}, Hot Yoga` }));
    expect(navigation.navigate).toHaveBeenCalledWith('BookingFlow', {
      venueId: VENUE_ID,
      activity: { id: CLASSES[0]!.id, name: 'Hot Yoga', provider: 'abler' },
    });
  });

  it('a premium walk-in with no classes: the full-width Scan pill with its price, and the from-price kicker', async () => {
    serve({ venue: { inBundle: false, surchargePrice: 1990 }, classes: [] });
    await renderPage();
    expect(screen.getByTestId('venue.kicker')).toHaveTextContent('PREMIUM · FROM ISK 1,990');
    expect(screen.getByTestId('venue.walkin.price')).toHaveTextContent('from ISK 1,990');
    expect(screen.queryByTestId('venue.classes')).toBeNull();
    expect(screen.getByRole('button', { name: `${en('venue.scan_qr')}, from ISK 1,990` })).toBeOnTheScreen();
    expect(screen.queryByTestId('venue.bar.classes')).toBeNull();
  });

  it('a premium class shows its from-price and that the exact one comes at confirm', async () => {
    serve({ venue: { inBundle: false, surchargePrice: 1990, walkInsAllowed: false } });
    await renderPage();
    expect(screen.getAllByText('from ISK 1,990 · exact price at confirm')).toHaveLength(2);
  });

  it('coming soon: the card and no bar', async () => {
    serve({ venue: { awaitingConnection: true } });
    await renderPage();
    expect(screen.getByText(en('venue.coming_soon'))).toBeOnTheScreen();
    expect(screen.getByText(en('venue.coming_soon_body', { name: 'Hress Reykjavík' }))).toBeOnTheScreen();
    expect(screen.queryByTestId('venue.bar.scan')).toBeNull();
    expect(screen.queryByTestId('venue.bar.bookable')).toBeNull();
  });

  it('nothing to book: "Bookings not yet available" and Call the venue', async () => {
    serve({ venue: { walkInsAllowed: false }, classes: [] });
    await renderPage();
    expect(screen.getByText(en('venue.no_bookings'))).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('link', { name: en('venue.call_venue') }));
    expect(openURL).toHaveBeenCalledWith('tel:+3545551234');
    expect(screen.queryByTestId('venue.bar.scan')).toBeNull();
  });

  it('nothing to book and no phone: no Call', async () => {
    serve({ venue: { walkInsAllowed: false, phone: null }, classes: [] });
    await renderPage();
    expect(screen.getByText(en('venue.no_bookings'))).toBeOnTheScreen();
    expect(screen.queryByRole('link', { name: en('venue.call_venue') })).toBeNull();
  });

  it('a failed preview keeps the page: the walk-in card and the Scan-only bar, no classes', async () => {
    serve();
    api.on('GET', '/check-ins/walk-in/preview', Reply.problem(500, 'internal_error'));
    await renderPage();
    expect(screen.getByText(en('venue.walkin_heading'))).toBeOnTheScreen();
    expect(screen.queryByTestId('venue.classes')).toBeNull();
    expect(screen.getByTestId('venue.bar.scan')).toBeOnTheScreen();
    expect(screen.queryByTestId('venue.heads_up')).toBeNull();
  });
});

describe('directions', () => {
  it('opens "Get directions": Google Maps by coordinates, another app, or Cancel', async () => {
    serve();
    await renderPage();
    await fireEvent.press(screen.getAllByRole('button', { name: en('venue.directions') })[0]!);
    expect(screen.getByRole('button', { name: en('venue.maps_google') })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Open in another app' })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: en('common.cancel') })).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: en('venue.maps_google') }));
    await waitFor(() =>
      expect(openURL).toHaveBeenCalledWith(
        'https://www.google.com/maps/dir/?api=1&destination=64.1436,-21.9187&travelmode=driving',
      ),
    );
  });

  it('"Getting there" has the same button', async () => {
    serve();
    await renderPage();
    const block = screen.getByTestId('venue.getting_there');
    await fireEvent.press(within(block).getByRole('button', { name: en('venue.directions') }));
    await fireEvent.press(screen.getByRole('button', { name: 'Open in another app' }));
    await waitFor(() => expect(openURL).toHaveBeenCalledWith('geo:64.1436,-21.9187?q=64.1436,-21.9187(Hress%20Reykjav%C3%ADk)'));
  });

  it('no address and no position: no Directions anywhere, and no "Getting there" without a phone', async () => {
    serve({ venue: { address: null, coordinates: null, phone: null } });
    await renderPage();
    expect(screen.queryByRole('button', { name: en('venue.directions') })).toBeNull();
    expect(screen.queryByTestId('venue.getting_there')).toBeNull();
  });
});

describe('hours, description and reviews', () => {
  it('no opening hours: no hours block', async () => {
    serve({ venue: { openingHours: null } });
    await renderPage();
    expect(screen.queryByTestId('venue.hours')).toBeNull();
  });

  it('in Icelandic: the Icelandic description, the days and the kicker', async () => {
    setCurrentLanguage('is');
    serve();
    await renderPage();
    expect(screen.getByText(/Vinaleg líkamsræktarstöð/)).toBeOnTheScreen();
    expect(screen.getByText(is('venue.day.monday'))).toBeOnTheScreen();
    expect(screen.getByTestId('venue.kicker')).toHaveTextContent('Í ÁSKRIFTINNI ÞINNI');
    expect(screen.getByTestId('venue.walkin.price')).toHaveTextContent(is('venue.included_in_plan'));
    expect(screen.getByRole('button', { name: `${is('venue.scan_short')}, ${is('venue.price.included')}` })).toBeOnTheScreen();
  });

  it('in Icelandic with no Icelandic description: the English one', async () => {
    setCurrentLanguage('is');
    serve({ venue: { descriptionIs: null } });
    await renderPage();
    expect(screen.getByText(/A friendly gym with an open floor/)).toBeOnTheScreen();
  });

  it('no reviews: "Be the first to review" and "Write one", both opening the reviews', async () => {
    serve({ venue: { averageRating: null, totalReviews: 0 }, reviews: [] });
    await renderPage();
    expect(screen.getByText(en('venue.no_reviews'))).toBeOnTheScreen();
    expect(screen.getByText(en('venue.review_empty').toUpperCase())).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: en('venue.be_first') }));
    await fireEvent.press(screen.getByRole('button', { name: en('venue.write_one') }));
    expect(navigation.navigate).toHaveBeenCalledTimes(2);
    expect(navigation.navigate).toHaveBeenLastCalledWith('VenueReviews', { venueId: VENUE_ID, venueName: 'Hress Reykjavík' });
  });
});

describe('share and the heart', () => {
  it('shares the web page by slug, with the venue as the subject', async () => {
    serve();
    await renderPage();
    await fireEvent.press(screen.getByRole('button', { name: 'Share' }));
    expect(share).toHaveBeenCalledWith(
      {
        message: 'Check out Hress Reykjavík on LifePass https://www.lifepass.is/venues/hress-reykjavik',
        title: 'Hress Reykjavík',
      },
      { dialogTitle: 'Hress Reykjavík' },
    );
  });

  it('the heart shows the saved state and toggles it', async () => {
    mockFavourite.isFavourite = true;
    serve();
    await renderPage();
    const heart = screen.getByRole('togglebutton', { name: 'Save to favourites' });
    expect(heart.props.accessibilityState).toEqual({ checked: true });
    await fireEvent.press(heart);
    expect(mockToggle).toHaveBeenCalledTimes(1);
  });
});

describe('failures', () => {
  it('a venue that does not load: the reason and Try again, which loads it', async () => {
    api.on('GET', '/venues/by-slug/:slug', Reply.raw(502, '<html>Bad gateway</html>'));
    await renderPage();
    expect(screen.getByTestId('venue.load_failed')).toBeOnTheScreen();
    expect(screen.getByText(en('error.unexpected_status', { code: 502 }))).toBeOnTheScreen();
    serve();
    await fireEvent.press(screen.getByRole('button', { name: en('venue.try_again') }));
    await waitFor(() => expect(screen.getByRole('header', { name: 'Hress Reykjavík' })).toBeOnTheScreen());
  });

  it('reviews that fail after the venue loaded: the "Heads up" alert over the page', async () => {
    serve();
    api.on('GET', `/venues/${VENUE_ID}/reviews`, Reply.raw(502, '<html>Bad gateway</html>'));
    await renderPage();
    expect(screen.getByRole('header', { name: 'Hress Reykjavík' })).toBeOnTheScreen();
    expect(screen.getByRole('header', { name: en('common.heads_up') })).toBeOnTheScreen();
    expect(screen.getByText(en('error.unexpected_status', { code: 502 }))).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: en('common.ok') }));
    expect(screen.queryByRole('header', { name: en('common.heads_up') })).toBeNull();
    expect(screen.getByRole('header', { name: 'Hress Reykjavík' })).toBeOnTheScreen();
  });

  it('the "Heads up" alert waits until the page is in front again', async () => {
    serve();
    api.on('GET', `/venues/${VENUE_ID}/reviews`, Reply.delayed(50, Reply.raw(502, '<html>Bad gateway</html>')));
    await render(
      <VenueDetailScreen
        navigation={navigation as never}
        route={{ key: 'VenueDetail-1', name: 'VenueDetail', params: { slug: VENUE_SLUG } } as never}
      />,
    );
    // The member switched tab while the page was loading.
    await act(async () => navigation.emit('blur'));
    await waitFor(() => expect(screen.getByRole('header', { name: 'Hress Reykjavík' })).toBeOnTheScreen());
    expect(screen.queryByRole('header', { name: en('common.heads_up') })).toBeNull();

    // Back on the page, it reads again; the reviews still fail, and now it says so.
    await act(async () => navigation.emit('focus'));
    await waitFor(() => expect(screen.getByRole('header', { name: en('common.heads_up') })).toBeOnTheScreen());
  });

  it("a first-build caller's id still opens the page", async () => {
    api.on('GET', '/venues', Reply.ok({ data: [venueJson()], pagination: { nextCursor: null, hasMore: false, limit: 100 } }));
    serve();
    await renderPage({ venueId: VENUE_ID });
    expect(screen.getByRole('header', { name: 'Hress Reykjavík' })).toBeOnTheScreen();
  });
});
