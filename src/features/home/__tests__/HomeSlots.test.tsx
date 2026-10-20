/**
 * What Home hands the slots other packages fill (plan 3.0.3): the Today row
 * (PLAN-2) knows the booking the upcoming card shows, sends its taps to Plan
 * and sits in iOS's spacing, which Home owns; the Outside card (ATTR-1) opens
 * a sight on Home's stack or Explore's map with the sights on, and reads
 * again with Home through Home's published door; the proof banner
 * (CHECKIN-1) gets the check-in the profile read carried. Each slot is
 * replaced here by a stand-in that exposes what Home passed.
 */
import { act, fireEvent, screen } from '@testing-library/react-native';
import { api, Reply } from '@test/server';
import { StyleSheet } from 'react-native';

import { stubApiClientPerTest } from '../../../api/testing';
import { restoreTestFontScale, setTestFontScale } from '../../../hooks/testing';
import { useIntentStore } from '../../../stores/intentStore';
import { bookingRow, freshHome, homeNavigation, leaveHome, profileJSON, renderHome, settle } from './homeHarness';
import { REYKJAVIK, testVenue, venuePage } from './homeVenues';

jest.mock('expo-asset', () => jest.requireActual('expo/node_modules/expo-asset'), { virtual: true });

/** True while the Today row stand-in renders nothing, as the row does with no plan. */
let mockTodayHidden = false;
/* eslint-disable @typescript-eslint/no-require-imports */
jest.mock('../../plan/HomeTodayRow', () => {
  const { Pressable: MockPressable, Text: MockText, View: MockView } = require('react-native');
  return {
    __esModule: true,
    default: (props: { upcomingBookingId: string | null; onOpenPlan: () => void; onStart: (id: string) => void }) =>
      mockTodayHidden ? null : (
        <MockView testID="today.row">
          <MockText testID="today.booking">{String(props.upcomingBookingId)}</MockText>
          <MockPressable testID="today.open" onPress={props.onOpenPlan} />
          <MockPressable testID="today.start" onPress={() => props.onStart('session-7')} />
        </MockView>
      ),
  };
});
jest.mock('../../attractions/HomeOutsideCard', () => {
  const { Pressable: MockPressable, Text: MockText, View: MockView } = require('react-native');
  const { useState: mockUseState } = require('react');
  // Through Home's published door (../index.ts), as ATTR-1's card would.
  const { useOnHomeRead: mockUseOnHomeRead } = require('..');
  return {
    __esModule: true,
    default: function MockOutside(props: { onOpenSight: (slug: string) => void; onSeeAllOnMap: () => void }) {
      // How many times a card that follows Home's reads loads its picks.
      const [loads, setLoads] = mockUseState(0);
      mockUseOnHomeRead(() => setLoads((count: number) => count + 1));
      return (
        <MockView>
          <MockText testID="outside.loads">{String(loads)}</MockText>
          <MockPressable testID="outside.sight" onPress={() => props.onOpenSight('seljalandsfoss')} />
          <MockPressable testID="outside.map" onPress={props.onSeeAllOnMap} />
        </MockView>
      );
    },
  };
});
jest.mock('../../../components/CheckInProofBanner', () => {
  const { Text: MockText } = require('react-native');
  return {
    __esModule: true,
    default: ({ checkIn }: { checkIn: { venue: { name: string }; memberName: string | null } }) => (
      <MockText testID="proof.banner">{`${checkIn.venue.name} / ${checkIn.memberName}`}</MockText>
    ),
  };
});
/* eslint-enable @typescript-eslint/no-require-imports */

stubApiClientPerTest();
jest.setTimeout(30_000);

beforeEach(() => {
  setTestFontScale(1);
  mockTodayHidden = false;
});
afterEach(() => {
  restoreTestFontScale();
  leaveHome();
});

function serve(profile: Record<string, unknown> = profileJSON(), bookings: unknown[] = []) {
  api.on('GET', '/venues', Reply.ok(venuePage([testVenue(1, 'Sundhöllin', { at: REYKJAVIK })])));
  api.on('GET', '/bookings', Reply.ok({ data: bookings, pagination: { nextCursor: null, hasMore: false, limit: 100 } }));
  api.on('GET', '/profile', Reply.ok(profile));
}

it('the Today row knows the booking the card shows; its taps go to Plan, Start with the session parked', async () => {
  freshHome();
  serve(profileJSON(), [bookingRow('b-1', new Date(Date.now() + 2 * 864e5).toISOString(), 'Sundhöllin')]);
  await renderHome();
  expect(screen.getByTestId('today.booking')).toHaveTextContent('b-1');

  await fireEvent.press(screen.getByTestId('today.open'));
  expect(useIntentStore.getState().pendingTab).toBe('Plan');
  useIntentStore.getState().clearPendingTab();

  await fireEvent.press(screen.getByTestId('today.start'));
  expect(useIntentStore.getState().pendingTab).toBe('Plan');
  expect(useIntentStore.getState().takePlanAction()?.action).toEqual({ kind: 'startWorkout', sessionId: 'session-7' });
});

it('the Outside card opens a sight on Home’s stack, and "See all on the map" parks the sights for Explore', async () => {
  freshHome();
  serve();
  await renderHome();
  await fireEvent.press(screen.getByTestId('outside.map'));
  expect(useIntentStore.getState().pendingExploreSights).toBe(true);
  expect(useIntentStore.getState().pendingTab).toBe('Explore');

  await fireEvent.press(screen.getByTestId('outside.sight'));
  await settle();
  expect(screen.getByTestId('params.AttractionDetail')).toHaveTextContent(JSON.stringify({ slug: 'seljalandsfoss' }));
});

it('the Outside card loads once per Home read: at the first focus, every focus after, every pull to refresh (iOS loadOutsideMarkers)', async () => {
  freshHome();
  serve();
  await renderHome();
  // Read while Home is out of sight too (another tab is showing).
  const loads = () => Number(screen.getByTestId('outside.loads', { includeHiddenElements: true }).props.children);
  // Once on the first focus, not once more for mounting.
  expect(loads()).toBe(1);

  // Away to another tab and back: Home reads again, so does the card.
  await act(async () => homeNavigation.navigate('Explore'));
  await settle();
  expect(loads()).toBe(1);
  await act(async () => homeNavigation.navigate('Home'));
  await settle();
  expect(loads()).toBe(2);

  const refresh = screen.getByTestId('home.scroll').props.refreshControl as { props: { onRefresh: () => Promise<void> } };
  await act(async () => {
    await refresh.props.onRefresh();
  });
  await settle();
  expect(loads()).toBe(3);
});

it('Home draws the Today row in iOS spacing: 20 dp at the sides and above (iOS .padding outside the row)', async () => {
  freshHome();
  serve();
  await renderHome();
  const slot = screen.getByTestId('home.today');
  expect(StyleSheet.flatten(slot.props.style)).toEqual({ paddingHorizontal: 20, gap: 20 });
  // An empty first child, then the row: the 20 dp above the row is the gap
  // between them, so it is there only while the row is.
  expect(slot.children).toHaveLength(2);
  expect(screen.getByTestId('today.row')).toBeOnTheScreen();
});

it('a Today row that renders nothing leaves no gap: only the empty child, no height', async () => {
  mockTodayHidden = true;
  freshHome();
  serve();
  await renderHome();
  expect(screen.queryByTestId('today.row')).toBeNull();
  expect(screen.getByTestId('home.today').children).toHaveLength(1);
});

it('the proof banner shows above the hero from the profile Home read, with the short name only', async () => {
  freshHome();
  serve(
    profileJSON({
      recentCheckIn: {
        checkInId: '11111111-2222-4333-8444-555555666666',
        checkedInAt: new Date().toISOString(),
        memberName: 'Anna Jónsdóttir',
        memberShortName: 'Anna J.',
        venue: { id: '00000000-0000-4000-8000-000000000001', name: 'Sundhöllin' },
        activity: null,
      },
    }),
  );
  await renderHome();
  expect(screen.getByTestId('proof.banner')).toHaveTextContent('Sundhöllin / Anna J.');
  // One profile read per visit: the banner does not read it again.
  expect(api.sentAll('/profile')).toHaveLength(1);
});

it('no recent check-in: no banner', async () => {
  freshHome();
  serve();
  await renderHome();
  expect(screen.queryByTestId('proof.banner')).toBeNull();
});

it('at the largest text size Home still draws the hero, the greeting and the shelves', async () => {
  setTestFontScale(2);
  freshHome();
  serve();
  await renderHome();
  expect(screen.getByTestId('home.hero')).toBeOnTheScreen();
  expect(screen.getByTestId('home.greeting')).toBeOnTheScreen();
  expect(screen.getByTestId('home.referral')).toBeOnTheScreen();
});
