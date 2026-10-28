/**
 * Port of iOS LifePassTests/PlanSectionTests.swift (the Plan half) and
 * PlanActionAnswerTests: the table of `ios-ux.md` 3.4 asserted column by
 * column, the three adopted lines, the feedback anchor, and what of an
 * action's answer goes into today's read.
 *
 * WHY THIS IS A TEST AND NOT A COMMENT. Which body the Plan tab draws is one
 * expression reading two independent facts, entitlement and a programme, and
 * the order they are read in decides what a member sees. Getting it wrong
 * does not crash: it hands a lapsed member the active plan body with a row
 * of buttons the server answers 403 to, or sends a member who has just
 * finished a block to the gate.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import { decodeSessionActionResponse, ReminderKeys, type HealthAccess } from '../../../../health';
import { lookup } from '../../../../i18n';
import { planActionAnswer } from '../actionAnswer';
import { ADOPTED_BANNER_KEYS, adoptedBannerKey, readAdoptedBannerKey, reminderDeniedKey, storedFlag } from '../adoptedBanner';
import {
  hasProgramToShow,
  planSectionAnalyticsState,
  planSectionAnchor,
  resolvePlanSection,
  type PlanSection,
} from '../sectionRule';

function section(
  access: HealthAccess,
  { consent = true, day = true, loading = false, failed = false, program = false } = {},
): PlanSection {
  return resolvePlanSection({
    access,
    hasConsent: consent,
    hasDay: day,
    isLoading: loading,
    readFailed: failed,
    hasProgramToShow: program,
  });
}

describe("the feedback card's anchor (SPEC 9.2)", () => {
  it('has an anchor of its own after the review', () => {
    expect(planSectionAnchor('feedback')).toBe('feedback');
    expect(planSectionAnchor('review')).toBe('review');
    expect(planSectionAnchor('feedback')).not.toBe(planSectionAnchor('review'));
    expect(planSectionAnchor('nonsense')).toBeNull();
  });
});

describe('3.4, column by column', () => {
  it('entitled with a programme gets the plan', () => {
    expect(section('entitled', { program: true })).toBe('plan');
  });

  it('entitled without a programme gets the intro', () => {
    expect(section('entitled')).toBe('intro');
    expect(section('entitled', { consent: false })).toBe('intro');
  });

  // The regression the iOS file exists for: the Today read answers with a
  // programme for a lapsed member whose consent stands, so asking for the
  // programme before entitlement handed them the plan body.
  it('a lapsed member with a programme still gets the gate', () => {
    for (const access of ['not_member', 'pass_only', 'company_inactive', 'unknown'] as const) {
      expect(section(access, { program: true })).toBe('gate');
      expect(section(access)).toBe('gate');
      expect(section(access, { consent: false })).toBe('gate');
    }
  });

  it('past_due keeps the plan it already has and gets the gate without one', () => {
    expect(section('past_due', { program: true })).toBe('plan');
    expect(section('past_due')).toBe('gate');
  });

  it('a minor is the minor card whatever else is true', () => {
    expect(section('minor', { program: true })).toBe('minor');
    expect(section('minor', { consent: false, day: false, loading: true })).toBe('minor');
  });
});

describe('loading and error (0.5)', () => {
  it('loading with no cache is the skeleton', () => {
    expect(section('entitled', { day: false, loading: true })).toBe('loading');
    expect(section('not_member', { day: false, loading: true })).toBe('loading');
  });

  it('a failed read with no cache is the error block for anyone with consent', () => {
    expect(section('entitled', { day: false, failed: true })).toBe('error');
    expect(section('not_member', { day: false, failed: true })).toBe('error');
    // Nothing was asked for without consent, so nothing failed.
    expect(section('entitled', { consent: false, day: false, failed: true })).toBe('intro');
    expect(section('not_member', { consent: false, day: false, failed: true })).toBe('gate');
  });

  it('a cached day outranks the loading and the failure', () => {
    expect(section('entitled', { loading: true, program: true })).toBe('plan');
    expect(section('entitled', { failed: true })).toBe('intro');
  });
});

describe('5.7, the block that finished', () => {
  it('a finished block still renders the plan for an entitled member', () => {
    expect(hasProgramToShow('completed')).toBe(true);
    expect(section('entitled', { program: hasProgramToShow('completed') })).toBe('plan');
  });

  it('active and paused are shown; proposed, ended and unknown are not', () => {
    expect(hasProgramToShow('active')).toBe(true);
    expect(hasProgramToShow('paused')).toBe(true);
    for (const status of ['proposed', 'abandoned', 'discarded', 'unknown', null, undefined] as const) {
      expect(hasProgramToShow(status)).toBe(false);
    }
  });
});

describe('plan_viewed.state', () => {
  it('says what iOS says for each body', () => {
    expect(planSectionAnalyticsState('loading')).toBe('no_plan');
    expect(planSectionAnalyticsState('error')).toBe('no_plan');
    expect(planSectionAnalyticsState('intro')).toBe('no_plan');
    expect(planSectionAnalyticsState('minor')).toBe('minor');
    expect(planSectionAnalyticsState('gate')).toBe('gate');
    expect(planSectionAnalyticsState('plan')).toBe('active');
  });
});

describe('3.5, the three adopted lines', () => {
  it('uses all three of its lines', () => {
    expect(adoptedBannerKey(true, false)).toBe('plan.adopted.banner');
    expect(adoptedBannerKey(true, true)).toBe('plan.adopted.banner_no_notes');
    // The toggle off outranks the permission.
    expect(adoptedBannerKey(false, false)).toBe('plan.adopted.banner_plain');
    expect(adoptedBannerKey(false, true)).toBe('plan.adopted.banner_plain');
  });

  it('has every line in both languages', () => {
    for (const key of ADOPTED_BANNER_KEYS) {
      for (const lang of ['en', 'is'] as const) {
        expect(lookup(key, lang)).not.toBe(key);
        expect(lookup(key, lang)).toContain('{date}');
      }
    }
    expect(lookup('plan.adopted.banner', 'is')).not.toBe(lookup('plan.adopted.banner', 'en'));
  });

  it("reads the member's toggle and the phone's refusal from storage", async () => {
    const member = 'member-a';
    // Never asked: the notes are on by default.
    await expect(readAdoptedBannerKey(member)).resolves.toBe('plan.adopted.banner');
    await AsyncStorage.setItem(reminderDeniedKey(member), 'true');
    await expect(readAdoptedBannerKey(member)).resolves.toBe('plan.adopted.banner_no_notes');
    await AsyncStorage.setItem(ReminderKeys.workoutDay(member), 'false');
    await expect(readAdoptedBannerKey(member)).resolves.toBe('plan.adopted.banner_plain');
    await AsyncStorage.setItem(ReminderKeys.workoutDay(member), 'true');
    await AsyncStorage.setItem(reminderDeniedKey(member), 'false');
    await expect(readAdoptedBannerKey(member)).resolves.toBe('plan.adopted.banner');
    // Nobody signed in: no promise.
    await expect(readAdoptedBannerKey(null)).resolves.toBe('plan.adopted.banner_plain');
  });

  it("keeps iOS's key name for the refusal", () => {
    expect(reminderDeniedKey('abc')).toBe('health.reminders.abc.denied');
    expect(storedFlag('true')).toBe(true);
    expect(storedFlag('1')).toBe(true);
    expect(storedFlag('false')).toBe(false);
    expect(storedFlag(null)).toBe(false);
  });
});

describe("PlanActionAnswer: an action on last week's row never lands under this week's strip", () => {
  function response(sessionDate: string, weekStartsOn: string) {
    return decodeSessionActionResponse({
      session: { id: 's-1', scheduledFor: sessionDate, kind: 'strength', status: 'done' },
      week: { weekStartsOn, days: [] },
      upcoming: [],
    });
  }

  it('an answer about this week is applied', () => {
    const rule = planActionAnswer(response('2026-09-23', '2026-09-21'), '2026-09-21', '2026-09-23');
    expect(rule.week?.weekStartsOn).toBe('2026-09-21');
    expect(rule.session?.id).toBe('s-1');
    expect(rule.rereadsShownDate).toBe(false);
  });

  it("logging last week's missed row leaves today's strip alone", () => {
    const rule = planActionAnswer(response('2026-09-20', '2026-09-14'), '2026-09-21', '2026-09-22');
    expect(rule.week).toBeNull();
    expect(rule.session).toBeNull();
    expect(rule.rereadsShownDate).toBe(true);
  });

  it('a missed row earlier this week keeps the week but not the session', () => {
    const rule = planActionAnswer(response('2026-09-21', '2026-09-21'), '2026-09-21', '2026-09-23');
    expect(rule.week?.weekStartsOn).toBe('2026-09-21');
    expect(rule.session).toBeNull();
    expect(rule.rereadsShownDate).toBe(false);
  });

  it('an answer with no week or no date is about today', () => {
    const answer = decodeSessionActionResponse({ session: { id: 's-2', kind: 'strength', status: 'done' } });
    const rule = planActionAnswer(answer, '2026-09-21', '2026-09-23');
    expect(rule.session?.id).toBe('s-2');
    expect(rule.week).toBeNull();
    expect(rule.rereadsShownDate).toBe(false);
  });
});
