/**
 * The classes feed on screen (iOS ClassesDiscoveryView): opening asks for no
 * location, the day groups and cards, the states (error, plain empty, the
 * next-match hint), the filters, the full-schedule sheet, load more, the
 * mode switch, and the session a row hands the class sheet.
 */
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import { api, Reply } from '@test/server';

import { stubApiClientPerTest } from '../../../api/testing';
import { bottomSheetMock } from '../../../components/ui/testing/bottomSheetMock';
import { setCurrentLanguage } from '../../../i18n';
import { locationStore } from '../../../stores/locationStore';
import ClassesDiscovery from '../ClassesDiscovery';
import { isoDay } from '../feed/days';
import { openClassSheet } from '../sheet';
import { classJSON, day, HRESS, NEARBY, page, REYKJAVIK } from './feedFixtures';

jest.mock('@gorhom/bottom-sheet', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('../../../components/ui/testing/bottomSheetMock').bottomSheetModule,
);
jest.mock('expo-asset', () => jest.requireActual('expo/node_modules/expo-asset'), { virtual: true });
jest.mock('../sheet', () => ({
  openClassSheet: jest.fn(),
  ClassSheetHost: () => null,
}));

stubApiClientPerTest();

const requestLocation = jest.fn(async () => undefined);
const initialLocation = locationStore.getState();

function setLocation(granted: boolean) {
  locationStore.setState({
    permission: granted ? 'granted' : 'undetermined',
    permissionKnown: true,
    currentLocation: granted ? { ...REYKJAVIK, accuracy: 20, timestamp: Date.now() } : null,
    requestLocation,
  });
}

beforeEach(() => {
  bottomSheetMock.reset();
  requestLocation.mockClear();
  setLocation(false);
});

afterEach(() => {
  locationStore.setState(initialLocation, true);
});

const rows = () => screen.queryAllByTestId('classes.row');

describe('opening the feed', () => {
  it('asks for no location, and lists the classes by day', async () => {
    const tomorrow = day(1, 9);
    api.on(
      'GET',
      '/classes',
      Reply.delayed(30, page([classJSON({ name: 'Yoga Flow', startsAt: tomorrow }), classJSON({ name: 'Spin', startsAt: day(2, 7) })])),
    );
    await render(<ClassesDiscovery showsModeToggle />);
    expect(screen.getByTestId('classes.loading')).toBeTruthy();
    await waitFor(() => expect(rows()).toHaveLength(2));

    expect(requestLocation).not.toHaveBeenCalled();
    expect(api.sent('/classes').query).toEqual({ limit: '100' });
    expect(screen.getByText('Yoga Flow')).toBeTruthy();
    // Serif day headers, venue-local.
    expect(screen.getAllByRole('header').length).toBeGreaterThanOrEqual(2);
  });

  it('a card says what it is to TalkBack, and opens the class sheet for its own session', async () => {
    const start = day(1, 6);
    api.on(
      'GET',
      '/classes',
      page([
        classJSON({
          name: 'Yoga Flow',
          startsAt: start,
          extra: { instructor: 'Sigrún', surchargeFromIsk: 1990, attendance: { current: 9, limit: 14 } },
        }),
      ]),
    );
    await render(<ClassesDiscovery showsModeToggle />);
    await waitFor(() => expect(rows()).toHaveLength(1));
    const row = rows()[0]!;
    expect(row.props.accessibilityLabel).toBe('Yoga Flow, 06:00–07:00 · Sigrún, Hress, Surcharge from ISK 1,990, 5 left');
    expect(row.props.accessibilityHint).toBe('Opens booking for this class');

    await fireEvent.press(row);
    expect(openClassSheet).toHaveBeenCalledTimes(1);
    const [occurrence] = (openClassSheet as jest.Mock).mock.calls[0]!;
    expect(occurrence.startsAt).toEqual(start);
    expect(occurrence.handle.kind).toBe('ablerClass');
    expect(occurrence.venueName).toBe('Hress');
  });

  it('a booking in the sheet re-reads the feed once the sheet has gone', async () => {
    api.on('GET', '/classes', page([classJSON({ startsAt: day(1, 9) })]));
    await render(<ClassesDiscovery showsModeToggle />);
    await waitFor(() => expect(rows()).toHaveLength(1));
    await fireEvent.press(rows()[0]!);
    const [, options] = (openClassSheet as jest.Mock).mock.calls[(openClassSheet as jest.Mock).mock.calls.length - 1]!;

    // Closed without a booking: nothing to re-read.
    await act(async () => options.onDismiss());
    expect(api.requests).toHaveLength(1);

    await act(async () => options.onBooked());
    expect(api.requests).toHaveLength(1);
    await act(async () => options.onDismiss());
    await waitFor(() => expect(api.requests).toHaveLength(2));
  });

  it('a row of a kind this build does not know cannot be pressed', async () => {
    api.on('GET', '/classes', page([classJSON({ startsAt: day(1, 9), booking: { kind: 'waitlist', activityId: '1f2e3d4c-5b6a-4987-8e1f-0a1b2c3d4e5f' } })]));
    await render(<ClassesDiscovery showsModeToggle />);
    await waitFor(() => expect(screen.getByTestId('classes.row.static')).toBeTruthy());
    expect(rows()).toHaveLength(0);
  });

  it('distances show from a granted fix only, never from the fallback', async () => {
    setLocation(true);
    api.on('GET', '/classes', page([classJSON({ venue: NEARBY, startsAt: day(1, 9) }), classJSON({ venue: HRESS, startsAt: day(1, 10) })]));
    await render(<ClassesDiscovery showsModeToggle />);
    await waitFor(() => expect(rows()).toHaveLength(2));
    expect(screen.getAllByTestId('classes.row.distance')).toHaveLength(2);
    expect(rows()[0]!.props.accessibilityLabel).toContain('m away');

    // Location revoked while the app is open: the distances go, and with
    // "Near me" on the note says where the radius measures from.
    await act(async () => setLocation(false));
    expect(screen.queryAllByTestId('classes.row.distance')).toHaveLength(0);
    await fireEvent.press(screen.getByTestId('classes.near_me'));
    expect(requestLocation).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('classes.location_fallback')).toBeTruthy();
    // The radius (5 km) around central Reykjavík drops Hress (about 9 km).
    expect(rows()).toHaveLength(1);
    await fireEvent.press(screen.getByTestId('classes.radius.10'));
    expect(rows()).toHaveLength(2);
  });
});

describe('states', () => {
  it('a failed load shows the error, and Try again reloads', async () => {
    api.on('GET', '/classes', Reply.problem(500, 'internal_error'));
    await render(<ClassesDiscovery showsModeToggle />);
    await waitFor(() => expect(screen.getByText('Could not load classes. Please try again.')).toBeTruthy());
    // The filters stay reachable in every state.
    expect(screen.getByTestId('classes.filters.panel')).toBeTruthy();

    api.on('GET', '/classes', page([classJSON({ startsAt: day(1, 9) })]));
    await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(rows()).toHaveLength(1));
  });

  it('an empty window says so, in words for Near me too', async () => {
    api.on('GET', '/classes', page([]));
    await render(<ClassesDiscovery showsModeToggle />);
    await waitFor(() => expect(screen.getByText('No upcoming classes match these filters.')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('classes.near_me'));
    expect(screen.getByText('No upcoming classes within this distance. Try a wider radius.')).toBeTruthy();
  });

  it('an empty day names the next match, and its button moves the day', async () => {
    const today = isoDay(new Date());
    const match = day(3, 6);
    api.on('GET', '/classes', (r) => (r.query.start === today ? page([]) : page([classJSON({ startsAt: match })])));
    await render(<ClassesDiscovery showsModeToggle={false} initialCategory="pilates" initialDate={today} />);
    await waitFor(() => expect(screen.getByTestId('classes.next_match')).toBeTruthy());
    expect(screen.getByText('No Pilates today.')).toBeTruthy();
    const show = screen.getByTestId('classes.next_match.show');
    expect(show.props.accessibilityHint).toBe('Moves the day selector to that day.');

    api.on('GET', '/classes', page([classJSON({ startsAt: match })]));
    await fireEvent.press(show);
    await waitFor(() => expect(rows()).toHaveLength(1));
    expect(api.sent('/classes').query.start).toBe(isoDay(match));
    expect(api.sent('/classes').query.category).toBe('pilates');
  });

  it('load more appears with a cursor and appends the next page', async () => {
    api.on('GET', '/classes', (r) =>
      r.query.cursor ? page([classJSON({ name: 'Second', startsAt: day(2, 9) })]) : page([classJSON({ name: 'First', startsAt: day(1, 9) })], 'p2'),
    );
    await render(<ClassesDiscovery showsModeToggle />);
    await waitFor(() => expect(screen.getByTestId('classes.load_more')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('classes.load_more'));
    await waitFor(() => expect(rows()).toHaveLength(2));
    expect(screen.queryByTestId('classes.load_more')).toBeNull();
  });
});

describe('filters', () => {
  it('a category chip and a day chip reload with the filter; the badge counts them', async () => {
    api.on('GET', '/classes', page([]));
    await render(<ClassesDiscovery showsModeToggle />);
    await waitFor(() => expect(api.requests).toHaveLength(1));

    await fireEvent.press(screen.getByTestId('classes.category.yoga'));
    await waitFor(() => expect(api.requests).toHaveLength(2));
    expect(api.sent('/classes').query.category).toBe('yoga');

    await fireEvent.press(screen.getByTestId('classes.day.1'));
    const tomorrow = isoDay(day(1));
    await waitFor(() => expect(api.requests.length).toBeGreaterThanOrEqual(3));
    expect(api.requests[2]!.query).toMatchObject({ start: tomorrow, end: tomorrow, category: 'yoga' });
    // The empty day then looks ahead (the fortnight after it, same category).
    await waitFor(() => expect(screen.getByTestId('classes.next_match.none')).toBeTruthy());
    expect(api.requests[3]!.query).toMatchObject({ start: isoDay(day(2)), category: 'yoga' });

    const filters = screen.getByTestId('classes.filters');
    expect(filters.props.accessibilityValue).toEqual({ text: '2' });
    expect(screen.getByTestId('classes.day.1').props.accessibilityState).toMatchObject({ selected: true });

    // Clear goes back to the default window.
    const asked = api.requests.length;
    await fireEvent.press(screen.getByTestId('classes.date_clear'));
    await waitFor(() => expect(api.requests).toHaveLength(asked + 1));
    expect(api.sent('/classes').query.start).toBeUndefined();
  });

  it('the Filters chip folds the filter rows', async () => {
    api.on('GET', '/classes', page([]));
    await render(<ClassesDiscovery showsModeToggle />);
    expect(screen.getByTestId('classes.filters.panel')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('classes.filters'));
    expect(screen.queryByTestId('classes.filters.panel')).toBeNull();
    await fireEvent.press(screen.getByTestId('classes.filters'));
    expect(screen.getByTestId('classes.filters.panel')).toBeTruthy();
    await waitFor(() => expect(api.requests).toHaveLength(1));
  });

  it('the full schedule picks a later day, and Done loads it', async () => {
    api.on('GET', '/classes', page([]));
    await render(<ClassesDiscovery showsModeToggle />);
    await waitFor(() => expect(api.requests).toHaveLength(1));
    await fireEvent.press(screen.getByTestId('classes.calendar'));
    const sheet = await screen.findByTestId('classes.calendar.grid');
    const target = isoDay(day(9));
    // The target may sit in next month's page.
    if (!within(sheet).queryByTestId(`classes.calendar.day.${target}`)) {
      await fireEvent.press(screen.getByTestId('classes.calendar.next'));
    }
    await fireEvent.press(screen.getByTestId(`classes.calendar.day.${target}`));
    // A day past the horizon cannot be picked.
    const beyond = isoDay(day(20));
    const beyondCell = screen.queryByTestId(`classes.calendar.day.${beyond}`);
    if (beyondCell) expect(beyondCell.props.accessibilityState).toMatchObject({ disabled: true });

    await fireEvent.press(screen.getByTestId('classes.date_sheet.done'));
    await waitFor(() => expect(api.requests.length).toBeGreaterThanOrEqual(2));
    expect(api.requests[1]!.query).toMatchObject({ start: target, end: target });
    // The circle shows the custom pick, highlighted.
    const circle = screen.getByTestId('classes.calendar');
    expect(circle.props.accessibilityValue).toEqual({ text: String(Number(target.slice(8))) });
    expect(circle.props.accessibilityState).toMatchObject({ selected: true });
  });

  it('the search is debounced into one request', async () => {
    api.on('GET', '/classes', page([]));
    await render(<ClassesDiscovery showsModeToggle />);
    await waitFor(() => expect(api.requests).toHaveLength(1));
    await fireEvent.changeText(screen.getByTestId('classes.search'), 'yo');
    await fireEvent.changeText(screen.getByTestId('classes.search'), 'yoga ');
    await waitFor(() => expect(api.requests).toHaveLength(2), { timeout: 2_000 });
    expect(api.sent('/classes').query.q).toBe('yoga');
  });
});

describe('the mode switch', () => {
  it('Explore shows it; Venues hands back', async () => {
    api.on('GET', '/classes', page([]));
    const onShowVenues = jest.fn();
    await render(<ClassesDiscovery showsModeToggle onShowVenues={onShowVenues} />);
    await fireEvent.press(screen.getByTestId('classes.mode.venues'));
    expect(onShowVenues).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('classes.mode.classes').props.accessibilityState).toMatchObject({ selected: true });
    await waitFor(() => expect(api.requests).toHaveLength(1));
  });

  it('Plan opens it without the switch', async () => {
    api.on('GET', '/classes', page([]));
    await render(<ClassesDiscovery showsModeToggle={false} />);
    expect(screen.queryByTestId('classes.mode.venues')).toBeNull();
    await waitFor(() => expect(api.requests).toHaveLength(1));
  });
});

describe('Icelandic', () => {
  it('reads the chips and the quick days in Icelandic', async () => {
    setCurrentLanguage('is');
    api.on('GET', '/classes', page([classJSON({ startsAt: day(1, 9) })]));
    await render(<ClassesDiscovery showsModeToggle />);
    await waitFor(() => expect(rows()).toHaveLength(1));
    expect(screen.getByText('Í dag')).toBeTruthy();
    expect(screen.getByText('Á morgun')).toBeTruthy();
    expect(screen.getByText('Nálægt mér')).toBeTruthy();
    expect(screen.getByText('Jóga')).toBeTruthy();
    expect(screen.getByText('9 laus')).toBeTruthy();
    expect(screen.getByText('Tímar')).toBeTruthy();
  });
});
