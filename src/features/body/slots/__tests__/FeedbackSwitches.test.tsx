/**
 * Body and goals' "Monthly feedback" section (iOS BodyAndGoalsView
 * `feedbackSection`, `SPEC` 9.5): nothing without the feature, toggles that
 * wait for the read, a save that sends only its switch, the one place the
 * feedback asks for notifications, the error line, and "Past months".
 */
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { api, Reply } from '@test/server';
import { AccessibilityInfo } from 'react-native';

import { stubApiClientPerTest } from '../../../../api/testing';
import { decodeProfile } from '../../../../api/profile';
import { translate } from '../../../../i18n';
import { resetAppStoreForTests, useAppStore } from '../../../../stores/appStore';
import { useFeedbackStore } from '../../../feedback';
import FeedbackSwitches from '../FeedbackSwitches';

// @expo/vector-icons loads expo-font, which needs expo-asset (installed under expo/).
jest.mock('expo-asset', () => jest.requireActual('expo/node_modules/expo-asset'), { virtual: true });

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { notificationsState } = require('expo-notifications') as typeof import('../../../../../test/mocks/expoNotifications');

stubApiClientPerTest();

const en = (key: string) => translate(key, 'en');
const MEMBER = '8c2c1b36-2a7e-4b1f-9e0e-2f1c4f0a9c11';

function signIn(features: string[] = ['health_feedback']): void {
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
      health: { access: 'entitled', consent: { version: '2026-09-v1', consentedAt: '2026-09-20T10:00:00Z', ageSource: 'self_attested' } },
    }),
  });
}

function summary(settings: Record<string, unknown>) {
  return {
    settings: { monthlyReport: true, midMonthNote: false, includeFoodAndWeight: false, includeFoodAndWeightSource: 'no_plan', updatedAt: null, ...settings },
    latest: null,
    note: null,
    nextReport: null,
    foodAndWeightOffer: true,
    features: ['health_feedback'],
  };
}

async function settle(ms = 0): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 8; i += 1) await new Promise<void>((resolve) => setTimeout(resolve, 0));
    if (ms > 0) await new Promise<void>((resolve) => setTimeout(resolve, ms));
  });
}

beforeEach(() => {
  resetAppStoreForTests();
  useFeedbackStore.getState().wipe();
  useFeedbackStore.setState({ staleFeatures: null });
});

it('draws nothing while the server does not advertise the feedback', async () => {
  signIn(['plan_revision']);
  await render(<FeedbackSwitches />);
  expect(screen.queryByTestId('bodygoals.feedback')).toBeNull();
  expect(api.requests).toHaveLength(0);
});

it('waits for the read, then shows the switches as the server holds them', async () => {
  signIn();
  // Held until the waiting state is checked: a timed delay raced a slow CI runner.
  let answer!: () => void;
  const answered = new Promise<void>((resolve) => (answer = resolve));
  api.on('GET', '/health/feedback', async () => {
    await answered;
    return Reply.ok(summary({}));
  });
  await render(<FeedbackSwitches />);
  expect(screen.getByText(en('bodygoals.sec.feedback').toUpperCase())).toBeOnTheScreen();
  expect(screen.getByRole('switch', { name: en('bodygoals.fb_monthly') })).toBeDisabled();
  answer();
  await settle();
  const monthly = screen.getByRole('switch', { name: en('bodygoals.fb_monthly') });
  expect(monthly).toBeEnabled();
  expect(monthly).toBeChecked();
  expect(screen.getByRole('switch', { name: en('bodygoals.fb_note') })).not.toBeChecked();
  // Off only by default: the member is told why.
  expect(screen.getByText(`${en('bodygoals.fb_food_sub')} ${en('bodygoals.fb_food_offer')}`)).toBeOnTheScreen();
  expect(screen.getByText(en('bodygoals.fb_footer'))).toBeOnTheScreen();
});

it('a switch turned off moves at once, sends only that switch and asks for nothing', async () => {
  signIn();
  api.on('GET', '/health/feedback', Reply.ok(summary({})));
  api.on('PUT', '/health/feedback/settings', Reply.delayed(40, Reply.ok({ settings: summary({ monthlyReport: false }).settings, features: ['health_feedback'] })));
  await render(<FeedbackSwitches />);
  await settle();
  api.on('GET', '/health/feedback', Reply.ok(summary({ monthlyReport: false })));
  await fireEvent.press(screen.getByRole('switch', { name: en('bodygoals.fb_monthly') }));
  const monthly = screen.getByRole('switch', { name: en('bodygoals.fb_monthly') });
  expect(monthly).not.toBeChecked();
  // Held still while its save is in flight.
  expect(monthly).toBeDisabled();
  await settle(80);
  expect(api.sent('/health/feedback/settings', 'PUT').rawBody).toBe('{"monthlyReport":false}');
  expect(screen.getByRole('switch', { name: en('bodygoals.fb_monthly') })).not.toBeChecked();
  expect(screen.getByRole('switch', { name: en('bodygoals.fb_monthly') })).toBeEnabled();
  expect(notificationsState.requestCount()).toBe(0);
});

it('turning the note on asks for notifications once, in context', async () => {
  signIn();
  api.on('GET', '/health/feedback', Reply.ok(summary({})));
  api.on('PUT', '/health/feedback/settings', Reply.ok({ settings: summary({ midMonthNote: true }).settings, features: ['health_feedback'] }));
  await render(<FeedbackSwitches />);
  await settle();
  await fireEvent.press(screen.getByRole('switch', { name: en('bodygoals.fb_note') }));
  await settle();
  expect(api.sent('/health/feedback/settings', 'PUT').rawBody).toBe('{"midMonthNote":true}');
  expect(notificationsState.requestCount()).toBe(1);
});

it('a failed save goes back, says so, and tells TalkBack', async () => {
  const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility');
  signIn();
  api.on('GET', '/health/feedback', Reply.ok(summary({ includeFoodAndWeight: true, includeFoodAndWeightSource: 'plan' })));
  api.on('PUT', '/health/feedback/settings', Reply.problem(400, 'invalid_request'));
  await render(<FeedbackSwitches />);
  await settle();
  await fireEvent.press(screen.getByRole('switch', { name: en('bodygoals.fb_food') }));
  await settle();
  expect(screen.getByRole('switch', { name: en('bodygoals.fb_food') })).toBeChecked();
  expect(screen.getByText(en('bodygoals.fb_err'))).toBeOnTheScreen();
  expect(announce).toHaveBeenCalledWith(en('bodygoals.fb_err'));
});

it('Past months opens the history in its own sheet', async () => {
  signIn();
  api.on('GET', '/health/feedback', Reply.ok(summary({})));
  api.on('GET', '/health/feedback/reports', Reply.ok({ data: [], pagination: { nextCursor: null, hasMore: false } }));
  await render(<FeedbackSwitches />);
  await settle();
  await fireEvent.press(screen.getByRole('button', { name: en('bodygoals.fb_past') }));
  await settle();
  expect(screen.getByText(en('feedback.history.empty'))).toBeOnTheScreen();
});
