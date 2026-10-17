/**
 * The booking flow on screen: the steps, the disclosure, the refusal panel
 * with Confirm hidden and its re-check on the way back from Plans, the
 * dialogs, the busy guard, and a first-build caller's legacy params.
 */
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { ComponentType } from 'react';
import { DeviceEventEmitter, Text } from 'react-native';
import { api, Reply } from '@test/server';

import { stubApiClientPerTest } from '../../../api/testing';
import { lookup, setCurrentLanguage } from '../../../i18n';
import { navigationRef } from '../../../navigation/navigationRef';
import BookingFlowScreen from '../BookingFlowScreen';
import { bodyOf, bookingPosts, CONFIRMED, consent, FREE_PREVIEW, plus, respond, slotsReply, START, VENUE_ID } from './bookingHarness';

// The Kenni sheet (a refusal step) draws icons, whose font loader needs expo-asset.
jest.mock('expo-asset', () => jest.requireActual('expo/node_modules/expo-asset'), { virtual: true });

stubApiClientPerTest();

const en = (key: string) => lookup(key, 'en');
const ACTIVITY = { id: '0b7d4a62-3c9e-4f1a-a2d5-6e8f9c1b2a34', name: 'Spin', provider: 'internal' };

const Stack = createNativeStackNavigator();

function Start() {
  return <Text>Venue page</Text>;
}

function Plans() {
  return <Text>Plans screen</Text>;
}

async function renderFlow(params: Record<string, unknown>) {
  await render(
    <NavigationContainer ref={navigationRef}>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        <Stack.Screen name="Start" component={Start} />
        <Stack.Screen name="BookingFlow" component={BookingFlowScreen as unknown as ComponentType} />
        <Stack.Screen name="Plans" component={Plans} />
      </Stack.Navigator>
    </NavigationContainer>,
  );
  await act(async () => {
    (navigationRef.navigate as unknown as (name: string, params?: object) => void)('BookingFlow', params);
  });
}

/** The walk-in preview the screen reads for the venue's name (and a legacy caller's activity). */
function walkInPreview(slotActivities: unknown[] = []) {
  return Reply.ok({
    venue: { id: VENUE_ID, slug: 'spin-studio', name: 'Spin Studio' },
    walkInsAllowed: true,
    activities: [],
    slotActivities,
    allowed: true,
    blockingReason: null,
    charge: null,
    attendableBooking: null,
    guestBands: null,
    coveredBy: null,
  });
}

beforeEach(() => setCurrentLanguage('en'));

it('date, timetable and confirm: the day loads on arrival, a pick enables Next, Confirm books and Done leaves', async () => {
  respond((request) => {
    if (request.path === '/check-ins/walk-in/preview') return walkInPreview();
    if (request.path.endsWith('/availability')) return slotsReply([START, plus(START, 3600)]);
    if (request.path.endsWith('/booking-preview')) return Reply.ok(FREE_PREVIEW);
    if (request.method === 'POST' && request.path === '/bookings') return Reply.ok(CONFIRMED);
    return Reply.problem(404, 'not_found');
  });
  await renderFlow({ venueId: VENUE_ID, activity: ACTIVITY, initialDate: '2030-03-14' });

  expect(screen.getByText('Book Spin')).toBeOnTheScreen();
  // Opened on the day: its timetable, Next grey until a time is picked.
  expect(await screen.findByText('10:00')).toBeOnTheScreen();
  expect(api.requests.filter((r) => r.path.endsWith('/availability'))).toHaveLength(1);
  expect(screen.getByTestId('booking.timetable.next')).toBeDisabled();
  await fireEvent.press(screen.getByTestId('booking.slot.10:00'));
  expect(screen.getByTestId('booking.timetable.next')).toBeEnabled();
  await fireEvent.press(screen.getByTestId('booking.timetable.next'));

  // Confirm: the card on the venue's clock, and the disclosure.
  expect(await screen.findByText(`${en('consent.disclosure.free')} 5 left this month.`)).toBeOnTheScreen();
  expect(screen.getByText('14 March 2030')).toBeOnTheScreen();
  expect(screen.getByText('Spin Studio')).toBeOnTheScreen();
  await fireEvent.press(screen.getByTestId('booking.confirm'));

  expect(await screen.findByText(en('booking.confirmed_title'))).toBeOnTheScreen();
  expect(screen.getByText(`${en('booking.confirmed_body')}\n\n${en('booking.reminder.inline')}`)).toBeOnTheScreen();
  expect(bodyOf(bookingPosts()[0]).startsAt).toBe('2030-03-14T10:00:00Z');
  await fireEvent.press(screen.getByTestId('booking.confirmed.done'));
  expect(await screen.findByText('Venue page')).toBeOnTheScreen();
});

it('the date step: a tap only selects, Next loads that day, and an empty day says so', async () => {
  respond((request) => {
    if (request.path === '/check-ins/walk-in/preview') return walkInPreview();
    if (request.path.endsWith('/availability')) return slotsReply([]);
    return Reply.problem(404, 'not_found');
  });
  await renderFlow({ venueId: VENUE_ID, activity: ACTIVITY });
  expect(screen.getByText(en('booking.select_date'))).toBeOnTheScreen();
  await fireEvent.press(screen.getByTestId('booking.calendar.next'));
  const day = screen.getAllByRole('button').find((button) => /^booking\.day\./.test(button.props.testID ?? ''))!;
  await fireEvent.press(day);
  // Still on the date step: a tap selects, it does not advance.
  expect(screen.getByText(en('booking.select_date'))).toBeOnTheScreen();
  expect(api.requests.filter((r) => r.path.endsWith('/availability'))).toHaveLength(0);
  await fireEvent.press(screen.getByTestId('booking.date.next'));
  expect(await screen.findByText(en('booking.no_slots'))).toBeOnTheScreen();
  const asked = api.requests.filter((r) => r.path.endsWith('/availability'))[0];
  expect(asked.query.start).toBe((day.props.testID as string).replace('booking.day.', ''));
});

it('a membership refusal hides Confirm and offers plans; back from Plans the same time is checked again', async () => {
  let bought = false;
  respond((request) => {
    if (request.path === '/check-ins/walk-in/preview') return walkInPreview();
    if (request.path.endsWith('/availability')) return slotsReply([START]);
    if (request.path.endsWith('/booking-preview')) {
      return bought ? Reply.ok(FREE_PREVIEW) : Reply.problem(403, 'no_active_plan_or_pass');
    }
    return Reply.problem(404, 'not_found');
  });
  await renderFlow({ venueId: VENUE_ID, activity: ACTIVITY, initialDate: '2030-03-14' });
  await fireEvent.press(await screen.findByTestId('booking.slot.10:00'));
  await fireEvent.press(screen.getByTestId('booking.timetable.next'));

  expect(await screen.findByText(en('booking.err.no_plan'))).toBeOnTheScreen();
  expect(screen.queryByTestId('booking.confirm')).toBeNull();
  bought = true;
  await fireEvent.press(screen.getByRole('button', { name: en('booking.err.view_plans') }));
  expect(await screen.findByText('Plans screen')).toBeOnTheScreen();

  await act(async () => navigationRef.goBack());
  expect(await screen.findByTestId('booking.confirm')).toBeOnTheScreen();
  expect(screen.queryByText(en('booking.err.no_plan'))).toBeNull();
  expect(api.requests.filter((r) => r.path.endsWith('/booking-preview'))).toHaveLength(2);
});

it('back does nothing while the charge consent is up; after Cancel it leaves', async () => {
  respond((request) => {
    if (request.path === '/check-ins/walk-in/preview') return walkInPreview();
    if (request.path.endsWith('/availability')) return slotsReply([START]);
    if (request.path.endsWith('/booking-preview')) return Reply.ok(FREE_PREVIEW);
    if (request.method === 'POST' && request.path === '/bookings') return consent(1_990);
    return Reply.problem(404, 'not_found');
  });
  await renderFlow({ venueId: VENUE_ID, activity: ACTIVITY, initialDate: '2030-03-14' });
  await fireEvent.press(await screen.findByTestId('booking.slot.10:00'));
  await fireEvent.press(screen.getByTestId('booking.timetable.next'));
  await fireEvent.press(await screen.findByTestId('booking.confirm'));

  expect(await screen.findByText(en('consent.title'))).toBeOnTheScreen();
  expect(screen.getByText('This is a premium venue: a surcharge of ISK 1,990 applies and is charged when you confirm.')).toBeOnTheScreen();
  expect(screen.getByText('Confirm and pay ISK 1,990')).toBeOnTheScreen();

  // The screen holds: a removal is refused while the consent is up.
  await act(async () => navigationRef.goBack());
  expect(screen.getByTestId('booking.flow')).toBeOnTheScreen();

  await fireEvent.press(screen.getByTestId('booking.consent.cancel'));
  await act(async () => {
    DeviceEventEmitter.emit('hardwareBackPress');
  });
  await waitFor(() => expect(screen.getByText('Venue page')).toBeOnTheScreen());
  expect(bookingPosts()).toHaveLength(1);
});

it('an accepted booking still being confirmed is never called booked', async () => {
  respond((request) => {
    if (request.path === '/check-ins/walk-in/preview') return walkInPreview();
    if (request.path.endsWith('/availability')) return slotsReply([START]);
    if (request.path.endsWith('/booking-preview')) return Reply.ok(FREE_PREVIEW);
    if (request.method === 'POST' && request.path === '/bookings') return Reply.ok({ ...CONFIRMED, status: 'pending' });
    return Reply.problem(404, 'not_found');
  });
  await renderFlow({ venueId: VENUE_ID, activity: ACTIVITY, initialDate: '2030-03-14' });
  await fireEvent.press(await screen.findByTestId('booking.slot.10:00'));
  await fireEvent.press(screen.getByTestId('booking.timetable.next'));
  await fireEvent.press(await screen.findByTestId('booking.confirm'));
  expect(await screen.findByText(en('booking.pending_title'))).toBeOnTheScreen();
  expect(screen.getByText(en('booking.pending_body'))).toBeOnTheScreen();
  expect(screen.queryByText(en('booking.confirmed_title'))).toBeNull();
});

it('a refusal alert offers its step: a declined card is Try again', async () => {
  let posts = 0;
  respond((request) => {
    if (request.path === '/check-ins/walk-in/preview') return walkInPreview();
    if (request.path.endsWith('/availability')) return slotsReply([START]);
    if (request.path.endsWith('/booking-preview')) return Reply.ok(FREE_PREVIEW);
    if (request.method === 'POST' && request.path === '/bookings') {
      posts += 1;
      return posts === 1 ? Reply.problem(402, 'card_declined') : Reply.ok(CONFIRMED);
    }
    return Reply.problem(404, 'not_found');
  });
  await renderFlow({ venueId: VENUE_ID, activity: ACTIVITY, initialDate: '2030-03-14' });
  await fireEvent.press(await screen.findByTestId('booking.slot.10:00'));
  await fireEvent.press(screen.getByTestId('booking.timetable.next'));
  await fireEvent.press(await screen.findByTestId('booking.confirm'));
  expect(await screen.findByText(en('booking.err.title'))).toBeOnTheScreen();
  expect(screen.getByText(en('refusal.payment_failed'))).toBeOnTheScreen();
  await fireEvent.press(screen.getByTestId('booking.error.cta'));
  expect(await screen.findByText(en('booking.confirmed_title'))).toBeOnTheScreen();
  const keys = bookingPosts().map((post) => post.headers['idempotency-key']);
  expect(keys[0]).not.toBe(keys[1]);
});

it("a first-build caller's { venueId, activityId } finds the activity and its provider in the walk-in preview", async () => {
  respond((request) => {
    if (request.path === '/check-ins/walk-in/preview') {
      return walkInPreview([{ id: ACTIVITY.id, name: 'Hress', provider: 'abler' }]);
    }
    return Reply.problem(404, 'not_found');
  });
  await renderFlow({ venueId: VENUE_ID, activityId: ACTIVITY.id });
  expect(await screen.findByText('Book Hress')).toBeOnTheScreen();
  expect(screen.getByText(en('booking.pick_start_date'))).toBeOnTheScreen();
  expect(screen.getByText(en('booking.two_weeks_hint'))).toBeOnTheScreen();
  expect(screen.getByText(en('booking.class'))).toBeOnTheScreen();
});
