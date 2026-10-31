/**
 * The party section and the rung picker inside the real booking flow (iOS
 * BookingFlowView's timetable and confirm steps): what a member taps, what
 * the phone then asks and sends, and what the disclosure and the consent
 * say. Only a Bókun slot activity shows the party; only a slot's preview
 * that offers two rungs shows the picker.
 */
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { act, fireEvent, render, screen, within } from '@testing-library/react-native';
import type { ComponentType } from 'react';
import { Text } from 'react-native';
import { api, Reply, type StubReply, type StubRequest } from '@test/server';

import { stubApiClientPerTest } from '../../../../api/testing';
import { lookup, setCurrentLanguage } from '../../../../i18n';
import { navigationRef } from '../../../../navigation/navigationRef';
import BookingFlowScreen from '../../BookingFlowScreen';
import {
  bodyOf,
  bookingPosts,
  classesReply,
  CONFIRMED,
  consent,
  FREE_PREVIEW,
  iso,
  klass,
  plus,
  respond,
  RUNG_CHOICE_PREVIEW,
  START,
  VENUE_ID,
} from '../../__tests__/bookingHarness';

// The Kenni sheet (a refusal step) draws icons, whose font loader needs expo-asset.
jest.mock('expo-asset', () => jest.requireActual('expo/node_modules/expo-asset'), { virtual: true });

stubApiClientPerTest();

const en = (key: string) => lookup(key, 'en');
const fill = (key: string, params: Record<string, string>) =>
  Object.entries(params).reduce((text, [name, value]) => text.split(`{${name}}`).join(value), en(key));

const LAGOON = { id: '0b7d4a62-3c9e-4f1a-a2d5-6e8f9c1b2a34', name: 'Sky Lagoon', provider: 'bokun' };
const DAY = '2030-03-14';
const BANDS = [
  { band: 'adult', rangeLabel: '16+', priceIsk: null },
  { band: 'child', rangeLabel: '6-15', priceIsk: 3_000 },
];
/** The printed count is hidden from TalkBack (the adjustable element says it). */
const HIDDEN = { includeHiddenElements: true } as const;

const Stack = createNativeStackNavigator();

function Start() {
  return <Text>Venue page</Text>;
}

async function renderFlow(activity: Record<string, unknown>) {
  await render(
    <NavigationContainer ref={navigationRef}>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        <Stack.Screen name="Start" component={Start} />
        <Stack.Screen name="BookingFlow" component={BookingFlowScreen as unknown as ComponentType} />
      </Stack.Navigator>
    </NavigationContainer>,
  );
  await act(async () => {
    (navigationRef.navigate as unknown as (name: string, params?: object) => void)('BookingFlow', {
      venueId: VENUE_ID,
      activity,
      initialDate: DAY,
    });
  });
}

function walkInPreview(): StubReply {
  return Reply.ok({
    venue: { id: VENUE_ID, slug: 'sky-lagoon', name: 'Sky Lagoon' },
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

function lagoon(options: {
  ageBands?: unknown[];
  capacity?: (participants: number) => number;
  preview?: (request: StubRequest) => StubReply;
  create?: (request: StubRequest) => StubReply;
}): void {
  respond((request) => {
    if (request.path === '/check-ins/walk-in/preview') return walkInPreview();
    if (request.path.endsWith('/availability')) {
      const participants = Number(request.query.participants ?? '1');
      return Reply.ok({
        activityId: LAGOON.id,
        provider: 'bokun',
        slots: [START, plus(START, 3600)].map((start) => ({
          startsAt: iso(start),
          endsAt: iso(plus(start, 7200)),
          available: true,
          remainingCapacity: options.capacity ? options.capacity(participants) : 8,
        })),
        ageBands: options.ageBands ?? BANDS,
        fetchedAt: iso(new Date()),
      });
    }
    if (request.path.endsWith('/booking-preview')) return options.preview?.(request) ?? Reply.ok(FREE_PREVIEW);
    if (request.method === 'POST' && request.path === '/bookings') return options.create?.(request) ?? Reply.ok(CONFIRMED);
    return Reply.problem(404, 'not_found');
  });
}

const availabilityReads = () => api.requests.filter((r) => r.path.endsWith('/availability'));
const previewReads = () => api.requests.filter((r) => r.path.endsWith('/booking-preview'));
const count = () => screen.getByTestId('booking.party.count', HIDDEN);

beforeEach(() => setCurrentLanguage('en'));

it('the stepper re-reads the day for the whole party, keeps the time that still fits, and the booking carries everyone', async () => {
  lagoon({ ageBands: [BANDS[0]] });
  await renderFlow(LAGOON);
  await fireEvent.press(await screen.findByTestId('booking.slot.10:00'));
  expect(count()).toHaveTextContent('1');
  expect(availabilityReads().at(-1)!.query.participants).toBe('1');

  await fireEvent.press(screen.getByTestId('booking.party.more'));
  await fireEvent.press(await screen.findByTestId('booking.party.more'));
  expect(await screen.findByText('3', HIDDEN)).toBeOnTheScreen();
  expect(availabilityReads().map((read) => read.query.participants)).toEqual(['1', '2', '3']);
  // One band on sale: no age rows.
  expect(screen.queryByText(en('booking.guest_ages_label'))).toBeNull();
  // The time still seats three: Next is still on.
  expect(await screen.findByTestId('booking.timetable.next')).toBeEnabled();

  await fireEvent.press(screen.getByTestId('booking.timetable.next'));
  await fireEvent.press(await screen.findByTestId('booking.confirm'));
  expect(await screen.findByText(en('booking.confirmed_title'))).toBeOnTheScreen();
  expect(previewReads().at(-1)!.query).toMatchObject({ participants: '3' });
  expect(previewReads().at(-1)!.query).not.toHaveProperty('guestAgeBands');
  const body = bodyOf(bookingPosts()[0]);
  expect(body.participants).toBe(3);
  expect(body).not.toHaveProperty('guestAgeBands');
});

it('a time that cannot seat the bigger party is let go, and Next waits for another', async () => {
  lagoon({ capacity: () => 2 });
  await renderFlow(LAGOON);
  await fireEvent.press(await screen.findByTestId('booking.slot.10:00'));
  await fireEvent.press(screen.getByTestId('booking.party.more'));
  expect(await screen.findByTestId('booking.timetable.next')).toBeEnabled();
  await fireEvent.press(screen.getByTestId('booking.party.more'));
  expect(await screen.findByText('3', HIDDEN)).toBeOnTheScreen();
  expect(await screen.findByTestId('booking.timetable.next')).toBeDisabled();
});

it('a child guest is picked by menu, priced and booked as a child; the disclosure and the consent itemise the party', async () => {
  const breakdown = {
    participants: 3,
    ownAmountIsk: 4_900,
    guestUnitIsk: 3_950,
    guestCount: 2,
    guests: [
      { band: 'adult', count: 1, unitIsk: 4_900 },
      { band: 'child', count: 1, unitIsk: 3_000 },
    ],
  };
  let posts = 0;
  lagoon({
    preview: () =>
      Reply.ok({
        kind: 'surcharge',
        surchargeReason: 'premium_subscriber_visit',
        priceIsk: 12_800,
        remainingMonthly: 3,
        isLastBeforeTopUp: false,
        breakdown,
      }),
    create: () => {
      posts += 1;
      return posts === 1 ? consent(12_800) : Reply.ok(CONFIRMED);
    },
  });
  await renderFlow(LAGOON);
  await fireEvent.press(await screen.findByTestId('booking.slot.10:00'));
  await fireEvent.press(screen.getByTestId('booking.party.more'));
  await fireEvent.press(await screen.findByTestId('booking.party.more'));

  // One row per guest, from Person 2, each an adult until picked.
  expect(await screen.findByRole('button', { name: 'Person 3' })).toHaveAccessibilityValue({ text: 'Adult (16+)' });
  expect(screen.getByText(en('booking.guest_ages_note'))).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: 'Person 3' }));
  await fireEvent.press(screen.getByRole('menuitem', { name: 'Child (6-15)' }));
  expect(screen.getByRole('button', { name: 'Person 3' })).toHaveAccessibilityValue({ text: 'Child (6-15)' });
  expect(screen.getByRole('button', { name: 'Person 2' })).toHaveAccessibilityValue({ text: 'Adult (16+)' });

  await fireEvent.press(await screen.findByTestId('booking.timetable.next'));
  const own = fill('consent.group_own', { price: 'ISK 4,900' });
  const disclosure = [
    own,
    '1 × Adult at ISK 4,900 each.',
    '1 × Child at ISK 3,000 each.',
    fill('consent.group_total', { price: 'ISK 12,800' }),
  ].join('\n');
  expect(await screen.findByText(disclosure)).toBeOnTheScreen();
  expect(previewReads().at(-1)!.query).toMatchObject({ participants: '3', guestAgeBands: 'adult,child' });

  await fireEvent.press(screen.getByTestId('booking.confirm'));
  // The consent restates the same composition at the offer's total.
  const consentDialog = await screen.findByTestId('booking.dialog.consent');
  expect(within(consentDialog).getByText(disclosure)).toBeOnTheScreen();
  expect(within(consentDialog).getByText(fill('consent.pay_button', { price: 'ISK 12,800' }))).toBeOnTheScreen();
  await fireEvent.press(screen.getByTestId('booking.consent.accept'));
  expect(await screen.findByText(en('booking.confirmed_title'))).toBeOnTheScreen();

  const [first, second] = bookingPosts();
  expect(bodyOf(first)).toMatchObject({ participants: 3, guestAgeBands: ['adult', 'child'] });
  expect(bodyOf(second)).toMatchObject({
    participants: 3,
    guestAgeBands: ['adult', 'child'],
    acceptCharge: true,
    acceptedChargeAmountIsk: 12_800,
  });
  expect(first.headers['idempotency-key']).toBe(second.headers['idempotency-key']);
});

it('a first-party slot and a class show no party', async () => {
  lagoon({});
  await renderFlow({ ...LAGOON, name: 'Spin', provider: 'internal' });
  expect(await screen.findByTestId('booking.slot.10:00')).toBeOnTheScreen();
  expect(screen.queryByTestId('booking.party')).toBeNull();
  await act(async () => navigationRef.goBack());

  respond((request) => {
    if (request.path === '/check-ins/walk-in/preview') return walkInPreview();
    if (request.path.endsWith('/classes')) return classesReply([klass(4242, START)]);
    return Reply.problem(404, 'not_found');
  });
  await act(async () => {
    (navigationRef.navigate as unknown as (name: string, params?: object) => void)('BookingFlow', {
      venueId: VENUE_ID,
      activity: { ...LAGOON, name: 'Hress', provider: 'abler' },
      initialDate: DAY,
    });
  });
  expect(await screen.findByTestId('booking.class.4242')).toBeOnTheScreen();
  expect(screen.queryByTestId('booking.party')).toBeNull();
});

describe('the rung picker', () => {
  /** The preview mirrors the rung asked for at its top level, as the server does. */
  function rungPreview(request: StubRequest): StubReply {
    const keep = request.query.visitChoice === 'keep_visit';
    return Reply.ok({
      ...RUNG_CHOICE_PREVIEW,
      surchargeReason: keep ? 'premium_visit_kept' : 'premium_subscriber_visit',
      priceIsk: keep ? 4_900 : 1_500,
      visitChoice: { ...RUNG_CHOICE_PREVIEW.visitChoice, selected: keep ? 'keep_visit' : 'spend_visit' },
    });
  }

  const spendRow = () => screen.getByTestId('booking.visit_choice.spend_visit');
  const keepRow = () => screen.getByTestId('booking.visit_choice.keep_visit');

  async function onConfirm(create?: (request: StubRequest) => StubReply) {
    lagoon({ preview: rungPreview, create });
    await renderFlow(LAGOON);
    await fireEvent.press(await screen.findByTestId('booking.slot.10:00'));
    await fireEvent.press(screen.getByTestId('booking.timetable.next'));
    expect(await screen.findByText(en('consent.visit_choice_title'))).toBeOnTheScreen();
  }

  it('picking "keep my visit" re-previews with it; the disclosure, the consent and the booking follow it', async () => {
    let posts = 0;
    await onConfirm(() => {
      posts += 1;
      return posts === 1 ? consent(4_900) : Reply.ok(CONFIRMED);
    });
    expect(spendRow()).toBeChecked();
    expect(within(spendRow()).getByText('ISK 1,500')).toBeOnTheScreen();
    expect(within(keepRow()).getByText('ISK 4,900')).toBeOnTheScreen();
    expect(screen.getByText(fill('consent.surcharge_premium_subscriber_visit', { price: 'ISK 1,500' }))).toBeOnTheScreen();

    await fireEvent.press(keepRow());
    const kept = fill('consent.surcharge_premium_visit_kept', { price: 'ISK 4,900' });
    expect(await screen.findByText(kept)).toBeOnTheScreen();
    expect(keepRow()).toBeChecked();
    expect(spendRow()).not.toBeChecked();
    expect(previewReads().at(-1)!.query.visitChoice).toBe('keep_visit');

    await fireEvent.press(screen.getByTestId('booking.confirm'));
    const consentDialog = await screen.findByTestId('booking.dialog.consent');
    expect(within(consentDialog).getByText(kept)).toBeOnTheScreen();
    expect(within(consentDialog).getByText(fill('consent.pay_button', { price: 'ISK 4,900' }))).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('booking.consent.accept'));
    expect(await screen.findByText(en('booking.confirmed_title'))).toBeOnTheScreen();
    expect(bookingPosts().map((post) => bodyOf(post).visitChoice)).toEqual(['keep_visit', 'keep_visit']);
  });

  it('a moved price drops the picked rung: the price is read once more at the default, and Confirm asks again', async () => {
    let posts = 0;
    await onConfirm(() => {
      posts += 1;
      return posts === 1 ? Reply.problem(409, 'visit_choice_unavailable') : Reply.ok(CONFIRMED);
    });
    await fireEvent.press(keepRow());
    expect(await screen.findByText(fill('consent.surcharge_premium_visit_kept', { price: 'ISK 4,900' }))).toBeOnTheScreen();
    const reads = previewReads().length;

    await fireEvent.press(screen.getByTestId('booking.confirm'));
    expect(await screen.findByText(en('refusal.price_changed'))).toBeOnTheScreen();
    expect(previewReads()).toHaveLength(reads + 1);
    expect(previewReads().at(-1)!.query.visitChoice).toBeUndefined();
    await fireEvent.press(screen.getByTestId('booking.error.ok'));
    expect(await screen.findByText(fill('consent.surcharge_premium_subscriber_visit', { price: 'ISK 1,500' }))).toBeOnTheScreen();
    expect(spendRow()).toBeChecked();

    await fireEvent.press(screen.getByTestId('booking.confirm'));
    expect(await screen.findByText(en('booking.confirmed_title'))).toBeOnTheScreen();
    expect(bodyOf(bookingPosts()[0]).visitChoice).toBe('keep_visit');
    expect(bodyOf(bookingPosts()[1])).not.toHaveProperty('visitChoice');
  });
});
