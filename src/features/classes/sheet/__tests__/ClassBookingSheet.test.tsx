/**
 * The class sheet on screen, opened the way the feed and the Coach open it
 * (`openClassSheet`), drawn by its host, booking against the stub server:
 *
 * - a tapped class: checked first, then its header, the disclosure, the line
 *   above Confirm and Confirm's spoken amount; consent, booked, Done; the
 *   opener hears `onBooked`, then `onDismiss` once;
 * - a session that can't be booked says why, hides Confirm and offers the
 *   full schedule on its day, after which the opener re-reads;
 * - a refusal's page (Plans) hides the sheet until the member is back, then
 *   the same class is checked again;
 * - a booking in flight holds the sheet (close, swipe, back, a second sheet);
 * - a card-less class pays on the payment page with the sheet under it, and
 *   an old server's refusal is 2.5.4's "add a card";
 * - a Coach slot whose re-check failed offers Try again;
 * - the 30 s tick, TalkBack announcements and the large-text height.
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import * as WebBrowser from 'expo-web-browser';
import { AccessibilityInfo, AppState, DeviceEventEmitter } from 'react-native';
import { Reply, type StubReply } from '@test/server';

import { stubApiClientPerTest } from '../../../../api/testing';
import { bottomSheetMock } from '../../../../components/ui/testing/bottomSheetMock';
import { restoreTestFontScale, setTestFontScale } from '../../../../hooks/testing';
import { lookup, setCurrentLanguage, VenueTimeFormat } from '../../../../i18n';
import { confirmedBody } from '../../../../payments';
import { freshPaymentsPerTest, signIn } from '../../../../payments/__tests__/paymentsHarness';
import { CLASS_SHEET_TICK_MS } from '../ClassBookingSheet';
import ClassSheetHost from '../ClassSheetHost';
import { openClassSheet } from '../index';
import { currentClassSheetRequest, resetClassSheetRequestsForTests } from '../requests';
import {
  ablerOccurrence,
  ACTIVITY_ID,
  bookingPosts,
  cardlessClassServer,
  classesReply,
  CONFIRMED,
  consent,
  fakePages,
  flush,
  FREE_PREVIEW,
  FULL_SNAPSHOT,
  klass,
  plus,
  requests,
  respond,
  sessionPosts,
  sheetSessionOptions,
  slotOccurrence,
  slotsReply,
  START,
  SURCHARGE_PREVIEW,
  VENUE_ID,
  type FakePages,
} from './sheetHarness';

jest.mock('@gorhom/bottom-sheet', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('../../../../components/ui/testing/bottomSheetMock').bottomSheetModule,
);
jest.mock('expo-asset', () => jest.requireActual('expo/node_modules/expo-asset'), { virtual: true });
jest.mock('expo-web-browser', () => ({ openAuthSessionAsync: jest.fn() }));

const openAuthSession = jest.mocked(WebBrowser.openAuthSessionAsync);
const DONE = { type: 'dismiss' } as WebBrowser.WebBrowserAuthSessionResult;
const en = (key: string) => lookup(key, 'en');

stubApiClientPerTest();
freshPaymentsPerTest();

beforeEach(() => {
  signIn();
  setCurrentLanguage('en');
  setTestFontScale(1);
  bottomSheetMock.reset();
  resetClassSheetRequestsForTests();
});
afterEach(() => {
  restoreTestFontScale();
  jest.restoreAllMocks();
});

interface Opened {
  readonly pages: FakePages;
  readonly onBooked: jest.Mock;
  readonly onDismiss: jest.Mock;
  readonly reminders: jest.Mock;
}

/** The host on screen, then the sheet asked for, as a feed row asks. */
async function openSheet(
  occurrence = ablerOccurrence(),
  options: { pages?: FakePages; now?: () => Date } = {},
): Promise<Opened> {
  const pages = options.pages ?? fakePages();
  const session = sheetSessionOptions();
  const sessionOptions = options.now ? { deps: { ...session.options.deps, now: options.now } } : session.options;
  const onBooked = jest.fn();
  const onDismiss = jest.fn();
  await render(<ClassSheetHost pages={pages} sessionOptions={sessionOptions} />);
  await act(async () => {
    openClassSheet(occurrence, { onBooked, onDismiss });
  });
  return { pages, onBooked, onDismiss, reminders: session.reminders };
}

/** A class the server lists, priced by `preview`, and booked by `create`. */
function classServer(preview: StubReply, create?: (body: Record<string, unknown>) => StubReply | Promise<StubReply>): void {
  respond((request) => {
    if (request.path.endsWith('/classes')) return classesReply([klass(4242, START)]);
    if (request.path.endsWith('/booking-preview')) return preview;
    if (request.method === 'POST' && request.path === '/bookings' && create) {
      return create((request.body ?? {}) as Record<string, unknown>);
    }
    return Reply.problem(404, 'not_found');
  });
}

const when = `${VenueTimeFormat.dayTime(START, 'en')}–11:00`;

it('a tapped class is checked, priced above Confirm, booked with consent, and Done closes it', async () => {
  classServer(Reply.ok(SURCHARGE_PREVIEW), (body) => (body.acceptCharge === true ? Reply.ok(CONFIRMED) : consent(1_990)));
  const { onBooked, onDismiss, reminders } = await openSheet();

  // The title, and the header as one TalkBack element.
  expect(screen.getByText(en('classsheet.title'))).toBeOnTheScreen();
  const header = screen.getByTestId('classsheet.header');
  expect(header.props.accessibilityLabel).toMatch(/^Yoga Flow at Hress, /);

  // Ready: the re-checked spots, the instructor, the disclosure and the line.
  expect(await screen.findByText('9 spots left')).toBeOnTheScreen();
  expect(screen.getByText('Sigrún Jónsdóttir')).toBeOnTheScreen();
  expect(screen.getByText(when)).toBeOnTheScreen();
  expect(screen.getByTestId('classsheet.header').props.accessibilityLabel).toBe(
    `Yoga Flow at Hress, ${when}, Sigrún Jónsdóttir, 9 spots left`,
  );
  expect(screen.getByTestId('booking.disclosure')).toBeOnTheScreen();
  expect(screen.getByTestId('classsheet.price').props.accessibilityLabel).toBe('ISK 1,990 charged when you confirm');
  const confirm = screen.getByTestId('classsheet.confirm');
  expect(confirm).toBeEnabled();
  expect(confirm.props.accessibilityLabel).toBe(`Confirm booking: Yoga Flow, ${when}. ISK 1,990 charged when you confirm`);
  // One venue day was asked, and the preview at the session's start.
  expect(requests('/classes')[0]?.query).toMatchObject({ start: '2030-03-14', end: '2030-03-14' });
  expect(requests('/booking-preview')[0]?.query.startsAt).toBe('2030-03-14T10:00:00Z');
  expect(screen.queryByTestId('classsheet.other_times')).toBeNull();

  await fireEvent.press(confirm);
  expect(await screen.findByText(en('consent.title'))).toBeOnTheScreen();
  await fireEvent.press(screen.getByTestId('booking.consent.accept'));
  expect(await screen.findByText(en('booking.confirmed_title'))).toBeOnTheScreen();
  expect(screen.getByText(confirmedBody(true, true, 'en'))).toBeOnTheScreen();
  expect(onBooked).toHaveBeenCalledTimes(1);
  expect(onDismiss).not.toHaveBeenCalled();
  expect(reminders).toHaveBeenCalledWith({ className: 'Class 4242', startsAt: START, language: 'en' });
  // The event and the key ride the consent re-POST.
  expect(bookingPosts().map((post) => post.body)).toEqual([
    { activityId: ACTIVITY_ID, eventId: 4242 },
    { activityId: ACTIVITY_ID, eventId: 4242, acceptCharge: true, acceptedChargeAmountIsk: 1_990 },
  ]);
  expect(bookingPosts()[1]?.headers['idempotency-key']).toBe(bookingPosts()[0]?.headers['idempotency-key']);

  await fireEvent.press(screen.getByTestId('booking.confirmed.done'));
  await waitFor(() => expect(screen.queryByTestId('classsheet.header')).toBeNull());
  expect(onDismiss).toHaveBeenCalledTimes(1);
  expect(onBooked.mock.invocationCallOrder[0]).toBeLessThan(onDismiss.mock.invocationCallOrder[0]!);
  expect(currentClassSheetRequest()).toBeNull();
});

it('the close button, a swipe and back close an idle sheet; the opener hears onDismiss once and no onBooked', async () => {
  classServer(Reply.ok(FREE_PREVIEW));
  const first = await openSheet();
  await screen.findByTestId('classsheet.confirm');
  expect(screen.queryByTestId('classsheet.price')).toBeNull();
  expect(bottomSheetMock.latest()?.enablePanDownToClose).toBe(true);
  await fireEvent.press(screen.getByTestId('classsheet.close'));
  await waitFor(() => expect(screen.queryByTestId('classsheet.header')).toBeNull());
  expect(first.onDismiss).toHaveBeenCalledTimes(1);
  expect(first.onBooked).not.toHaveBeenCalled();

  // Hardware back.
  const onDismiss = jest.fn();
  await act(async () => {
    openClassSheet(ablerOccurrence(), { onDismiss });
  });
  await screen.findByTestId('classsheet.confirm');
  await act(async () => {
    DeviceEventEmitter.emit('hardwareBackPress');
  });
  await waitFor(() => expect(screen.queryByTestId('classsheet.header')).toBeNull());
  expect(onDismiss).toHaveBeenCalledTimes(1);
});

it('a full class says so, is not previewed, hides Confirm, and See other times opens the full flow on its day', async () => {
  respond((request) =>
    request.path.endsWith('/classes')
      ? classesReply([klass(4242, START, { canBook: false, reason: 'class_full', full: true })])
      : Reply.problem(404, 'not_found'),
  );
  const { pages, onBooked, onDismiss } = await openSheet(ablerOccurrence({ snapshot: FULL_SNAPSHOT }));

  expect(await screen.findByText(en('booking.class.err_full'))).toBeOnTheScreen();
  expect(screen.queryByTestId('classsheet.confirm')).toBeNull();
  expect(screen.queryByTestId('classsheet.spots')).toBeNull();
  expect(requests('/booking-preview')).toHaveLength(0);

  await fireEvent.press(screen.getByTestId('classsheet.other_times'));
  expect(pages.opened).toEqual([
    {
      name: 'BookingFlow',
      params: {
        venueId: VENUE_ID,
        activity: { id: ACTIVITY_ID, name: 'Hress', provider: 'abler' },
        initialDate: '2030-03-14',
      },
    },
  ]);
  // Out of the way of the flow, but not over yet.
  await waitFor(() => expect(screen.queryByTestId('classsheet.header')).toBeNull());
  expect(onDismiss).not.toHaveBeenCalled();
  expect(currentClassSheetRequest()).not.toBeNull();

  // Back from the flow: the list underneath re-reads (a booking may have landed there).
  await act(async () => pages.returnFrom('back'));
  expect(onBooked).toHaveBeenCalledTimes(1);
  expect(onDismiss).toHaveBeenCalledTimes(1);
  expect(onBooked.mock.invocationCallOrder[0]).toBeLessThan(onDismiss.mock.invocationCallOrder[0]!);
  expect(currentClassSheetRequest()).toBeNull();
});

it('a membership refusal offers plans; the sheet steps aside for Plans and checks the same class again on the way back', async () => {
  let bought = false;
  respond((request) => {
    if (request.path.endsWith('/classes')) return classesReply([klass(4242, START)]);
    if (request.path.endsWith('/booking-preview')) return bought ? Reply.ok(FREE_PREVIEW) : Reply.problem(403, 'no_active_plan_or_pass');
    return Reply.problem(404, 'not_found');
  });
  const { pages, onDismiss } = await openSheet();

  expect(await screen.findByText(en('booking.err.no_plan'))).toBeOnTheScreen();
  expect(screen.queryByTestId('classsheet.confirm')).toBeNull();
  // The plans step answers it: no "See other times" beside it.
  expect(screen.queryByTestId('classsheet.other_times')).toBeNull();

  await fireEvent.press(screen.getByRole('button', { name: en('booking.err.view_plans') }));
  expect(pages.opened).toEqual([{ name: 'Plans' }]);
  await waitFor(() => expect(screen.queryByTestId('classsheet.header')).toBeNull());
  expect(pages.watching()).toBe(true);

  bought = true;
  await act(async () => pages.returnFrom('back'));
  expect(await screen.findByTestId('classsheet.header')).toBeOnTheScreen();
  await waitFor(() => expect(screen.getByTestId('classsheet.confirm')).toBeEnabled());
  expect(screen.queryByText(en('booking.err.no_plan'))).toBeNull();
  expect(requests('/classes')).toHaveLength(2);
  expect(requests('/booking-preview')).toHaveLength(2);
  expect(onDismiss).not.toHaveBeenCalled();
});

it('a page that took the member elsewhere for good ends the sheet', async () => {
  classServer(Reply.problem(403, 'no_active_plan_or_pass'));
  const { pages, onDismiss } = await openSheet();
  await fireEvent.press(await screen.findByRole('button', { name: en('booking.err.view_plans') }));
  await act(async () => pages.returnFrom('gone'));
  expect(onDismiss).toHaveBeenCalledTimes(1);
  expect(currentClassSheetRequest()).toBeNull();
});

it('a page that could not open leaves the sheet where it was', async () => {
  classServer(Reply.problem(403, 'no_active_plan_or_pass'));
  const pages = fakePages();
  pages.canOpen = false;
  await openSheet(ablerOccurrence(), { pages });
  await fireEvent.press(await screen.findByRole('button', { name: en('booking.err.view_plans') }));
  expect(await screen.findByTestId('classsheet.header')).toBeOnTheScreen();
  expect(pages.watching()).toBe(false);
});

it('a booking in flight holds the sheet: no close, no swipe, no back, and no second sheet over it', async () => {
  let answer: (reply: StubReply) => void = () => undefined;
  classServer(Reply.ok(FREE_PREVIEW), () => new Promise<StubReply>((resolve) => (answer = resolve)));
  const { onDismiss } = await openSheet();
  await fireEvent.press(await screen.findByTestId('classsheet.confirm'));
  await flush();

  expect(screen.getByTestId('classsheet.close')).toBeDisabled();
  expect(bottomSheetMock.latest()?.enablePanDownToClose).toBe(false);
  await fireEvent.press(screen.getByTestId('classsheet.close'));
  await act(async () => {
    DeviceEventEmitter.emit('hardwareBackPress');
  });
  expect(screen.getByTestId('classsheet.header')).toBeOnTheScreen();
  expect(onDismiss).not.toHaveBeenCalled();

  // Another row tapped meanwhile: dropped, and its opener is not left waiting.
  const second = jest.fn();
  await act(async () => {
    openClassSheet(ablerOccurrence({ eventId: 9999 }), { onDismiss: second });
  });
  expect(second).toHaveBeenCalledTimes(1);
  expect(currentClassSheetRequest()?.occurrence.id).toBe('occ-4242');

  await act(async () => answer(Reply.ok(CONFIRMED)));
  expect(await screen.findByText(en('booking.confirmed_title'))).toBeOnTheScreen();
  expect(screen.getByTestId('classsheet.close')).toBeEnabled();
  expect(bookingPosts()).toHaveLength(1);
});

it('a card-less member pays for the class on the payment page, with the sheet under it, and reads it is paid', async () => {
  cardlessClassServer();
  let closePage: (result: WebBrowser.WebBrowserAuthSessionResult) => void = () => undefined;
  openAuthSession.mockImplementationOnce(() => new Promise((resolve) => (closePage = resolve)));
  const { onBooked } = await openSheet();

  await fireEvent.press(await screen.findByTestId('classsheet.confirm'));
  expect(await screen.findByText('Confirm and pay ISK 1,990')).toBeOnTheScreen();
  await fireEvent.press(screen.getByTestId('booking.consent.accept'));
  await flush();

  // The page is open; the sheet is still there, held.
  expect(openAuthSession).toHaveBeenCalledTimes(1);
  expect(sessionPosts()[0]?.body).toEqual({ kind: 'booking', activityId: ACTIVITY_ID, eventId: 4242, acceptedChargeAmountIsk: 1_990 });
  expect(screen.getByTestId('classsheet.header')).toBeOnTheScreen();
  expect(screen.getByTestId('classsheet.close')).toBeDisabled();

  await act(async () => closePage(DONE));
  expect(await screen.findByText(en('booking.confirmed_title'))).toBeOnTheScreen();
  expect(screen.getByText(confirmedBody(true, true, 'en'))).toBeOnTheScreen();
  expect(onBooked).toHaveBeenCalledTimes(1);
});

it("an old server's refusal of a card-less class is 2.5.4's add-a-card answer, and nothing is paid", async () => {
  cardlessClassServer({ session: Reply.problem(400, 'invalid-booking-payment') });
  await openSheet();
  await fireEvent.press(await screen.findByTestId('classsheet.confirm'));
  await fireEvent.press(await screen.findByTestId('booking.consent.accept'));
  expect(await screen.findByText(en('checkin.err.no_card_title'))).toBeOnTheScreen();
  expect(screen.getByText(en('booking.err.no_card_body'))).toBeOnTheScreen();
  expect(openAuthSession).not.toHaveBeenCalled();
});

it('a Coach slot with no end that could not be checked offers Try again, and is booked only once it has its end', async () => {
  let failing = true;
  respond((request) => {
    if (request.path.endsWith('/availability')) return failing ? Reply.problem(500, 'internal_error') : slotsReply([START]);
    if (request.path.endsWith('/booking-preview')) return Reply.ok(FREE_PREVIEW);
    return Reply.problem(404, 'not_found');
  });
  await openSheet(slotOccurrence(null));

  expect(await screen.findByText(en('classsheet.load_error'))).toBeOnTheScreen();
  expect(screen.queryByTestId('classsheet.confirm')).toBeNull();
  expect(screen.getByTestId('classsheet.other_times')).toBeOnTheScreen();
  expect(screen.getByText(VenueTimeFormat.dayTime(START, 'en'))).toBeOnTheScreen();

  failing = false;
  await fireEvent.press(screen.getByTestId('classsheet.retry'));
  await waitFor(() => expect(screen.getByTestId('classsheet.confirm')).toBeEnabled());
  expect(screen.getByText(`${VenueTimeFormat.dayTime(START, 'en')}–10:45`)).toBeOnTheScreen();
  expect(screen.getByText('6 spots left')).toBeOnTheScreen();
});

it('a class that starts while the sheet is open stops being bookable at the next tick', async () => {
  const intervals = jest.spyOn(global, 'setInterval');
  let now = new Date('2030-03-14T09:00:00Z');
  classServer(Reply.ok(FREE_PREVIEW));
  await openSheet(ablerOccurrence(), { now: () => now });
  await screen.findByTestId('classsheet.confirm');

  const tick = intervals.mock.calls.find(([, ms]) => ms === CLASS_SHEET_TICK_MS)?.[0] as (() => void) | undefined;
  expect(tick).toBeDefined();
  now = plus(START, 1);
  await act(async () => tick!());
  expect(await screen.findByText(en('booking.class.err_passed'))).toBeOnTheScreen();
  expect(screen.queryByTestId('classsheet.confirm')).toBeNull();
  expect(screen.getByTestId('classsheet.other_times')).toBeOnTheScreen();
});

it('a return to the app ticks at once', async () => {
  const listeners: ((state: string) => void)[] = [];
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, listener) => {
    listeners.push(listener as (state: string) => void);
    return { remove: jest.fn() } as never;
  });
  let now = new Date('2030-03-14T09:00:00Z');
  classServer(Reply.ok(FREE_PREVIEW));
  await openSheet(ablerOccurrence(), { now: () => now });
  await screen.findByTestId('classsheet.confirm');
  now = plus(START, 60);
  await act(async () => listeners.forEach((listener) => listener('active')));
  expect(await screen.findByText(en('booking.class.err_passed'))).toBeOnTheScreen();
});

it('TalkBack hears a session that turned out not to be bookable, and the amount when it appears', async () => {
  jest.spyOn(AccessibilityInfo, 'isScreenReaderEnabled').mockResolvedValue(true);
  const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => undefined);
  respond((request) =>
    request.path.endsWith('/classes')
      ? classesReply([klass(4242, START, { canBook: false, reason: 'class_full', full: true })])
      : Reply.problem(404, 'not_found'),
  );
  await openSheet();
  await screen.findByText(en('booking.class.err_full'));
  await waitFor(() => expect(announce).toHaveBeenCalledWith(en('booking.class.err_full')));

  await fireEvent.press(screen.getByTestId('classsheet.close'));
  await waitFor(() => expect(screen.queryByTestId('classsheet.header')).toBeNull());
  announce.mockClear();
  classServer(Reply.ok(SURCHARGE_PREVIEW));
  await act(async () => {
    openClassSheet(ablerOccurrence());
  });
  await screen.findByTestId('classsheet.price');
  await waitFor(() => expect(announce).toHaveBeenCalledWith('ISK 1,990 charged when you confirm'));
  expect(announce).toHaveBeenCalledTimes(1);
});

it('nothing is announced with TalkBack off', async () => {
  jest.spyOn(AccessibilityInfo, 'isScreenReaderEnabled').mockResolvedValue(false);
  const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => undefined);
  classServer(Reply.ok(SURCHARGE_PREVIEW));
  await openSheet();
  await screen.findByTestId('classsheet.price');
  await flush();
  expect(announce).not.toHaveBeenCalled();
});

it('half height by default; at the accessibility text sizes full height is the only height', async () => {
  classServer(Reply.ok(FREE_PREVIEW));
  await openSheet();
  await screen.findByTestId('classsheet.confirm');
  expect(bottomSheetMock.latest()?.snapPoints).toEqual(['50%', '100%']);
  await fireEvent.press(screen.getByTestId('classsheet.close'));
  await waitFor(() => expect(screen.queryByTestId('classsheet.header')).toBeNull());

  setTestFontScale(2);
  await act(async () => {
    openClassSheet(ablerOccurrence());
  });
  await screen.findByTestId('classsheet.confirm');
  expect(bottomSheetMock.latest()?.snapPoints).toEqual(['100%']);
});

it('Choose another time on a class that filled after the check opens the full flow on its day', async () => {
  classServer(Reply.ok(FREE_PREVIEW), () => Reply.problem(409, 'slot_unavailable', { reason: 'class_full' }));
  const { pages } = await openSheet();
  await fireEvent.press(await screen.findByTestId('classsheet.confirm'));
  // In place, with its own step; no second "See other times" beside it.
  expect(await screen.findByText(en('booking.class.err_full'))).toBeOnTheScreen();
  expect(screen.queryByTestId('classsheet.other_times')).toBeNull();
  await fireEvent.press(screen.getByTestId('refusal.cta'));
  expect(pages.opened.map((page) => page.name)).toEqual(['BookingFlow']);
});
