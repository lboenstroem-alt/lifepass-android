/**
 * The Coach's Saved sheet (iOS FavouritesView), presented from a screen in a
 * real stack against the stub server: its copy, the Premium tag, saved
 * classes, the reasons, the suggestion heart with its spinner, and every way
 * out closing the sheet before the page opens.
 */
import { createNavigationContainerRef, NavigationContainer, useRoute } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { useState, type ComponentType } from 'react';
import { Pressable, Text, View } from 'react-native';

import { api, Reply, type StubReply } from '@test/server';

import { stubApiClientPerTest } from '../../../api/testing';
import { bottomSheetMock } from '../../../components/ui/testing/bottomSheetMock';
import { setCurrentLanguage } from '../../../i18n';
import { setAnalyticsObserver } from '../../../lib/analytics';
import { useIntentStore } from '../../../stores/intentStore';
import { favouritesStore } from '../../favourites';
import { SavedSheet } from '..';

import { favouriteActivityJSON, favouriteJSON, venueJSON } from './fixtures';
import { settle } from './harness';

/* eslint-disable @typescript-eslint/no-require-imports */
jest.mock('@gorhom/bottom-sheet', () => require('../../../components/ui/testing/bottomSheetMock').bottomSheetModule);
// @expo/vector-icons loads its fonts through expo-asset, which npm nests under expo.
jest.mock('expo-asset', () => jest.requireActual('expo/node_modules/expo-asset'), { virtual: true });
/* eslint-enable @typescript-eslint/no-require-imports */

stubApiClientPerTest();

const SAVED_A = 'aaaaaaaa-0000-4000-8000-000000000001';
const PREMIUM = 'aaaaaaaa-0000-4000-8000-000000000002';
const CLASS_ID = 'cccccccc-0000-4000-8000-000000000001';
const PICKS = ['bbbbbbbb-0000-4000-8000-000000000001', 'bbbbbbbb-0000-4000-8000-000000000002', 'bbbbbbbb-0000-4000-8000-000000000003'];

const navigationRef = createNavigationContainerRef<Record<string, object | undefined>>();
const Stack = createNativeStackNavigator();

function standIn(name: string): ComponentType {
  return function StandIn() {
    const route = useRoute();
    return (
      <View testID={`route.${name}`}>
        <Text testID={`params.${name}`}>{JSON.stringify(route.params ?? null)}</Text>
      </View>
    );
  };
}

/** The Coach stand-in: a button that presents the sheet. */
function Coach() {
  const [open, setOpen] = useState(false);
  return (
    <View testID="route.Coach">
      <Pressable accessibilityRole="button" onPress={() => setOpen(true)}>
        <Text>Open saved</Text>
      </Pressable>
      <SavedSheet visible={open} onClose={() => setOpen(false)} />
    </View>
  );
}

const VenueDetail = standIn('VenueDetail');
const Profile = standIn('Profile');

async function renderSheet() {
  await render(
    <NavigationContainer ref={navigationRef}>
      <Stack.Navigator screenOptions={{ headerShown: false, animation: 'none' }}>
        <Stack.Screen name="Coach" component={Coach} />
        <Stack.Screen name="VenueDetail" component={VenueDetail} />
        <Stack.Screen name="Profile" component={Profile} />
      </Stack.Navigator>
    </NavigationContainer>,
  );
  await fireEvent.press(screen.getByText('Open saved'));
  await settle();
}

function answerSaved(venues: unknown[] = [], activities: unknown[] = [], all: unknown[] = []) {
  api.on('GET', '/favourites', Reply.ok({ venues, activities }));
  api.on('GET', '/venues', Reply.ok({ data: all, pagination: { nextCursor: null, hasMore: false, limit: 100 } }));
}

const route = () => navigationRef.getCurrentRoute()?.name;
const favouriteReads = () => api.requests.filter((r) => r.method === 'GET' && r.path === '/favourites').length;

beforeEach(() => {
  bottomSheetMock.reset();
  setCurrentLanguage('en');
  favouritesStore.getState().reset();
  useIntentStore.setState({ pendingTab: null });
  answerSaved();
});

describe('the Saved sheet', () => {
  it('says what it is and how many are saved', async () => {
    answerSaved([favouriteJSON(SAVED_A)]);
    await renderSheet();
    expect(screen.getByText('SAVED')).toBeOnTheScreen();
    expect(screen.getByText('YOUR SHORTLIST')).toBeOnTheScreen();
    expect(screen.getByText('Studios & lagoons')).toBeOnTheScreen();
    expect(screen.getByTestId('saved.count')).toHaveTextContent('1 SAVED');
  });

  it('tags a venue outside the bundle Premium, and only that one', async () => {
    answerSaved([favouriteJSON(SAVED_A), favouriteJSON(PREMIUM, { inBundle: false })]);
    await renderSheet();
    expect(screen.getByTestId(`saved.venue.${PREMIUM}.premium`)).toHaveTextContent('Premium');
    expect(screen.queryByTestId(`saved.venue.${SAVED_A}.premium`)).toBeNull();
  });

  it('a saved venue closes the sheet, then opens the venue by slug', async () => {
    answerSaved([favouriteJSON(SAVED_A)]);
    await renderSheet();
    await fireEvent.press(screen.getByTestId(`saved.venue.${SAVED_A}`));
    await settle();
    expect(route()).toBe('VenueDetail');
    expect(screen.getByTestId('params.VenueDetail')).toHaveTextContent(JSON.stringify({ slug: 'slug-aaaa' }));
    expect(screen.queryByTestId('saved.sheet')).toBeNull();
  });

  it('lists saved classes only when there are any, each opening its venue', async () => {
    answerSaved([favouriteJSON(SAVED_A)]);
    await renderSheet();
    expect(screen.queryByTestId('saved.classes')).toBeNull();

    await act(async () => navigationRef.goBack());
    answerSaved([favouriteJSON(SAVED_A)], [favouriteActivityJSON(CLASS_ID, { venueSlug: 'hot-yoga-studio' })]);
    favouritesStore.getState().reset();
    await renderSheet();
    expect(screen.getByText('SAVED CLASSES')).toBeOnTheScreen();
    expect(screen.getByText('Hot Yoga')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId(`saved.class.${CLASS_ID}`));
    await settle();
    expect(screen.getByTestId('params.VenueDetail')).toHaveTextContent(JSON.stringify({ slug: 'hot-yoga-studio' }));
  });

  it('empty: "Find a venue" closes the sheet, then switches to Explore', async () => {
    await renderSheet();
    expect(screen.getByText("You haven't saved any venues yet.\nTap the heart on a venue to add it.")).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Find a venue' }));
    await settle();
    expect(screen.queryByTestId('saved.sheet')).toBeNull();
    expect(useIntentStore.getState().pendingTab).toBe('Explore');
  });

  it('the person button closes the sheet and opens Profile on Bookings, saying where from', async () => {
    const events: [string, unknown][] = [];
    setAnalyticsObserver((event, params) => events.push([event, params]));
    try {
      await renderSheet();
      await fireEvent.press(screen.getByRole('button', { name: 'Open profile: bookings and saved' }));
      await settle();
      expect(route()).toBe('Profile');
      expect(screen.getByTestId('params.Profile')).toHaveTextContent(JSON.stringify({ initialTab: 'bookings' }));
      expect(events).toContainEqual(['profile_opened', { entry: 'favourites' }]);
    } finally {
      setAnalyticsObserver(null);
    }
  });

  it('gives each suggestion its reason', async () => {
    answerSaved(
      [],
      [],
      [
        venueJSON(PICKS[0], { name: 'Lagoon', inBundle: false, categories: ['lagoon'] }),
        venueJSON(PICKS[1], { name: 'Studio', categories: ['hot yoga'] }),
        venueJSON(PICKS[2], { name: 'Pool', categories: [] }),
      ],
    );
    await renderSheet();
    expect(screen.getByText('Similar to your premium spots')).toBeOnTheScreen();
    expect(screen.getByText('You liked Hot Yoga')).toBeOnTheScreen();
    expect(screen.getByText('Near your saved spots')).toBeOnTheScreen();
  });

  it('with nothing left to suggest, says so', async () => {
    answerSaved([favouriteJSON(SAVED_A)], [], [venueJSON(SAVED_A)]);
    await renderSheet();
    expect(screen.getByText("We'll suggest venues here as you explore.")).toBeOnTheScreen();
  });

  it('the heart spins while it saves, then the venue moves up into the saved list', async () => {
    answerSaved([], [], [venueJSON(PICKS[0], { name: 'Pick' })]);
    let release: () => void = () => undefined;
    api.on('POST', '/favourites', () => new Promise<StubReply>((resolve) => (release = () => resolve(Reply.ok({ ok: true })))));
    await renderSheet();
    const before = favouriteReads();

    await fireEvent.press(screen.getByRole('button', { name: 'Save Pick' }));
    await settle(2);
    expect(screen.getByRole('button', { name: 'Save Pick' })).toBeDisabled();

    answerSaved([favouriteJSON(PICKS[0], { name: 'Pick' })], [], [venueJSON(PICKS[0], { name: 'Pick' })]);
    api.on('POST', '/favourites', Reply.ok({ ok: true }));
    await act(async () => release());
    await settle();
    expect(favouriteReads()).toBeGreaterThan(before);
    expect(screen.getByTestId('saved.count')).toHaveTextContent('1 SAVED');
    expect(screen.getByTestId(`saved.venue.${PICKS[0]}`)).toBeOnTheScreen();
  });

  it('a heart the server refuses fails silently', async () => {
    answerSaved([], [], [venueJSON(PICKS[0], { name: 'Pick' })]);
    api.on('POST', '/favourites', Reply.problem(500, 'internal_error'));
    await renderSheet();
    await fireEvent.press(screen.getByRole('button', { name: 'Save Pick' }));
    await settle();
    expect(screen.queryByText('Heads up')).toBeNull();
    expect(screen.getByText('Pick')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Save Pick' })).toBeEnabled();
  });

  it('reads the lists again each time it is presented', async () => {
    answerSaved([favouriteJSON(SAVED_A)]);
    await renderSheet();
    expect(favouriteReads()).toBe(1);
    await fireEvent.press(screen.getByTestId(`saved.venue.${SAVED_A}`));
    await settle();
    await act(async () => navigationRef.goBack());
    await fireEvent.press(screen.getByText('Open saved'));
    await settle();
    expect(favouriteReads()).toBe(2);
  });
});
