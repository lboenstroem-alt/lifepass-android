/**
 * Analytics may say that a member USES the plan. It may never say anything
 * about their body: the port of iOS AnalyticsParamTests.
 *
 * The rule is mechanical: a short allow-list of keys, no member-answer
 * vocabulary as a value, and no bare numbers.
 */
import { setDev } from '@test/harness';

import {
  ALLOWED_PARAMS,
  ANALYTICS_EVENTS,
  countBand,
  isForbidden,
  refusedParams,
  setAnalyticsObserver,
  track,
  type AnalyticsEvent,
  type AnalyticsParams,
} from '../analytics';

afterEach(() => setAnalyticsObserver(null));

describe('the param rules', () => {
  it('health value keys are not on the allow-list', () => {
    for (const key of [
      'weight', 'weight_kg', 'kcal', 'protein', 'height', 'age', 'feeling', 'skip_reason',
      'food', 'exercise', 'sleep', 'resting_hr', 'body_part', 'measured_at', 'date',
    ]) {
      expect(ALLOWED_PARAMS.has(key)).toBe(false);
    }
  });

  it('the keys the release actually uses are allowed', () => {
    for (const key of [
      'entry', 'mode', 'source', 'outcome', 'kind', 'step', 'count_band', 'items', 'tab', 'action', 'cta',
      'state', 'relative', 'filter', 'field', 'choice', 'camera', 'brand', 'from', 'tray', 'reason',
      'replaced', 'future', 'feeling_given', 'with_rating', 'quick', 'edited', 'deleted',
    ]) {
      expect(ALLOWED_PARAMS.has(key)).toBe(true);
    }
  });

  it('member answers are refused whatever the key', () => {
    for (const value of ['tired', 'sore', 'too_hard', 'pregnant', 'injury', 'condition', 'knee', 'lower_back', 'KNEE']) {
      expect(isForbidden('reason', value)).toBe(true);
    }
  });

  it('bare numbers are refused, except a wizard step', () => {
    expect(isForbidden('count_band', '72.5')).toBe(true);
    expect(isForbidden('outcome', '1900')).toBe(true);
    expect(isForbidden('outcome', '-3e2')).toBe(true);
    expect(isForbidden('outcome', 'nan')).toBe(true);
    expect(isForbidden('step', '3')).toBe(false);
  });

  it('unknown keys are refused', () => {
    expect(isForbidden('weight_kg', '72')).toBe(true);
    expect(isForbidden('note', 'felt great')).toBe(true);
  });

  it("the release's own values pass", () => {
    const cases: [string, string][] = [
      ['tab', 'plan'], ['entry', 'home_avatar'], ['state', 'gate'], ['cta', 'choose'], ['kind', 'strength'],
      ['outcome', 'ok'], ['count_band', '2-5'], ['items', '6+'], ['mode', 'photo'], ['action', 'start'],
      ['relative', 'past'], ['reason', 'signout'],
    ];
    for (const [key, value] of cases) expect(isForbidden(key, value)).toBe(false);
  });

  it('count bands never carry the number', () => {
    expect(countBand(0)).toBe('0');
    expect(countBand(-2)).toBe('0');
    expect(countBand(1)).toBe('1');
    expect(countBand(4)).toBe('2-5');
    expect(countBand(5)).toBe('2-5');
    expect(countBand(40)).toBe('6+');
  });

  it('a session kind is safe as an analytics kind', () => {
    expect(isForbidden('kind', 'class')).toBe(false);
    expect(isForbidden('kind', 'hike')).toBe(false);
  });
});

describe('the guard track runs', () => {
  it('refuses a forbidden VALUE under an allowed key', () => {
    expect(refusedParams({ reason: 'tired' })).toEqual(['reason']);
    expect(refusedParams({ outcome: 'too_hard' })).toEqual(['outcome']);
    expect(refusedParams({ count_band: 72.5 })).toEqual(['count_band']);
  });

  it('still refuses a stray key', () => {
    expect(refusedParams({ weight_kg: '72' })).toEqual(['weight_kg']);
  });

  it('checks only the key of a value it cannot read back', () => {
    expect(refusedParams({ venue_id: new Date() })).toEqual([]);
    expect(refusedParams({ measured_at: new Date() })).toEqual(['measured_at']);
  });

  it('every event the app already fires passes', () => {
    const live: AnalyticsParams[] = [
      { tab: 'plan' },
      { entry: 'scan' },
      { state: 'gate' },
      { cta: 'choose' },
      { kind: 'strength', action: 'start' },
      { reason: 'signout' },
      { venue_id: '3f2b8c1e-7d4a-4b6e-9c2f-1a2b3c4d5e6f', venue_name: 'Laugar' },
      { plan_id: 'pass-day', plan: 'subscription' },
      { op: 'loadProfile', error: 'offline' },
      { op: 'loadProfile', error: '503' },
      { has_nationality: true, marketing_opt_in: false, email_confirmation_required: true },
    ];
    for (const params of live) expect(refusedParams(params)).toEqual([]);
  });

  it('the target weight and Adjust my plan events carry only allow-listed words', () => {
    const events: AnalyticsParams[] = [
      { entry: 'chip' }, { entry: 'gate' }, { change: 'goal' }, { change: 'days' }, { change: 'weekdays' },
      { change: 'length' }, { change: 'target' }, { outcome: 'set', surface: 'body_sheet' },
      { outcome: 'cleared', surface: 'sheet' }, { outcome: 'refused', surface: 'coach' },
      { mode: 'goal', field: 'goal', target: 'unchanged' }, { mode: 'intake', field: 'details', target: 'set' },
    ];
    for (const params of events) expect(refusedParams(params)).toEqual([]);
    const names: readonly string[] = ANALYTICS_EVENTS;
    expect(names).toContain('program_adjust_started');
    expect(names).toContain('program_adjust_submitted');
    expect(names).toContain('target_weight_saved');
  });

  it('the monthly feedback keys are allowed and still refuse numbers', () => {
    expect(ALLOWED_PARAMS.has('setting')).toBe(true);
    expect(ALLOWED_PARAMS.has('value')).toBe(true);
    expect(refusedParams({ setting: 'monthly', value: 'off' })).toEqual([]);
    expect(refusedParams({ value: 72.5 })).toEqual(['value']);
  });

  it('a target weight is never an analytics value', () => {
    expect(refusedParams({ target: 72.5 })).toEqual(['target']);
    expect(refusedParams({ target: '72.5' })).toEqual(['target']);
    expect(refusedParams({ target_kg: 'set' })).toEqual(['target_kg']);
  });
});

describe('track', () => {
  it('hands an accepted event to the observer', () => {
    const seen: [AnalyticsEvent, AnalyticsParams][] = [];
    setAnalyticsObserver((event, params) => seen.push([event, params]));
    track('nav_tab_selected', { tab: 'plan' });
    expect(seen).toEqual([['nav_tab_selected', { tab: 'plan' }]]);
  });

  it('a development build throws on a refused param, naming the key and never the value', () => {
    expect(() => track('workout_skipped', { reason: 'pregnant' })).toThrow('analytics param refused: [reason] on workout_skipped');
    try {
      track('weigh_in_logged', { kind: 72.5 });
    } catch (error) {
      expect(String(error)).not.toContain('72.5');
    }
  });

  it('a release build sends nothing and never throws', () => {
    setDev(false);
    const seen: unknown[] = [];
    setAnalyticsObserver((event) => seen.push(event));
    expect(() => track('workout_skipped', { reason: 'pregnant' })).not.toThrow();
    track('nav_tab_selected', { tab: 'plan' });
    expect(seen).toEqual([]);
  });
});
