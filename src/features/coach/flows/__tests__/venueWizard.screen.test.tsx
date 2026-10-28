/**
 * The venue wizard on the Coach tab, with the real screen and the real flow
 * (iOS CoachView's question bubbles and venue carousel driven by
 * `CoachViewModel`'s Q&A wizard): a tile or the lagoon chip opens it, the
 * chips walk its questions, the cards book by slug, and the strip offers
 * another search. Location is asked for when the wizard starts, never when
 * the tab opens.
 */
import { NavigationContainer, createNavigationContainerRef } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';
import { api, Reply, type StubRequest } from '@test/server';

import { decodeProfile } from '../../../../api/profile';
import { stubApiClientPerTest } from '../../../../api/testing';
import { decodeVenue, venueToApi } from '../../../../api/venues';
import { UiKitProvider, dismissAllDialogs } from '../../../../components/ui';
import CoachScreen from '../../../../screens/coach/CoachScreen';
import { resetSpeechModuleForTests } from '../../../../screens/coach/useDictation';
import { lookup } from '../../../../i18n';
import { resetAppStoreForTests, useAppStore } from '../../../../stores/appStore';
import { resetIntentStoreForTests } from '../../../../stores/intentStore';
import { locationStore } from '../../../../stores/locationStore';
import { claimCoachForMember } from '../../register';
import { pendingCoachSaves, resetCoachStoreForTests } from '../../store/coachStore';
import { venueWizardFlow } from '../venueWizard';

/* eslint-disable @typescript-eslint/no-require-imports */
// expo-font (behind @expo/vector-icons) imports expo-asset, which npm left
// nested under expo/ where Jest's resolver cannot see it; Metro resolves it.
jest.mock('expo-asset', () => jest.requireActual('expo/node_modules/expo-asset'), { virtual: true });
jest.mock('expo-speech-recognition', () => ({
  ExpoSpeechRecognitionModule: require('../../../../screens/coach/__tests__/fakeSpeech').fakeSpeech,
}));
// The hearts are VENUE-2's store; here a heart only has to draw.
// The Coach mounts the Saved sheet, which reads the real store (closed here).
jest.mock('../../../favourites', () => ({
  ...jest.requireActual('../../../favourites'),
  useFavourite: () => ({ isFavourite: false, loading: false, toggle: async () => undefined }),
}));
/* eslint-enable @typescript-eslint/no-require-imports */

stubApiClientPerTest();

const MEMBER = '8c2c1b36-2a7e-4b1f-9e0e-2f1c4f0a9c11';
const en = (key: string) => lookup(key, 'en');
const is = (key: string) => lookup(key, 'is');

function profile(locale: 'en' | 'is' = 'en') {
  return decodeProfile({ id: MEMBER, email: 'member@example.com', kennitalaVerified: false, marketingConsent: false, locale });
}

const VENUES = [
  decodeVenue({
    id: '00000000-0000-4000-8000-000000000011',
    slug: 'world-class-laugar',
    name: 'World Class Laugar',
    city: 'Reykjavík',
    address: 'Sundlaugavegur 30a',
    categories: ['Gym'],
    coordinates: { latitude: 64.1468, longitude: -21.8796 },
  }),
  decodeVenue({
    id: '00000000-0000-4000-8000-000000000012',
    slug: 'sky-lagoon',
    name: 'Sky Lagoon',
    city: 'Kópavogur',
    categories: ['Lagoon'],
    coordinates: { latitude: 64.1166, longitude: -21.9447 },
  }),
];

function serveVenues() {
  api.on('GET', '/venues', (request: StubRequest) => {
    const category = request.query.category?.toLowerCase();
    const rows = VENUES.filter((row) => (row.categories ?? []).some((c) => c.toLowerCase() === category));
    return Reply.ok({ data: rows.map(venueToApi), pagination: { nextCursor: null, hasMore: false, limit: 100 } });
  });
}

// ---------------------------------------------------------------------------
// A tab stack with a venue page stand-in.

type Routes = { CoachMain: undefined; VenueDetail: { slug: string } };
const Stack = createNativeStackNavigator<Routes>();
const navigation = createNavigationContainerRef<Routes>();

function StandIn({ route }: { route: { name: string; params?: object } }) {
  return <Text>{`${route.name} ${JSON.stringify(route.params ?? {})}`}</Text>;
}

async function renderCoach() {
  await render(
    <NavigationContainer ref={navigation}>
      <UiKitProvider>
        <Stack.Navigator screenOptions={{ headerShown: false, animation: 'none' }}>
          <Stack.Screen name="CoachMain" component={CoachScreen as never} />
          <Stack.Screen name="VenueDetail" component={StandIn} />
        </Stack.Navigator>
      </UiKitProvider>
    </NavigationContainer>,
  );
  await act(async () => undefined);
}

async function settle() {
  await act(async () => {
    for (let turn = 0; turn < 8; turn += 1) await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function press(name: string) {
  await fireEvent.press(screen.getByRole('button', { name }));
  await settle();
}

const requestLocation = jest.fn(async () => undefined);
const initialLocation = locationStore.getState();

beforeEach(async () => {
  resetAppStoreForTests();
  resetIntentStoreForTests();
  resetCoachStoreForTests();
  venueWizardFlow.reset();
  resetSpeechModuleForTests();
  requestLocation.mockClear();
  locationStore.setState({ permission: 'undetermined', permissionKnown: true, currentLocation: null, requestLocation });
  useAppStore.setState({ isAuthenticated: true, userId: MEMBER, profile: profile() });
  await claimCoachForMember(MEMBER, false);
});

afterEach(async () => {
  await act(async () => dismissAllDialogs());
  await pendingCoachSaves();
  locationStore.setState(initialLocation, true);
});

it('a tile opens the wizard; the chips walk it; the cards and the strip follow, and nothing calls the model', async () => {
  serveVenues();
  await renderCoach();
  // Location is not asked for when the Coach opens.
  expect(requestLocation).not.toHaveBeenCalled();

  await press(en('coach.chip.nearby'));
  await fireEvent.press(screen.getByTestId('coach.category.gyms'));
  await settle();
  expect(requestLocation).toHaveBeenCalledTimes(1);
  expect(screen.getByText(en('coach.q.gym.type'))).toBeOnTheScreen();

  await press(en('coach.opt.gym.weightlifting'));
  // The answered question's chip stays marked; its other chips close.
  expect(screen.getByRole('button', { name: en('coach.opt.gym.weightlifting') })).toBeSelected();
  expect(screen.getByRole('button', { name: en('coach.opt.gym.crossfit') })).toBeDisabled();
  expect(screen.getByText(en('coach.q.location'))).toBeOnTheScreen();

  await press(en('coach.loc.capital'));
  await press(en('coach.opt.gym.no_pref'));

  expect(
    screen.getByText(lookup('coach.found.one', 'en').replace('{count}', '1').replace('{category}', en('coach.cat_name.gym'))),
  ).toBeOnTheScreen();
  expect(screen.getByTestId('coach.venue.world-class-laugar')).toBeOnTheScreen();
  expect(screen.getByText(en('coach.explore_else'))).toBeOnTheScreen();
  // Two strips now: the "What's nearby?" answer and the one after the results.
  expect(screen.getAllByTestId('coach.category.pools')).toHaveLength(2);
  expect(api.sentAll('/coach')).toHaveLength(0);

  await press(`${en('coach.venue.book_it')}, World Class Laugar`);
  expect(screen.getByText('VenueDetail {"slug":"world-class-laugar"}')).toBeOnTheScreen();
});

it('the lagoon chip opens the lagoon wizard', async () => {
  serveVenues();
  await renderCoach();
  await press(en('coach.chip.lagoon'));
  expect(screen.getByText(en('coach.q.lagoon.experience'))).toBeOnTheScreen();
  await press(en('coach.opt.lagoon.geothermal'));
  await press(en('coach.loc.capital'));
  expect(screen.getByTestId('coach.venue.sky-lagoon')).toBeOnTheScreen();
});

it('typed words naming a venue open the wizard; a typed schedule question goes to the chat', async () => {
  api.on('POST', '/coach', Reply.ok({ reply: 'Spinning at Hress is at 17:30.' }));
  await renderCoach();
  await fireEvent.changeText(screen.getByTestId('coach.input'), 'spinning tomorrow at Hress?');
  await fireEvent(screen.getByTestId('coach.input'), 'submitEditing');
  await settle();
  expect(screen.getByText('Spinning at Hress is at 17:30.')).toBeOnTheScreen();
  expect(screen.queryByText(en('coach.q.gym.type'))).toBeNull();

  await fireEvent.changeText(screen.getByTestId('coach.input'), 'find me a gym');
  await fireEvent(screen.getByTestId('coach.input'), 'submitEditing');
  await settle();
  expect(screen.getByText(en('coach.q.gym.type'))).toBeOnTheScreen();
  expect(api.sentAll('/coach')).toHaveLength(1);
});

it('"Other" takes the member’s own words as the answer', async () => {
  await renderCoach();
  await press(en('coach.chip.nearby'));
  await fireEvent.press(screen.getByTestId('coach.category.spa'));
  await settle();
  await press(en('coach.other.label'));
  await fireEvent.changeText(screen.getByTestId('coach.question.other_input'), 'infrared sauna');
  await fireEvent(screen.getByTestId('coach.question.other_input'), 'submitEditing');
  await settle();
  // The words are the member's bubble, and the next question follows.
  expect(screen.getByText('infrared sauna')).toBeOnTheScreen();
  expect(screen.getByText(en('coach.q.location'))).toBeOnTheScreen();
});

it('an Icelandic member gets the wizard in Icelandic', async () => {
  serveVenues();
  useAppStore.setState({ profile: profile('is') });
  await renderCoach();
  await press(is('coach.chip.nearby'));
  await fireEvent.press(screen.getByTestId('coach.category.yoga'));
  await settle();
  expect(screen.getByText(is('coach.q.yoga.style'))).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: is('coach.opt.yoga.vinyasa') })).toBeOnTheScreen();
  await press(is('coach.opt.yoga.hot'));
  expect(screen.getByText(is('coach.q.location'))).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: is('coach.loc.drive') })).toBeOnTheScreen();
});
