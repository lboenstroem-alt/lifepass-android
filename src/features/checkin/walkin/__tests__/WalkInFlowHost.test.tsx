/**
 * The walk-in host on screen: what each step draws and what each tap sends,
 * against the stub server. The sheets run on the UI kit's stand-in for the
 * bottom-sheet library (their pinned footers are drawn), the alerts are the
 * kit's Dialog, and CHECKIN-1's proof is stood in for by a view that prints
 * what it was handed.
 */
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { BackHandler, Text, View } from 'react-native';
import { api, Reply } from '@test/server';

import { bottomSheetMock } from '../../../../components/ui/testing/bottomSheetMock';
import { restoreTestFontScale, setTestFontScale } from '../../../../hooks/testing';
import { translate } from '../../../../i18n';
import { configureWalkInDeps, defaultWalkInDeps, walkInStore } from '../store';
import { useWalkInFlow, WalkInFlowHost } from '..';

import {
  ADVENTURER,
  BOOKING_ID,
  bodyOf,
  checkInJSON,
  posts,
  previewJSON,
  SKY_LAGOON_ID,
  SWIM_ID,
  walkInTestEnvironment,
  YOGA_ID,
} from './walkInHarness';

jest.mock('@gorhom/bottom-sheet', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('../../../../components/ui/testing/bottomSheetMock').bottomSheetModule,
);
jest.mock('expo-web-browser', () => ({ openAuthSessionAsync: jest.fn() }));
jest.mock('expo-asset', () => jest.requireActual('expo/node_modules/expo-asset'), { virtual: true });
// CHECKIN-1's proof, as a view that prints what the walk-in handed it.
jest.mock('../../proof/CheckInProofDisplay', () => {
  const { Text: RNText } = jest.requireActual<typeof import('react-native')>('react-native');
  return {
    __esModule: true,
    default: (props: Record<string, unknown>) => (
      <RNText testID="proof">
        {JSON.stringify({
          venueName: props.venueName,
          memberShortName: props.memberShortName,
          activityName: props.activityName,
          party: props.party,
          balance: props.balance,
          confirmationCode: props.confirmationCode,
        })}
      </RNText>
    ),
  };
});

walkInTestEnvironment();

beforeEach(() => {
  bottomSheetMock.reset();
  setTestFontScale(1);
  configureWalkInDeps(walkInStore, { dismissBeatMs: 0, refreshCredits: async () => undefined });
});
afterEach(async () => {
  // An async act: a synchronous one here leaves React mid-update, and the
  // next test's render draws nothing.
  await act(async () => walkInStore.getState().reset());
  configureWalkInDeps(walkInStore, defaultWalkInDeps);
  restoreTestFontScale();
});

const Stack = createNativeStackNavigator();

function Scan() {
  const flow = useWalkInFlow();
  return (
    <View style={{ flex: 1 }}>
      <Text testID="idle">{String(flow.isIdle)}</Text>
      <WalkInFlowHost />
    </View>
  );
}

async function renderScan() {
  await render(
    <NavigationContainer>
      <Stack.Navigator>
        <Stack.Screen name="ScanMain" component={Scan} />
      </Stack.Navigator>
    </NavigationContainer>,
  );
}

async function start(venueId = SKY_LAGOON_ID, fromLink = false) {
  await act(async () => {
    await walkInStore.getState().startWalkIn(venueId, { fromLink });
  });
}

/** Lets the flow's requests and zero-length waits finish. */
async function settle() {
  await act(async () => {
    for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function press(testID: string) {
  await fireEvent.press(screen.getByTestId(testID));
  await settle();
}

function proof(): Record<string, unknown> {
  return JSON.parse(String(screen.getByTestId('proof').props.children)) as Record<string, unknown>;
}

it('a free camera read checks in and shows the proof; Done clears it', async () => {
  api.on('GET', '/check-ins/walk-in/preview', Reply.ok(previewJSON()));
  api.on('POST', '/check-ins/walk-in', Reply.ok(checkInJSON({ memberShortName: 'Lucas B.', memberName: 'Lucas Bönström' }), 201));
  await renderScan();
  expect(screen.getByTestId('idle').props.children).toBe('true');

  await start();

  expect(proof()).toMatchObject({ venueName: 'Sky Lagoon', memberShortName: 'Lucas B.', confirmationCode: null });
  expect(JSON.stringify(proof())).not.toContain('Bönström'); // the full name is never on the proof
  expect(screen.getByTestId('idle').props.children).toBe('false');

  await press('walkin.success.done');
  expect(screen.queryByTestId('proof')).toBeNull();
  expect(screen.getByTestId('idle').props.children).toBe('true');
});

describe('the consent alert', () => {
  it('reads the charge before anything is sent; accept re-sends with consent', async () => {
    api.on('GET', '/check-ins/walk-in/preview', Reply.ok(previewJSON({ charge: { kind: 'surcharge', amountIsk: 1500 } })));
    api.on('POST', '/check-ins/walk-in', Reply.ok(checkInJSON(), 201));
    await renderScan();
    await start();

    expect(screen.getByText(translate('consent.title', 'en'))).toBeOnTheScreen();
    expect(screen.getByText(translate('consent.surcharge', 'en', { price: 'ISK 1,500' }))).toBeOnTheScreen();
    expect(posts('/check-ins/walk-in')).toHaveLength(0);

    await press('walkin.consent.accept');
    expect(bodyOf(posts('/check-ins/walk-in')[0])).toMatchObject({ acceptCharge: true, acceptedChargeAmountIsk: 1500 });
    expect(screen.getByTestId('proof')).toBeOnTheScreen();
  });

  it('cancel declines: nothing is sent and the flow is idle', async () => {
    api.on('GET', '/check-ins/walk-in/preview', Reply.ok(previewJSON({ charge: { kind: 'topup', amountIsk: 1990, reason: 'monthly_exhausted' } })));
    await renderScan();
    await start();
    expect(screen.getByText(translate('consent.dropin_title', 'en'))).toBeOnTheScreen();
    expect(screen.getByText(translate('consent.dropin_button', 'en', { price: 'ISK 1,990' }))).toBeOnTheScreen();

    await press('walkin.consent.cancel');
    expect(posts('/check-ins/walk-in')).toHaveLength(0);
    expect(walkInStore.getState().showChargeConsent).toBe(false);
    expect(screen.getByTestId('idle').props.children).toBe('true');
  });
});

describe('the own-visit step', () => {
  it('says what covers the visit; "Check in, no charge" checks in once, solo', async () => {
    api.on('GET', '/check-ins/walk-in/preview', Reply.ok(previewJSON({
      coveredBy: ADVENTURER,
      guestBands: [{ band: 'adult', rangeLabel: null, unitIsk: 2650 }],
    })));
    api.on('POST', '/check-ins/walk-in', Reply.ok(checkInJSON({ coveredBy: ADVENTURER }), 201));
    await renderScan();
    await start();

    expect(screen.getByText('Covered by your Adventurer pass: uses 1 of 6 visits (5 left after)')).toBeOnTheScreen();
    expect(screen.getByText('Sky Lagoon')).toBeOnTheScreen();
    expect(screen.queryByText(/2,650/)).toBeNull(); // no guest price on this step
    expect(screen.getByTestId('walkin.ownVisit.guests').props.accessibilityHint).toBe(translate('checkin.cover.guest_hint', 'en'));

    // A second tap while the step closes (the button is still on screen).
    const checkIn = screen.getByTestId('walkin.ownVisit.checkIn');
    await fireEvent.press(checkIn);
    await fireEvent.press(checkIn);
    await settle();
    expect(posts('/check-ins/walk-in')).toHaveLength(1);
    expect(bodyOf(posts('/check-ins/walk-in')[0])).toEqual({ venueId: SKY_LAGOON_ID });
    expect(proof().balance).toBe('5 of 6 visits left on your Adventurer pass');
  });

  it('the close button sends nothing', async () => {
    api.on('GET', '/check-ins/walk-in/preview', Reply.ok(previewJSON({ guestBands: [{ band: 'adult', unitIsk: 2650 }] })));
    await renderScan();
    await start();
    expect(screen.getByText(translate('checkin.cover.free', 'en'))).toBeOnTheScreen();
    await press('walkin.ownVisit.close');
    expect(posts('/check-ins/walk-in')).toHaveLength(0);
    expect(walkInStore.getState().showOwnVisitConfirm).toBe(false);
  });

  it('a link shows its note on the step', async () => {
    api.on('GET', '/check-ins/walk-in/preview', Reply.ok(previewJSON({ guestBands: [{ band: 'adult', unitIsk: 2650 }] })));
    await renderScan();
    await start(SKY_LAGOON_ID, true);
    expect(screen.getByText(translate('checkin.link.confirm_body', 'en'))).toBeOnTheScreen();
  });

  it('opens full height at the accessibility text sizes', async () => {
    setTestFontScale(2);
    api.on('GET', '/check-ins/walk-in/preview', Reply.ok(previewJSON({ guestBands: [{ band: 'adult', unitIsk: 2650 }] })));
    await renderScan();
    await start();
    expect(bottomSheetMock.latest()?.snapPoints).toEqual(['100%']);
  });
});

describe('the guest sheet', () => {
  it('prices the guests, caps the party at nine, and names the own price apart', async () => {
    api.on('GET', '/check-ins/walk-in/preview', Reply.ok(previewJSON({
      charge: { kind: 'topup', amountIsk: 1990, reason: 'monthly_exhausted' },
      guestBands: [
        { band: 'adult', rangeLabel: null, unitIsk: 2650 },
        { band: 'child', rangeLabel: '6–15', unitIsk: 1350 },
        { band: 'infant', rangeLabel: '0–5', unitIsk: 0 },
      ],
    })));
    await renderScan();
    await start();

    expect(screen.getByText(translate('checkin.guests.title', 'en'))).toBeOnTheScreen();
    expect(screen.getByTestId('walkin.guests.whosePrice')).toHaveTextContent(
      'Your visit: ISK 1,990. Guest prices come on top of the price for your own visit.',
    );
    expect(screen.getByText('Child (6–15)')).toBeOnTheScreen();
    expect(screen.getByText('ISK 1,350 per guest')).toBeOnTheScreen();
    expect(screen.getByText(translate('checkin.guests.free', 'en'))).toBeOnTheScreen();
    expect(screen.getByLabelText('Add a guest: Child (6–15)')).toBeOnTheScreen();
    expect(screen.getByLabelText('Remove a guest: Adult guest').props.accessibilityState).toMatchObject({ disabled: true });
    // No guests: the button says Just me, and there is no total.
    expect(screen.getByTestId('walkin.guests.continue')).toHaveTextContent(translate('checkin.guests.just_me', 'en'));
    expect(screen.queryByTestId('walkin.guests.total')).toBeNull();

    await press('walkin.guests.add.adult');
    await press('walkin.guests.add.child');
    expect(screen.getByTestId('walkin.guests.total')).toHaveTextContent(/ISK 4,000/);
    expect(screen.getByTestId('walkin.guests.continue')).toHaveTextContent(translate('checkin.guests.continue', 'en'));
    for (let i = 0; i < 10; i += 1) await press('walkin.guests.add.infant');
    expect(screen.getByTestId('walkin.guests.count.infant')).toHaveTextContent('7');
    expect(screen.getByLabelText('Add a guest: Adult guest').props.accessibilityState).toMatchObject({ disabled: true });

    await press('walkin.guests.continue');
    expect(walkInStore.getState().showChargeConsent).toBe(true);
    expect(walkInStore.getState().pendingOffer?.amountIsk).toBe(1990 + 2650 + 1350);
    expect(posts('/check-ins/walk-in')).toHaveLength(0);
  });

  it('a free own visit says the prices are for guests only', async () => {
    api.on('GET', '/check-ins/walk-in/preview', Reply.ok(previewJSON({ guestBands: [{ band: 'adult', unitIsk: 2650 }] })));
    await renderScan();
    await start();
    await press('walkin.ownVisit.guests');
    expect(screen.getByTestId('walkin.guests.whosePrice')).toHaveTextContent(translate('checkin.guests.own_free', 'en'));
  });

  it('hardware back ends the attempt with nothing sent', async () => {
    const listeners: (() => boolean | null | undefined)[] = [];
    jest.spyOn(BackHandler, 'addEventListener').mockImplementation((_event, handler) => {
      listeners.push(handler);
      return { remove: () => listeners.splice(listeners.indexOf(handler), 1) };
    });
    api.on('GET', '/check-ins/walk-in/preview', Reply.ok(previewJSON({
      charge: { kind: 'surcharge', amountIsk: 1500 },
      guestBands: [{ band: 'adult', unitIsk: 2650 }],
    })));
    await renderScan();
    await start();
    expect(walkInStore.getState().showGuestPicker).toBe(true);
    await act(async () => {
      listeners.at(-1)?.();
    });
    expect(walkInStore.getState().showGuestPicker).toBe(false);
    expect(posts('/check-ins/walk-in')).toHaveLength(0);
    expect(screen.getByTestId('idle').props.children).toBe('true');
  });
});

describe('the attendance choice', () => {
  function booked(withinWindow: boolean, allowed = true) {
    api.on('GET', '/check-ins/walk-in/preview', Reply.ok(previewJSON({
      allowed,
      blockingReason: allowed ? null : 'walk_ins_not_allowed',
      attendableBooking: { bookingId: BOOKING_ID, activityName: 'Spinning', startsAt: '2026-10-17T18:00:00.000Z', withinWindow },
    })));
    api.on('POST', '/check-ins/walk-in', Reply.ok(checkInJSON(), 201));
  }

  it('within the window, "Mark me as present" leads and the regular visit is the small link', async () => {
    booked(true);
    await renderScan();
    await start();
    expect(screen.getByText('Spinning · 18:00')).toBeOnTheScreen();
    expect(screen.getByText(translate('checkin.attend.free_note', 'en'))).toBeOnTheScreen();
    expect(screen.getByTestId('walkin.attend.present')).toHaveTextContent(translate('checkin.attend.cta', 'en'));
    expect(screen.getByTestId('walkin.attend.walkIn')).toHaveTextContent(translate('checkin.attend.walk_in_instead', 'en'));

    await press('walkin.attend.present');
    expect(bodyOf(posts('/check-ins/walk-in')[0])).toEqual({ venueId: SKY_LAGOON_ID, bookingAction: 'attend' });
  });

  it('later today, the regular visit leads', async () => {
    booked(false);
    await renderScan();
    await start();
    expect(screen.getByText(translate('checkin.attend.later_note', 'en'))).toBeOnTheScreen();
    expect(screen.getByTestId('walkin.attend.walkIn')).toHaveTextContent(translate('checkin.attend.walk_in_primary', 'en'));
    expect(screen.getByTestId('walkin.attend.present')).toHaveTextContent(translate('checkin.attend.attend_secondary', 'en'));
  });

  it('where walk-ins are blocked, attendance is the only action', async () => {
    booked(false, false);
    await renderScan();
    await start();
    expect(screen.getByTestId('walkin.attend.present')).toHaveTextContent(translate('checkin.attend.cta', 'en'));
    expect(screen.queryByTestId('walkin.attend.walkIn')).toBeNull();
  });
});

it('the activity picker lists the activities and confirms the pick', async () => {
  api.on('GET', '/check-ins/walk-in/preview', Reply.ok(previewJSON({
    activities: [{ id: YOGA_ID, name: 'Yoga' }, { id: SWIM_ID, name: 'Swim' }],
  })));
  api.on('POST', '/check-ins/walk-in', Reply.ok(checkInJSON(), 201));
  await renderScan();
  await start();
  expect(screen.getByText(translate('checkin.select_activity_title', 'en'))).toBeOnTheScreen();
  expect(screen.getByText('Select an activity at Sky Lagoon')).toBeOnTheScreen();
  await press(`walkin.activity.${SWIM_ID}`);
  expect(bodyOf(posts('/check-ins/walk-in')[0]).activityId).toBe(SWIM_ID);
});

describe('the link confirm', () => {
  it('names the venue and what covers the visit; nothing is recorded without the tap', async () => {
    api.on('GET', '/check-ins/walk-in/preview', Reply.ok(previewJSON({ coveredBy: ADVENTURER })));
    api.on('POST', '/check-ins/walk-in', Reply.ok(checkInJSON(), 201));
    await renderScan();
    await start(SKY_LAGOON_ID, true);
    expect(screen.getByText('Check in at Sky Lagoon?')).toBeOnTheScreen();
    expect(
      screen.getByText(
        `Covered by your Adventurer pass: uses 1 of 6 visits (5 left after)\n\n${translate('checkin.link.confirm_body', 'en')}`,
      ),
    ).toBeOnTheScreen();
    expect(posts('/check-ins/walk-in')).toHaveLength(0);
    await press('walkin.link.confirm');
    expect(posts('/check-ins/walk-in')).toHaveLength(1);
  });
});

describe('a refusal', () => {
  it('shows the member\'s words with its step; Try again scans the venue again', async () => {
    api.on('GET', '/check-ins/walk-in/preview', Reply.ok(previewJSON()));
    api.on('POST', '/check-ins/walk-in', Reply.ok(checkInJSON(), 201));
    api.once('POST', '/check-ins/walk-in', Reply.problem(429, 'rate_limited'));
    await renderScan();
    await start();
    expect(screen.getByText(translate('checkin.err.rate_limited', 'en'))).toBeOnTheScreen();
    expect(screen.getByTestId('walkin.error.step')).toHaveTextContent(translate('refusal.cta.try_again', 'en'));

    await press('walkin.error.step');
    await waitFor(() => expect(posts('/check-ins/walk-in')).toHaveLength(2));
    await waitFor(() => expect(screen.getByTestId('proof')).toBeOnTheScreen());
  });

  it('a step the Scan tab cannot take is not offered: OK only', async () => {
    api.on('GET', '/check-ins/walk-in/preview', Reply.ok(previewJSON()));
    api.on('POST', '/check-ins/walk-in', Reply.problem(409, 'booking_full_brand_new'));
    await renderScan();
    await start();
    expect(screen.getByText(translate('error.refusal_fallback', 'en'))).toBeOnTheScreen();
    expect(screen.queryByTestId('walkin.error.step')).toBeNull();
    await press('walkin.error.ok');
    expect(screen.getByTestId('idle').props.children).toBe('true');
  });
});

function TwoHosts() {
  return (
    <View>
      <WalkInFlowHost />
      <WalkInFlowHost />
    </View>
  );
}

it('only the newest host draws the flow', async () => {
  api.on('GET', '/check-ins/walk-in/preview', Reply.ok(previewJSON({ charge: { kind: 'surcharge', amountIsk: 1500 } })));
  await render(
    <NavigationContainer>
      <Stack.Navigator>
        <Stack.Screen name="ScanMain" component={TwoHosts} />
      </Stack.Navigator>
    </NavigationContainer>,
  );
  await start();
  expect(screen.getAllByText(translate('consent.title', 'en'))).toHaveLength(1);
});
