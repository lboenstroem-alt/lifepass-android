/**
 * The weekly review slot on the Plan tab (iOS PlanView `reviewSection`), in
 * the real Plan screen: the check-in prompt or the review, the heading Plan
 * moves TalkBack onto, and the three doors to the check-in sheet (the
 * prompt card, Plan's bridge as the Today card calls it, the notification's
 * parked action).
 */
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { api, Reply } from '@test/server';
import { Text } from 'react-native';

import { stubApiClientPerTest } from '../../../../api/testing';
import { UiKitProvider } from '../../../../components/ui';
import { bottomSheetMock } from '../../../../components/ui/testing/bottomSheetMock';
import * as healthLocalStore from '../../../../health/localStore';
import { translate } from '../../../../i18n';
import { useIntentStore } from '../../../../stores/intentStore';
import { dayJSON, freshPlan, memberProfile, recordAnalytics, settle, signIn, TODAY } from '../../__tests__/planFixtures';
import { resetWeeklyCheckInPresenterForTests, useWeeklyCheckInPresenter } from '../../checkin/presenter';
import PlanScreen from '../../PlanScreen';
import { openPlanWeeklyCheckIn } from '../../sections/WeeklyReview';
import { installWeeklyCheckInOpener, usePlanBridges } from '../../shell/bridges';
import { planFocusTarget } from '../../shell/focusTargets';
import { usePlanShell } from '../../shell/planShell';

jest.mock('@gorhom/bottom-sheet', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('../../../../components/ui/testing/bottomSheetMock').bottomSheetModule,
);
jest.mock('expo-asset', () => jest.requireActual('expo/node_modules/expo-asset'), { virtual: true });

stubApiClientPerTest();

const en = (key: string, params?: Record<string, string | number>) => translate(key, 'en', params);

const Stack = createNativeStackNavigator();

function StandIn({ route }: { route: { name: string } }) {
  return <Text>{`route:${route.name}`}</Text>;
}

async function renderPlan() {
  await render(
    <NavigationContainer>
      <UiKitProvider>
        <Stack.Navigator screenOptions={{ headerShown: false }}>
          <Stack.Screen name="PlanMain" component={PlanScreen as never} />
          <Stack.Screen name="BodyAndGoals" component={StandIn as never} />
        </Stack.Navigator>
      </UiKitProvider>
    </NavigationContainer>,
  );
  await act(async () => settle());
}

const REVIEW = {
  id: 'r-1',
  weekStartsOn: '2026-10-05',
  hasPlan: true,
  sessionsPlanned: 3,
  sessionsDone: 3,
  checkInsCount: 2,
  streakWeeks: 1,
  nextWeekChange: { kind: 'add_set', text: 'One more set on squats.' },
  insight: { key: 'insight.streak', text: 'Three for three.' },
};

const WEIGH_IN = { due: true, lastWeightKg: 80, lastMeasuredAt: '2026-10-12T08:00:00Z', heightCm: 180, heightConfirmDue: false };

beforeEach(() => {
  freshPlan();
  bottomSheetMock.reset();
  resetWeeklyCheckInPresenterForTests();
  // A fresh process loses the opener the slot installs as Plan loads it; put it back.
  installWeeklyCheckInOpener(openPlanWeeklyCheckIn);
});

afterEach(async () => {
  await settle();
  await healthLocalStore.settled();
});

describe('which card', () => {
  it('last week\'s review, every line the server sent, with its heading registered for TalkBack', async () => {
    signIn();
    api.on('GET', '/health', Reply.ok(dayJSON(TODAY, { checkIn: { due: false }, review: REVIEW })));
    await renderPlan();
    expect(screen.getByText(en('review.kicker', { date: 'Mon 5 Oct' }).toUpperCase())).toBeOnTheScreen();
    expect(screen.getByRole('header', { name: en('review.title') })).toBeOnTheScreen();
    expect(screen.getByText(en('review.sessions', { done: 3, planned: 3 }))).toBeOnTheScreen();
    expect(screen.getByText(en('review.check_ins.many', { count: 2 }))).toBeOnTheScreen();
    expect(screen.getByText(en('review.streak.one', { count: 1 }))).toBeOnTheScreen();
    expect(screen.getByText(en('review.next_week').toUpperCase())).toBeOnTheScreen();
    expect(screen.getByText('One more set on squats.')).toBeOnTheScreen();
    expect(screen.getByText('Three for three.')).toBeOnTheScreen();
    expect(planFocusTarget('review')).not.toBeNull();
    expect(screen.queryByTestId('plan.review.prompt')).toBeNull();
  });

  it('the week is up: the prompt instead of the review, and its button opens the check-in', async () => {
    const events = recordAnalytics();
    signIn();
    api.on('GET', '/health', Reply.ok(dayJSON(TODAY, { checkIn: { due: true }, review: REVIEW, weighIn: WEIGH_IN })));
    await renderPlan();
    expect(screen.getByRole('header', { name: en('review.prompt.title') })).toBeOnTheScreen();
    expect(screen.getByText(en('review.prompt.body'))).toBeOnTheScreen();
    expect(screen.queryByText(en('review.sessions', { done: 3, planned: 3 }))).toBeNull();
    expect(planFocusTarget('review')).not.toBeNull();

    await fireEvent.press(screen.getByRole('button', { name: en('review.prompt.cta') }));
    expect(await screen.findByRole('header', { name: en('checkin.title') })).toBeOnTheScreen();
    expect(screen.getByTestId('plan.checkin.weight.input').props.value).toBe('80');
    expect(events).toEqual(
      expect.arrayContaining([
        { event: 'review_prompt_opened', params: {} },
        { event: 'weekly_checkin_opened', params: { entry: 'review_card' } },
      ]),
    );
  });

  it('a member who is not entitled never gets the prompt, only the review they have', async () => {
    signIn(memberProfile({ access: 'past_due' }));
    api.on('GET', '/health', Reply.ok(dayJSON(TODAY, { checkIn: { due: true }, review: REVIEW })));
    await renderPlan();
    expect(screen.queryByTestId('plan.review.prompt')).toBeNull();
    expect(screen.getByRole('header', { name: en('review.title') })).toBeOnTheScreen();
  });

  it('nothing to show: no card at all', async () => {
    signIn();
    api.on('GET', '/health', Reply.ok(dayJSON(TODAY, { checkIn: { due: false }, review: null })));
    await renderPlan();
    expect(screen.queryByTestId('plan.review')).toBeNull();
    expect(screen.queryByTestId('plan.review.prompt')).toBeNull();
    expect(planFocusTarget('review')).toBeNull();
  });
});

describe('the doors to the check-in', () => {
  it('Plan\'s bridge (the Today card\'s row) opens the same sheet', async () => {
    const events = recordAnalytics();
    signIn();
    api.on('GET', '/health', Reply.ok(dayJSON(TODAY, { checkIn: { due: true }, weighIn: WEIGH_IN })));
    await renderPlan();
    await act(async () => {
      usePlanBridges.getState().weeklyCheckIn?.('plan');
    });
    expect(await screen.findByRole('header', { name: en('checkin.title') })).toBeOnTheScreen();
    expect(events).toContainEqual({ event: 'weekly_checkin_opened', params: { entry: 'plan' } });
  });

  it('the notification opens it once the read says it is due', async () => {
    const events = recordAnalytics();
    signIn();
    api.on('GET', '/health', Reply.ok(dayJSON(TODAY, { checkIn: { due: true }, weighIn: WEIGH_IN })));
    useIntentStore.getState().parkPlanAction({ kind: 'openWeeklyCheckIn' });
    await renderPlan();
    expect(await screen.findByRole('header', { name: en('checkin.title') })).toBeOnTheScreen();
    expect(events).toContainEqual({ event: 'weekly_checkin_opened', params: { entry: 'notification' } });
  });

  it('a save reads the day again, and the review takes the prompt\'s place', async () => {
    signIn();
    let checkedIn = false;
    api.on('GET', '/health', () =>
      Reply.ok(dayJSON(TODAY, checkedIn ? { checkIn: { due: false }, review: REVIEW } : { checkIn: { due: true }, weighIn: WEIGH_IN })),
    );
    api.on('POST', '/health/checkin', () => {
      checkedIn = true;
      return Reply.ok({ measurement: null, review: REVIEW, weighIn: { ...WEIGH_IN, due: false }, checkIn: { due: false } });
    });
    await renderPlan();
    await fireEvent.press(screen.getByRole('button', { name: en('review.prompt.cta') }));
    await fireEvent.press(await screen.findByTestId('plan.checkin.save'));
    expect(await screen.findByTestId('plan.checkin.review')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('plan.checkin.done'));
    await waitFor(() => expect(useWeeklyCheckInPresenter.getState().request).toBeNull());
    await waitFor(() => expect(screen.queryByTestId('plan.review.prompt')).toBeNull());
    expect(screen.getByText('Three for three.')).toBeOnTheScreen();
  });

  it('with no sheet to draw, the notification lands on the review instead', async () => {
    signIn();
    // Nothing mounted (no Plan on screen): the bridge's door cannot open a sheet.
    openPlanWeeklyCheckIn('notification');
    expect(useWeeklyCheckInPresenter.getState().request).toBeNull();
    expect(usePlanShell.getState().scrollTarget).toBe('review');
  });
});
