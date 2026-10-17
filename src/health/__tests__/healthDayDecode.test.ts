/**
 * The Today read with and without the newer additions: the port of iOS
 * HealthDayDecodeTests, plus the fail-soft rules of HealthModels.swift the
 * Plan tab depends on (a fractional HRV, an unknown enum, the cache round
 * trip).
 *
 * Production is promoted by hand, so this build meets servers that do not
 * have target weights yet, and older builds meet servers that do. Both
 * directions are decode questions: an older server's day must decode with
 * every new flag off, and a newer server's odd value must cost that value,
 * never the member's Plan tab.
 */
import { sampleResponse } from '@test/contract';

import { useAppStore, selectSupportsPlanRevision, selectSupportsTargetWeight } from '../../stores/appStore';
import {
  allPendingDrafts,
  decodeCachedHealthDay,
  decodeHealthDay,
  decodeProgramSummary,
  encodeHealthDay,
  isRevision,
  isServerToday,
  knownAppliesTo,
  knownDirection,
  isTargetOutsideHealthyRange,
  isTargetReached,
  type HealthDay,
} from '../models';

function decode(extra: Record<string, unknown> = {}): HealthDay {
  return decodeHealthDay({
    contractVersion: '2026-09-v1',
    date: '2026-09-24',
    today: '2026-09-24',
    locale: 'en',
    access: 'entitled',
    program: null,
    proposal: null,
    week: null,
    day: null,
    note: null,
    meals: null,
    scores: null,
    review: null,
    weighIn: null,
    checkIn: null,
    upcoming: [],
    pendingDrafts: [],
    history: null,
    libraryVersion: '2026-09-v1',
    ...extra,
  });
}

describe('the target view and the feature list (iOS HealthDayDecodeTests)', () => {
  it('the target view and the features decode', () => {
    const day = decode({
      targetWeight: {
        targetWeightKg: 72.0,
        direction: 'lose',
        setAt: '2026-09-01T09:00:00Z',
        reachedAt: null,
        outsideHealthyRange: false,
        appliesTo: 'program',
        eta: { weeksLow: 26, weeksHigh: 34 },
      },
      features: ['target_weight', 'plan_revision'],
    });
    const target = day.targetWeight!;
    expect(target.targetWeightKg).toBe(72);
    expect(knownDirection(target)).toBe('lose');
    expect(knownAppliesTo(target)).toBe('program');
    expect(target.eta).toEqual({ weeksLow: 26, weeksHigh: 34 });
    expect(isTargetReached(target)).toBe(false);
    expect(target.setAt).not.toBeNull();
    expect(day.features).toEqual(['target_weight', 'plan_revision']);
  });

  it('a reached target has no estimate', () => {
    const day = decode({
      targetWeight: {
        targetWeightKg: 72.0,
        direction: 'lose',
        setAt: '2026-09-01T09:00:00Z',
        reachedAt: '2026-09-20T07:00:00Z',
        outsideHealthyRange: false,
        appliesTo: 'goal',
        eta: null,
      },
    });
    expect(isTargetReached(day.targetWeight!)).toBe(true);
    expect(day.targetWeight!.eta).toBeNull();
  });

  it("a newer server's words for a direction or a scope do not throw", () => {
    const day = decode({
      targetWeight: {
        targetWeightKg: 72.0,
        direction: 'sideways',
        setAt: 'not a date',
        reachedAt: null,
        outsideHealthyRange: 'maybe',
        appliesTo: 'everything',
        eta: { weeksLow: 'ten' },
      },
    });
    const target = day.targetWeight!;
    expect(knownDirection(target)).toBeNull();
    expect(knownAppliesTo(target)).toBeNull();
    expect(target.setAt).toBeNull();
    expect(target.eta).toBeNull();
    expect(isTargetOutsideHealthyRange(target)).toBe(false);
  });

  it('an unreadable target costs the target, never the day', () => {
    const day = decode({ targetWeight: '72 kg', features: 'all of them' });
    expect(day.targetWeight).toBeNull();
    expect(day.features).toBeNull();
    expect(day.date).toBe('2026-09-24');
  });

  it('an estimate that makes no sense is dropped', () => {
    const day = decode({ targetWeight: { targetWeightKg: 72.0, direction: 'lose', eta: { weeksLow: 12, weeksHigh: 10 } } });
    expect(day.targetWeight!.eta).toBeNull();
    const zero = decode({ targetWeight: { targetWeightKg: 72.0, eta: { weeksLow: 0, weeksHigh: 4 } } });
    expect(zero.targetWeight!.eta).toBeNull();
  });

  it("an older server's day turns everything off", () => {
    const day = decode();
    expect(day.targetWeight).toBeNull();
    expect(day.features).toBeNull();
    useAppStore.getState().noteServerFeatures(day.features);
    expect(selectSupportsTargetWeight(useAppStore.getState())).toBe(false);
    expect(selectSupportsPlanRevision(useAppStore.getState())).toBe(false);
  });

  it('the additions survive the cache round trip', () => {
    const day = decode({
      targetWeight: { targetWeightKg: 68.5, direction: 'gain', appliesTo: 'goal', eta: { weeksLow: 5, weeksHigh: 6 } },
      features: ['target_weight'],
    });
    expect(decodeCachedHealthDay(encodeHealthDay(day))).toEqual(day);
  });

  it('the revision fields on a programme summary are additive', () => {
    const revision = decodeProgramSummary({ id: 'prop-2', status: 'proposed', revisionOf: 'prog-1', revised: false }, 'p');
    expect(isRevision(revision)).toBe(true);
    expect(revision.revisionOf).toBe('prog-1');
    const old = decodeProgramSummary({ id: 'prog-1', status: 'abandoned' }, 'p');
    expect(isRevision(old)).toBe(false);
    expect(old.revised).toBeNull();
  });
});

describe('fail soft, as HealthModels.swift is', () => {
  it('a fractional HRV and a median resting heart rate decode, rounded, without failing the day', () => {
    const day = decode({
      scores: {
        connected: true,
        day: '2026-09-24',
        sleepMinutes: 431.6,
        steps: 8210,
        restingHrBpm: 54,
        restingHrTypicalBpm: 55.5,
        hrvMs: 45.37,
        hrvTypicalMs: 44.5,
        activeEnergyKcal: '410',
        nightsAvailable: 6,
        sources: ['Apple Watch'],
        syncedAt: '2026-09-24T06:00:00Z',
        stale: false,
      },
    });
    expect(day.scores).not.toBeNull();
    expect(day.scores!.hrvMs).toBe(45);
    expect(day.scores!.hrvTypicalMs).toBe(45);
    expect(day.scores!.restingHrTypicalBpm).toBe(56);
    expect(day.scores!.sleepMinutes).toBe(432);
    // One unreadable value leaves that value out, never the scores.
    expect(day.scores!.activeEnergyKcal).toBeNull();
    expect(day.scores!.steps).toBe(8210);
  });

  it('an unknown enum never blanks the day', () => {
    const day = decode({
      access: 'trial_pending',
      program: { id: 'p1', status: 'hibernating', kinds: ['strength', 'kayaking'] },
      week: {
        days: [{ date: '2026-09-24', kind: 'kayaking', status: 'pencilled_in' }],
      },
      day: {
        date: '2026-09-24',
        relative: 'today',
        session: {
          id: 's1',
          kind: 'kayaking',
          status: 'planned',
          intensity: 'brutal',
          undoAction: 'teleport',
          extras: [{ index: 0, kind: 'paddleboard', feeling: 'great' }],
        },
      },
      meals: { meals: [{ id: 'm1', slot: 'elevenses' }], targetWithheld: 'new_reason' },
      weighIn: { lastSource: 'smart_scale' },
    });
    expect(day.access).toBe('unknown');
    expect(day.program!.status).toBe('unknown');
    expect(day.program!.kinds).toEqual(['strength', 'unknown']);
    expect(day.week!.days![0].kind).toBe('unknown');
    expect(day.week!.days![0].status).toBe('unknown');
    const session = day.day!.session!;
    expect(session.kind).toBe('unknown');
    expect(session.intensity).toBe('unknown');
    expect(session.undoAction).toBe('unknown');
    expect(session.extras![0].kind).toBe('unknown');
    expect(session.extras![0].feeling).toBe('unknown');
    expect(day.meals!.meals![0].slot).toBe('unknown');
    expect(day.meals!.targetWithheld).toBe('unknown');
    expect(day.weighIn!.lastSource).toBe('unknown');
  });

  it("an extra's newer fields are fail-soft on their own", () => {
    const day = decode({
      day: {
        date: '2026-09-24',
        session: {
          id: 's1',
          extras: [{ index: 1, minutes: 30, id: 42, kind: 7, note: false, title: ['Gym'], canRemove: 'yes' }],
        },
      },
    });
    const extra = day.day!.session!.extras![0];
    expect(extra.minutes).toBe(30);
    expect(extra.id).toBeNull();
    expect(extra.kind).toBeNull();
    expect(extra.note).toBeNull();
    expect(extra.title).toBeNull();
    expect(extra.canRemove).toBeNull();
  });

  it("a proposal's unreadable week costs the preview rows, never the proposal", () => {
    const day = decode({ proposal: { id: 'prop-1', status: 'proposed', summaryTitle: 'Build muscle', week1: 'soon' } });
    expect(day.proposal!.program.id).toBe('prop-1');
    expect(day.proposal!.week1).toEqual([]);
  });

  it('a member the day always had, with the wrong type, fails the read as it does on iOS', () => {
    expect(() => decode({ week: { weekNo: 'two' } })).toThrow();
    expect(() => decode({ date: 20260924 })).toThrow();
    expect(() => decode({ upcoming: [{ title: 'no id' }] })).toThrow();
  });

  it('the meal-description drafts are fail-soft; a pending draft list is merged newest first', () => {
    const day = decode({
      pendingDrafts: [
        { id: 'a', loggedAt: '2026-09-22T08:00:00Z', source: 'photo' },
        { id: 'b', loggedAt: '2026-09-24T08:00:00Z' },
      ],
      pendingTextDrafts: [
        { id: 'c', loggedAt: '2026-09-23T08:00:00Z' },
        { id: 'b', loggedAt: '2026-09-24T08:00:00Z' },
      ],
    });
    expect(allPendingDrafts(day).map((d) => [d.id, d.source])).toEqual([
      ['b', null],
      ['c', 'text'],
      ['a', 'photo'],
    ]);
    expect(decode({ pendingTextDrafts: 'none' }).pendingTextDrafts).toBeNull();
  });

  it('knows the day the server calls today', () => {
    expect(isServerToday(decode())).toBe(true);
    expect(isServerToday(decode({ date: '2026-09-23' }))).toBe(false);
    expect(isServerToday(decode({ date: '2026-09-23', day: { date: '2026-09-23', relative: 'today' } }))).toBe(true);
  });
});

describe("the contract's own Today read", () => {
  it('decodes the full sample, and the cache round trip keeps it whole', () => {
    const full = sampleResponse('GET', '/health', 200, 'full');
    const day = decodeHealthDay(full);
    expect(day.date).toEqual(expect.any(String));
    const again = decodeCachedHealthDay(encodeHealthDay(day));
    expect(again).toEqual(day);
  });

  it('decodes the minimal sample', () => {
    const minimal = sampleResponse('GET', '/health', 200, 'minimal');
    expect(() => decodeHealthDay(minimal)).not.toThrow();
  });

  it('an unreadable cache is no cache', () => {
    expect(decodeCachedHealthDay('{"date":')).toBeNull();
    expect(decodeCachedHealthDay('[]')).toBeNull();
    expect(decodeCachedHealthDay('{"today":"2026-09-24"}')).toBeNull();
  });
});
