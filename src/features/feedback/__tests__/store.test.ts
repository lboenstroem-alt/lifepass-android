/**
 * The feedback store against the stub server: the safety hook
 * (iOS FeedbackSafetyHookTests, the store's half), the optimistic switches
 * with their one retry under the same key, the throttled and shared read, the
 * stale flag, the marks, and the generation guard of a wipe.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { api, Reply } from '@test/server';

import { stubApiClientPerTest } from '../../../api/testing';
import { feedbackSettings } from '../../../api/feedback';
import { FeedbackKeys } from '../../../health/localKeys';
import { refusedParams, setAnalyticsObserver } from '../../../lib/analytics';
import { isCardEmpty, resolveFeedbackCardState } from '../cardState';
import { FEEDBACK_FRESHNESS_WINDOW_MS, shouldTurnOffFoodForSafety } from '../store';

import { ENV, makeStore, recordAnalytics, settingsAnswer, settle, summaryJSON } from './feedbackFixtures';

stubApiClientPerTest();

afterEach(() => setAnalyticsObserver(null));

const SAFETY_WORDS = ['pregnan', 'eating', 'breast', 'disorder', 'reason', 'safety'];

function noSafetyWordSent(): void {
  for (const request of api.requests) {
    const raw = (request.rawBody ?? '').toLowerCase();
    for (const word of SAFETY_WORDS) expect(raw).not.toContain(word);
    for (const value of Object.values(request.query)) {
      for (const word of SAFETY_WORDS) expect(value.toLowerCase()).not.toContain(word);
    }
  }
}

describe('the safety hook (FeedbackSafetyHookTests)', () => {
  it('the safety PUT sends the switch and nothing else', async () => {
    const events = recordAnalytics();
    const { store } = makeStore();
    api.on('PUT', '/health/feedback/settings', Reply.ok(settingsAnswer()));
    await store.getState().turnOffFoodAndWeightForSafety();
    const puts = api.sentAll('/health/feedback/settings', 'PUT');
    expect(puts).toHaveLength(1);
    expect(puts[0]!.rawBody).toBe('{"includeFoodAndWeight":false}');
    expect(puts[0]!.headers['idempotency-key']).toBeTruthy();
    expect(await store.getState().foodOffPending('p-1')).toBe(false);
    noSafetyWordSent();
    // The food switch is never tracked, whoever moves it.
    expect(events.map((e) => e.event)).not.toContain('feedback_setting_changed');
  });

  it('a failed PUT is retried on the next foreground until it succeeds, before the read', async () => {
    const { store } = makeStore();
    api.on('PUT', '/health/feedback/settings', Reply.fail());
    await store.getState().turnOffFoodAndWeightForSafety();
    expect(await store.getState().foodOffPending('p-1')).toBe(true);
    expect(await AsyncStorage.getItem(FeedbackKeys.foodOffPending('p-1'))).toBe('true');

    api.reset();
    api.on('PUT', '/health/feedback/settings', Reply.ok(settingsAnswer()));
    api.on(
      'GET',
      '/health/feedback',
      Reply.ok(summaryJSON({ settings: settingsAnswer().settings, latest: null, note: null, nextReport: null })),
    );
    await store.getState().refresh({ force: true });
    expect(api.requests.map((r) => r.method)).toEqual(['PUT', 'GET']);
    expect(await store.getState().foodOffPending('p-1')).toBe(false);
    expect(store.getState().summary?.settings?.includeFoodAndWeight).toBe(false);
    noSafetyWordSent();
  });

  it('a pending food-off gets one try before sign-out, and nothing when nothing waits', async () => {
    const { store } = makeStore();
    api.on('PUT', '/health/feedback/settings', Reply.fail());
    await store.getState().turnOffFoodAndWeightForSafety();
    expect(await store.getState().foodOffPending('p-1')).toBe(true);

    api.reset();
    api.on('PUT', '/health/feedback/settings', Reply.fail());
    await store.getState().sendPendingFoodOffBeforeSignOut();
    expect(api.requests.map((r) => r.method)).toEqual(['PUT']);
    expect(await store.getState().foodOffPending('p-1')).toBe(true);

    api.reset();
    api.on('PUT', '/health/feedback/settings', Reply.ok(settingsAnswer()));
    await store.getState().sendPendingFoodOffBeforeSignOut();
    const put = api.sent('/health/feedback/settings', 'PUT');
    expect(put.rawBody).toBe('{"includeFoodAndWeight":false}');
    expect(await store.getState().foodOffPending('p-1')).toBe(false);

    api.reset();
    await store.getState().sendPendingFoodOffBeforeSignOut();
    expect(api.requests).toHaveLength(0);
  });

  it('a request still running at the sign-out deadline is cancelled, and the flag stays', async () => {
    const { store } = makeStore();
    await AsyncStorage.setItem(FeedbackKeys.foodOffPending('p-1'), 'true');
    api.on('PUT', '/health/feedback/settings', Reply.hang());
    const started = Date.now();
    await store.getState().sendPendingFoodOffBeforeSignOut(50);
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(await store.getState().foodOffPending('p-1')).toBe(true);
  });

  it('consent gone, or the route missing: there is nothing left to switch off', async () => {
    const { store } = makeStore();
    api.on('PUT', '/health/feedback/settings', Reply.problem(409, 'health_consent_required'));
    await store.getState().turnOffFoodAndWeightForSafety();
    expect(await store.getState().foodOffPending('p-1')).toBe(false);

    api.on('PUT', '/health/feedback/settings', Reply.raw(404, '<html>Not found</html>'));
    await store.getState().turnOffFoodAndWeightForSafety();
    expect(await store.getState().foodOffPending('p-1')).toBe(false);
  });

  it('turns the switch off here at once, makes it the member choice and ends the offer', async () => {
    const { store } = makeStore();
    api.on(
      'GET',
      '/health/feedback',
      Reply.ok(
        summaryJSON({
          settings: { monthlyReport: true, midMonthNote: true, includeFoodAndWeight: false, includeFoodAndWeightSource: 'no_plan', updatedAt: null },
          latest: null,
          note: null,
          foodAndWeightOffer: true,
        }),
      ),
    );
    await store.getState().refresh();
    api.on('PUT', '/health/feedback/settings', Reply.delayed(40, Reply.fail()));
    const send = store.getState().turnOffFoodAndWeightForSafety(new Date('2026-10-12T10:00:00Z'));
    const settings = store.getState().summary?.settings;
    expect(settings?.includeFoodAndWeight).toBe(false);
    expect(settings?.includeFoodAndWeightSource).toBe('member');
    expect(settings?.updatedAt).toEqual(new Date('2026-10-12T10:00:00Z'));
    expect(store.getState().summary?.foodAndWeightOffer).toBe(false);
    await settle();
    // The flag went down before the request.
    expect(await AsyncStorage.getItem(FeedbackKeys.foodOffPending('p-1'))).toBe('true');
    const card = resolveFeedbackCardState({
      summary: store.getState().summary,
      introDismissed: false,
      foodOfferDismissed: false,
      foodOffPending: true,
      hasLivePlan: false,
      now: new Date(),
    });
    expect(card.showsFoodOffer).toBe(false);
    expect(card.introBodyKey).toBe('feedback.intro.body_no_food');
    await send;
  });

  it('sends nothing without the feature or the consent', async () => {
    const { store } = makeStore({ ...ENV, eligible: false });
    await store.getState().turnOffFoodAndWeightForSafety();
    await store.getState().sendPendingFoodOffBeforeSignOut();
    expect(api.requests).toHaveLength(0);
  });

  it('the hook decision follows the switch', () => {
    expect(shouldTurnOffFoodForSafety(null)).toBe(true);
    expect(shouldTurnOffFoodForSafety(feedbackSettings({ includeFoodAndWeight: true, includeFoodAndWeightSource: 'plan' }))).toBe(true);
    expect(shouldTurnOffFoodForSafety(feedbackSettings({ includeFoodAndWeight: false, includeFoodAndWeightSource: 'no_plan' }))).toBe(
      true,
    );
    expect(shouldTurnOffFoodForSafety(feedbackSettings({ includeFoodAndWeight: false, includeFoodAndWeightSource: 'member' }))).toBe(
      false,
    );
  });
});

describe('the switches', () => {
  async function loaded() {
    const made = makeStore();
    api.on('GET', '/health/feedback', Reply.ok(summaryJSON()));
    await made.store.getState().refresh();
    api.reset();
    return made;
  }

  it('moves at once, sends only that switch, reports it and reads the summary again', async () => {
    const { store, calls } = await loaded();
    const events = recordAnalytics();
    api.on('PUT', '/health/feedback/settings', Reply.ok(settingsAnswer({ ...summaryJSON().settings as object, monthlyReport: false })));
    api.on('GET', '/health/feedback', Reply.ok(summaryJSON()));
    const save = store.getState().setMonthly(false);
    expect(store.getState().summary?.settings?.monthlyReport).toBe(false);
    expect(store.getState().savingSettings).toEqual(['monthly']);
    await save;
    expect(api.sent('/health/feedback/settings', 'PUT').rawBody).toBe('{"monthlyReport":false}');
    expect(api.requests.map((r) => r.method)).toEqual(['PUT', 'GET']);
    expect(store.getState().savingSettings).toEqual([]);
    expect(events).toEqual([{ event: 'feedback_setting_changed', params: { setting: 'monthly', value: 'off' } }]);
    expect(refusedParams(events[0]!.params)).toEqual([]);
    expect(calls.serverFeatures).toContainEqual(['health_feedback']);
  });

  it('retries a transient failure once with the SAME key', async () => {
    const { store } = await loaded();
    // Later routes win: the one-off 503 answers first.
    api.on('PUT', '/health/feedback/settings', Reply.ok(settingsAnswer()));
    api.once('PUT', '/health/feedback/settings', Reply.problem(503, 'service_unavailable'));
    api.on('GET', '/health/feedback', Reply.ok(summaryJSON()));
    await store.getState().setNote(false);
    const puts = api.sentAll('/health/feedback/settings', 'PUT');
    expect(puts).toHaveLength(2);
    expect(puts[0]!.headers['idempotency-key']).toBe(puts[1]!.headers['idempotency-key']);
    expect(store.getState().settingsErrorKey).toBeNull();
  });

  it('a refused or rate-limited save goes back with the error line, and is not retried', async () => {
    const { store } = await loaded();
    api.on('PUT', '/health/feedback/settings', Reply.problem(429, 'rate_limited'));
    await store.getState().setMonthly(false);
    expect(api.sentAll('/health/feedback/settings', 'PUT')).toHaveLength(1);
    expect(store.getState().summary?.settings?.monthlyReport).toBe(true);
    expect(store.getState().settingsErrorKey).toBe('bodygoals.fb_err');
    // The next tap clears it.
    api.on('PUT', '/health/feedback/settings', Reply.delayed(20, Reply.problem(400, 'invalid_request')));
    const next = store.getState().setNote(false);
    expect(store.getState().settingsErrorKey).toBeNull();
    await next;
  });

  it('a failed food switch puts its value AND its source back, untracked', async () => {
    const made = makeStore();
    api.on(
      'GET',
      '/health/feedback',
      Reply.ok(
        summaryJSON({
          settings: { monthlyReport: true, midMonthNote: true, includeFoodAndWeight: false, includeFoodAndWeightSource: 'no_plan', updatedAt: null },
        }),
      ),
    );
    await made.store.getState().refresh();
    const events = recordAnalytics();
    api.on('PUT', '/health/feedback/settings', Reply.problem(400, 'invalid_request'));
    const save = made.store.getState().setIncludeFoodAndWeight(true);
    expect(made.store.getState().summary?.settings?.includeFoodAndWeightSource).toBe('member');
    await save;
    expect(made.store.getState().summary?.settings).toMatchObject({ includeFoodAndWeight: false, includeFoodAndWeightSource: 'no_plan' });
    expect(events).toEqual([]);
  });

  it('a consent refusal is handed on as a problem', async () => {
    const { store, calls } = await loaded();
    api.on('PUT', '/health/feedback/settings', Reply.problem(409, 'health_consent_required'));
    await store.getState().setMonthly(false);
    expect(calls.problems).toHaveLength(1);
  });

  it('answering the offer closes it here for good and sends the choice, silently on failure', async () => {
    const made = makeStore();
    api.on(
      'GET',
      '/health/feedback',
      Reply.ok(
        summaryJSON({
          settings: { monthlyReport: true, midMonthNote: true, includeFoodAndWeight: false, includeFoodAndWeightSource: 'no_plan', updatedAt: null },
          latest: null,
          foodAndWeightOffer: true,
        }),
      ),
    );
    await made.store.getState().refresh();
    await made.store.getState().loadFlags('p-1');
    api.on('PUT', '/health/feedback/settings', Reply.problem(400, 'invalid_request'));
    await made.store.getState().answerFoodOffer(true, 'p-1');
    expect(api.sent('/health/feedback/settings', 'PUT').rawBody).toBe('{"includeFoodAndWeight":true}');
    expect(made.store.getState().summary?.foodAndWeightOffer).toBe(false);
    expect(made.store.getState().settingsErrorKey).toBeNull();
    expect(made.store.getState().flags).toMatchObject({ foodOfferDismissed: true, introDismissed: true });
    expect(await AsyncStorage.getItem(FeedbackKeys.foodOfferDismissed('p-1'))).toBe('true');
    expect(await AsyncStorage.getItem(FeedbackKeys.introDismissed('p-1'))).toBe('true');
  });

  it('does nothing before the switches have loaded', async () => {
    const { store } = makeStore();
    await store.getState().setMonthly(false);
    expect(api.requests).toHaveLength(0);
  });
});

describe('the read', () => {
  it('is throttled to ten minutes on the same Iceland day, unless forced', async () => {
    const { store, calls } = makeStore();
    api.on('GET', '/health/feedback', Reply.ok(summaryJSON()));
    const t0 = new Date('2026-10-12T10:00:00Z');
    await store.getState().refresh({ now: t0 });
    await store.getState().refresh({ now: new Date(t0.getTime() + FEEDBACK_FRESHNESS_WINDOW_MS - 1) });
    expect(api.sentAll('/health/feedback')).toHaveLength(1);
    await store.getState().refresh({ now: new Date(t0.getTime() + 60_000), force: true });
    expect(api.sentAll('/health/feedback')).toHaveLength(2);
    await store.getState().refresh({ now: new Date(t0.getTime() + FEEDBACK_FRESHNESS_WINDOW_MS + 60_001) });
    expect(api.sentAll('/health/feedback')).toHaveLength(3);
    expect(api.sent('/health/feedback').query).toEqual({ locale: 'en' });
    expect(calls.changed).toBe(3);
  });

  it('a new Iceland day reads again inside the window', async () => {
    const { store } = makeStore();
    api.on('GET', '/health/feedback', Reply.ok(summaryJSON()));
    await store.getState().refresh({ now: new Date('2026-10-31T23:58:00Z') });
    await store.getState().refresh({ now: new Date('2026-11-01T00:01:00Z') });
    expect(api.sentAll('/health/feedback')).toHaveLength(2);
  });

  it('concurrent calls share one request', async () => {
    const { store } = makeStore();
    api.on('GET', '/health/feedback', Reply.delayed(20, Reply.ok(summaryJSON())));
    await Promise.all([store.getState().refresh(), store.getState().refresh(), store.getState().refresh()]);
    expect(api.sentAll('/health/feedback')).toHaveLength(1);
    expect(store.getState().loadState.kind).toBe('loaded');
  });

  it('a bare 404 hides the feature under the list the app holds, and drops its notifications', async () => {
    const { store, calls } = makeStore();
    api.on('GET', '/health/feedback', Reply.raw(404, '<html>Not found</html>'));
    await store.getState().refresh();
    expect(store.getState().staleFeatures).toEqual(['health_feedback']);
    expect(store.getState().summary).toBeNull();
    expect(store.getState().loadState.kind).toBe('failed');
    expect(store.getState().isHidden(['health_feedback'])).toBe(true);
    expect(store.getState().isHidden(['health_feedback', 'meal_describe'])).toBe(false);
    expect(calls.removedNotifications).toBe(1);
  });

  it('a later read clears the stale flag', async () => {
    const { store } = makeStore();
    api.on('GET', '/health/feedback', Reply.raw(404, '<html>Not found</html>'));
    await store.getState().refresh();
    api.on('GET', '/health/feedback', Reply.ok(summaryJSON()));
    await store.getState().refresh({ force: true });
    expect(store.getState().staleFeatures).toBeNull();
  });

  it('a consent refusal drops the summary and is handed on', async () => {
    const { store, calls } = makeStore();
    api.on('GET', '/health/feedback', Reply.ok(summaryJSON()));
    await store.getState().refresh();
    api.on('GET', '/health/feedback', Reply.problem(409, 'health_consent_required'));
    await store.getState().refresh({ force: true });
    expect(store.getState().summary).toBeNull();
    expect(calls.problems).toHaveLength(1);
    expect(calls.removedNotifications).toBe(1);
  });

  it('a failure keeps what the card shows', async () => {
    const { store } = makeStore();
    api.on('GET', '/health/feedback', Reply.ok(summaryJSON()));
    await store.getState().refresh();
    api.on('GET', '/health/feedback', Reply.problem(500, 'internal_error'));
    await store.getState().refresh({ force: true });
    expect(store.getState().summary?.latest?.id).toBe('r-1');
    expect(store.getState().loadState.kind).toBe('failed');
  });

  it('never calls without the feature and the consent', async () => {
    const { store } = makeStore({ ...ENV, eligible: false });
    await store.getState().refresh({ force: true });
    expect(api.requests).toHaveLength(0);
  });

  it('an answer that left before a wipe never lands', async () => {
    const { store } = makeStore();
    api.on('GET', '/health/feedback', Reply.delayed(30, Reply.ok(summaryJSON())));
    const read = store.getState().refresh();
    await new Promise((resolve) => setTimeout(resolve, 5));
    store.getState().wipe();
    await read;
    expect(store.getState().summary).toBeNull();
    expect(store.getState().loadState.kind).toBe('idle');
  });

  it('an answer for a member who has gone never lands', async () => {
    const made = makeStore();
    api.on('GET', '/health/feedback', Reply.delayed(20, Reply.ok(summaryJSON())));
    const read = made.store.getState().refresh();
    made.setEnvironment({ ...ENV, profileId: 'p-2' });
    await read;
    expect(made.store.getState().summary).toBeNull();
  });
});

describe('seen and hidden', () => {
  async function loaded() {
    const made = makeStore();
    api.on('GET', '/health/feedback', Reply.ok(summaryJSON()));
    await made.store.getState().refresh();
    api.reset();
    return made;
  }

  it('marks a report seen once, at once', async () => {
    const { store } = await loaded();
    api.on('POST', '/health/feedback/reports/:id', Reply.ok({ id: 'r-1', seenAt: '2026-10-12T18:00:00.000Z', dismissedAt: null }));
    const at = new Date('2026-10-12T17:59:00Z');
    const mark = store.getState().markSeen('r-1', at);
    expect(store.getState().summary?.latest?.seenAt).toEqual(at);
    await mark;
    expect(api.sent('/health/feedback/reports/r-1', 'POST').body).toEqual({ action: 'seen' });
    await store.getState().markSeen('r-1');
    expect(api.sentAll('/health/feedback/reports/r-1', 'POST')).toHaveLength(1);
  });

  it('hides the note at once; a failed hide puts it back', async () => {
    const { store, calls } = await loaded();
    const events = recordAnalytics();
    api.on('POST', '/health/feedback/reports/:id', Reply.problem(500, 'internal_error'));
    const hide = store.getState().dismissNote('n-1');
    expect(store.getState().summary?.note).toBeNull();
    await hide;
    expect(api.sent('/health/feedback/reports/n-1', 'POST').body).toEqual({ action: 'dismiss' });
    expect(store.getState().summary?.note?.id).toBe('n-1');
    expect(events.map((e) => e.event)).toEqual(['feedback_note_dismissed']);
    expect(calls.changed).toBeGreaterThanOrEqual(2);
  });

  it('a hidden note stays hidden when the server heard it', async () => {
    const { store } = await loaded();
    api.on('POST', '/health/feedback/reports/:id', Reply.ok({ id: 'n-1', seenAt: null, dismissedAt: '2026-10-12T18:00:00.000Z' }));
    await store.getState().dismissNote('n-1');
    expect(store.getState().summary?.note).toBeNull();
  });
});

describe('local flags', () => {
  it('reads a member flags once and writes them through', async () => {
    const { store } = makeStore();
    await AsyncStorage.setItem(FeedbackKeys.introDismissed('p-1'), 'true');
    expect(await store.getState().loadFlags('p-1')).toEqual({
      profileId: 'p-1',
      introDismissed: true,
      foodOfferDismissed: false,
      foodOffPending: false,
    });
    await store.getState().dismissFoodOffer('p-1');
    expect(store.getState().flags?.foodOfferDismissed).toBe(true);
    expect(await AsyncStorage.getItem(FeedbackKeys.foodOfferDismissed('p-1'))).toBe('true');
  });

  it('the card offers no intro until the flags are read', () => {
    const summary = {
      settings: feedbackSettings({ includeFoodAndWeight: true, includeFoodAndWeightSource: 'plan' }),
      latest: null,
      note: null,
      nextReport: null,
      foodAndWeightOffer: false,
      features: null,
    };
    expect(
      isCardEmpty(
        resolveFeedbackCardState({ summary, introDismissed: true, foodOfferDismissed: true, foodOffPending: false, hasLivePlan: true, now: new Date() }),
      ),
    ).toBe(true);
  });
});
