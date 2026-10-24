/**
 * The booking flow at the largest font size, in Icelandic: Back, Next and
 * Confirm are pinned BELOW each step's scrolling content, never inside it,
 * so a long disclosure or a tall party section cannot push them off a small
 * screen. The Android check for the iOS 3.0.0 report (a pass holder stuck on
 * Forest Lagoon's confirm step with Confirm under the tab bar): iOS tests it
 * on an iPhone SE at the largest accessibility size with a premium pass
 * surcharge; Jest draws no layout, so this holds the structure that makes it
 * impossible (the tab bar is not drawn over the flow either, see
 * src/navigation/__tests__/CustomTabBar.test.tsx).
 */
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { act, fireEvent, render, screen, within } from '@testing-library/react-native';
import type { ComponentType } from 'react';
import { Text } from 'react-native';
import { Reply } from '@test/server';

import { stubApiClientPerTest } from '../../../api/testing';
import { restoreTestFontScale, setTestFontScale } from '../../../hooks/testing';
import { lookup, setCurrentLanguage } from '../../../i18n';
import { navigationRef } from '../../../navigation/navigationRef';
import BookingFlowScreen from '../BookingFlowScreen';
import { bookingPosts, CONFIRMED, plus, respond, slotsReply, START, VENUE_ID } from './bookingHarness';

// The Kenni sheet (a refusal step) draws icons, whose font loader needs expo-asset.
jest.mock('expo-asset', () => jest.requireActual('expo/node_modules/expo-asset'), { virtual: true });

stubApiClientPerTest();

const is = (key: string) => lookup(key, 'is');
const ACTIVITY = { id: '0b7d4a62-3c9e-4f1a-a2d5-6e8f9c1b2a34', name: 'Forest Lagoon Access', provider: 'internal' };

/** A one-visit pass at a premium venue: the visit is spent and a surcharge applies (the reported case). */
const PREMIUM_PASS_VISIT_PREVIEW = {
  kind: 'surcharge',
  surchargeReason: 'premium_pass_visit',
  priceIsk: 4_500,
  remainingMonthly: null,
  isLastBeforeTopUp: false,
};

const Stack = createNativeStackNavigator();

function Start() {
  return <Text>Venue page</Text>;
}

async function renderFlow(params: Record<string, unknown>) {
  await render(
    <NavigationContainer ref={navigationRef}>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        <Stack.Screen name="Start" component={Start} />
        <Stack.Screen name="BookingFlow" component={BookingFlowScreen as unknown as ComponentType} />
      </Stack.Navigator>
    </NavigationContainer>,
  );
  await act(async () => {
    (navigationRef.navigate as unknown as (name: string, params?: object) => void)('BookingFlow', params);
  });
}

function serve() {
  respond((request) => {
    if (request.path === '/check-ins/walk-in/preview') {
      return Reply.ok({
        venue: { id: VENUE_ID, slug: 'forest-lagoon', name: 'Forest Lagoon' },
        walkInsAllowed: true,
        activities: [],
        slotActivities: [],
        allowed: true,
        blockingReason: null,
        charge: null,
        attendableBooking: null,
        guestBands: null,
        coveredBy: null,
      });
    }
    if (request.path.endsWith('/availability')) return slotsReply([START, plus(START, 3600)]);
    if (request.path.endsWith('/booking-preview')) return Reply.ok(PREMIUM_PASS_VISIT_PREVIEW);
    if (request.method === 'POST' && request.path === '/bookings') return Reply.ok(CONFIRMED);
    return Reply.problem(404, 'not_found');
  });
}

/** `id` is drawn in the step's pinned footer and NOT inside its scroll view. */
function expectPinned(id: string, step: 'date' | 'timetable' | 'confirm') {
  expect(within(screen.getByTestId(`booking.${step}.footer`)).getByTestId(id)).toBeOnTheScreen();
  expect(within(screen.getByTestId(`booking.${step}.scroll`)).queryByTestId(id)).toBeNull();
}

async function toConfirmStep() {
  await renderFlow({ venueId: VENUE_ID, activity: ACTIVITY, initialDate: '2030-03-14' });
  await fireEvent.press(await screen.findByTestId('booking.slot.10:00'));
  await fireEvent.press(screen.getByTestId('booking.timetable.next'));
  // The premium pass disclosure has landed.
  await screen.findByText(/lúxusstaður/);
}

beforeEach(() => {
  setCurrentLanguage('is');
  serve();
});

afterEach(() => restoreTestFontScale());

describe('at the largest font size (2.0), in Icelandic', () => {
  beforeEach(() => setTestFontScale(2));

  it('the confirm step scrolls the summary and the disclosure; Confirm and Back are pinned, stacked, and Confirm books', async () => {
    await toConfirmStep();

    const scroll = screen.getByTestId('booking.confirm.scroll');
    expect(within(scroll).getByText(is('booking.confirm_title'))).toBeOnTheScreen();
    const card = within(scroll).getByTestId('booking.confirm.card');
    // Every row, each under its own label: the booked service is "Þjónusta",
    // so "Tími" labels the time alone.
    expect(within(card).getByText('Þjónusta')).toBeOnTheScreen();
    expect(within(card).getByText(is('booking.venue'))).toBeOnTheScreen();
    expect(within(card).getByText(is('booking.date'))).toBeOnTheScreen();
    expect(within(card).getAllByText('Tími')).toHaveLength(1);
    expect(within(card).getByText('Forest Lagoon Access')).toBeOnTheScreen();
    expect(within(card).getByText('Forest Lagoon')).toBeOnTheScreen();
    expect(within(card).getByText('10:00')).toBeOnTheScreen();
    expect(within(scroll).getByText(/lúxusstaður/)).toBeOnTheScreen();

    expectPinned('booking.confirm', 'confirm');
    expectPinned('booking.confirm.back', 'confirm');
    // Stacked at the accessibility sizes: Confirm first, full width, then Back.
    const stacked = screen.getByTestId('booking.confirm.footer.stacked');
    expect(within(stacked).getByText(is('booking.confirm_cta'))).toBeOnTheScreen();
    expect(within(stacked).getByText(is('common.back'))).toBeOnTheScreen();
    expect(screen.queryByTestId('booking.confirm.footer.row')).toBeNull();

    // Visible and hittable: enabled, and a press sends the booking.
    const confirm = screen.getByTestId('booking.confirm');
    expect(confirm).toBeEnabled();
    await fireEvent.press(confirm);
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
    expect(bookingPosts()).toHaveLength(1);
  });

  it('the timetable scrolls the title and the slots together; Back and Next are pinned below', async () => {
    await renderFlow({ venueId: VENUE_ID, activity: ACTIVITY, initialDate: '2030-03-14' });
    const slot = await screen.findByTestId('booking.slot.10:00');
    expect(within(screen.getByTestId('booking.timetable.scroll')).getByTestId('booking.slot.10:00')).toBe(slot);
    expect(within(screen.getByTestId('booking.timetable.scroll')).getByText(is('booking.select_time'))).toBeOnTheScreen();
    expectPinned('booking.timetable.next', 'timetable');
    expectPinned('booking.timetable.back', 'timetable');
    expect(screen.getByTestId('booking.timetable.footer.stacked')).toBeOnTheScreen();
  });

  it('the date step scrolls the calendar; Next is pinned below it', async () => {
    await renderFlow({ venueId: VENUE_ID, activity: ACTIVITY });
    expect(within(screen.getByTestId('booking.date.scroll')).getByTestId('booking.calendar.next')).toBeOnTheScreen();
    expectPinned('booking.date.next', 'date');
    expect(screen.getByTestId('booking.date.footer.stacked')).toBeOnTheScreen();
  });
});

it('at the default font size Back and Confirm sit side by side, still pinned below the scroll', async () => {
  setTestFontScale(1);
  await toConfirmStep();
  expectPinned('booking.confirm', 'confirm');
  expectPinned('booking.confirm.back', 'confirm');
  expect(screen.getByTestId('booking.confirm.footer.row')).toBeOnTheScreen();
  expect(screen.queryByTestId('booking.confirm.footer.stacked')).toBeNull();
});

it('a gate refusal still hides Confirm and keeps Back pinned', async () => {
  setTestFontScale(2);
  respond((request) => {
    if (request.path === '/check-ins/walk-in/preview') return Reply.problem(404, 'not_found');
    if (request.path.endsWith('/availability')) return slotsReply([START]);
    if (request.path.endsWith('/booking-preview')) {
      return Reply.problem(403, 'no_active_plan_or_pass');
    }
    return Reply.problem(404, 'not_found');
  });
  await renderFlow({ venueId: VENUE_ID, activity: ACTIVITY, initialDate: '2030-03-14' });
  await fireEvent.press(await screen.findByTestId('booking.slot.10:00'));
  await fireEvent.press(screen.getByTestId('booking.timetable.next'));
  expect(await screen.findByText(is('booking.err.no_plan'))).toBeOnTheScreen();
  expect(screen.queryByTestId('booking.confirm')).toBeNull();
  expectPinned('booking.confirm.back', 'confirm');
});
