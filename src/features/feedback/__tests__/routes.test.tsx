/**
 * The feedback's routes in a real stack, as iOS's NavigationStack shows
 * them: a screen covered by another reads again when it shows again (iOS
 * `.task` on every appearance), keeping what it shows meanwhile. React
 * Navigation keeps the covered screen mounted, so nothing else would.
 */
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { api, Reply } from '@test/server';
import { Pressable, Text } from 'react-native';

import { stubApiClientPerTest } from '../../../api/testing';
import { translate } from '../../../i18n';
import FeedbackHistoryScreen from '../FeedbackHistoryScreen';
import FeedbackReportScreen from '../FeedbackReportScreen';
import { useFeedbackStore } from '../feedbackStore';

import { freshApp, reportJSON, settle, signIn } from './feedbackFixtures';

// @expo/vector-icons loads expo-font, which needs expo-asset (installed under expo/).
jest.mock('expo-asset', () => jest.requireActual('expo/node_modules/expo-asset'), { virtual: true });

stubApiClientPerTest();

const en = (key: string) => translate(key, 'en');

beforeEach(() => {
  freshApp();
  useFeedbackStore.getState().wipe();
  useFeedbackStore.setState({ staleFeatures: null });
});

/** A screen pushed over the feedback, with a way back. */
function StandIn({ route, navigation }: { route: { name: string }; navigation: { goBack: () => void } }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`leave ${route.name}`} onPress={() => navigation.goBack()}>
      <Text>{route.name}</Text>
    </Pressable>
  );
}

const Stack = createNativeStackNavigator();

async function renderStack(initial: 'FeedbackReport' | 'FeedbackHistory') {
  await render(
    <NavigationContainer>
      <Stack.Navigator screenOptions={{ headerShown: false }} initialRouteName={initial}>
        {initial === 'FeedbackReport' ? (
          <>
            <Stack.Screen name="FeedbackReport" component={FeedbackReportScreen as never} initialParams={{ reportId: 'r-1' }} />
            <Stack.Screen name="FeedbackHistory" component={StandIn as never} />
          </>
        ) : (
          <>
            <Stack.Screen name="FeedbackHistory" component={FeedbackHistoryScreen as never} />
            <Stack.Screen name="FeedbackReport" component={StandIn as never} />
          </>
        )}
        <Stack.Screen name="BodyAndGoals" component={StandIn as never} />
      </Stack.Navigator>
    </NavigationContainer>,
  );
  await act(settle);
}

const SEEN = '2026-10-02T10:00:00.000Z';

describe('the report', () => {
  it('reads again on the way back from Body and goals, keeping the report meanwhile', async () => {
    signIn();
    api.on('GET', '/health/feedback/reports/:id', Reply.ok(reportJSON({ seenAt: SEEN })));
    await renderStack('FeedbackReport');
    expect(screen.getByText('Food and weight are left out of this report.')).toBeOnTheScreen();
    expect(screen.queryByRole('header', { name: 'Eating' })).toBeNull();

    await fireEvent.press(screen.getAllByRole('button', { name: en('feedback.detail.settings') })[0]!);
    await act(settle);
    // Body and goals: food and weight switched on. The next read says so.
    const eating = {
      topic: 'eating',
      title: 'Eating',
      status: 'shown',
      metrics: [{ key: 'metric.days_logged', label: 'Days with meals logged', value: '18 of 30' }],
      messages: [],
      hint: null,
    };
    const workouts = (reportJSON().report as { sections: unknown[] }).sections[0];
    api.on(
      'GET',
      '/health/feedback/reports/:id',
      Reply.delayed(30, Reply.ok(reportJSON({ seenAt: SEEN, leftOut: null, leftOutLine: null, sections: [workouts, eating] }))),
    );
    await fireEvent.press(screen.getByRole('button', { name: 'leave BodyAndGoals' }));

    // Back at once with the report on screen, no skeleton, while it reads again.
    expect(screen.queryByLabelText(en('a11y.loading'))).toBeNull();
    expect(screen.getByRole('header', { name: 'September 2026' })).toBeOnTheScreen();
    await act(() => new Promise((resolve) => setTimeout(resolve, 60)));
    await act(settle);
    expect(api.sentAll('/health/feedback/reports/r-1', 'GET')).toHaveLength(2);
    expect(screen.queryByText('Food and weight are left out of this report.')).toBeNull();
    expect(screen.getByRole('header', { name: 'Eating' })).toBeOnTheScreen();
  });

  it('reads once on its first appearance', async () => {
    signIn();
    api.on('GET', '/health/feedback/reports/:id', Reply.ok(reportJSON({ seenAt: SEEN })));
    await renderStack('FeedbackReport');
    expect(api.sentAll('/health/feedback/reports/r-1', 'GET')).toHaveLength(1);
  });
});

describe('past months', () => {
  it('a month opened and closed comes back without its "New"', async () => {
    signIn();
    const page = (seenAt: string | null) => ({
      data: [{ id: 'r-1', kind: 'monthly', periodMonth: '2026-09', title: 'September 2026', seenAt, highlights: [] }],
      pagination: { nextCursor: null, hasMore: false },
    });
    api.on('GET', '/health/feedback/reports', Reply.ok(page(null)));
    await renderStack('FeedbackHistory');
    expect(api.sentAll('/health/feedback/reports')).toHaveLength(1);
    await fireEvent.press(screen.getByRole('button', { name: `September 2026, ${en('feedback.card.new')}` }));
    await act(settle);

    // The report marked it seen.
    api.on('GET', '/health/feedback/reports', Reply.ok(page(SEEN)));
    await fireEvent.press(screen.getByRole('button', { name: 'leave FeedbackReport' }));
    await act(settle);
    expect(api.sentAll('/health/feedback/reports')).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'September 2026' })).toBeOnTheScreen();
    expect(screen.queryByText(en('feedback.card.new'))).toBeNull();
  });
});
