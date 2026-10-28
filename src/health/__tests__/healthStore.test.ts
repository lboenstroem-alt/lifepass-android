/**
 * The health store: the Today read with its cache, freshness, ordering and
 * memory; the action patches; the problem table; the reconcile after every
 * profile read; and the local wipe. The iOS HealthStore behaviour the Plan
 * tab, Home and the Coach rely on.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { fileSystemState } from '@test/mocks/expoFileSystem';
import { notificationsState } from '@test/mocks/expoNotifications';
import { api, Reply } from '@test/server';

import { apiGet } from '../../api';
import { stubApiClientPerTest } from '../../api/testing';
import { decodeProfile, type Profile } from '../../api/profile';
import { todayServerDay, addServerDays } from '../../i18n/format';
import { scheduleAt } from '../../notifications';
import { useAppStore, resetAppStoreForTests } from '../../stores/appStore';
import { FeedbackKeys, planIntroCollapsedKey, ReminderKeys, scanMealGateSeenKey, WearableKeys } from '../localKeys';
import * as localStore from '../localStore';
import { decodeSessionView, encodeHealthDay, decodeHealthDay } from '../models';
import {
  evictOldDays,
  FRESHNESS_WINDOW_MS,
  livePlanGoal,
  mayTakeTarget,
  MAX_REMEMBERED_DAYS,
  resetHealthStoreForTests,
  useHealthStore,
  wipeWithoutMember,
} from '../store';
import { registerHealthWipeHook, type HealthWipeContext } from '../wipe';

stubApiClientPerTest();

const MEMBER = '8c2c1b36-2a7e-4b1f-9e0e-2f1c4f0a9c11';
const TODAY = todayServerDay();
const store = () => useHealthStore.getState();

function profile(health: Record<string, unknown> | null | undefined = { access: 'entitled', consent: { version: '2026-09-v1' } }): Profile {
  return decodeProfile({
    id: MEMBER,
    email: 'member@example.com',
    locale: 'en',
    kennitalaVerified: true,
    marketingConsent: false,
    ...(health === undefined ? {} : { health }),
  });
}

function dayJSON(date = TODAY, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    contractVersion: '2026-09-v1',
    date,
    today: TODAY,
    locale: 'en',
    access: 'entitled',
    day: {
      date,
      relative: date === TODAY ? 'today' : 'past',
      session: { id: `s-${date}`, scheduledFor: date, kind: 'strength', title: 'Full body', status: 'planned' },
    },
    week: { weekNo: 1, planned: 3, done: 0 },
    upcoming: [],
    features: ['target_weight'],
    ...extra,
  };
}

function signedIn(p: Profile = profile()): void {
  useAppStore.setState({ isAuthenticated: true, userId: MEMBER, profile: p });
}

beforeEach(() => {
  resetAppStoreForTests();
  resetHealthStoreForTests();
});

afterEach(async () => {
  await localStore.settled();
});

describe('the Today read', () => {
  it('reads in the account language, keeps the day, writes the cache and notes the features', async () => {
    signedIn(decodeProfile({ id: MEMBER, locale: 'is', kennitalaVerified: true, marketingConsent: false }));
    api.on('GET', '/health', Reply.ok(dayJSON()));
    await store().load();
    expect(api.sent('/health').query).toEqual({ locale: 'is' });
    expect(store().today?.date).toBe(TODAY);
    expect(store().days[TODAY]).toBeDefined();
    expect(store().loadState.kind).toBe('loaded');
    expect(useAppStore.getState().serverFeatures).toEqual(['target_weight']);
    await localStore.settled();
    expect(fileSystemState.exists(`health/${MEMBER}/today.json`)).toBe(true);
  });

  it("draws today's cache first while the read is in flight, and ignores yesterday's", async () => {
    signedIn();
    fileSystemState.seed(`health/${MEMBER}/today.json`, encodeHealthDay(decodeHealthDay(dayJSON(TODAY, { features: ['plan_revision'] }))));
    let release: () => void = () => undefined;
    api.on('GET', '/health', () => new Promise((resolve) => (release = () => resolve(Reply.ok(dayJSON())))));
    const loading = store().load();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(store().isShowingCache).toBe(true);
    expect(store().today?.date).toBe(TODAY);
    expect(store().cachedAt).toBeInstanceOf(Date);
    expect(useAppStore.getState().serverFeatures).toEqual(['plan_revision']);
    release();
    await loading;
    expect(store().isShowingCache).toBe(false);

    resetHealthStoreForTests();
    const yesterday = addServerDays(TODAY, -1)!;
    fileSystemState.seed(`health/${MEMBER}/today.json`, encodeHealthDay(decodeHealthDay(dayJSON(yesterday))));
    api.on('GET', '/health', Reply.problem(503, 'unavailable'));
    await store().load();
    expect(store().today).toBeNull();
  });

  it('stays fresh for five minutes; force skips that', async () => {
    signedIn();
    api.on('GET', '/health', Reply.ok(dayJSON()));
    await store().load();
    await store().load();
    expect(api.sentAll('/health')).toHaveLength(1);
    await store().load({ force: true });
    expect(api.sentAll('/health')).toHaveLength(2);
    useHealthStore.setState({ loadState: { kind: 'loaded', at: new Date(Date.now() - FRESHNESS_WINDOW_MS - 1) } });
    await store().load();
    expect(api.sentAll('/health')).toHaveLength(3);
  });

  it('an older answer never overwrites a newer one', async () => {
    signedIn();
    let first = true;
    api.on('GET', '/health', () => {
      if (first) {
        first = false;
        return Reply.delayed(40, Reply.ok(dayJSON(TODAY, { week: { weekNo: 1 } })));
      }
      return Reply.ok(dayJSON(TODAY, { week: { weekNo: 2 } }));
    });
    const older = store().load({ force: true });
    await new Promise((resolve) => setTimeout(resolve, 5));
    await store().load({ force: true });
    await older;
    expect(store().today?.week?.weekNo).toBe(2);
  });

  it('another date is remembered in memory only, at most fourteen of them', async () => {
    signedIn();
    api.on('GET', '/health', (request) => Reply.ok(dayJSON(request.query.date ?? TODAY)));
    const other = addServerDays(TODAY, -3)!;
    await store().load({ date: other });
    expect(api.sent('/health').query.date).toBe(other);
    expect(store().days[other]).toBeDefined();
    expect(store().today).toBeNull();
    await localStore.settled();
    expect(fileSystemState.files()).toEqual([]);

    const days: Record<string, ReturnType<typeof decodeHealthDay>> = {};
    for (let i = 0; i <= MAX_REMEMBERED_DAYS + 3; i += 1) {
      const date = addServerDays(TODAY, -i)!;
      days[date] = decodeHealthDay(dayJSON(date));
    }
    const kept = evictOldDays(days, TODAY);
    expect(Object.keys(kept)).toHaveLength(MAX_REMEMBERED_DAYS + 1);
    expect(kept[TODAY]).toBeDefined();
    expect(kept[addServerDays(TODAY, -MAX_REMEMBERED_DAYS - 1)!]).toBeUndefined();
  });

  it('a language change forgets the other dates', () => {
    const other = addServerDays(TODAY, -2)!;
    useHealthStore.setState({ days: { [TODAY]: decodeHealthDay(dayJSON()), [other]: decodeHealthDay(dayJSON(other)) } });
    store().forgetOtherDays();
    expect(Object.keys(store().days)).toEqual([TODAY]);
  });

  it('a failed read keeps what was on screen and says why', async () => {
    signedIn();
    api.on('GET', '/health', Reply.ok(dayJSON()));
    await store().load();
    api.on('GET', '/health', Reply.problem(500, 'internal_error'));
    await store().load({ force: true });
    expect(store().loadState).toEqual({ kind: 'failed', code: 'internal_error' });
    expect(store().lastError).not.toBeNull();
    expect(store().today?.date).toBe(TODAY);
  });
});

describe('action answers patch today without a second read', () => {
  beforeEach(() => {
    const today = decodeHealthDay(dayJSON());
    useHealthStore.setState({ today, days: { [TODAY]: today }, profileId: MEMBER });
  });

  it("an answer about today's row replaces the session, the week and upcoming in today AND its remembered read", () => {
    const session = decodeSessionView({ id: `s-${TODAY}`, scheduledFor: TODAY, status: 'done', kind: 'strength' }, 's');
    store().applyActionResult({ session, week: { ...decodeHealthDay(dayJSON()).week!, done: 1 }, upcoming: [] });
    expect(store().today?.day?.session?.status).toBe('done');
    expect(store().today?.week?.done).toBe(1);
    expect(store().days[TODAY].day?.session?.status).toBe('done');
  });

  it("an answer's week reaches the other remembered days of that week, not another week's (API 0.35.0, iOS LogWorkoutTests)", () => {
    // Yesterday's card logs an extra: the answer's week (the same week as
    // today's) reaches yesterday's remembered read too, whose strip is the
    // one on screen; another week's read, and another plan's, are left alone.
    const week = (weekStartsOn: string, programId: string | null = 'prog-1') => ({ programId, weekNo: 2, weeks: 4, weekStartsOn, days: [], planned: 3, done: 1 });
    const yesterday = addServerDays(TODAY, -1)!;
    const lastWeek = addServerDays(TODAY, -8)!;
    const otherPlan = addServerDays(TODAY, -2)!;
    const thisWeekStart = '2026-09-28';
    const remember = (date: string, weekJSON: Record<string, unknown>) => decodeHealthDay(dayJSON(date, { week: weekJSON }));
    const today = remember(TODAY, week(thisWeekStart));
    useHealthStore.setState({
      today,
      days: {
        [TODAY]: today,
        [yesterday]: remember(yesterday, week(thisWeekStart)),
        [lastWeek]: remember(lastWeek, week('2026-09-21')),
        [otherPlan]: remember(otherPlan, week(thisWeekStart, 'prog-2')),
      },
    });

    const answered = decodeHealthDay(dayJSON(TODAY, { week: { ...week(thisWeekStart), extrasDone: 1, workoutsDone: 2 } })).week!;
    store().applyActionResult({ week: answered });

    expect(store().today?.week?.extrasDone).toBe(1);
    expect(store().days[TODAY].week?.extrasDone).toBe(1);
    expect(store().days[yesterday].week?.extrasDone).toBe(1);
    expect(store().days[yesterday].week?.workoutsDone).toBe(2);
    expect(store().days[yesterday].day?.session?.id).toBe(`s-${yesterday}`);
    expect(store().days[lastWeek].week?.extrasDone).toBeNull();
    expect(store().days[otherPlan].week?.extrasDone).toBeNull();
  });

  it("a move's partner on today's date is the row today shows", () => {
    const moved = decodeSessionView({ id: 'other', scheduledFor: addServerDays(TODAY, 1), status: 'planned' }, 's');
    const partner = decodeSessionView({ id: 'partner', scheduledFor: TODAY, status: 'planned', title: 'Swim' }, 's');
    store().applyActionResult({ session: moved, changed: [partner] });
    expect(store().today?.day?.session?.id).toBe('partner');
  });

  it('a row on another remembered date takes the answer; one the date does not show is left alone', () => {
    const other = addServerDays(TODAY, -1)!;
    useHealthStore.setState({ days: { ...store().days, [other]: decodeHealthDay(dayJSON(other)) } });
    store().applySessionsToOtherDays([
      decodeSessionView({ id: `s-${other}`, scheduledFor: other, status: 'done' }, 's'),
      decodeSessionView({ id: 'stranger', scheduledFor: other, status: 'done' }, 's'),
    ]);
    expect(store().days[other].day?.session?.status).toBe('done');
    expect(store().days[other].day?.session?.id).toBe(`s-${other}`);
  });
});

describe('the problem table', () => {
  const problem = async (slug: string, status = 409, extra: Record<string, unknown> = {}) => {
    api.once('GET', '/health/sessions', Reply.problem(status, slug, extra));
    return apiGet('/health/sessions').catch((error: unknown) => error);
  };

  it('consent required: the sheet for an entitled member who just tapped, a reconcile otherwise', async () => {
    signedIn();
    useHealthStore.setState({ today: decodeHealthDay(dayJSON()) });
    api.on('GET', '/profile', Reply.ok({ id: MEMBER, locale: 'en', kennitalaVerified: true, marketingConsent: false }));
    const error = await problem('health_consent_required');
    expect(store().handle(error, { foreground: true })).toBe('presentConsent');
    expect(store().handle(error, { foreground: false })).toBe('reconciling');
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(api.sentAll('/profile').length).toBeGreaterThan(0);
    // An override (a 403 just now) means the member is NOT entitled: no sheet.
    useAppStore.getState().applyHealthAccessOverride('pass_holder');
    expect(store().handle(error, { foreground: true })).toBe('reconciling');
  });

  it('the hyphenated spelling is the same problem', async () => {
    const error = await problem('health-consent-required');
    expect(store().handle(error, { foreground: false })).toBe('reconciling');
  });

  it('a minor is wiped; a gate refusal sets the override; a pending deletion is its own outcome', async () => {
    useHealthStore.setState({ profileId: MEMBER });
    fileSystemState.seed(`health/${MEMBER}/today.json`, '{}');
    expect(store().handle(await problem('health_minor_blocked', 403), { foreground: true })).toBe('minor');
    await new Promise((resolve) => setTimeout(resolve, 10));
    await localStore.settled();
    expect(fileSystemState.files()).toEqual([]);

    expect(store().handle(await problem('no_active_plan_or_pass', 403, { memberPricing: 'company_covered' }), { foreground: true })).toBe('gate');
    expect(useAppStore.getState().healthAccessOverride).toBe('company_inactive');
    expect(store().handle(await problem('account_pending_deletion', 403), { foreground: true })).toBe('pendingDeletion');
  });

  it('changed elsewhere and rate limited leave a toast', async () => {
    for (const slug of ['meal_changed', 'health_session_not_found', 'session_action_not_allowed']) {
      store().setToast(null);
      expect(store().handle(await problem(slug), { foreground: true })).toBe('changedElsewhere');
      expect(store().toastKey).toBe('health.err.changed');
    }
    expect(store().handle(await problem('rate_limited', 429), { foreground: true })).toBe('rateLimited');
    expect(store().toastKey).toBe('health.err.rate_limited');
    expect(store().handle(new Error('boom'), { foreground: true })).toBe('other');
  });
});

describe('reconcile after every profile read', () => {
  it('an unreadable block deletes nothing', async () => {
    fileSystemState.seed(`health/${MEMBER}/outbox.json`, '[]');
    await store().reconcile(profile({ access: 42 }));
    expect(fileSystemState.files()).toEqual([`files/health/${MEMBER}/outbox.json`]);
    expect(store().toastKey).toBeNull();
  });

  it('consent withdrawn elsewhere: the phone forgets, and says so once', async () => {
    fileSystemState.seed(`health/${MEMBER}/outbox.json`, '[]');
    const reasons: HealthWipeContext[] = [];
    const unregister = registerHealthWipeHook('test.reasons', (context) => void reasons.push(context));
    await store().reconcile(profile({ access: 'entitled', consent: null }));
    unregister();
    expect(fileSystemState.files()).toEqual([]);
    expect(store().toastKey).toBe('health.consent_off_elsewhere');
    expect(reasons).toEqual([{ profileId: MEMBER, reason: 'withdrawn_elsewhere' }]);
  });

  it('a verified minor is wiped with the minor reason, consent or not', async () => {
    await AsyncStorage.setItem(ReminderKeys.workoutDay(MEMBER), '1');
    const reasons: string[] = [];
    const unregister = registerHealthWipeHook('test.reasons', ({ reason }) => void reasons.push(reason));
    await store().reconcile(profile({ access: 'minor', consent: { version: '2026-09-v1' } }));
    unregister();
    expect(reasons).toEqual(['minor']);
    expect(await AsyncStorage.getItem(ReminderKeys.workoutDay(MEMBER))).toBeNull();
  });

  it('with nothing on the phone there is nothing to wipe and nothing to say', async () => {
    await store().reconcile(profile({ access: 'entitled', consent: null }));
    expect(store().toastKey).toBeNull();
    expect(store().profileId).toBe(MEMBER);
  });

  it('a wearable disconnected elsewhere tears down only the marker', async () => {
    await AsyncStorage.setItem(WearableKeys.connectedProfileId, MEMBER);
    await AsyncStorage.setItem(WearableKeys.anchorIndex(MEMBER), JSON.stringify(['sleep']));
    await AsyncStorage.setItem(WearableKeys.anchor(MEMBER, 'sleep'), 'anchor-data');
    fileSystemState.seed(`health/${MEMBER}/today.json`, '{}');
    await store().reconcile(profile({ access: 'entitled', consent: { version: '2026-09-v1' }, appleHealth: { connected: false } }));
    expect(await AsyncStorage.getItem(WearableKeys.connectedProfileId)).toBeNull();
    expect(await AsyncStorage.getItem(WearableKeys.anchor(MEMBER, 'sleep'))).toBeNull();
    expect(fileSystemState.files()).toEqual([`files/health/${MEMBER}/today.json`]);
  });
});

describe('the local wipe', () => {
  async function seedEverything(): Promise<void> {
    fileSystemState.seed(`health/${MEMBER}/today.json`, '{}');
    fileSystemState.seed(`health/${MEMBER}/outbox.json`, '[]');
    fileSystemState.seed(`health/${MEMBER}/meal-outbox.json`, '[]');
    await localStore.writeExport('{}', TODAY);
    await AsyncStorage.multiSet([
      ...ReminderKeys.all(MEMBER).map((key) => [key, '1'] as [string, string]),
      [scanMealGateSeenKey(MEMBER), 'true'],
      [planIntroCollapsedKey(MEMBER), 'true'],
      ...FeedbackKeys.all(MEMBER).map((key) => [key, 'true'] as [string, string]),
      [FeedbackKeys.lastProfileId, MEMBER],
      ['installation.id', 'phone-1'],
    ]);
    notificationsState.setPermission('granted');
    const later = new Date(Date.now() + 3_600_000);
    await scheduleAt('health.workoutday.2026-10-18', later, { title: 'a', body: 'b' }, 'health');
    await scheduleAt('health.weeklycheckin', later, { title: 'a', body: 'b' }, 'health');
    await scheduleAt('booking.reminder.t30', later, { title: 'a', body: 'b' }, 'bookings');
    await scheduleAt('engagement.stayactive', later, { title: 'a', body: 'b' }, 'engagement');
    await notificationsState.fire('health.weeklycheckin');
  }

  it('removes the files, the keys and every health.* notification, and nothing else', async () => {
    await seedEverything();
    useHealthStore.setState({ today: decodeHealthDay(dayJSON()), toastKey: null, profileId: MEMBER });
    await store().wipeLocal({ reason: 'withdrawn' });

    expect(fileSystemState.files()).toEqual([]);
    for (const key of [...ReminderKeys.all(MEMBER), scanMealGateSeenKey(MEMBER), planIntroCollapsedKey(MEMBER), ...FeedbackKeys.all(MEMBER), FeedbackKeys.lastProfileId]) {
      expect(await AsyncStorage.getItem(key)).toBeNull();
    }
    expect(await AsyncStorage.getItem('installation.id')).toBe('phone-1');
    expect(notificationsState.scheduled().map((n) => n.identifier).sort()).toEqual(['booking.reminder.t30', 'engagement.stayactive']);
    expect(notificationsState.presented()).toEqual([]);
    expect(store().today).toBeNull();
    expect(store().loadState).toEqual({ kind: 'idle' });
  });

  it('a sign-out keeps only a pending safety food-off', async () => {
    await seedEverything();
    await store().wipeLocal({ profileId: MEMBER, reason: 'signout' });
    expect(await AsyncStorage.getItem(FeedbackKeys.foodOffPending(MEMBER))).toBe('true');
    for (const key of FeedbackKeys.all(MEMBER).filter((k) => k !== FeedbackKeys.foodOffPending(MEMBER))) {
      expect(await AsyncStorage.getItem(key)).toBeNull();
    }
    expect(await AsyncStorage.getItem(FeedbackKeys.lastProfileId)).toBeNull();
  });

  it('every other reason removes the food-off too', async () => {
    for (const reason of ['withdrawn', 'withdrawn_elsewhere', 'account_deletion', 'minor'] as const) {
      await AsyncStorage.setItem(FeedbackKeys.foodOffPending(MEMBER), 'true');
      await store().wipeLocal({ profileId: MEMBER, reason });
      expect(await AsyncStorage.getItem(FeedbackKeys.foodOffPending(MEMBER))).toBeNull();
    }
  });

  it('a read in flight when the wipe runs never lands', async () => {
    signedIn();
    api.on('GET', '/health', Reply.delayed(30, Reply.ok(dayJSON())));
    const loading = store().load({ force: true });
    await new Promise((resolve) => setTimeout(resolve, 5));
    await store().wipeLocal({ profileId: MEMBER, reason: 'withdrawn' });
    await loading;
    await localStore.settled();
    expect(store().today).toBeNull();
    expect(fileSystemState.files()).toEqual([]);
  });

  it('a wipe while the cache is being read: the wiped day never comes back, and nothing is read for them', async () => {
    signedIn();
    fileSystemState.seed(`health/${MEMBER}/today.json`, JSON.stringify(dayJSON()));
    let reads = 0;
    api.on('GET', '/health', () => {
      reads += 1;
      return Reply.ok(dayJSON());
    });
    // The load is waiting on the disk when the sign-out's wipe starts.
    const loading = store().load({ force: true });
    const wiping = store().wipeLocal({ profileId: MEMBER, reason: 'signout' });
    await Promise.all([loading, wiping]);
    await localStore.settled();
    expect(store().today).toBeNull();
    expect(store().isShowingCache).toBe(false);
    expect(reads).toBe(0);
    expect(fileSystemState.files()).toEqual([]);
  });

  it('a wipe between reading the cache and its date: the cached day stays gone', async () => {
    signedIn();
    fileSystemState.seed(`health/${MEMBER}/today.json`, JSON.stringify(dayJSON()));
    api.on('GET', '/health', Reply.ok(dayJSON()));
    const modifiedAt = jest.spyOn(localStore, 'modifiedAt').mockImplementationOnce(async () => {
      await store().wipeLocal({ profileId: MEMBER, reason: 'withdrawn_elsewhere' });
      return new Date();
    });
    try {
      await store().load({ force: true });
      await localStore.settled();
      expect(modifiedAt).toHaveBeenCalledTimes(1);
      expect(store().today).toBeNull();
      expect(store().cachedAt).toBeNull();
      expect(fileSystemState.files()).toEqual([]);
    } finally {
      modifiedAt.mockRestore();
    }
  });

  it('a sign-out that names nobody also drops a read in flight', async () => {
    signedIn();
    api.on('GET', '/health', Reply.delayed(30, Reply.ok(dayJSON())));
    const loading = store().load({ force: true });
    await new Promise((resolve) => setTimeout(resolve, 5));
    await wipeWithoutMember();
    await loading;
    await localStore.settled();
    expect(store().today).toBeNull();
    expect(store().loadState).toEqual({ kind: 'idle' });
  });

  it('with no member at all there is nothing to delete', async () => {
    fileSystemState.seed(`health/${MEMBER}/today.json`, '{}');
    await store().wipeLocal({ reason: 'withdrawn' });
    expect(fileSystemState.files()).toEqual([`files/health/${MEMBER}/today.json`]);
  });
});

describe("the live plan's goal", () => {
  it('known from the Today read, unknown while only the profile says a plan is live', () => {
    expect(livePlanGoal({ id: 'p1', status: 'active', goal: 'lose_weight' }, { id: 'p1', status: 'active' })).toEqual({ kind: 'known', goal: 'lose_weight' });
    expect(livePlanGoal(null, { id: 'p1', status: 'active' })).toEqual({ kind: 'unknown' });
    expect(livePlanGoal({ id: 'p2', status: 'active', goal: 'lose_weight' }, { id: 'p1', status: 'paused' })).toEqual({ kind: 'unknown' });
    expect(livePlanGoal({ id: 'p1', status: 'completed', goal: 'lose_weight' }, null)).toEqual({ kind: 'noLivePlan' });
    expect(livePlanGoal({ id: 'p1', status: 'active', goal: 'swim_the_channel' }, null)).toEqual({ kind: 'known', goal: null });
  });

  it('may take a target: a weight goal, or a goal not known here', () => {
    expect(mayTakeTarget({ kind: 'known', goal: 'gain_weight' })).toBe(true);
    expect(mayTakeTarget({ kind: 'known', goal: 'build_muscle' })).toBe(false);
    expect(mayTakeTarget({ kind: 'known', goal: null })).toBe(false);
    expect(mayTakeTarget({ kind: 'unknown' })).toBe(true);
    expect(mayTakeTarget({ kind: 'noLivePlan' })).toBe(false);
  });
});
