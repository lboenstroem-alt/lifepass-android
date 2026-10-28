/**
 * Test set-up shared by the feedback suites: a store on the stub server with
 * a fixed member, answers in the shape the server sends them, a member in the
 * app store for the app's own instance, and the analytics recorder.
 */
import { decodeProfile, type Profile } from '../../../api/profile';
import { resetHealthStoreForTests } from '../../../health/store';
import { setAnalyticsObserver, type AnalyticsEvent, type AnalyticsParams } from '../../../lib/analytics';
import { resetAppStoreForTests, useAppStore } from '../../../stores/appStore';
import { resetIntentStoreForTests } from '../../../stores/intentStore';
import { createFeedbackStore, type FeedbackEnvironment, type FeedbackStoreDeps } from '../store';

export const MEMBER = '8c2c1b36-2a7e-4b1f-9e0e-2f1c4f0a9c11';

export const ENV: FeedbackEnvironment = { profileId: 'p-1', language: 'en', eligible: true, features: ['health_feedback'] };

export interface TestStore {
  readonly store: ReturnType<typeof createFeedbackStore>;
  readonly calls: {
    serverFeatures: (readonly string[] | null)[];
    problems: unknown[];
    changed: number;
    removedNotifications: number;
  };
  /** Swap the environment the store sees (null: nobody signed in). */
  setEnvironment(env: FeedbackEnvironment | null): void;
}

/** A store against the stub server, with recorded hooks. */
export function makeStore(env: FeedbackEnvironment | null = ENV): TestStore {
  let current = env;
  const calls: TestStore['calls'] = { serverFeatures: [], problems: [], changed: 0, removedNotifications: 0 };
  const deps: FeedbackStoreDeps = {
    environment: () => current,
    onServerFeatures: (features) => calls.serverFeatures.push(features),
    onProblem: (error) => calls.problems.push(error),
    onChanged: () => {
      calls.changed += 1;
    },
    removeNotifications: async () => {
      calls.removedNotifications += 1;
    },
  };
  return {
    store: createFeedbackStore(deps),
    calls,
    setEnvironment(next) {
      current = next;
    },
  };
}

export const SETTINGS_JSON = {
  monthlyReport: true,
  midMonthNote: true,
  includeFoodAndWeight: false,
  includeFoodAndWeightSource: 'member',
  updatedAt: '2026-10-02T09:00:00Z',
};

/** FB-2's answer. */
export function settingsAnswer(settings: Record<string, unknown> = SETTINGS_JSON) {
  return { settings, features: ['health_feedback'] };
}

/** FB-1's answer, with an unread current report and a note unless told otherwise. */
export function summaryJSON(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    settings: {
      monthlyReport: true,
      midMonthNote: true,
      includeFoodAndWeight: true,
      includeFoodAndWeightSource: 'plan',
      updatedAt: null,
    },
    latest: {
      id: 'r-1',
      kind: 'monthly',
      periodMonth: '2026-09',
      title: 'September 2026',
      createdAt: '2026-10-01T06:12:00.000Z',
      seenAt: null,
      current: true,
      highlights: ['You trained 11 times.', 'Your nights were steady.'],
    },
    note: {
      id: 'n-1',
      periodMonth: '2026-10',
      createdAt: '2026-10-12T06:11:00.000Z',
      seenAt: null,
      expiresOn: '2026-10-22',
      title: 'A note for you',
      message: { key: 'note.sleep_short', text: 'Your nights have been short.', action: null },
    },
    nextReport: { periodMonth: '2026-10', readyOn: '2026-11-01', expected: true },
    foodAndWeightOffer: false,
    features: ['health_feedback'],
    ...extra,
  };
}

/** A report as FB-4 answers it. */
export function reportJSON(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    report: {
      id: 'r-1',
      kind: 'monthly',
      periodMonth: '2026-09',
      periodStart: '2026-09-01',
      periodEnd: '2026-09-30',
      title: 'September 2026',
      createdAt: '2026-10-01T06:12:00.000Z',
      seenAt: null,
      dismissedAt: null,
      rulesVersion: 'feedback-2026-10-v1',
      leftOut: 'setting',
      leftOutLine: 'Food and weight are left out of this report.',
      sections: [
        {
          topic: 'workouts',
          title: 'Workouts',
          status: 'shown',
          metrics: [{ key: 'metric.workouts_done', label: 'Planned workouts done', value: '11 of 13' }],
          messages: [{ key: 'workouts.few_done', text: 'Workouts were hard to fit in.', action: 'adjust_plan' }],
          hint: null,
        },
        {
          topic: 'sleep',
          title: 'Sleep',
          status: 'not_enough_data',
          metrics: [],
          messages: [],
          hint: { key: 'sleep.hint', text: 'Wear your watch to bed.', action: null },
        },
      ],
      note: null,
      disclaimer: 'Written by LifePass rules, never by AI.',
      ...extra,
    },
    features: ['health_feedback'],
  };
}

export const CONSENT = { version: '2026-09-v1', consentedAt: '2026-09-20T10:00:00Z', ageSource: 'self_attested' };

export function memberProfile(options: { access?: string; consent?: boolean; program?: string | null } = {}): Profile {
  const { access = 'entitled', consent = true, program = 'active' } = options;
  return decodeProfile({
    id: MEMBER,
    email: 'member@example.com',
    locale: 'en',
    kennitalaVerified: true,
    marketingConsent: false,
    health: {
      access,
      consent: consent ? CONSENT : null,
      ...(program ? { program: { id: 'prog-1', status: program } } : {}),
    },
  });
}

/** Signs a member in on the app store, with the server advertising the feedback (or not). */
export function signIn(options: { features?: string[]; profile?: Profile } = {}): void {
  useAppStore.setState({
    isAuthenticated: true,
    isLoading: false,
    userId: MEMBER,
    profile: options.profile ?? memberProfile(),
    serverFeatures: options.features ?? ['health_feedback', 'plan_revision'],
  });
}

export interface TrackedEvent {
  readonly event: AnalyticsEvent;
  readonly params: AnalyticsParams;
}

export function recordAnalytics(): TrackedEvent[] {
  const events: TrackedEvent[] = [];
  setAnalyticsObserver((event, params) => events.push({ event, params }));
  return events;
}

export function freshApp(): void {
  resetAppStoreForTests();
  resetHealthStoreForTests();
  resetIntentStoreForTests();
  setAnalyticsObserver(null);
}

/** Lets msw answers and the state they set land. */
export async function settle(): Promise<void> {
  for (let i = 0; i < 8; i += 1) {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
}
