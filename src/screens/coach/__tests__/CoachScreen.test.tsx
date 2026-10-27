/**
 * The Coach tab on screen (iOS CoachView.swift): the empty state and its
 * chips' gating, the free tier's line and card, the locking input, the
 * drawer (its Saved presenting the Saved sheet), venue cards' "Book it" by
 * slug, a class answer's cards (Book, close and show again), parked prompts
 * consumed on every appearance, and dictation (en-US, on the phone where it can, stopped when
 * the tab loses focus, never while locked).
 *
 * The four flows are COACH-2 to COACH-5's. The venue wizard (COACH-2) is the
 * real one, so the words this file sends (typed, dictated or parked) name no
 * venue type and ask for no plan: they reach the model. The wizard on screen, parked
 * Home prompts that open it included, is tested in
 * src/features/coach/flows/__tests__.
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
import { bottomSheetMock } from '../../../components/ui/testing/bottomSheetMock';
import {
  pendingCoachSaves,
  resetCoachStoreForTests,
  useCoachStore,
} from '../../../features/coach/store/coachStore';
import { claimCoachForMember } from '../../../features/coach/register';
import { favouritesStore } from '../../../features/favourites';
import { CARDS_EN, envelope, onDay } from '../../../features/coach/chat/__tests__/classCardFixtures';
import { lookup, translatePlural } from '../../../i18n';
import { runSignInHooks } from '../../../app/signOut';
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
// The sheets as the library draws them (the Saved sheet's portal and dismissal).
jest.mock('@gorhom/bottom-sheet', () => require('../../../components/ui/testing/bottomSheetMock').bottomSheetModule);
// The hearts are VENUE-2's store; here a heart only has to draw. The Saved
// sheet reads the real store.
jest.mock('../../../features/favourites', () => ({
  ...jest.requireActual('../../../features/favourites'),
  useFavourite: () => ({ isFavourite: false, loading: false, toggle: async () => undefined }),
}));
// A class card's Book is the day plan's own (tested with the class sheet in
// src/features/classes/sheet/__tests__/coachLookup.test.ts); here only that
// the card hands it its session.
jest.mock('../../../features/coach/dayPlan/wizard', () => ({
  ...jest.requireActual('../../../features/coach/dayPlan/wizard'),
  bookPlanClass: jest.fn(async () => undefined),
}));
/* eslint-enable @typescript-eslint/no-require-imports */

const wizard = jest.requireMock('../../../features/coach/dayPlan/wizard') as { bookPlanClass: jest.Mock };

stubApiClientPerTest();

const MEMBER_A = '8c2c1b36-2a7e-4b1f-9e0e-2f1c4f0a9c11';
const MEMBER_B = '3c4c1b36-2a7e-4b1f-9e0e-2f1c4f0a9c22';
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

beforeEach(async () => {
  bottomSheetMock.reset();
  favouritesStore.getState().reset();
  resetAppStoreForTests();
  resetIntentStoreForTests();
  resetCoachStoreForTests();
  resetSpeechModuleForTests();
  fakeSpeech.reset();
  useAppStore.setState({ isAuthenticated: true, userId: MEMBER_A, profile: profile() });
  // The sign-in hook claims the saved chats before the tabs appear.
  await claimCoachForMember(MEMBER_A, false);
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

  it('reads "Change my plan" while a plan runs on a server that changes plans by chat (COACH-6), and it asks what to change', async () => {
    const withConsent = profile({
      health: {
        access: 'entitled',
        program: { id: 'program-1', status: 'active' },
        consent: { version: '2026-09-v3', consentedAt: '2026-09-01T10:00:00Z', ageSource: 'kennitala' },
      },
    });
    useAppStore.setState({ profile: withConsent, serverFeatures: ['plan_revision', 'plan_edit'] });
    await renderCoach();
    expect(screen.queryByRole('button', { name: en('coach.chip.adjust_plan') })).toBeNull();
    await fireEvent.press(screen.getByTestId('coach.chip.planEdit'));
    expect(screen.getByText(en('coach.planEdit.ask'))).toBeOnTheScreen();
    expect(api.sentAll('/coach')).toHaveLength(0);
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

  it('a class answer lists its classes under the reply: Book hands over the session, the list closes and comes back', async () => {
    // The server's own recorded answer, moved a year ahead so its classes are upcoming.
    api.on('POST', '/coach', Reply.json(200, envelope(onDay(CARDS_EN, '2099-10-13'))));
    await renderCoach();
    await fireEvent.changeText(screen.getByTestId('coach.input'), 'any classes in Akureyri?');
    await fireEvent(screen.getByTestId('coach.input'), 'submitEditing');
    await settle();
    expect((api.sent('/coach', 'POST').body as { cards?: string[] }).cards).toEqual(['classes']);
    expect(screen.getByText('Here are classes in Akureyri today. Tap one to book.')).toBeOnTheScreen();
    expect(screen.getByTestId('coach.classes')).toBeOnTheScreen();

    await fireEvent.press(screen.getByTestId('coach.classes.row.cls_292c2799eb.book'));
    await settle();
    expect(wizard.bookPlanClass).toHaveBeenCalledTimes(1);
    expect(wizard.bookPlanClass.mock.calls[0]![0]).toMatchObject({ id: 'cls_292c2799eb', booking: { eventId: 2_102_243_144 } });
    // A full class offers no Book.
    expect(screen.queryByTestId('coach.classes.row.cls_be41a59600.book')).toBeNull();

    await fireEvent.press(screen.getByRole('button', { name: en('coach.classes.close') }));
    expect(screen.queryByTestId('coach.classes')).toBeNull();
    expect(useCoachStore.getState().messages.at(-1)!.classCardsHidden).toBe(true);
    await fireEvent.press(screen.getByRole('button', { name: lookup('coach.classes.show', 'en').replace('{count}', '4') }));
    expect(screen.getByTestId('coach.classes')).toBeOnTheScreen();
  });

  it('a prompt parked by Home is sent on the next appearance, and one parked while on screen too', async () => {
    api.on('POST', '/coach', (request) =>
      Reply.ok({ reply: `re: ${(request.body as { messages: { content: string }[] }).messages.at(-1)!.content}` }),
    );
    useIntentStore.getState().parkCoachPrompt('What should I eat after training?');
    await renderCoach();
    await settle();
    expect(screen.getByText('re: What should I eat after training?')).toBeOnTheScreen();

    await act(async () => useIntentStore.getState().parkCoachPrompt('Help me unwind after a long week.'));
    await settle();
    expect(screen.getByText('re: Help me unwind after a long week.')).toBeOnTheScreen();
    expect(api.sentAll('/coach')).toHaveLength(2);
  });

  it('a prompt parked while a venue page covers the chat takes the tab back to the chat and is sent at once', async () => {
    api.on('POST', '/coach', Reply.ok({ reply: 'Here is a calm evening.' }));
    await renderCoach();
    await act(async () => navigation.navigate('VenueDetail', { slug: 'sky-lagoon' }));
    await settle();
    expect(screen.getByText('VenueDetail {"slug":"sky-lagoon"}')).toBeOnTheScreen();

    // Home parks it (the member went to Home and tapped a card).
    await act(async () => useIntentStore.getState().parkCoachPrompt('Help me unwind after a long week.'));
    await settle();
    expect(screen.queryByText('VenueDetail {"slug":"sky-lagoon"}')).toBeNull();
    expect(screen.getByText('Here is a calm evening.')).toBeOnTheScreen();
    expect(useIntentStore.getState().pendingCoachPrompt).toBeNull();
    expect(api.sentAll('/coach')).toHaveLength(1);
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

describe('where a flow sends the member (iOS programRoute)', () => {
  it('the Plan tab, and Plan opened on its past plans or the saved proposal', async () => {
    await renderCoach();
    await act(async () => useCoachStore.getState().route({ kind: 'planTab' }));
    expect(useIntentStore.getState().pendingTab).toBe('Plan');
    expect(useIntentStore.getState().pendingPlanAction).toBeNull();

    await act(async () => useCoachStore.getState().route({ kind: 'pastPlans' }));
    expect(useIntentStore.getState().pendingPlanAction?.action).toEqual({ kind: 'openPastPlans' });

    await act(async () => useCoachStore.getState().route({ kind: 'savedProposal' }));
    expect(useIntentStore.getState().pendingPlanAction?.action).toEqual({ kind: 'openProposal' });
    // Each is performed once.
    expect(useCoachStore.getState().pendingRoute).toBeNull();
  });

  it('the memberships screen, Account, and a venue by slug', async () => {
    await renderCoach();
    await act(async () => useCoachStore.getState().route({ kind: 'plans' }));
    await settle();
    expect(screen.getByText('Plans {}')).toBeOnTheScreen();

    await act(async () => navigation.goBack());
    await act(async () => useCoachStore.getState().route({ kind: 'account' }));
    await settle();
    expect(screen.getByText('Account {}')).toBeOnTheScreen();

    await act(async () => navigation.goBack());
    await act(async () => useCoachStore.getState().route({ kind: 'venue', slug: 'laugardalslaug' }));
    await settle();
    expect(screen.getByText('VenueDetail {"slug":"laugardalslaug"}')).toBeOnTheScreen();
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

    await fireEvent.changeText(screen.getByTestId('coach.input'), 'somewhere calm near Laugardalur?');
    await fireEvent(screen.getByTestId('coach.input'), 'submitEditing');
    await settle();

    await fireEvent.press(screen.getByRole('button', { name: en('coach.android.a11y.menu') }));
    await fireEvent.press(screen.getByTestId('coach.drawer.add_chat'));
    await settle();
    // The empty state is back, and the chat is in RECENTS.
    expect(screen.getByRole('header', { name: en('coach.empty.heading') })).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: en('coach.android.a11y.menu') }));
    const drawer = screen.getByTestId('coach.drawer');
    await fireEvent.press(within(drawer).getByRole('button', { name: 'somewhere calm near Laugardalur?' }));
    await settle();
    expect(screen.getByText('Three pools.')).toBeOnTheScreen();
  });

  it("another account signing in with the tabs still up sees none of the last member's chats", async () => {
    api.on('POST', '/coach', Reply.ok({ reply: 'Three pools.' }));
    await renderCoach();
    await fireEvent.changeText(screen.getByTestId('coach.input'), "A's question");
    await fireEvent(screen.getByTestId('coach.input'), 'submitEditing');
    await settle();
    await fireEvent.press(screen.getByRole('button', { name: en('coach.android.a11y.menu') }));
    await fireEvent.press(screen.getByTestId('coach.drawer.add_chat'));
    await settle();
    await fireEvent.press(screen.getByRole('button', { name: en('coach.android.a11y.menu') }));
    expect(within(screen.getByTestId('coach.drawer')).getByRole('button', { name: "A's question" })).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: en('common.close') }));

    // An auth link for B: the user id changes first, then the sign-in hooks run.
    await act(async () => {
      useAppStore.setState({ userId: MEMBER_B });
      await runSignInHooks({ userId: MEMBER_B, restoredSession: false });
    });
    await settle();
    await fireEvent.press(screen.getByRole('button', { name: en('coach.android.a11y.menu') }));
    expect(screen.getByText(en('coach.drawer.no_recents'))).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: "A's question" })).toBeNull();
  });

  it('"Saved" closes the drawer and presents the Saved sheet, saved classes and all', async () => {
    api.on(
      'GET',
      '/favourites',
      Reply.ok({
        venues: [
          {
            id: 'faaaaaaa-0000-4000-8000-000000000001',
            venueId: 'aaaaaaaa-0000-4000-8000-000000000001',
            slug: 'laugar',
            name: 'Laugar',
            description: null,
            city: 'Reykjavík',
            address: null,
            inBundle: false,
            imageUrl: null,
            categories: ['spa'],
            createdAt: '2026-10-02T14:00:00.000Z',
          },
        ],
        activities: [
          {
            id: 'accccccc-0000-4000-8000-000000000001',
            activityId: 'cccccccc-0000-4000-8000-000000000001',
            name: 'Hot Yoga',
            description: null,
            durationMinutes: 60,
            imageUrl: null,
            venueId: '1b9c6d2e-3f40-4a51-8b62-7c83d94e05f1',
            venueSlug: 'yoga-shala',
            venueName: 'Yoga Shala',
            createdAt: '2026-10-02T14:00:00.000Z',
          },
        ],
      }),
    );
    api.on('GET', '/venues', Reply.ok({ data: [], pagination: { nextCursor: null, hasMore: false, limit: 100 } }));
    await renderCoach();
    await fireEvent.press(screen.getByRole('button', { name: en('coach.android.a11y.menu') }));
    await fireEvent.press(screen.getByTestId('coach.drawer.saved'));
    await settle();

    expect(screen.getByTestId('saved.sheet')).toBeOnTheScreen();
    expect(navigation.getCurrentRoute()?.name).toBe('CoachMain');
    expect(screen.getByText('Laugar')).toBeOnTheScreen();
    expect(screen.getByTestId('saved.venue.aaaaaaaa-0000-4000-8000-000000000001.premium')).toBeOnTheScreen();
    expect(screen.getByText(en('saved.classes').toUpperCase())).toBeOnTheScreen();
    expect(screen.getByText('Hot Yoga')).toBeOnTheScreen();

    // A saved class opens its venue's page, the sheet gone first.
    await fireEvent.press(screen.getByTestId('saved.class.cccccccc-0000-4000-8000-000000000001'));
    await settle();
    expect(screen.getByText('VenueDetail {"slug":"yoga-shala"}')).toBeOnTheScreen();
    expect(screen.queryByTestId('saved.sheet')).toBeNull();
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
    // Android has no Speech Recognition permission: the sentence names only the microphone.
    expect(screen.getByText(lookup('coach.android.mic.denied_body', 'is'))).toBeOnTheScreen();
    expect(screen.queryByText(lookup('coach.mic.denied_body', 'is'))).toBeNull();
    expect(screen.getByRole('button', { name: lookup('coach.mic.open_settings', 'is') })).toBeOnTheScreen();
    expect(fakeSpeech.started).toEqual([]);
  });

  it('a phone with no speech service says so, and does not send the member to Settings', async () => {
    fakeSpeech.available = false;
    await renderCoach();
    await fireEvent.press(screen.getByRole('button', { name: en('coach.a11y.start_voice') }));
    await settle();
    expect(screen.getByText(en('coach.android.voice_unavailable'))).toBeOnTheScreen();
    expect(screen.queryByText(en('coach.mic.denied_title'))).toBeNull();
    expect(screen.queryByRole('button', { name: en('coach.mic.open_settings') })).toBeNull();
    expect(fakeSpeech.started).toEqual([]);
  });

  it('stops when the Coach loses focus', async () => {
    await renderCoach();
    await fireEvent.press(screen.getByRole('button', { name: en('coach.a11y.start_voice') }));
    await settle();
    expect(fakeSpeech.aborts).toBe(0);
    await act(async () => navigation.navigate('Elsewhere'));
    await settle();
    expect(fakeSpeech.aborts).toBe(1);
  });

  it('a send mid-dictation leaves the input empty: nothing the recogniser still says comes back', async () => {
    api.on('POST', '/coach', Reply.ok({ reply: 'Sky Lagoon.' }));
    await renderCoach();
    await fireEvent.press(screen.getByRole('button', { name: en('coach.a11y.start_voice') }));
    await settle();
    await act(async () => fakeSpeech.result('somewhere quiet near me'));
    await fireEvent(screen.getByTestId('coach.input'), 'submitEditing');
    // A final result the native module still delivers after the send.
    await act(async () => fakeSpeech.result('somewhere quiet near me', true));
    await settle();
    expect(screen.getByTestId('coach.input').props.value).toBe('');
    expect(fakeSpeech.stops).toBe(0);
    expect(api.sentAll('/coach')).toHaveLength(1);
  });

  it('leaving before the recogniser has started still cancels it', async () => {
    fakeSpeech.autoStart = false;
    await renderCoach();
    await fireEvent.press(screen.getByRole('button', { name: en('coach.a11y.start_voice') }));
    await settle();
    expect(fakeSpeech.started).toHaveLength(1);
    await act(async () => navigation.navigate('Elsewhere'));
    await settle();
    expect(fakeSpeech.aborts).toBe(1);
    // The recogniser's late 'start' and words go nowhere.
    await act(async () => fakeSpeech.emit('start', {}));
    await act(async () => fakeSpeech.result('off screen'));
    await act(async () => navigation.goBack());
    await settle();
    expect(screen.getByTestId('coach.input').props.value).toBe('');
    expect(screen.queryByRole('button', { name: en('coach.a11y.stop_recording') })).toBeNull();
  });

  it('leaving while the microphone prompt is up never starts listening off screen', async () => {
    fakeSpeech.holdPermission = true;
    await renderCoach();
    await fireEvent.press(screen.getByRole('button', { name: en('coach.a11y.start_voice') }));
    await settle();
    await act(async () => navigation.navigate('Elsewhere'));
    await settle();
    await act(async () => fakeSpeech.answerPermission());
    await settle();
    expect(fakeSpeech.started).toEqual([]);
  });
});
