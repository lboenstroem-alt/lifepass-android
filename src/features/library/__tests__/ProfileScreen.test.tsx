/**
 * Profile (iOS LibraryView), rendered in a real stack against the stub
 * server: the member card, the raw booking statuses, the cancel with its
 * dialogs and refusals, the reload on every appearance and on a pull, and
 * the Saved half (find venues, open a venue, the suggestion heart, the
 * Android unsave heart).
 */
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react-native';
import { Linking } from 'react-native';

import { api, Reply, type StubRequest } from '@test/server';

import { stubApiClientPerTest } from '../../../api/testing';
import { setCurrentLanguage, t } from '../../../i18n';
import { useIntentStore } from '../../../stores/intentStore';
import { colors } from '../../../theme';
import { favouritesStore } from '../../favourites';
import { PENDING_AMBER } from '../bookings/BookingRows';

import {
  bookingJSON,
  bookingsPage,
  favouriteActivityJSON,
  favouriteAttractionJSON,
  favouriteJSON,
  LANES,
  profileJSON,
  signedInAs,
  subscriptionJSON,
  usageJSON,
  venueJSON,
} from './fixtures';
import { currentRoute, navigationRef, renderProfile, settle } from './harness';

// @expo/vector-icons loads its fonts through expo-asset, which npm nests under expo.
jest.mock('expo-asset', () => jest.requireActual('expo/node_modules/expo-asset'), { virtual: true });

stubApiClientPerTest();

const FUTURE = new Date(Date.now() + 3 * 86_400_000).toISOString();
const LATER = new Date(Date.now() + 5 * 86_400_000).toISOString();
const PAST = '2026-01-10T10:00:00.000Z';

const PENDING_ID = '00000000-0000-4000-8000-0000000000a1';
const CONFIRMED_ID = '00000000-0000-4000-8000-0000000000a2';
const CHECKED_IN_ID = '00000000-0000-4000-8000-0000000000a3';
const PAST_ID = '00000000-0000-4000-8000-0000000000b1';

const SAVED_A = 'aaaaaaaa-0000-4000-8000-000000000001';
const SAVED_B = 'aaaaaaaa-0000-4000-8000-000000000002';
const SUGGEST = ['bbbbbbbb-0000-4000-8000-000000000001', 'bbbbbbbb-0000-4000-8000-000000000002', 'bbbbbbbb-0000-4000-8000-000000000003', 'bbbbbbbb-0000-4000-8000-000000000004'];

/** Every host component name under `node` (a photo would be an image view). */
function hostTypes(node: unknown): string[] {
  const found: string[] = [];
  const walk = (current: unknown) => {
    if (typeof current !== 'object' || current === null) return;
    const { type, children } = current as { type?: unknown; children?: unknown[] };
    if (typeof type === 'string') found.push(type);
    for (const child of children ?? []) walk(child);
  };
  walk(node);
  return found;
}

const reads = (range: string): StubRequest[] =>
  api.requests.filter((r) => r.method === 'GET' && r.path === '/bookings' && r.query.range === range);
const cancels = (): StubRequest[] => api.requests.filter((r) => r.method === 'POST' && r.path.endsWith('/cancel'));

function answerBookings(upcoming: unknown[], past: unknown[] = []) {
  api.on('GET', '/bookings', (request) => Reply.ok(bookingsPage(request.query.range === 'upcoming' ? upcoming : past)));
}

function answerSaved(venues: unknown[] = [], activities: unknown[] = [], all: unknown[] = [], attractions: unknown[] = []) {
  api.on('GET', '/favourites', Reply.ok({ venues, activities, attractions }));
  api.on('GET', '/venues', Reply.ok({ data: all, pagination: { nextCursor: null, hasMore: false, limit: 100 } }));
}

beforeEach(() => {
  setCurrentLanguage('en');
  favouritesStore.getState().reset();
  useIntentStore.setState({ pendingTab: null });
  signedInAs(profileJSON({ usage: usageJSON(LANES) }), subscriptionJSON());
  answerBookings([]);
  answerSaved();
});

describe('the member card', () => {
  it('names the member and the plan, with this period caps; the badge opens Plans', async () => {
    await renderProfile();
    const card = screen.getByTestId('library.memberCard');
    expect(within(card).getByText('Anna Jónsdóttir')).toBeOnTheScreen();
    expect(within(card).getByText('anna@example.com')).toBeOnTheScreen();
    expect(screen.getByTestId('library.memberCard.caps')).toHaveTextContent('Gym 3/8 · Pool 2/4');
    await fireEvent.press(screen.getByRole('button', { name: 'PLUS' }));
    expect(currentRoute()).toBe('Plans');
  });

  it('with no plan and no tier: VIEW PLANS and no caps line', async () => {
    signedInAs(profileJSON(), null);
    await renderProfile();
    expect(screen.getByRole('button', { name: 'VIEW PLANS' })).toBeOnTheScreen();
    expect(screen.queryByTestId('library.memberCard.caps')).toBeNull();
  });

  it('the card itself is not a button; the gear opens Account and back leaves', async () => {
    await renderProfile();
    expect(screen.getByTestId('library.memberCard').props.accessibilityRole).toBeUndefined();
    await fireEvent.press(screen.getByRole('button', { name: 'Settings' }));
    expect(currentRoute()).toBe('Account');
    await act(async () => navigationRef.goBack());
    await settle();
    await fireEvent.press(screen.getByRole('button', { name: 'Back' }));
    expect(currentRoute()).toBe('Start');
    await settle();
  });

  it('speaks Icelandic for an Icelandic account', async () => {
    signedInAs(profileJSON({ locale: 'is', usage: usageJSON(LANES) }), subscriptionJSON());
    setCurrentLanguage('is');
    await renderProfile();
    expect(screen.getByText('SAFN')).toBeOnTheScreen();
    expect(screen.getByText('BÓKANIR OG VISTAÐ')).toBeOnTheScreen();
    expect(screen.getByTestId('library.memberCard.caps')).toHaveTextContent('Rækt 3/8 · Sund 2/4');
    expect(screen.getByText('Fram undan')).toBeOnTheScreen();
  });
});

describe('the bookings', () => {
  it('keeps the raw status: pending reads Pending in amber, checked in reads Checked in', async () => {
    answerBookings([
      bookingJSON(CONFIRMED_ID, LATER),
      bookingJSON(PENDING_ID, FUTURE, { status: 'pending' }),
      bookingJSON(CHECKED_IN_ID, FUTURE, { status: 'checked_in' }),
    ]);
    await renderProfile();
    const pending = screen.getByTestId(`library.booking.${PENDING_ID}.status`);
    expect(pending).toHaveTextContent('Pending');
    expect(pending).toHaveStyle({ color: PENDING_AMBER });
    expect(screen.getByTestId(`library.booking.${CHECKED_IN_ID}.status`)).toHaveTextContent('Checked in');
    expect(screen.getByTestId(`library.booking.${CHECKED_IN_ID}.status`)).toHaveStyle({ color: colors.aurora });
    expect(screen.getByTestId(`library.booking.${CONFIRMED_ID}.status`)).toHaveTextContent('Confirmed');
  });

  it('counts both halves in the tab and each half in its chip; the X only where it can still cancel', async () => {
    answerBookings(
      [bookingJSON(PENDING_ID, FUTURE, { status: 'pending' }), bookingJSON(CHECKED_IN_ID, FUTURE, { status: 'checked_in' })],
      [bookingJSON(PAST_ID, PAST, { status: 'completed' })],
    );
    await renderProfile();
    expect(screen.getByRole('tab', { name: 'Bookings, 3' })).toBeOnTheScreen();
    expect(screen.getByRole('tab', { name: 'Upcoming, 2' })).toBeOnTheScreen();
    expect(screen.getByRole('tab', { name: 'Past, 1' })).toBeOnTheScreen();
    expect(screen.getByTestId(`library.booking.${PENDING_ID}.cancel`)).toBeOnTheScreen();
    expect(screen.queryByTestId(`library.booking.${CHECKED_IN_ID}.cancel`)).toBeNull();
  });

  it('draws a calendar tile, never a photo, and names a booking with no class "Booking"', async () => {
    answerBookings([bookingJSON(CONFIRMED_ID, FUTURE, { externalTitle: null })]);
    await renderProfile();
    const card = screen.getByTestId(`library.booking.${CONFIRMED_ID}`);
    expect(within(card).getByText('Booking')).toBeOnTheScreen();
    expect(hostTypes(card)).toContain('Text');
    expect(hostTypes(card).some((type) => /image/i.test(type))).toBe(false);
  });

  it('says each half is empty in its own words', async () => {
    await renderProfile();
    expect(screen.getByText(t('library.empty_upcoming'))).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('library.segment.past'));
    expect(screen.getByText('Your past bookings will show up here.')).toBeOnTheScreen();
  });

  it('lists the past newest first, compact', async () => {
    const older = '00000000-0000-4000-8000-0000000000b2';
    answerBookings([], [bookingJSON(older, '2025-12-01T10:00:00.000Z'), bookingJSON(PAST_ID, PAST, { externalTitle: 'Spin' })]);
    await renderProfile();
    await fireEvent.press(screen.getByTestId('library.segment.past'));
    const ids = screen.getAllByTestId(/^library\.past\./).map((node) => node.props.testID);
    expect(ids).toEqual([`library.past.${PAST_ID}`, `library.past.${older}`]);
    expect(screen.getByText('Spin · 10 Jan 2026, 10:00')).toBeOnTheScreen();
  });

  it('"Book Now" leaves Profile first, then switches to Explore', async () => {
    await renderProfile();
    await fireEvent.press(screen.getByTestId('library.bookNow'));
    expect(currentRoute()).toBe('Start');
    expect(useIntentStore.getState().pendingTab).toBe('Explore');
  });

  it('reloads on every appearance', async () => {
    await renderProfile();
    expect(reads('upcoming')).toHaveLength(1);
    expect(reads('past')).toHaveLength(1);
    await fireEvent.press(screen.getByRole('button', { name: 'Settings' }));
    await act(async () => navigationRef.goBack());
    await settle();
    expect(reads('upcoming')).toHaveLength(2);
    expect(api.requests.filter((r) => r.path === '/favourites')).toHaveLength(2);
  });

  it('reloads on a pull, keeping the list on screen', async () => {
    answerBookings([bookingJSON(CONFIRMED_ID, FUTURE)]);
    await renderProfile();
    const scroll = screen.getByTestId('library.bookings.scroll');
    await act(async () => {
      scroll.props.refreshControl.props.onRefresh();
    });
    await settle();
    expect(reads('upcoming')).toHaveLength(2);
    expect(screen.getByTestId(`library.booking.${CONFIRMED_ID}`)).toBeOnTheScreen();
  });

  it('a failed load shows the Error alert with OK only', async () => {
    api.on('GET', '/bookings', Reply.raw(502, '<html>gateway</html>'));
    await renderProfile();
    expect(screen.getByText('Error')).toBeOnTheScreen();
    expect(screen.queryByTestId('library.error.cta')).toBeNull();
    await fireEvent.press(screen.getByTestId('library.error.ok'));
    await settle(2);
    expect(screen.queryByText('Error')).toBeNull();
  });
});

describe('the cancel', () => {
  beforeEach(() => answerBookings([bookingJSON(CONFIRMED_ID, FUTURE)]));

  it('asks first; Keep booking sends nothing', async () => {
    await renderProfile();
    await fireEvent.press(screen.getByRole('button', { name: 'Cancel booking' }));
    expect(screen.getByText('Are you sure you want to cancel this booking?')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('library.cancel.keep'));
    await settle(2);
    expect(cancels()).toHaveLength(0);
  });

  it('Cancel booking sends one cancel with a key, then reloads the list', async () => {
    let cancelledOnServer = false;
    api.on('POST', '/bookings/:id/cancel', () => {
      cancelledOnServer = true;
      return Reply.ok({ bookingId: CONFIRMED_ID, status: 'cancelled' });
    });
    api.on('GET', '/bookings', (request) =>
      Reply.ok(bookingsPage(request.query.range === 'upcoming' && !cancelledOnServer ? [bookingJSON(CONFIRMED_ID, FUTURE)] : [])),
    );
    await renderProfile();
    await fireEvent.press(screen.getByTestId(`library.booking.${CONFIRMED_ID}.cancel`));
    await fireEvent.press(screen.getByTestId('library.cancel.confirm'));
    await settle();
    expect(cancels()).toHaveLength(1);
    expect(cancels()[0].headers['idempotency-key']).toEqual(expect.any(String));
    expect(cancels()[0].path).toBe(`/bookings/${CONFIRMED_ID}/cancel`);
    expect(reads('upcoming')).toHaveLength(2);
    expect(screen.queryByTestId(`library.booking.${CONFIRMED_ID}`)).toBeNull();
    expect(screen.getByText(t('library.empty_upcoming'))).toBeOnTheScreen();
  });

  it('a booking that can no longer be cancelled reads so, and Refresh reloads', async () => {
    api.on('POST', '/bookings/:id/cancel', Reply.problem(409, 'booking_not_cancellable'));
    await renderProfile();
    await fireEvent.press(screen.getByTestId(`library.booking.${CONFIRMED_ID}.cancel`));
    await fireEvent.press(screen.getByTestId('library.cancel.confirm'));
    await settle();
    expect(screen.getByText("This booking can't be cancelled anymore.")).toBeOnTheScreen();
    const before = reads('upcoming').length;
    await fireEvent.press(screen.getByRole('button', { name: 'Refresh' }));
    await settle();
    expect(reads('upcoming').length).toBe(before + 1);
  });

  it('an uncertain cancel never offers My bookings (this is My bookings)', async () => {
    api.on('POST', '/bookings/:id/cancel', Reply.problem(502, 'cancel_provider_uncertain'));
    await renderProfile();
    await fireEvent.press(screen.getByTestId(`library.booking.${CONFIRMED_ID}.cancel`));
    await fireEvent.press(screen.getByTestId('library.cancel.confirm'));
    await settle();
    expect(screen.getByText(t('refusal.cancel_uncertain'))).toBeOnTheScreen();
    expect(screen.queryByTestId('library.error.cta')).toBeNull();
    expect(screen.getByTestId('library.error.ok')).toBeOnTheScreen();
  });

  it('a closed window offers Contact support, which writes to support', async () => {
    const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    try {
      api.on('POST', '/bookings/:id/cancel', Reply.problem(409, 'cancellation_window_closed'));
      await renderProfile();
      await fireEvent.press(screen.getByTestId(`library.booking.${CONFIRMED_ID}.cancel`));
      await fireEvent.press(screen.getByTestId('library.cancel.confirm'));
      await settle();
      expect(screen.getByText(t('refusal.cancel_window'))).toBeOnTheScreen();
      await fireEvent.press(screen.getByRole('button', { name: 'Contact support' }));
      await settle(2);
      expect(openURL).toHaveBeenCalledWith('mailto:support@lifepass.is');
    } finally {
      openURL.mockRestore();
    }
  });

  it('Try again is the same cancel, under the same key', async () => {
    let calls = 0;
    api.on('POST', '/bookings/:id/cancel', () => {
      calls += 1;
      return calls === 1 ? Reply.problem(500, 'booking_cancel_failed') : Reply.ok({ bookingId: CONFIRMED_ID, status: 'cancelled' });
    });
    await renderProfile();
    await fireEvent.press(screen.getByTestId(`library.booking.${CONFIRMED_ID}.cancel`));
    await fireEvent.press(screen.getByTestId('library.cancel.confirm'));
    await settle();
    await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    await settle();
    expect(cancels()).toHaveLength(2);
    expect(cancels()[1].headers['idempotency-key']).toBe(cancels()[0].headers['idempotency-key']);
  });
});

describe('the Saved half', () => {
  it('opens on Saved when asked (the Coach drawer)', async () => {
    await renderProfile('saved');
    expect(screen.getByText('Your spots')).toBeOnTheScreen();
    expect(screen.getByRole('tab', { name: 'Saved, 0', selected: true })).toBeOnTheScreen();
  });

  it('empty: "Find venues" leaves Profile, then switches to Explore', async () => {
    await renderProfile('saved');
    expect(screen.getByText('No saved venues yet.')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Find venues' }));
    expect(currentRoute()).toBe('Start');
    expect(useIntentStore.getState().pendingTab).toBe('Explore');
  });

  it('lists the saved venues with their count, and a row opens the venue by slug', async () => {
    answerSaved([favouriteJSON(SAVED_A), favouriteJSON(SAVED_B, { city: 'Akureyri' })]);
    await renderProfile('saved');
    expect(screen.getByTestId('library.saved.count')).toHaveTextContent('2 SAVED');
    expect(screen.getByRole('tab', { name: 'Saved, 2' })).toBeOnTheScreen();
    expect(screen.getByText('Akureyri')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId(`library.saved.${SAVED_B}`));
    expect(currentRoute()).toBe('VenueDetail');
    expect(screen.getByTestId('params.VenueDetail')).toHaveTextContent(JSON.stringify({ slug: 'slug-aaaa' }));
  });

  it('suggests the first three venues not saved; a suggestion opens its venue', async () => {
    answerSaved(
      [favouriteJSON(SUGGEST[0])],
      [],
      SUGGEST.map((id, i) => venueJSON(id, { name: `Pick ${i}`, categories: i === 2 ? [] : ['yoga'] })),
    );
    await renderProfile('saved');
    expect(screen.getByText('FOR YOU')).toBeOnTheScreen();
    expect(screen.getByText('Based on your saved spots')).toBeOnTheScreen();
    expect(screen.queryByText('Pick 0')).toBeNull();
    expect(screen.getByText('Pick 1')).toBeOnTheScreen();
    expect(screen.getByText('Pick 2')).toBeOnTheScreen();
    expect(screen.getByText('Pick 3')).toBeOnTheScreen();
    expect(screen.getByText('Wellness')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId(`library.suggestion.${SUGGEST[1]}`));
    expect(currentRoute()).toBe('VenueDetail');
  });

  it('the suggestion heart saves the venue, then the half reloads', async () => {
    answerSaved([], [], [venueJSON(SUGGEST[0], { name: 'Pick 0' })]);
    api.on('POST', '/favourites', Reply.ok({ ok: true }));
    await renderProfile('saved');
    const before = api.requests.filter((r) => r.method === 'GET' && r.path === '/favourites').length;
    answerSaved([favouriteJSON(SUGGEST[0], { name: 'Pick 0' })], [], [venueJSON(SUGGEST[0], { name: 'Pick 0' })]);
    api.on('POST', '/favourites', Reply.ok({ ok: true }));
    await fireEvent.press(screen.getByRole('button', { name: 'Save Pick 0' }));
    await settle();
    expect(api.sent('/favourites', 'POST').body).toEqual({ venueId: SUGGEST[0] });
    expect(api.requests.filter((r) => r.method === 'GET' && r.path === '/favourites').length).toBeGreaterThan(before);
    expect(screen.getByTestId('library.saved.count')).toHaveTextContent('1 SAVED');
    expect(screen.queryByTestId('library.suggestions')).toBeNull();
  });

  it('a suggestion heart the server refuses fails silently and stays a suggestion', async () => {
    answerSaved([], [], [venueJSON(SUGGEST[0], { name: 'Pick 0' })]);
    api.on('POST', '/favourites', Reply.problem(500, 'internal_error'));
    await renderProfile('saved');
    await fireEvent.press(screen.getByRole('button', { name: 'Save Pick 0' }));
    await settle();
    expect(screen.queryByText('Heads up')).toBeNull();
    expect(screen.getByText('Pick 0')).toBeOnTheScreen();
  });

  it('keeps the Android unsave heart (owner decision D4): the row goes at once', async () => {
    answerSaved([favouriteJSON(SAVED_A, { name: 'Laugar' })]);
    api.on('DELETE', '/favourites', Reply.ok({ ok: true }));
    await renderProfile('saved');
    await fireEvent.press(screen.getByRole('button', { name: 'Remove Laugar from saved' }));
    await waitFor(() => expect(screen.queryByText('Laugar')).toBeNull());
    expect(api.sent('/favourites', 'DELETE').query).toEqual({ venueId: SAVED_A });
  });

  it('Profile shows no saved classes (iOS shows them in the Coach Saved sheet)', async () => {
    answerSaved([favouriteJSON(SAVED_A)], [favouriteActivityJSON('cccccccc-0000-4000-8000-000000000001')]);
    await renderProfile('saved');
    expect(screen.queryByText('Hot Yoga')).toBeNull();
  });
});

describe('the Saved half: hikes and sights (API 0.45.0)', () => {
  it('asks for the places in the account language, and lists them under "Hikes & sights"', async () => {
    answerSaved([], [], [], [
      favouriteAttractionJSON('skogafoss', { name: 'Skógafoss' }),
      favouriteAttractionJSON('glymur', { name: 'Glymur', kind: 'hike', kindLabel: 'Hike', regionLabel: 'West Iceland', lengthM: 7100, durationMinutes: 180, outAndBack: true }),
    ]);
    await renderProfile('saved');
    expect(api.requests.find((r) => r.method === 'GET' && r.path === '/favourites')?.query).toEqual({ include: 'attractions', locale: 'en' });
    const section = within(screen.getByTestId('library.sights'));
    expect(section.getByText('HIKES & SIGHTS')).toBeOnTheScreen();
    expect(section.getByText('Skógafoss')).toBeOnTheScreen();
    expect(section.getByText('Hike · West Iceland')).toBeOnTheScreen();
    expect(section.getByText('7.1 km one way · 3 h there and back')).toBeOnTheScreen();
    // The tab counts everything on the half; "{count} saved" stays the venues.
    expect(screen.getByRole('tab', { name: 'Saved, 2' })).toBeOnTheScreen();
    expect(screen.getByTestId('library.saved.count')).toHaveTextContent('0 SAVED');
  });

  it('a row opens the place’s card by its slug', async () => {
    answerSaved([], [], [], [favouriteAttractionJSON('skogafoss', { name: 'Skógafoss' })]);
    await renderProfile('saved');
    await fireEvent.press(screen.getByTestId('library.sights.row.skogafoss.open'));
    expect(currentRoute()).toBe('AttractionDetail');
    expect(screen.getByTestId('params.AttractionDetail')).toHaveTextContent(JSON.stringify({ slug: 'skogafoss' }));
  });

  it('the remove button takes the place off at once, by its slug', async () => {
    answerSaved([], [], [], [favouriteAttractionJSON('skogafoss', { name: 'Skógafoss' }), favouriteAttractionJSON('glymur')]);
    api.on('DELETE', '/favourites', Reply.ok({ ok: true }));
    await renderProfile('saved');
    await fireEvent.press(screen.getByRole('button', { name: 'Remove Skógafoss from favourites' }));
    expect(screen.queryByTestId('library.sights.row.skogafoss')).toBeNull();
    expect(screen.getByTestId('library.sights.row.glymur')).toBeOnTheScreen();
    await waitFor(() => expect(api.sent('/favourites', 'DELETE').query).toEqual({ attractionSlug: 'skogafoss' }));
  });

  it('none saved: the empty state in its own words, in both languages', async () => {
    await renderProfile('saved');
    expect(within(screen.getByTestId('library.sights.empty')).getByText('No saved hikes or sights yet')).toBeOnTheScreen();
    expect(screen.getByText('Tap the heart on a hike, a waterfall or any other sight to keep it here.')).toBeOnTheScreen();
    screen.unmount();
    favouritesStore.getState().reset();
    setCurrentLanguage('is');
    await renderProfile('saved');
    expect(screen.getByText('ÚTIVIST')).toBeOnTheScreen();
    expect(screen.getByText('Ekkert vistað hér enn')).toBeOnTheScreen();
    expect(screen.getByText('Gönguleiðir og áhugaverðir staðir sem þú vistar með hjartanu birtast hér.')).toBeOnTheScreen();
  });
});
