/**
 * The class room in the booking flow (API 0.44.0): on the venue's own
 * timetable the room stands alone (the row has no venue name to follow), and
 * the confirm card gives it a labelled row, "Room: Salur 4" in English and
 * "Salur: 4" in Icelandic (never "Salur: Salur 4"). A class with no room shows
 * no room at all.
 */
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { act, fireEvent, render, screen, within } from '@testing-library/react-native';
import type { ComponentType } from 'react';
import { Text } from 'react-native';
import { Reply } from '@test/server';

import { stubApiClientPerTest } from '../../../api/testing';
import { lookup, setCurrentLanguage, type Lang } from '../../../i18n';
import { navigationRef } from '../../../navigation/navigationRef';
import BookingFlowScreen from '../BookingFlowScreen';
import { classesReply, FREE_PREVIEW, klass, plus, respond, START, VENUE_ID } from './bookingHarness';

// The Kenni sheet (a refusal step) draws icons, whose font loader needs expo-asset.
jest.mock('expo-asset', () => jest.requireActual('expo/node_modules/expo-asset'), { virtual: true });

stubApiClientPerTest();

const ABLER = { id: '0b7d4a62-3c9e-4f1a-a2d5-6e8f9c1b2a34', name: 'World Class Laugar & Pool', provider: 'abler' };
const Stack = createNativeStackNavigator();

function Start() {
  return <Text>Venue page</Text>;
}

async function renderFlow() {
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
      activity: ABLER,
      initialDate: '2030-03-14',
    });
  });
}

beforeEach(() => {
  respond((request) => {
    if (request.path === '/check-ins/walk-in/preview') return Reply.problem(404, 'not_found');
    if (request.path.endsWith('/classes')) {
      return classesReply([
        klass(101, START, { room: 'Salur 4' }),
        klass(102, plus(START, 3600), { room: null }),
        klass(103, plus(START, 7200), { room: 'Salur 2 Heitur' }),
      ]);
    }
    if (request.path.endsWith('/booking-preview')) return Reply.ok(FREE_PREVIEW);
    return Reply.problem(404, 'not_found');
  });
});

describe.each<[Lang, string, string]>([
  ['en', 'Room', 'Salur 4'],
  ['is', 'Salur', '4'],
])('in %s', (lang, label, value) => {
  beforeEach(() => setCurrentLanguage(lang));

  it('the timetable shows the room alone, and only for a class that has one', async () => {
    await renderFlow();
    const withRoom = await screen.findByTestId('booking.class.101');
    expect(within(withRoom).getByTestId('booking.class.101.room')).toHaveTextContent('Salur 4', { exact: true });
    // As sent: no label on the timetable, and never the venue's name.
    expect(within(withRoom).queryByText(/World Class/)).toBeNull();
    expect(withRoom.props.accessibilityLabel).toContain('Salur 4');
    expect(screen.queryByTestId('booking.class.102.room')).toBeNull();
    expect(screen.getByTestId('booking.class.103.room')).toHaveTextContent('Salur 2 Heitur', { exact: true });
  });

  it(`the confirm card has a "${label}" row reading "${value}"`, async () => {
    await renderFlow();
    await fireEvent.press(await screen.findByTestId('booking.class.101'));
    await fireEvent.press(screen.getByTestId('booking.timetable.next'));
    const row = await screen.findByTestId('booking.confirm.row.room');
    expect(within(row).getByText(lookup('booking.room.label', lang))).toBeOnTheScreen();
    expect(within(row).getByText(label)).toBeOnTheScreen();
    expect(within(row).getByText(value)).toBeOnTheScreen();
    expect(row.props.accessibilityLabel).toBe(`${label}, ${value}`);
    expect(screen.queryByText('Salur: Salur 4')).toBeNull();
  });

  it('a class with no room has no room row', async () => {
    await renderFlow();
    await fireEvent.press(await screen.findByTestId('booking.class.102'));
    await fireEvent.press(screen.getByTestId('booking.timetable.next'));
    await screen.findByTestId('booking.confirm.card');
    expect(screen.queryByTestId('booking.confirm.row.room')).toBeNull();
  });
});
