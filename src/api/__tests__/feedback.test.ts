/**
 * The monthly feedback decodes the way the rest of the health models do:
 * fail soft (iOS FeedbackDecodeTests, `SPEC` 9.1, 13.3). An unknown topic,
 * action or kind is `'unknown'` and never throws; a missing optional field is
 * null; one malformed row costs that row. And the five calls send what the
 * contract says, a switch change only that switch.
 */
import { api, Reply } from '@test/server';

import { HttpStatusError } from '..';
import {
  applySettingsChange,
  decodeFeedbackMarkResponse,
  decodeFeedbackReport,
  decodeFeedbackReportPage,
  decodeFeedbackReportSummary,
  decodeFeedbackSettings,
  decodeFeedbackSettingsResponse,
  decodeFeedbackSummary,
  feedbackPathId,
  feedbackSettings,
  feedbackSettingsBody,
  FeedbackMonth,
  fetchFeedbackReport,
  fetchFeedbackReports,
  fetchFeedbackSummary,
  foodAndWeightChosen,
  foodAndWeightOffByDefault,
  isEmptyNote,
  isFeedbackRouteMissing,
  markFeedbackReport,
  revertSettingsChange,
  updateFeedbackSettings,
  type FeedbackFoodSource,
  type FeedbackSettingsChange,
} from '../feedback';
import { expectSentToMatchContract, replyFromContract, stubApiClientPerTest } from '../testing';
import { encodeBody } from '../wire';
import { shouldTurnOffFoodForSafety } from '../../features/feedback/store';
import { resolveFeedbackAction } from '../../features/feedback/cardState';

stubApiClientPerTest();

const date = (iso: string) => new Date(iso);

const summaryJSON = {
  settings: {
    monthlyReport: true,
    midMonthNote: false,
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
    highlights: ['One.', 'Two.', 'Three.', 'Four.'],
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
  features: ['target_weight', 'plan_revision', 'health_feedback'],
};

describe('decoding (FeedbackDecodeTests)', () => {
  it('the summary decodes', () => {
    const summary = decodeFeedbackSummary(summaryJSON, 'feedback');
    expect(summary.settings?.monthlyReport).toBe(true);
    expect(summary.settings?.midMonthNote).toBe(false);
    expect(summary.settings?.includeFoodAndWeight).toBe(true);
    expect(summary.settings?.includeFoodAndWeightSource).toBe('plan');
    expect(summary.settings?.updatedAt).toBeNull();
    expect(summary.latest?.id).toBe('r-1');
    expect(summary.latest?.createdAt).toEqual(date('2026-10-01T06:12:00Z'));
    expect(summary.note?.createdAt).toEqual(date('2026-10-12T06:11:00Z'));
    expect(summary.latest?.current).toBe(true);
    expect(summary.latest?.highlights).toHaveLength(3);
    expect(summary.note?.expiresOn).toBe('2026-10-22');
    expect(summary.note?.message?.key).toBe('note.sleep_short');
    expect(summary.note?.message?.action).toBeNull();
    expect(summary.nextReport).toEqual({ periodMonth: '2026-10', readyOn: '2026-11-01', expected: true });
    expect(summary.foodAndWeightOffer).toBe(false);
    expect(summary.features).toEqual(['target_weight', 'plan_revision', 'health_feedback']);
  });

  it('the report decodes with its sections', () => {
    const report = decodeFeedbackReport(
      {
        id: 'r-1',
        kind: 'monthly',
        periodMonth: '2026-09',
        periodStart: '2026-09-01',
        periodEnd: '2026-09-30',
        title: 'September 2026',
        createdAt: '2026-10-01T06:12:00.000Z',
        seenAt: '2026-10-01T18:30:12.345Z',
        dismissedAt: null,
        rulesVersion: 'feedback-2026-10-v1',
        leftOut: 'setting',
        leftOutLine: 'Food and weight are left out.',
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
            topic: 'weight_activity',
            title: 'Activity',
            status: 'not_enough_data',
            metrics: [],
            messages: [],
            hint: { key: 'weight.hint', text: 'Weigh in about once a week.', action: null },
          },
        ],
        note: null,
        disclaimer: 'Written by LifePass rules.',
      },
      'report',
    );
    expect(report.kind).toBe('monthly');
    expect(report.createdAt).toEqual(date('2026-10-01T06:12:00Z'));
    expect(report.seenAt!.getTime() - date('2026-10-01T18:30:12Z').getTime()).toBe(345);
    expect(report.dismissedAt).toBeNull();
    expect(report.leftOut).toBe('setting');
    expect(report.sections.map((s) => s.topic)).toEqual(['workouts', 'weight_activity']);
    expect(report.sections[0]!.messages[0]!.action).toBe('adjust_plan');
    expect(report.sections[1]!.status).toBe('not_enough_data');
    expect(report.sections[1]!.hint?.key).toBe('weight.hint');
    expect(isEmptyNote(report)).toBe(false);
  });

  it('the note report decodes', () => {
    const report = decodeFeedbackReport(
      {
        id: 'n-1',
        kind: 'note',
        periodMonth: '2026-10',
        sections: [],
        note: { key: 'note.logging_paused', text: 'No meals logged this past week.', action: 'log_meal' },
        disclaimer: 'x',
      },
      'report',
    );
    expect(report.kind).toBe('note');
    expect(report.note?.action).toBe('log_meal');
    expect(isEmptyNote(report)).toBe(false);
  });

  it('a note with nothing to show is empty (a food note while food and weight are off)', () => {
    expect(isEmptyNote(decodeFeedbackReport({ id: 'n-1', kind: 'note', note: null }, 'report'))).toBe(true);
    expect(isEmptyNote(decodeFeedbackReport({ id: 'n-1', kind: 'note', note: { key: 'k', text: '   ', action: null } }, 'report'))).toBe(
      true,
    );
  });

  it('unknown enum strings read as unknown and never throw', () => {
    const report = decodeFeedbackReport(
      {
        id: 'r-1',
        kind: 'quarterly',
        leftOut: 'moon_phase',
        sections: [
          {
            topic: 'hydration',
            title: 'Water',
            status: 'shown',
            metrics: [{ key: 'm', label: 'Glasses', value: '8' }],
            messages: [],
            hint: null,
          },
          {
            topic: 'sleep',
            title: 'Sleep',
            status: 'brand_new',
            metrics: [],
            messages: [{ key: 'sleep.x', text: 'A line.', action: 'book_a_nap' }],
            hint: null,
          },
        ],
      },
      'report',
    );
    expect(report.kind).toBe('unknown');
    expect(report.leftOut).toBe('unknown');
    expect(report.sections.map((s) => s.topic)).toEqual(['sleep']);
    expect(report.sections[0]!.status).toBe('unknown');
    expect(report.sections[0]!.messages[0]!.action).toBe('unknown');
    expect(resolveFeedbackAction('unknown', { supportsPlanRevision: true, hasLiveProgram: true, access: 'entitled' })).toBeNull();
  });

  it('sections with no content, and rows with nothing to draw, are dropped', () => {
    const report = decodeFeedbackReport(
      {
        id: 'r-1',
        kind: 'monthly',
        sections: [
          { topic: 'eating', title: 'Eating', status: 'not_enough_data', metrics: [], messages: [], hint: null },
          {
            topic: 'sleep',
            title: 'Sleep',
            status: 'shown',
            metrics: [
              { key: 'a', label: '', value: '7 h' },
              { key: 'b', label: 'Average', value: null },
              { key: 'c', label: 'Average', value: '7 h' },
            ],
            messages: [{ key: 'x', text: ' ', action: null }, 'not a message'],
            hint: { key: 'h', text: '', action: null },
          },
        ],
      },
      'report',
    );
    expect(report.sections.map((s) => s.topic)).toEqual(['sleep']);
    expect(report.sections[0]!.metrics.map((m) => m.key)).toEqual(['c']);
    expect(report.sections[0]!.messages).toEqual([]);
    expect(report.sections[0]!.hint).toBeNull();
  });

  it('missing optional fields are null, and the switches default to the safer value', () => {
    const summary = decodeFeedbackSummary({}, 'feedback');
    expect(summary).toEqual({
      settings: null,
      latest: null,
      note: null,
      nextReport: null,
      foodAndWeightOffer: null,
      features: null,
    });
    const settings = decodeFeedbackSettings({}, 'settings');
    expect(settings.monthlyReport).toBe(true);
    expect(settings.midMonthNote).toBe(true);
    expect(settings.includeFoodAndWeight).toBe(false);
    expect(settings.includeFoodAndWeightSource).toBeNull();

    const latest = decodeFeedbackReportSummary({ id: 'r-1' }, 'latest');
    expect(latest.kind).toBe('monthly');
    expect(latest.current).toBe(false);
    expect(latest.highlights).toEqual([]);
    expect(latest.seenAt).toBeNull();
  });

  it('a malformed row costs only that row', () => {
    const page = decodeFeedbackReportPage(
      {
        data: [{ id: 'r-1', title: 'September 2026' }, { title: 'no id' }, { id: 'r-3', highlights: 'not a list' }],
        pagination: { nextCursor: 'c-2', hasMore: true, limit: 20 },
      },
      'page',
    );
    expect(page.reports.map((r) => r.id)).toEqual(['r-1', 'r-3']);
    expect(page.reports[1]!.highlights).toEqual([]);
    expect(page.nextCursor).toBe('c-2');
    expect(page.hasMore).toBe(true);

    const broken = decodeFeedbackSummary({ latest: { title: 'no id' }, settings: 5 }, 'feedback');
    expect(broken.latest).toBeNull();
    expect(broken.settings).toBeNull();
  });

  it('more pages only with a cursor to follow', () => {
    expect(decodeFeedbackReportPage({ data: [], pagination: { nextCursor: null, hasMore: true } }, 'p').hasMore).toBe(false);
    expect(decodeFeedbackReportPage({ data: [], pagination: { nextCursor: 5, hasMore: true } }, 'p')).toEqual({
      reports: [],
      nextCursor: null,
      hasMore: false,
    });
    expect(decodeFeedbackReportPage({ data: 'x' }, 'p')).toEqual({ reports: [], nextCursor: null, hasMore: false });
  });

  it('the mark and settings answers decode', () => {
    const mark = decodeFeedbackMarkResponse({ id: 'n-1', seenAt: '2026-10-12T18:00:00.000Z', dismissedAt: null }, 'mark');
    expect(mark.seenAt).toEqual(date('2026-10-12T18:00:00Z'));
    expect(mark.dismissedAt).toBeNull();
    const dismissed = decodeFeedbackMarkResponse(
      { id: 'n-1', seenAt: '2026-10-12T18:00:00+00:00', dismissedAt: '2026-10-12T18:00:01.000Z' },
      'mark',
    );
    expect(dismissed.seenAt).toEqual(date('2026-10-12T18:00:00Z'));
    expect(dismissed.dismissedAt).toEqual(date('2026-10-12T18:00:01Z'));
    const settings = decodeFeedbackSettingsResponse(
      {
        settings: {
          monthlyReport: false,
          midMonthNote: true,
          includeFoodAndWeight: false,
          includeFoodAndWeightSource: 'member',
          updatedAt: '2026-10-02T09:00:00.000Z',
        },
        features: ['health_feedback'],
      },
      'settings',
    );
    expect(settings.settings?.updatedAt).toEqual(date('2026-10-02T09:00:00Z'));
    expect(settings.settings?.monthlyReport).toBe(false);
    expect(settings.settings?.includeFoodAndWeightSource).toBe('member');
    expect(foodAndWeightChosen(settings.settings!)).toBe(true);
  });

  it('the summary in its envelope keeps every server timestamp', async () => {
    api.on(
      'GET',
      '/health/feedback',
      Reply.ok({
        settings: { monthlyReport: true, midMonthNote: true, includeFoodAndWeight: false, updatedAt: '2026-10-02T09:00:00.000Z' },
        latest: {
          id: 'r-1',
          kind: 'monthly',
          periodMonth: '2026-09',
          title: 'September 2026',
          createdAt: '2026-10-01T06:12:00.000Z',
          seenAt: '2026-10-01T18:30:00.000Z',
          current: true,
          highlights: [],
        },
        note: null,
        nextReport: null,
        features: ['health_feedback'],
      }),
    );
    const summary = await fetchFeedbackSummary('en');
    expect(summary.latest?.seenAt).toEqual(date('2026-10-01T18:30:00Z'));
    expect(summary.settings?.updatedAt).toEqual(date('2026-10-02T09:00:00Z'));
    expect(summary.settings?.includeFoodAndWeightSource).toBeNull();
    expect(summary.foodAndWeightOffer).toBeNull();
    // Without a source, a saved switch (updatedAt) is the member's choice.
    expect(foodAndWeightChosen(summary.settings!)).toBe(true);
  });

  it('the food source and the offer are read when sent and not needed', () => {
    const cases: [string, FeedbackFoodSource][] = [
      ['member', 'member'],
      ['plan', 'plan'],
      ['no_plan', 'no_plan'],
    ];
    for (const [raw, expected] of cases) {
      const settings = decodeFeedbackSettings(
        { includeFoodAndWeight: expected === 'plan', includeFoodAndWeightSource: raw, updatedAt: null },
        'settings',
      );
      expect(settings.includeFoodAndWeightSource).toBe(expected);
      expect(foodAndWeightChosen(settings)).toBe(expected === 'member');
      expect(foodAndWeightOffByDefault(settings)).toBe(expected === 'no_plan');
    }

    const unknown = decodeFeedbackSettings(
      { includeFoodAndWeight: false, includeFoodAndWeightSource: 'employer', updatedAt: '2026-10-02T09:00:00.000Z' },
      'settings',
    );
    expect(unknown.includeFoodAndWeightSource).toBe('unknown');
    expect(foodAndWeightChosen(unknown)).toBe(true);
    expect(foodAndWeightOffByDefault(unknown)).toBe(false);

    const older = decodeFeedbackSettings({ includeFoodAndWeight: false, updatedAt: null }, 'settings');
    expect(foodAndWeightChosen(older)).toBe(false);
    expect(foodAndWeightOffByDefault(older)).toBe(false);

    expect(decodeFeedbackSummary({ settings: {}, foodAndWeightOffer: true }, 'f').foodAndWeightOffer).toBe(true);
    const malformed = decodeFeedbackSummary({ settings: {}, foodAndWeightOffer: 'yes' }, 'f');
    expect(malformed.foodAndWeightOffer).toBeNull();
    expect(malformed.settings).not.toBeNull();
  });

  it('a failed food switch puts its source back', () => {
    const before = feedbackSettings({ includeFoodAndWeight: false, includeFoodAndWeightSource: 'no_plan' });
    const change: FeedbackSettingsChange = { key: 'includeFoodAndWeight', value: true };
    const optimistic = { ...applySettingsChange(change, before), includeFoodAndWeightSource: 'member' as const };
    const reverted = revertSettingsChange(change, optimistic, before);
    expect(reverted).toEqual(before);
    expect(foodAndWeightChosen(reverted)).toBe(false);
    expect(shouldTurnOffFoodForSafety(reverted)).toBe(true);

    // Another switch's failure leaves the food source alone.
    const monthly: FeedbackSettingsChange = { key: 'monthlyReport', value: false };
    const afterFood = feedbackSettings({ includeFoodAndWeight: true, includeFoodAndWeightSource: 'member' });
    expect(revertSettingsChange(monthly, applySettingsChange(monthly, afterFood), before).includeFoodAndWeightSource).toBe('member');
  });

  it('a switch change sends only that switch', () => {
    const cases: [FeedbackSettingsChange, string][] = [
      [{ key: 'monthlyReport', value: false }, 'monthlyReport'],
      [{ key: 'midMonthNote', value: true }, 'midMonthNote'],
      [{ key: 'includeFoodAndWeight', value: false }, 'includeFoodAndWeight'],
    ];
    for (const [change, key] of cases) {
      const body = feedbackSettingsBody(change);
      expect(Object.keys(body)).toEqual([key]);
      expect(body[change.key]).toBe(change.value);
      expect(encodeBody(body)).toBe(`{"${key}":${change.value}}`);
    }
  });

  it('the ready day of a month crosses the year', () => {
    expect(FeedbackMonth.readyOn('2026-12')).toBe('2027-01-01');
    expect(FeedbackMonth.readyOn('2026-09')).toBe('2026-10-01');
    expect(FeedbackMonth.readyOn('2026-13')).toBeNull();
    expect(FeedbackMonth.readyOn('soon')).toBeNull();
    expect(FeedbackMonth.day('2026-10-28', 6)).toBe('2026-11-03');
    expect(FeedbackMonth.days('2026-10-28', '2026-11-03')).toBe(6);
  });
});

describe('the calls', () => {
  it('FB-1 reads in the account language without caching', async () => {
    api.on('GET', '/health/feedback', replyFromContract('GET', '/health/feedback'));
    const summary = await fetchFeedbackSummary('is');
    const sent = expectSentToMatchContract('GET', '/health/feedback');
    expect(sent.query).toEqual({ locale: 'is' });
    expect(sent.headers['cache-control']).toBe('no-store');
    expect(summary.settings).not.toBeNull();
  });

  it('FB-2 sends the one switch with the caller key', async () => {
    api.on('PUT', '/health/feedback/settings', replyFromContract('PUT', '/health/feedback/settings'));
    await updateFeedbackSettings({ key: 'includeFoodAndWeight', value: false }, 'key-fb-01', 'en');
    const sent = expectSentToMatchContract('PUT', '/health/feedback/settings');
    expect(sent.rawBody).toBe('{"includeFoodAndWeight":false}');
    expect(sent.headers['idempotency-key']).toBe('key-fb-01');
    expect(sent.query).toEqual({ locale: 'en' });
  });

  it('FB-3 pages with a limit and a cursor', async () => {
    api.on('GET', '/health/feedback/reports', replyFromContract('GET', '/health/feedback/reports'));
    await fetchFeedbackReports({ cursor: null, language: 'en' });
    expect(expectSentToMatchContract('GET', '/health/feedback/reports').query).toEqual({ locale: 'en', limit: '20' });
    await fetchFeedbackReports({ cursor: 'c-2', language: 'is' });
    expect(expectSentToMatchContract('GET', '/health/feedback/reports').query).toEqual({
      locale: 'is',
      limit: '20',
      cursor: 'c-2',
    });
  });

  it('FB-4 and FB-5 put the id in the path, percent-encoded', async () => {
    const id = '6f1c2b3a-4d5e-4f60-8a7b-9c0d1e2f3a4b';
    api.on('GET', '/health/feedback/reports/:id', replyFromContract('GET', `/health/feedback/reports/${id}`));
    api.on('POST', '/health/feedback/reports/:id', replyFromContract('POST', `/health/feedback/reports/${id}`));
    const answer = await fetchFeedbackReport(id, 'en');
    expectSentToMatchContract('GET', `/health/feedback/reports/${id}`);
    expect(answer.report.id).toBeTruthy();
    await markFeedbackReport(id, 'seen', 'key-fb-02', 'en');
    const mark = expectSentToMatchContract('POST', `/health/feedback/reports/${id}`);
    expect(mark.body).toEqual({ action: 'seen' });
    expect(mark.headers['idempotency-key']).toBe('key-fb-02');

    expect(feedbackPathId(id)).toBe(id);
    expect(feedbackPathId('../x y')).toBe('%2E%2E%2Fx%20y');
  });

  it('a bare 404 is a missing route; a report that is gone is not', async () => {
    api.on('GET', '/health/feedback', Reply.raw(404, '<html>Not found</html>'));
    const missing = await fetchFeedbackSummary('en').catch((error: unknown) => error);
    expect(missing).toBeInstanceOf(HttpStatusError);
    expect(isFeedbackRouteMissing(missing)).toBe(true);

    api.on('GET', '/health/feedback/reports/:id', Reply.problem(404, 'health_feedback_report_not_found'));
    const gone = await fetchFeedbackReport('r-9', 'en').catch((error: unknown) => error);
    expect(isFeedbackRouteMissing(gone)).toBe(false);
  });
});
