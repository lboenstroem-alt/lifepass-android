/**
 * Plan landing on a section for a notification (iOS `deliverScroll`), and
 * what a health wipe does to Plan's stack, on the real page in a real
 * navigation stack: a scroll to a section the body has no place for gives up
 * at once; a slot that emptied takes its y back, so a later scroll waits for
 * the slot's new place rather than jumping to the old one; TalkBack lands
 * on the element the review card registered once the scroll has settled;
 * and a wipe closes a page open on Plan's stack.
 */
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { api, Reply } from '@test/server';
import { AccessibilityInfo, Text } from 'react-native';

import { stubApiClientPerTest } from '../../../api/testing';
import { UiKitProvider } from '../../../components/ui';
import { useHealthStore } from '../../../health';
import * as healthLocalStore from '../../../health/localStore';
import { ServerFeature } from '../../../stores/appStore';
import { useIntentStore } from '../../../stores/intentStore';
import PlanScreen from '../PlanScreen';
import { installPlanFeedback, type PlanFeedbackBridge } from '../shell/bridges';
import { pushPlanRoute, requestPlanScroll, usePlanShell } from '../shell/planShell';
import { dayJSON, freshPlan, MEMBER, memberProfile, settle, signIn, TODAY } from './planFixtures';
// The Plan shell's health wipe hooks, as the app registers them.
import '../register';

jest.mock('expo-asset', () => jest.requireActual('expo/node_modules/expo-asset'), { virtual: true });

/* eslint-disable @typescript-eslint/no-require-imports */
// The weekly review as PLAN-5 is to draw it: its heading is the element
// TalkBack lands on (./shell/focusTargets.ts).
jest.mock('../sections/WeeklyReview', () => {
  function MockWeeklyReview() {
    const { Text: MockText } = require('react-native');
    const { usePlanFocusTarget: mockUsePlanFocusTarget } = require('../shell/focusTargets');
    const focusTarget = mockUsePlanFocusTarget('review');
    return (
      <MockText ref={focusTarget} accessible accessibilityRole="header">
        Your week
      </MockText>
    );
  }
  return { __esModule: true, default: MockWeeklyReview };
});
/* eslint-enable @typescript-eslint/no-require-imports */

stubApiClientPerTest();

const FEATURES = { features: [ServerFeature.feedback] };

function StandIn({ route }: { route: { name: string; params?: object } }) {
  return <Text>{`route:${route.name}`}</Text>;
}

const Stack = createNativeStackNavigator();

async function renderPlan() {
  await render(
    <NavigationContainer>
      <UiKitProvider>
        <Stack.Navigator screenOptions={{ headerShown: false }}>
          <Stack.Screen name="PlanMain" component={PlanScreen as never} />
          <Stack.Screen name="Account" component={StandIn as never} />
        </Stack.Navigator>
      </UiKitProvider>
    </NavigationContainer>,
  );
  await act(async () => settle());
}

function feedbackWithCard(): PlanFeedbackBridge {
  return {
    isAvailable: () => true,
    refresh: async () => undefined,
    loadState: () => 'loaded',
    latestCurrentReportId: () => null,
    hasCardContent: () => true,
    subscribe: () => () => undefined,
  };
}

/** A slot's layout as Yoga reports it: first out of the flow, then in it. */
async function layOut(testID: string, y: number, height: number) {
  await fireEvent(screen.getByTestId(testID, { includeHiddenElements: true }), 'layout', {
    nativeEvent: { layout: { x: 0, y, width: 360, height } },
  });
}

beforeEach(() => {
  freshPlan();
});

afterEach(async () => {
  await settle();
  await healthLocalStore.settled();
});

describe('a scroll to a section', () => {
  it('gives up at once when the body on screen has no place for it (feedback over the gate)', async () => {
    // A lapsed member whose consent stands: the gate over their history,
    // which has no feedback card, although the feedback has content.
    signIn(memberProfile({ access: 'not_member' }));
    installPlanFeedback(feedbackWithCard());
    api.on('GET', '/health', Reply.ok(dayJSON(TODAY, FEATURES)));
    await renderPlan();
    expect(screen.getByTestId('plan.slot.history', { includeHiddenElements: true })).toBeTruthy();
    expect(screen.queryByTestId('plan.slot.feedback', { includeHiddenElements: true })).toBeNull();
    await act(async () => requestPlanScroll('feedback'));
    expect(usePlanShell.getState().scrollTarget).toBeNull();
  });

  it('waits for the place of a slot that emptied and filled again, never its old one', async () => {
    signIn();
    installPlanFeedback(feedbackWithCard());
    api.on('GET', '/health', Reply.ok(dayJSON(TODAY, FEATURES)));
    await renderPlan();
    const slot = 'plan.slot.feedback';
    await layOut(slot, 0, 120);
    await layOut(slot, 500, 120);
    // The card emptied: its y is not true any more.
    await layOut(slot, 500, 0);
    await act(async () => requestPlanScroll('feedback'));
    expect(usePlanShell.getState().scrollTarget).toBe('feedback');
    // It draws again, out of the flow first, then in its new place.
    await layOut(slot, 0, 150);
    expect(usePlanShell.getState().scrollTarget).toBe('feedback');
    await layOut(slot, 700, 150);
    expect(usePlanShell.getState().scrollTarget).toBeNull();
  });

  it('moves TalkBack onto the review card once the scroll has settled', async () => {
    signIn();
    api.on(
      'GET',
      '/health',
      Reply.ok(dayJSON(TODAY, { checkIn: { due: false }, review: { id: 'r-1', weekStartsOn: '2026-10-05', sessionsPlanned: 3, sessionsDone: 3 } })),
    );
    useIntentStore.getState().parkPlanAction({ kind: 'openWeeklyCheckIn' });
    await renderPlan();
    expect(usePlanShell.getState().scrollTarget).toBe('review');
    const send = jest.mocked(AccessibilityInfo.sendAccessibilityEvent);
    send.mockClear();
    await layOut('plan.slot.review', 0, 200);
    await layOut('plan.slot.review', 420, 200);
    expect(usePlanShell.getState().scrollTarget).toBeNull();
    // Not mid-scroll: the focus waits for the scroll to settle.
    expect(send).not.toHaveBeenCalled();
    // A real 400 ms timer: room for a machine loaded by parallel suites.
    await waitFor(() => expect(send).toHaveBeenCalledWith(expect.anything(), 'focus'), { timeout: 10_000 });
    expect(send).toHaveBeenCalledTimes(1);
  }, 20_000);
});

describe('a health wipe', () => {
  it("closes a page open on Plan's stack, as iOS resets planPath", async () => {
    signIn();
    api.on('GET', '/health', Reply.ok(dayJSON()));
    await renderPlan();
    await act(async () => pushPlanRoute('Account'));
    expect(screen.getByText('route:Account')).toBeOnTheScreen();
    await act(async () => {
      await useHealthStore.getState().wipeLocal({ profileId: MEMBER, reason: 'withdrawn_elsewhere' });
      await settle();
    });
    expect(screen.queryByText('route:Account')).toBeNull();
    expect(screen.getByTestId('plan.screen')).toBeOnTheScreen();
  });
});
