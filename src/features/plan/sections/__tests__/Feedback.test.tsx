/**
 * Plan's monthly feedback section (iOS PlanView `feedbackSection`): drawn
 * only with the feature, consent, today on the strip and something to draw;
 * what each of the card's buttons does on Plan's stack; and a note marked
 * seen only while Plan's first screen is the one showing.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNavigationContainerRef, NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { api, Reply } from '@test/server';
import { Text } from 'react-native';

import { decodeFeedbackSummary } from '../../../../api/feedback';
import { decodeProfile } from '../../../../api/profile';
import { stubApiClientPerTest } from '../../../../api/testing';
import { FeedbackKeys } from '../../../../health/localKeys';
import { resetHealthStoreForTests, useHealthStore } from '../../../../health/store';
import { translate } from '../../../../i18n';
import { addServerDays, todayServerDay } from '../../../../i18n/format';
import { setAnalyticsObserver, type AnalyticsParams } from '../../../../lib/analytics';
import { resetAppStoreForTests, useAppStore } from '../../../../stores/appStore';
import { resetIntentStoreForTests, useIntentStore } from '../../../../stores/intentStore';
import { useFeedbackStore } from '../../../feedback';
import { attachPlanNavigator } from '../../shell/planShell';
import FeedbackSection from '../Feedback';

// @expo/vector-icons loads expo-font, which needs expo-asset (installed under expo/).
jest.mock('expo-asset', () => jest.requireActual('expo/node_modules/expo-asset'), { virtual: true });

stubApiClientPerTest();

const en = (key: string) => translate(key, 'en');
const MEMBER = '8c2c1b36-2a7e-4b1f-9e0e-2f1c4f0a9c11';
const CONSENT = { version: '2026-09-v1', consentedAt: '2026-09-20T10:00:00Z', ageSource: 'self_attested' };

function signIn({ features = ['health_feedback', 'plan_revision'], consent = true } = {}): void {
  useAppStore.setState({
    isAuthenticated: true,
    isLoading: false,
    userId: MEMBER,
    serverFeatures: features,
    profile: decodeProfile({
      id: MEMBER,
      email: 'member@example.com',
      locale: 'en',
      kennitalaVerified: true,
      marketingConsent: false,
      health: { access: 'entitled', consent: consent ? CONSENT : null },
    }),
  });
}

const SETTINGS = { monthlyReport: true, midMonthNote: true, includeFoodAndWeight: true, includeFoodAndWeightSource: 'plan', updatedAt: null };
const LATEST = {
  id: 'r-1',
  kind: 'monthly',
  periodMonth: '2026-09',
  title: 'September 2026',
  createdAt: new Date().toISOString(),
  seenAt: null,
  current: true,
  highlights: ['You trained 11 times.'],
};
const NOTE = {
  id: 'n-1',
  seenAt: null,
  message: { key: 'note.logging_paused', text: 'No meals logged this past week.', action: 'log_meal' },
};

function seed(extra: Record<string, unknown> = {}): void {
  useFeedbackStore.setState({
    summary: decodeFeedbackSummary({ settings: SETTINGS, latest: LATEST, note: null, nextReport: null, foodAndWeightOffer: false, ...extra }, 'f'),
    flags: { profileId: MEMBER, introDismissed: false, foodOfferDismissed: false, foodOffPending: false },
  });
}

let navigated: { name: string; params?: object }[];
let poppedToTop: number;
let events: { event: string; params: AnalyticsParams }[];
let detach: () => void;

async function settle(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 8; i += 1) await new Promise<void>((resolve) => setTimeout(resolve, 0));
  });
}

beforeEach(() => {
  resetAppStoreForTests();
  resetHealthStoreForTests();
  resetIntentStoreForTests();
  useFeedbackStore.getState().wipe();
  useFeedbackStore.setState({ staleFeatures: null });
  navigated = [];
  poppedToTop = 0;
  events = [];
  setAnalyticsObserver((event, params) => events.push({ event, params }));
  detach = attachPlanNavigator({
    navigate: (name, params) => navigated.push({ name, params }),
    popToTop: () => {
      poppedToTop += 1;
    },
  });
});

afterEach(() => {
  detach();
  setAnalyticsObserver(null);
});

describe('when it draws', () => {
  it('draws the card with the feature, consent and today on the strip', async () => {
    signIn();
    seed();
    await render(<FeedbackSection />);
    expect(screen.getByRole('header', { name: 'September 2026' })).toBeOnTheScreen();
  });

  it.each([
    ['without the feature', () => signIn({ features: ['plan_revision'] })],
    ['without consent', () => signIn({ consent: false })],
    [
      'on another day of the strip',
      () => {
        signIn();
        useHealthStore.setState({ selectedDate: addServerDays(todayServerDay(), -1)! });
      },
    ],
  ])('draws nothing %s', async (_name, setUp) => {
    setUp();
    seed();
    await render(<FeedbackSection />);
    expect(screen.queryByTestId('feedback.section')).toBeNull();
  });

  it('draws nothing with nothing to say', async () => {
    signIn();
    seed({ latest: null, settings: { ...SETTINGS, monthlyReport: false } });
    await render(<FeedbackSection />);
    expect(screen.queryByTestId('feedback.section')).toBeNull();
  });

  it("reads the member's flags itself: an intro closed before stays closed", async () => {
    signIn();
    await AsyncStorage.setItem(FeedbackKeys.introDismissed(MEMBER), 'true');
    useFeedbackStore.setState({
      summary: decodeFeedbackSummary({ settings: SETTINGS, latest: null, note: null, nextReport: null, foodAndWeightOffer: false }, 'f'),
    });
    await render(<FeedbackSection />);
    await settle();
    expect(screen.queryByTestId('feedback.intro')).toBeNull();
  });
});

describe("the card's buttons", () => {
  it('See your month and Past months push onto Plan', async () => {
    signIn();
    seed();
    await render(<FeedbackSection />);
    await fireEvent.press(screen.getByRole('button', { name: en('feedback.card.open') }));
    await fireEvent.press(screen.getByRole('button', { name: en('feedback.card.history') }));
    expect(navigated).toEqual([{ name: 'FeedbackReport', params: { reportId: 'r-1' } }, { name: 'FeedbackHistory', params: undefined }]);
    expect(events).toEqual([{ event: 'feedback_opened', params: { entry: 'card' } }]);
  });

  it('Choose what is in it closes the intro and opens Body and goals on the feedback', async () => {
    signIn();
    seed({ latest: null });
    await render(<FeedbackSection />);
    await fireEvent.press(screen.getByRole('button', { name: en('feedback.intro.choose') }));
    expect(navigated).toEqual([{ name: 'BodyAndGoals', params: { anchor: 'feedback' } }]);
    expect(screen.queryByTestId('feedback.intro')).toBeNull();
    expect(await AsyncStorage.getItem(FeedbackKeys.introDismissed(MEMBER))).toBe('true');
  });

  it('the note is seen when shown; its action opens the meal page from Plan', async () => {
    signIn();
    seed({ note: NOTE });
    api.on('POST', '/health/feedback/reports/:id', Reply.ok({ id: 'n-1', seenAt: '2026-10-12T18:00:00.000Z', dismissedAt: null }));
    await render(<FeedbackSection />);
    await settle();
    expect(api.sent('/health/feedback/reports/n-1', 'POST').body).toEqual({ action: 'seen' });
    await fireEvent.press(screen.getByRole('button', { name: en('feedback.action.log_meal') }));
    expect(poppedToTop).toBe(1);
    expect(navigated.map((n) => n.name)).toEqual(['MealCapture']);
    expect(navigated[0]!.params).toMatchObject({ origin: 'plan', mode: 'search', date: todayServerDay() });
    expect(events.map((e) => e.event)).toContain('feedback_action_tapped');
    expect(events.find((e) => e.event === 'feedback_action_tapped')?.params).toEqual({ action: 'log_meal' });
  });

  it('Hide hides the note', async () => {
    signIn();
    seed({ note: { ...NOTE, seenAt: '2026-10-12T10:00:00Z' } });
    api.on('POST', '/health/feedback/reports/:id', Reply.ok({ id: 'n-1', seenAt: null, dismissedAt: '2026-10-12T18:00:00.000Z' }));
    await render(<FeedbackSection />);
    await fireEvent.press(screen.getByRole('button', { name: en('feedback.note.dismiss') }));
    await settle();
    expect(screen.queryByTestId('feedback.note')).toBeNull();
    expect(api.sent('/health/feedback/reports/n-1', 'POST').body).toEqual({ action: 'dismiss' });
  });

  it('Include food and weight saves the switch and says so when it took', async () => {
    signIn();
    seed({
      latest: null,
      settings: { ...SETTINGS, includeFoodAndWeight: false, includeFoodAndWeightSource: 'no_plan' },
      foodAndWeightOffer: true,
    });
    api.on(
      'PUT',
      '/health/feedback/settings',
      Reply.ok({ settings: { ...SETTINGS, includeFoodAndWeightSource: 'member' }, features: ['health_feedback'] }),
    );
    api.on('GET', '/health/feedback', Reply.ok({ settings: { ...SETTINGS, includeFoodAndWeightSource: 'member' }, latest: null, features: ['health_feedback'] }));
    await render(<FeedbackSection />);
    await fireEvent.press(screen.getByRole('button', { name: en('feedback.offer.on') }));
    await settle();
    expect(api.sent('/health/feedback/settings', 'PUT').rawBody).toBe('{"includeFoodAndWeight":true}');
    expect(useHealthStore.getState().toastKey).toBe('feedback.offer.done');
    expect(screen.queryByTestId('feedback.offer')).toBeNull();
    expect(events.map((e) => e.event)).toEqual([]);
  });

  it('Adjust my plan goes to the Coach with nothing from the report', async () => {
    signIn();
    useHealthStore.setState({
      today: { program: { id: 'prog-1', status: 'active' } } as unknown as ReturnType<typeof useHealthStore.getState>['today'],
    });
    seed({ note: { ...NOTE, seenAt: '2026-10-12T10:00:00Z', message: { key: 'k', text: 'Workouts were hard to fit in.', action: 'adjust_plan' } } });
    await render(<FeedbackSection />);
    await fireEvent.press(screen.getByRole('button', { name: en('coach.chip.adjust_plan') }));
    const intents = useIntentStore.getState();
    expect(intents.pendingCoachProgram).toEqual({ kind: 'adjust' });
    expect(intents.pendingTab).toBe('Coach');
    expect(intents.pendingCoachPrompt).toBeNull();
  });
});

describe('the note is seen only on screen', () => {
  function Other() {
    return <Text>other</Text>;
  }

  const SEEN_ANSWER = Reply.ok({ id: 'n-1', seenAt: '2026-10-12T18:00:00.000Z', dismissedAt: null });

  it('a note that lands while Plan is mounted under another tab waits for Plan', async () => {
    signIn();
    seed();
    api.on('POST', '/health/feedback/reports/:id', SEEN_ANSWER);
    const ref = createNavigationContainerRef<{ Home: undefined; Plan: undefined }>();
    const Tab = createBottomTabNavigator();
    await render(
      <NavigationContainer ref={ref}>
        <Tab.Navigator screenOptions={{ headerShown: false }} initialRouteName="Plan">
          <Tab.Screen name="Home" component={Other} />
          <Tab.Screen name="Plan" component={FeedbackSection} />
        </Tab.Navigator>
      </NavigationContainer>,
    );
    await settle();
    await act(async () => ref.navigate('Home'));
    // The app came back to the front on Home; the activation read brought a note.
    await act(async () => seed({ note: NOTE }));
    await settle();
    expect(screen.getByText('No meals logged this past week.', { includeHiddenElements: true })).toBeTruthy();
    expect(api.sentAll('/health/feedback/reports/n-1', 'POST')).toHaveLength(0);

    await act(async () => ref.navigate('Plan'));
    await settle();
    expect(api.sentAll('/health/feedback/reports/n-1', 'POST').map((r) => r.body)).toEqual([{ action: 'seen' }]);
  });

  it("a note that lands under a screen pushed on Plan waits for Plan's return", async () => {
    signIn();
    seed();
    api.on('POST', '/health/feedback/reports/:id', SEEN_ANSWER);
    const ref = createNavigationContainerRef<{ PlanMain: undefined; FeedbackReport: undefined }>();
    const Stack = createNativeStackNavigator();
    await render(
      <NavigationContainer ref={ref}>
        <Stack.Navigator screenOptions={{ headerShown: false }}>
          <Stack.Screen name="PlanMain" component={FeedbackSection} />
          <Stack.Screen name="FeedbackReport" component={Other} />
        </Stack.Navigator>
      </NavigationContainer>,
    );
    await settle();
    await act(async () => ref.navigate('FeedbackReport'));
    await act(async () => seed({ note: NOTE }));
    await settle();
    expect(api.sentAll('/health/feedback/reports/n-1', 'POST')).toHaveLength(0);

    await act(async () => ref.goBack());
    await settle();
    expect(api.sentAll('/health/feedback/reports/n-1', 'POST').map((r) => r.body)).toEqual([{ action: 'seen' }]);
  });
});
