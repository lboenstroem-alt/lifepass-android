/**
 * The monthly feedback stays in its own lane (iOS FeedbackPrivacyTests,
 * `SPEC` 11.4, 13.3), and the app's wiring around it (iOS
 * `AppState.wireFeedback`, `handleSignOut`, `activateHealth`, `signOut`):
 *
 * - a feedback action reaches the Coach as the fixed chip only: the `adjust`
 *   entry carries nothing, and no prompt is parked;
 * - the analytics events carry fixed, allow-listed words only;
 * - the local wipe removes every `health.feedback.*` key and the summary in
 *   memory; a sign-out keeps only a pending safety food-off;
 * - every notification the feedback schedules is `health.*`;
 * - the pre-sign-out try, the activation read and Plan's bridge.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { api, Reply } from '@test/server';

import { decodeFeedbackSummary } from '../../../api/feedback';
import { stubApiClientPerTest } from '../../../api/testing';
import { registeredHookIds, runActivationHooks, runPreSignOutHooks, runSignOutCleaners } from '../../../app/signOut';
import { FeedbackKeys } from '../../../health/localKeys';
import type { HealthWipeReason } from '../../../health/models';
import { useHealthStore } from '../../../health/store';
import { refusedParams } from '../../../lib/analytics';
import { NOTIFICATION_ROUTES } from '../../../app/notificationRouter';
import { useAppStore } from '../../../stores/appStore';
import { useIntentStore } from '../../../stores/intentStore';
import { usePlanBridges } from '../../plan/shell';
import {
  FEEDBACK_NOTIFICATION_PREFIX,
  performFeedbackAction,
  turnOffFoodForSafety,
  turnsOffFeedbackFoodOnRefusal,
  useFeedbackStore,
} from '..';
import { planFeedbackBridge } from '../register';

import { freshApp, MEMBER, memberProfile, settingsAnswer, settle, signIn, summaryJSON } from './feedbackFixtures';

// @expo/vector-icons loads expo-font, which needs expo-asset (installed under expo/).
jest.mock('expo-asset', () => jest.requireActual('expo/node_modules/expo-asset'), { virtual: true });

stubApiClientPerTest();

beforeEach(() => {
  freshApp();
  useFeedbackStore.getState().wipe();
  useFeedbackStore.setState({ staleFeatures: null });
});

function seedSummary(extra: Record<string, unknown> = {}): void {
  useFeedbackStore.setState({ summary: decodeFeedbackSummary(summaryJSON(extra), 'feedback') });
}

async function setEveryFeedbackKey(profileId: string): Promise<void> {
  await Promise.all(FeedbackKeys.all(profileId).map((key) => AsyncStorage.setItem(key, 'true')));
  await AsyncStorage.setItem(FeedbackKeys.lastProfileId, profileId);
}

describe('the Coach', () => {
  it('a feedback action reaches the Coach as the fixed chip only', () => {
    performFeedbackAction('adjust_plan', { fromPushedScreen: false });
    const intents = useIntentStore.getState();
    expect(intents.pendingCoachProgram).toEqual({ kind: 'adjust' });
    expect(intents.pendingTab).toBe('Coach');
    expect(intents.pendingCoachPrompt).toBeNull();
  });

  it('a feedback note route carries nothing but its kind', () => {
    expect(NOTIFICATION_ROUTES).toEqual(expect.arrayContaining(['plan.feedback', 'plan.feedback_note']));
  });
});

describe('analytics', () => {
  it('the events carry only allow-listed words', () => {
    const params = [
      { entry: 'card' },
      { entry: 'notification' },
      { entry: 'history' },
      { setting: 'monthly', value: 'on' },
      { setting: 'note', value: 'off' },
      { action: 'adjust_plan' },
      { action: 'change_days' },
      { action: 'log_meal' },
      { choice: 'ok' },
      { choice: 'choose' },
      { kind: 'feedback_monthly' },
      { kind: 'feedback_note' },
    ];
    for (const param of params) expect(refusedParams(param)).toEqual([]);
  });

  it('a report word is never an analytics value', () => {
    expect(refusedParams({ value: 7412 })).toEqual(['value']);
    expect(refusedParams({ value: '402' })).toEqual(['value']);
    expect(refusedParams({ topic: 'sleep' })).toEqual(['topic']);
    expect(refusedParams({ key: 'sleep.avg_short' })).toEqual(['key']);
    expect(refusedParams({ setting: 'pregnant' })).toEqual(['setting']);
  });
});

describe('the wipe', () => {
  const reasons: HealthWipeReason[] = ['withdrawn', 'withdrawn_elsewhere', 'account_deletion', 'minor'];

  it.each(reasons)('a %s wipe removes every feedback key and the summary', async (reason) => {
    const profileId = `wipe-${reason}`;
    await setEveryFeedbackKey(profileId);
    seedSummary();
    await useHealthStore.getState().wipeLocal({ profileId, reason });
    for (const key of FeedbackKeys.all(profileId)) {
      expect(await AsyncStorage.getItem(key)).toBeNull();
      expect(key.startsWith(`health.feedback.${profileId}.`)).toBe(true);
    }
    expect(await AsyncStorage.getItem(FeedbackKeys.lastProfileId)).toBeNull();
    expect(useFeedbackStore.getState().summary).toBeNull();
  });

  it('a sign-out keeps only a pending safety food-off', async () => {
    const profileId = 'wipe-signout';
    await setEveryFeedbackKey(profileId);
    seedSummary();
    await useHealthStore.getState().wipeLocal({ profileId, reason: 'signout' });
    expect(FeedbackKeys.keptOnSignOut(profileId)).toEqual([FeedbackKeys.foodOffPending(profileId)]);
    expect(await AsyncStorage.getItem(FeedbackKeys.foodOffPending(profileId))).toBe('true');
    for (const key of FeedbackKeys.all(profileId).filter((k) => k !== FeedbackKeys.foodOffPending(profileId))) {
      expect(await AsyncStorage.getItem(key)).toBeNull();
    }
    expect(await AsyncStorage.getItem(FeedbackKeys.lastProfileId)).toBeNull();
    expect(useFeedbackStore.getState().summary).toBeNull();
  });

  it('every feedback notification is one the wipe removes', () => {
    expect(FEEDBACK_NOTIFICATION_PREFIX.startsWith('health.')).toBe(true);
  });

  it('sign-out forgets the summary even with no member to name', async () => {
    seedSummary();
    await runSignOutCleaners({ memberId: null });
    expect(useFeedbackStore.getState().summary).toBeNull();
  });
});

describe('the session hooks', () => {
  it('are registered', () => {
    const ids = registeredHookIds();
    expect(ids.preSignOut).toContain('feedback.food-off');
    expect(ids.signOut).toContain('feedback.summary');
    expect(ids.activation).toContain('feedback.activate');
  });

  it('the pre-sign-out hook sends a waiting food-off while the session stands', async () => {
    signIn();
    await AsyncStorage.setItem(FeedbackKeys.foodOffPending(MEMBER), 'true');
    api.on('PUT', '/health/feedback/settings', Reply.ok(settingsAnswer()));
    await runPreSignOutHooks({ memberId: MEMBER });
    expect(api.sent('/health/feedback/settings', 'PUT').rawBody).toBe('{"includeFoodAndWeight":false}');
    expect(await AsyncStorage.getItem(FeedbackKeys.foodOffPending(MEMBER))).toBeNull();
  });

  it('every activation reads (throttled), the food-off first; never without the feature or consent', async () => {
    signIn();
    await AsyncStorage.setItem(FeedbackKeys.foodOffPending(MEMBER), 'true');
    api.on('PUT', '/health/feedback/settings', Reply.ok(settingsAnswer()));
    api.on('GET', '/health/feedback', Reply.ok(summaryJSON()));
    await runActivationHooks({ memberId: MEMBER, trigger: 'profile' });
    expect(api.requests.filter((r) => r.path.startsWith('/health/feedback')).map((r) => r.method)).toEqual(['PUT', 'GET']);
    expect(useFeedbackStore.getState().summary?.latest?.id).toBe('r-1');

    api.reset();
    useFeedbackStore.getState().wipe();
    signIn({ features: ['plan_revision'] });
    await runActivationHooks({ memberId: MEMBER, trigger: 'foreground' });
    signIn({ profile: memberProfile({ consent: false }) });
    await runActivationHooks({ memberId: MEMBER, trigger: 'foreground' });
    expect(api.requests.filter((r) => r.path.startsWith('/health/feedback'))).toHaveLength(0);
  });

  it('every answer passes its features to the app', async () => {
    signIn();
    api.on('GET', '/health/feedback', Reply.ok(summaryJSON({ features: ['health_feedback', 'meal_describe'] })));
    await useFeedbackStore.getState().refresh();
    expect(useAppStore.getState().serverFeatures).toEqual(['health_feedback', 'meal_describe']);
  });
});

describe("Plan's bridge", () => {
  it('is installed, and answers from the store', async () => {
    expect(usePlanBridges.getState().feedback).toBe(planFeedbackBridge);
    signIn();
    expect(planFeedbackBridge.loadState()).toBe('idle');
    expect(planFeedbackBridge.hasCardContent()).toBe(false);
    api.on('GET', '/health/feedback', Reply.ok(summaryJSON()));
    await planFeedbackBridge.refresh(false);
    expect(planFeedbackBridge.loadState()).toBe('loaded');
    expect(planFeedbackBridge.latestCurrentReportId()).toBe('r-1');
    expect(planFeedbackBridge.hasCardContent()).toBe(true);
    expect(planFeedbackBridge.isAvailable()).toBe(true);
  });

  it('a stale flag hides the feature until the feature list changes', async () => {
    signIn();
    api.on('GET', '/health/feedback', Reply.raw(404, '<html>Not found</html>'));
    await planFeedbackBridge.refresh(true);
    expect(planFeedbackBridge.isAvailable()).toBe(false);
    useAppStore.getState().noteServerFeatures(['health_feedback', 'plan_revision', 'meal_describe']);
    expect(planFeedbackBridge.isAvailable()).toBe(true);
  });

  it('tells Plan when the read lands', async () => {
    signIn();
    let told = 0;
    const unsubscribe = planFeedbackBridge.subscribe(() => {
      told += 1;
    });
    api.on('GET', '/health/feedback', Reply.ok(summaryJSON()));
    await planFeedbackBridge.refresh(true);
    unsubscribe();
    expect(told).toBeGreaterThan(0);
  });

  it('a current report that is not the current month is not offered', async () => {
    signIn();
    api.on('GET', '/health/feedback', Reply.ok(summaryJSON({ latest: { id: 'r-0', current: false } })));
    await planFeedbackBridge.refresh(true);
    expect(planFeedbackBridge.latestCurrentReportId()).toBeNull();
  });
});

describe('the Coach contract (COACH-4, COACH-5)', () => {
  it('turnsOffFeedbackFoodOnRefusal follows the feature, the consent and the switch', async () => {
    signIn();
    expect(turnsOffFeedbackFoodOnRefusal()).toBe(true);
    seedSummary({
      settings: { monthlyReport: true, midMonthNote: true, includeFoodAndWeight: false, includeFoodAndWeightSource: 'member', updatedAt: null },
    });
    expect(turnsOffFeedbackFoodOnRefusal()).toBe(false);
    seedSummary();
    expect(turnsOffFeedbackFoodOnRefusal()).toBe(true);
    signIn({ features: [] });
    expect(turnsOffFeedbackFoodOnRefusal()).toBe(false);
    signIn({ profile: memberProfile({ consent: false }) });
    expect(turnsOffFeedbackFoodOnRefusal()).toBe(false);
  });

  it('turnOffFoodForSafety sends the bare switch for the signed-in member', async () => {
    signIn();
    api.on('PUT', '/health/feedback/settings', Reply.ok(settingsAnswer()));
    await turnOffFoodForSafety();
    await settle();
    expect(api.sent('/health/feedback/settings', 'PUT').rawBody).toBe('{"includeFoodAndWeight":false}');
    expect(await AsyncStorage.getItem(FeedbackKeys.foodOffPending(MEMBER))).toBeNull();
  });
});
