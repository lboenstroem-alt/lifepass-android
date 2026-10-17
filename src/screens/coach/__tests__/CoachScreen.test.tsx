/**
 * The Coach tab on screen (iOS CoachView.swift): the empty state and its
 * chips' gating, the free tier's line and card, the locking input, the
 * drawer, venue cards' "Book it" by slug, parked prompts consumed on every
 * appearance, and dictation (en-US, on the phone where it can, stopped when
 * the tab loses focus, never while locked).
 *
 * The four flows are COACH-2 to COACH-5's; here they are the stubs that take
 * nothing, so typed words reach the model.
 */
import { NavigationContainer, createNavigationContainerRef } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { act, fireEvent, render, screen, within } from '@testing-library/react-native';
import { Linking, Text } from 'react-native';
import { api, Reply } from '@test/server';

import { stubApiClientPerTest } from '../../../api/testing';
import { decodeProfile } from '../../../api/profile';
import { decodeVenue, venueToApi } from '../../../api/venues';
import { UiKitProvider, dismissAllDialogs } from '../../../components/ui';
import {
  pendingCoachSaves,
  resetCoachStoreForTests,
  useCoachStore,
} from '../../../features/coach/store/coachStore';
import { lookup, translatePlural } from '../../../i18n';
import { resetAppStoreForTests, useAppStore } from '../../../stores/appStore';
import { resetIntentStoreForTests, useIntentStore } from '../../../stores/intentStore';
import CoachScreen from '../CoachScreen';
import { resetSpeechModuleForTests } from '../useDictation';
import { fakeSpeech } from './fakeSpeech';

/* eslint-disable @typescript-eslint/no-require-imports */
// expo-font (behind @expo/vector-icons) imports expo-asset, which npm left
// nested under expo/ where Jest's resolver cannot see it; Metro resolves it.
jest.mock('expo-asset', () => jest.requireActual('expo/node_modules/expo-asset'), { virtual: true });
jest.mock('expo-speech-recognition', () => ({ ExpoSpeechRecognitionModule: require('./fakeSpeech').fakeSpeech }));
// The hearts are VENUE-2's store; here a heart only has to draw.
jest.mock('../../../features/favourites', () => ({
  useFavourite: () => ({ isFavourite: false, loading: false, toggle: async () => undefined }),
}));
/* eslint-enable @typescript-eslint/no-require-imports */

stubApiClientPerTest();

const MEMBER_A = '8c2c1b36-2a7e-4b1f-9e0e-2f1c4f0a9c11';
const en = (key: string) => lookup(key, 'en');

/**
 * The member's profile. The app store derives the language and the health
 * access from it on every change, so a test sets them here, never on the
 * store's derived fields.
 */
function profile(extra: Record<string, unknown> = {}) {
  return decodeProfile({
    id: MEMBER_A,
    email: 'member@example.com',
    kennitalaVerified: false,
    marketingConsent: false,
    locale: 'en',
    ...extra,
  });
}

// ---------------------------------------------------------------------------
// A tab stack with the routes the Coach opens, each a stand-in that says
// where it is.

type Routes = {
  CoachMain: undefined;
  Elsewhere: undefined;
  VenueDetail: { slug: string };
  Plans: undefined;
  Profile: { initialTab: string };
  Account: undefined;
};

const Stack = createNativeStackNavigator<Routes>();
const navigation = createNavigationContainerRef<Routes>();

function StandIn({ route }: { route: { name: string; params?: object } }) {
  return <Text>{`${route.name} ${JSON.stringify(route.params ?? {})}`}</Text>;
}

function CoachApp() {
  return (
    <NavigationContainer ref={navigation}>
      <UiKitProvider>
        <Stack.Navigator screenOptions={{ headerShown: false, animation: 'none' }}>
          <Stack.Screen name="CoachMain" component={CoachScreen as never} />
          <Stack.Screen name="Elsewhere" component={StandIn} />
          <Stack.Screen name="VenueDetail" component={StandIn} />
          <Stack.Screen name="Plans" component={StandIn} />
          <Stack.Screen name="Profile" component={StandIn} />
          <Stack.Screen name="Account" component={StandIn} />
        </Stack.Navigator>
      </UiKitProvider>
    </NavigationContainer>
  );
}

async function renderCoach() {
  const view = await render(<CoachApp />);
  await act(async () => undefined);
  return view;
}

async function settle() {
  await act(async () => {
    for (let turn = 0; turn < 5; turn += 1) await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

beforeEach(() => {
  resetAppStoreForTests();
  resetIntentStoreForTests();
  resetCoachStoreForTests();
  resetSpeechModuleForTests();
  fakeSpeech.reset();
  useAppStore.setState({ isAuthenticated: true, userId: MEMBER_A, profile: profile() });
});

afterEach(async () => {
  await act(async () => dismissAllDialogs());
  await pendingCoachSaves();
});

// ---------------------------------------------------------------------------

describe('the empty state', () => {
  it('is the static heading, the 2x2 grid, "Plan my day" and "Get a 4-week plan"', async () => {
    await renderCoach();
    expect(screen.getByRole('header', { name: en('coach.empty.heading') })).toBeOnTheScreen();
    for (const key of [
      'coach.chip.nearby',
      'coach.chip.after_work',
      'coach.chip.lagoon',
      'coach.chip.something_new',
      'coach.chip.plan_day',
      'coach.chip.program',
    ]) {
      expect(screen.getByRole('button', { name: en(key) })).toBeOnTheScreen();
    }
    expect(screen.queryByRole('button', { name: en('coach.chip.adjust_plan') })).toBeNull();
  });

  it('is in Icelandic for an Icelandic account', async () => {
    useAppStore.setState({ profile: profile({ locale: 'is' }) });
    await renderCoach();
    expect(screen.getByRole('header', { name: lookup('coach.empty.heading', 'is') })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: lookup('coach.chip.plan_day', 'is') })).toBeOnTheScreen();
  });

  it('hides the programme chip from a member under 18', async () => {
    useAppStore.setState({ profile: profile({ health: { access: 'minor' } }) });
    await renderCoach();
    expect(screen.getByRole('button', { name: en('coach.chip.plan_day') })).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: en('coach.chip.program') })).toBeNull();
    expect(screen.queryByRole('button', { name: en('coach.chip.adjust_plan') })).toBeNull();
  });

  const liveProgram = () => profile({ health: { program: { id: 'program-1', status: 'active' } } });

  it('keeps "Get a 4-week plan" while a plan runs on a server that does not revise', async () => {
    useAppStore.setState({ profile: liveProgram(), serverFeatures: [] });
    await renderCoach();
    expect(screen.getByRole('button', { name: en('coach.chip.program') })).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: en('coach.chip.adjust_plan') })).toBeNull();
  });

  it('reads "Adjust my plan" while a plan runs on a server that revises', async () => {
    useAppStore.setState({ profile: liveProgram(), serverFeatures: ['plan_revision'] });
    await renderCoach();
    expect(screen.getByRole('button', { name: en('coach.chip.adjust_plan') })).toBeOnTheScreen();
    expect(screen.getByTestId('coach.chip.adjust')).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: en('coach.chip.program') })).toBeNull();
  });

  it('"What\'s nearby?" shows the six category tiles, never sending a prompt', async () => {
    await renderCoach();
    await fireEvent.press(screen.getByRole('button', { name: en('coach.chip.nearby') }));
    expect(screen.getByText(en('coach.chip.nearby'))).toBeOnTheScreen();
    expect(screen.getByText(en('coach.nearby_prompt'))).toBeOnTheScreen();
    for (const key of ['coach.cat.pools', 'coach.cat.gyms', 'coach.cat.wellness', 'coach.cat.golf', 'coach.cat.spa', 'coach.cat.yoga']) {
      expect(screen.getByRole('button', { name: en(key) })).toBeOnTheScreen();
    }
    expect(api.sentAll('/coach')).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------

describe('the chat', () => {
  it('Send on the keyboard sends, and the answer appears', async () => {
    api.on('POST', '/coach', Reply.ok({ reply: 'Laugardalslaug is open until 22.' }));
    await renderCoach();
    const input = screen.getByTestId('coach.input');
    await fireEvent.changeText(input, 'where can I swim tonight?');
    await fireEvent(input, 'submitEditing');
    await settle();
    expect(screen.getByText('where can I swim tonight?')).toBeOnTheScreen();
    expect(screen.getByText('Laugardalslaug is open until 22.')).toBeOnTheScreen();
    expect((api.sent('/coach', 'POST').body as { locale: string }).locale).toBe('en');
  });

  it('the send arrow shows once there is text, and says what it does', async () => {
    api.on('POST', '/coach', Reply.ok({ reply: 'Hi!' }));
    await renderCoach();
    expect(screen.queryByRole('button', { name: en('coach.a11y.send_message') })).toBeNull();
    expect(screen.getByRole('button', { name: en('coach.a11y.start_voice') })).toBeOnTheScreen();
    await fireEvent.changeText(screen.getByTestId('coach.input'), 'hello');
    expect(screen.queryByRole('button', { name: en('coach.a11y.start_voice') })).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: en('coach.a11y.send_message') }));
    await settle();
    expect(screen.getByText('Hi!')).toBeOnTheScreen();
  });

  it('"Book it" on a venue card opens the venue by slug', async () => {
    const sky = decodeVenue({
      id: '00000000-0000-4000-8000-000000000002',
      slug: 'sky-lagoon',
      name: 'Sky Lagoon',
      city: 'Kópavogur',
      inBundle: true,
    });
    api.on('GET', '/venues/by-slug/:slug', Reply.ok(venueToApi(sky)));
    api.on(
      'POST',
      '/coach',
      Reply.ok({ reply: '{"type":"venues","intro":"A calm evening.","venues":[{"id":"sky-lagoon","name":"Sky Lagoon"}]}' }),
    );
    await renderCoach();
    await fireEvent.changeText(screen.getByTestId('coach.input'), 'somewhere calm?');
    await fireEvent(screen.getByTestId('coach.input'), 'submitEditing');
    await settle();
    expect(screen.getByText('A calm evening.')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: `${en('coach.venue.book_it')}, Sky Lagoon` }));
    await settle();
    expect(screen.getByText('VenueDetail {"slug":"sky-lagoon"}')).toBeOnTheScreen();
  });

  it('a prompt parked by Home is sent on the next appearance, and one parked while on screen too', async () => {
    api.on('POST', '/coach', (request) =>
      Reply.ok({ reply: `re: ${(request.body as { messages: { content: string }[] }).messages.at(-1)!.content}` }),
    );
    useIntentStore.getState().parkCoachPrompt('Suggest gym classes I should try this week.');
    await renderCoach();
    await settle();
    expect(screen.getByText('re: Suggest gym classes I should try this week.')).toBeOnTheScreen();

    await act(async () => useIntentStore.getState().parkCoachPrompt('Plan a perfect spa evening for me.'));
    await settle();
    expect(screen.getByText('re: Plan a perfect spa evening for me.')).toBeOnTheScreen();
    expect(api.sentAll('/coach')).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------

describe('the free tier', () => {
  it('shows how many free messages are left', async () => {
    await renderCoach();
    await act(async () => useCoachStore.getState().recordFreeMessages({ limit: 3, remaining: 2 }));
    expect(screen.getByText(translatePlural('coach.free.left', 2, 'en', { count: 2 }))).toBeOnTheScreen();
  });

  it('once they are used: the card, the locked input and its placeholder, the mic disabled', async () => {
    await renderCoach();
    await act(async () =>
      useCoachStore.getState().recordFreeMessages({ limit: 3, remaining: 0, resetsAt: new Date(Date.now() + 5 * 86_400_000) }),
    );
    expect(screen.getByRole('header', { name: en('coach.free.limit.title') })).toBeOnTheScreen();
    const input = screen.getByTestId('coach.input');
    expect(input.props.editable).toBe(false);
    expect(input.props.placeholder).toBe(en('coach.input.free_limit'));
    expect(screen.getByRole('button', { name: en('coach.a11y.start_voice') })).toBeDisabled();
    expect(screen.queryByText(/free messages left/)).toBeNull();
  });

  it('a member at the daily cap reads "back tomorrow"; a free account never does', async () => {
    await renderCoach();
    await act(async () => useCoachStore.setState({ limitReached: true }));
    expect(screen.getByTestId('coach.input').props.placeholder).toBe(en('coach.input.limit_reached'));
    expect(screen.queryByRole('header', { name: en('coach.free.limit.title') })).toBeNull();
  });

  it('"Get a membership" opens the app\'s memberships screen', async () => {
    await renderCoach();
    await act(async () =>
      useCoachStore.setState({
        freeLimitReached: true,
        freeMessages: { limit: 3, remaining: 0 },
        upgrade: { action: 'plans', url: 'https://www.lifepass.is/plans' },
      }),
    );
    await fireEvent.press(screen.getByRole('button', { name: en('coach.free.limit.cta') }));
    await settle();
    expect(screen.getByText('Plans {}')).toBeOnTheScreen();
  });

  it('…or the web page when the server asks for something this build has no screen for', async () => {
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    try {
      await renderCoach();
      await act(async () =>
        useCoachStore.setState({
          freeLimitReached: true,
          freeMessages: { limit: 3, remaining: 0 },
          upgrade: { action: 'web', url: 'https://www.lifepass.is/plans' },
        }),
      );
      await fireEvent.press(screen.getByRole('button', { name: en('coach.free.limit.cta') }));
      expect(open).toHaveBeenCalledWith('https://www.lifepass.is/plans');
    } finally {
      open.mockRestore();
    }
  });

  it('a profile read newer than the last count lifts the lock (a membership bought)', async () => {
    await renderCoach();
    await act(async () => useCoachStore.getState().recordFreeMessages({ limit: 3, remaining: 0 }));
    expect(screen.getByTestId('coach.input').props.editable).toBe(false);
    await act(async () =>
      useAppStore.setState({ profile: profile({ coach: { tier: 'member' } }), profileReadAt: new Date(Date.now() + 1_000) }),
    );
    expect(screen.getByTestId('coach.input').props.editable).toBe(true);
  });
});

// ---------------------------------------------------------------------------

describe('the drawer', () => {
  it('lists no recents at first, and a new chat saves the one on screen to RECENTS', async () => {
    api.on('POST', '/coach', Reply.ok({ reply: 'Three pools.' }));
    await renderCoach();
    await fireEvent.press(screen.getByRole('button', { name: en('coach.android.a11y.menu') }));
    expect(screen.getByText(en('coach.drawer.no_recents'))).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: en('common.close') }));

    await fireEvent.changeText(screen.getByTestId('coach.input'), 'pools near Laugardalur?');
    await fireEvent(screen.getByTestId('coach.input'), 'submitEditing');
    await settle();

    await fireEvent.press(screen.getByRole('button', { name: en('coach.android.a11y.menu') }));
    await fireEvent.press(screen.getByTestId('coach.drawer.add_chat'));
    await settle();
    // The empty state is back, and the chat is in RECENTS.
    expect(screen.getByRole('header', { name: en('coach.empty.heading') })).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: en('coach.android.a11y.menu') }));
    const drawer = screen.getByTestId('coach.drawer');
    await fireEvent.press(within(drawer).getByRole('button', { name: 'pools near Laugardalur?' }));
    await settle();
    expect(screen.getByText('Three pools.')).toBeOnTheScreen();
  });

  it('"Saved" opens the saved venues', async () => {
    await renderCoach();
    await fireEvent.press(screen.getByRole('button', { name: en('coach.android.a11y.menu') }));
    await fireEvent.press(screen.getByTestId('coach.drawer.saved'));
    await settle();
    expect(screen.getByText('Profile {"initialTab":"saved"}')).toBeOnTheScreen();
  });
});

// ---------------------------------------------------------------------------

describe('dictation', () => {
  it('listens in US English, on the phone where it can, and streams into the input', async () => {
    fakeSpeech.onDevice = true;
    await renderCoach();
    await fireEvent.press(screen.getByRole('button', { name: en('coach.a11y.start_voice') }));
    await settle();
    expect(fakeSpeech.started).toEqual([
      { lang: 'en-US', interimResults: true, continuous: false, requiresOnDeviceRecognition: true },
    ]);
    expect(screen.getByRole('button', { name: en('coach.a11y.stop_recording') })).toBeOnTheScreen();
    await act(async () => fakeSpeech.result('a sauna near'));
    expect(screen.getByTestId('coach.input').props.value).toBe('a sauna near');
    await act(async () => fakeSpeech.result('a sauna near me', true));
    expect(screen.getByTestId('coach.input').props.value).toBe('a sauna near me');
    // Nothing is sent until the member taps send.
    expect(api.sentAll('/coach')).toHaveLength(0);
  });

  it('a phone that cannot recognise on the device uses the system recogniser', async () => {
    fakeSpeech.onDevice = false;
    await renderCoach();
    await fireEvent.press(screen.getByRole('button', { name: en('coach.a11y.start_voice') }));
    await settle();
    expect(fakeSpeech.started.map((options) => options.requiresOnDeviceRecognition)).toEqual([false]);
  });

  it('an on-device refusal of the language asks the system recogniser once', async () => {
    await renderCoach();
    await fireEvent.press(screen.getByRole('button', { name: en('coach.a11y.start_voice') }));
    await settle();
    await act(async () => fakeSpeech.emit('error', { error: 'language-not-supported', message: '' }));
    expect(fakeSpeech.started.map((options) => options.requiresOnDeviceRecognition)).toEqual([true, false]);
  });

  it('refused, it says where to turn the microphone on, in the account language', async () => {
    useAppStore.setState({ profile: profile({ locale: 'is' }) });
    fakeSpeech.granted = false;
    await renderCoach();
    await fireEvent.press(screen.getByRole('button', { name: lookup('coach.a11y.start_voice', 'is') }));
    await settle();
    expect(screen.getByText(lookup('coach.mic.denied_title', 'is'))).toBeOnTheScreen();
    expect(screen.getByText(lookup('coach.mic.denied_body', 'is'))).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: lookup('coach.mic.open_settings', 'is') })).toBeOnTheScreen();
    expect(fakeSpeech.started).toEqual([]);
  });

  it('stops when the Coach loses focus', async () => {
    await renderCoach();
    await fireEvent.press(screen.getByRole('button', { name: en('coach.a11y.start_voice') }));
    await settle();
    expect(fakeSpeech.stops).toBe(0);
    await act(async () => navigation.navigate('Elsewhere'));
    await settle();
    expect(fakeSpeech.stops).toBe(1);
  });
});
