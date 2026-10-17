/**
 * Test set-up shared by the Plan shell's suites: a member in the app store
 * built from the API's own JSON through the real decoders, a Today read in
 * the shape `GET /health` answers, and a fresh process between tests.
 */
import { decodeProfile, type Profile } from '../../../api/profile';
import { resetHealthStoreForTests } from '../../../health/store';
import { todayServerDay } from '../../../i18n/format';
import { resetAppStoreForTests, useAppStore } from '../../../stores/appStore';
import { resetIntentStoreForTests } from '../../../stores/intentStore';
import { setAnalyticsObserver, type AnalyticsEvent, type AnalyticsParams } from '../../../lib/analytics';
import { forgetIntroCollapse } from '../intro/introCollapse';
import { resetPlanBridgesForTests } from '../shell/bridges';
import { resetPlanShell } from '../shell/planShell';

export const MEMBER = '8c2c1b36-2a7e-4b1f-9e0e-2f1c4f0a9c11';
export const TODAY = todayServerDay();

export const CONSENT = { version: '2026-09-v1', consentedAt: '2026-09-20T10:00:00Z', ageSource: 'self_attested' };

/** A profile whose health block says `access`, with or without consent. */
export function memberProfile(
  options: { access?: string; consent?: boolean; trialEligible?: boolean; locale?: string; health?: boolean } = {},
): Profile {
  const { access = 'entitled', consent = true, trialEligible, locale = 'en', health = true } = options;
  return decodeProfile({
    id: MEMBER,
    email: 'member@example.com',
    locale,
    kennitalaVerified: true,
    marketingConsent: false,
    ...(health
      ? {
          health: {
            access,
            consent: consent ? CONSENT : null,
            ...(trialEligible === undefined ? {} : { trialEligible }),
          },
        }
      : {}),
  });
}

export function signIn(profile: Profile = memberProfile()): void {
  useAppStore.setState({ isAuthenticated: true, isLoading: false, userId: MEMBER, profile });
}

/** A Today read for `date`, with an active programme unless `program: null`. */
export function dayJSON(date: string = TODAY, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    contractVersion: '2026-09-v1',
    date,
    today: TODAY,
    locale: 'en',
    access: 'entitled',
    program: { id: 'p-1', status: 'active', weekNo: 2, weeks: 4 },
    day: {
      date,
      relative: date === TODAY ? 'today' : date < TODAY ? 'past' : 'future',
      session: { id: `s-${date}`, scheduledFor: date, kind: 'strength', title: 'Full body', status: 'planned' },
    },
    week: {
      weekStartsOn: '2026-10-12',
      planned: 3,
      done: 1,
      canGoBack: true,
      canGoForward: false,
      days: [
        { date: '2026-10-12', weekday: 1, inProgram: true, title: 'Full body', status: 'done' },
        { date: '2026-10-13', weekday: 2, inProgram: false, status: 'rest' },
      ],
    },
    upcoming: [],
    ...extra,
  };
}

export interface TrackedEvent {
  readonly event: AnalyticsEvent;
  readonly params: AnalyticsParams;
}

/** Records every analytics event of the test. */
export function recordAnalytics(): TrackedEvent[] {
  const events: TrackedEvent[] = [];
  setAnalyticsObserver((event, params) => events.push({ event, params }));
  return events;
}

/** A fresh process: no member, no day, nothing parked, nothing installed. */
export function freshPlan(): void {
  resetAppStoreForTests();
  resetHealthStoreForTests();
  resetIntentStoreForTests();
  resetPlanBridgesForTests();
  resetPlanShell();
  forgetIntroCollapse();
  setAnalyticsObserver(null);
}

/** Lets msw answers and the state they set land. */
export async function settle(): Promise<void> {
  for (let i = 0; i < 6; i += 1) {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
}
