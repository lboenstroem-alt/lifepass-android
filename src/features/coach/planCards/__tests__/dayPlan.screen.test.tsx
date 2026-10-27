/**
 * The day plan on the Coach tab, with the real screen, store and flow (iOS
 * CoachView's plan wizard and CoachPlanView): "Plan my day" opens the
 * wizard, the chips walk it, ONE call brings the plan, its cards open the
 * venue and the sight by slug, and a refinement chip asks again with the
 * plan's id. Typed words mid-wizard are dropped with the hint.
 */
import { NavigationContainer, createNavigationContainerRef } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';
import { api, Reply } from '@test/server';

import { decodeProfile } from '../../../../api/profile';
import { stubApiClientPerTest } from '../../../../api/testing';
import { decodeVenue, venueToApi } from '../../../../api/venues';
import { UiKitProvider, dismissAllDialogs } from '../../../../components/ui';
import CoachScreen from '../../../../screens/coach/CoachScreen';
import { resetSpeechModuleForTests } from '../../../../screens/coach/useDictation';
import { lookup, translate, type Params } from '../../../../i18n';
import { resetAppStoreForTests, useAppStore } from '../../../../stores/appStore';
import { resetIntentStoreForTests } from '../../../../stores/intentStore';
import { locationStore } from '../../../../stores/locationStore';
import { resetDayPlan } from '../../dayPlan/wizard';
import { claimCoachForMember } from '../../register';
import { pendingCoachSaves, resetCoachStoreForTests } from '../../store/coachStore';

/* eslint-disable @typescript-eslint/no-require-imports */
jest.mock('expo-asset', () => jest.requireActual('expo/node_modules/expo-asset'), { virtual: true });
jest.mock('expo-speech-recognition', () => ({
  ExpoSpeechRecognitionModule: require('../../../../screens/coach/__tests__/fakeSpeech').fakeSpeech,
}));
// The Coach mounts the Saved sheet, which reads the real store (closed here).
jest.mock('../../../favourites', () => ({
  ...jest.requireActual('../../../favourites'),
  useFavourite: () => ({ isFavourite: false, loading: false, toggle: async () => undefined }),
}));
/* eslint-enable @typescript-eslint/no-require-imports */

stubApiClientPerTest();

const MEMBER = '8c2c1b36-2a7e-4b1f-9e0e-2f1c4f0a9c11';
const en = (key: string, params?: Params) => translate(key, 'en', params);

const PLAN = {
  id: 'plan_abc',
  intro: 'A calm evening by the water.',
  steps: [
    {
      slot: 'main',
      kind: 'venue',
      note: 'Soak for an hour.',
      venue: { slug: 'sky-lagoon', name: 'Sky Lagoon', city: 'Kópavogur', imageUrl: null, category: 'Lagoon', priceLabel: 'Included' },
    },
    {
      slot: 'after',
      kind: 'sight',
      note: 'The falls at dusk.',
      sight: {
        slug: 'seljalandsfoss',
        name: 'Seljalandsfoss',
        kind: 'waterfall',
        region: 'south',
        imageUrl: 'https://www.lifepass.is/attractions/plate/seljalandsfoss.png',
        imageCredit: null,
        driveFromReykjavik: { minutes: 95, km: 125 },
        roadAccess: 'road',
      },
    },
  ],
  chips: ['closer'],
  refinements: [{ change: 'closer', label: 'closer' }],
};

const SKY_LAGOON = decodeVenue({
  id: '00000000-0000-4000-8000-000000000012',
  slug: 'sky-lagoon',
  name: 'Sky Lagoon',
  city: 'Kópavogur',
  categories: ['Lagoon'],
});

type Routes = { CoachMain: undefined; VenueDetail: { slug: string }; AttractionDetail: { slug: string } };
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
          <Stack.Screen name="AttractionDetail" component={StandIn} />
        </Stack.Navigator>
      </UiKitProvider>
    </NavigationContainer>,
  );
  await act(async () => undefined);
}

async function settle() {
  await act(async () => {
    for (let turn = 0; turn < 10; turn += 1) await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

/** Presses the newest button with this name (an answered question keeps its chips on screen, closed). */
async function press(name: string) {
  await fireEvent.press(screen.getAllByRole('button', { name }).at(-1)!);
  await settle();
}

async function type(text: string) {
  await fireEvent.changeText(screen.getByTestId('coach.input'), text);
  await fireEvent(screen.getByTestId('coach.input'), 'submitEditing');
  await settle();
}

const initialLocation = locationStore.getState();

beforeEach(async () => {
  resetAppStoreForTests();
  resetIntentStoreForTests();
  resetCoachStoreForTests();
  resetDayPlan();
  resetSpeechModuleForTests();
  locationStore.setState({ permission: 'undetermined', permissionKnown: true, currentLocation: null, requestLocation: async () => undefined });
  useAppStore.setState({
    isAuthenticated: true,
    userId: MEMBER,
    profile: decodeProfile({ id: MEMBER, email: 'member@example.com', kennitalaVerified: false, marketingConsent: false, locale: 'en' }),
  });
  await claimCoachForMember(MEMBER, false);
  api.on('GET', '/venues/by-slug/:slug', Reply.ok(venueToApi(SKY_LAGOON)));
});

afterEach(async () => {
  await act(async () => dismissAllDialogs());
  await pendingCoachSaves();
  locationStore.setState(initialLocation, true);
});

it('"Plan my day" walks the wizard to one call and draws the plan; its cards open by slug', async () => {
  api.on('POST', '/coach', Reply.ok({ reply: PLAN.intro, plan: PLAN }));
  await renderCoach();

  await press(en('coach.chip.plan_day'));
  expect(screen.getByText(en('coach.plan.q.goal'))).toBeOnTheScreen();
  await press(en('coach.plan.goal.relax'));
  // The answered chip stays marked; the others close.
  expect(screen.getByRole('button', { name: en('coach.plan.goal.relax') })).toBeSelected();
  expect(screen.getByRole('button', { name: en('coach.plan.goal.mix') })).toBeDisabled();

  // Typed words are dropped, with the hint, and the question asked again.
  await type('my shoulder is sore');
  expect(screen.queryByText('my shoulder is sore')).toBeNull();
  expect(screen.getByText(en('coach.plan.typed_hint'))).toBeOnTheScreen();
  expect(screen.getAllByText(en('coach.plan.q.area'))).toHaveLength(2);

  await press(lookup('attraction.region.capital', 'en'));
  await press(en('coach.plan.when.now'));
  await press(en('coach.plan.duration.short'));

  expect(api.sentAll('/coach', 'POST')).toHaveLength(1);
  expect(api.sent('/coach', 'POST').body).toEqual({
    locale: 'en',
    intake: { goal: 'relax', area: { kind: 'region', region: 'capital' }, when: 'now', duration: 'short' },
  });

  expect(screen.getByText(PLAN.intro)).toBeOnTheScreen();
  expect(screen.getByText(en('coach.plan.slot.main').toUpperCase())).toBeOnTheScreen();
  expect(screen.getByText('Soak for an hour.')).toBeOnTheScreen();
  // The venue's full row came in by slug: the carousel's card.
  expect(screen.getByTestId('coach.venue.sky-lagoon')).toBeOnTheScreen();

  await fireEvent.press(screen.getByText(en('coach.plan.sight.open')));
  await settle();
  expect(screen.getByText('AttractionDetail {"slug":"seljalandsfoss"}')).toBeOnTheScreen();
  await act(async () => navigation.goBack());
  await settle();

  await fireEvent.press(screen.getByTestId('coach.venue.sky-lagoon.book'));
  await settle();
  expect(screen.getByText('VenueDetail {"slug":"sky-lagoon"}')).toBeOnTheScreen();
});

it('a refinement chip posts its words and asks again with the plan’s id; Plan something else starts over', async () => {
  api.on('POST', '/coach', Reply.ok({ reply: PLAN.intro, plan: PLAN }));
  await renderCoach();
  await press(en('coach.chip.plan_day'));
  await press(en('coach.plan.goal.relax'));
  await press(lookup('attraction.region.capital', 'en'));
  await press(en('coach.plan.when.now'));
  await press(en('coach.plan.duration.short'));

  api.on('POST', '/coach', Reply.ok({ reply: 'Closer to home.', plan: { ...PLAN, id: 'plan_def', intro: 'Closer to home.' } }));
  await press(en('coach.plan.refine.closer'));
  expect(api.sent('/coach', 'POST').body).toEqual({ locale: 'en', refine: { planId: 'plan_abc', change: 'closer' } });
  expect(screen.getByText('Closer to home.')).toBeOnTheScreen();

  await press(en('coach.plan.new'));
  expect(screen.getAllByText(en('coach.plan.q.goal')).length).toBeGreaterThanOrEqual(2);
});
