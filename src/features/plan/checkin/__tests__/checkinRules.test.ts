/**
 * The weekly check-in's rules (iOS WeeklyCheckInSheet.swift): what the sheet
 * opens with, when Save is live, and the OP-23 body, which must never carry
 * both height forms and never a height without a weight
 * (`checkinBodySchema`, C27).
 */
import { expectRequestBodyValid } from '@test/contract';

import type { CheckInState, WeighInState } from '../../../../health';
import { translate } from '../../../../i18n';
import { BODY_HEIGHT_RANGE, BODY_WEIGHT_RANGE } from '../../../body/sheets';
import {
  CHECKIN_HEIGHT_RANGE,
  CHECKIN_WEIGHT_RANGE,
  canSaveCheckIn,
  checkInBody,
  checkInWeight,
  heightQuestionCm,
  lastWeightLine,
  prefillCheckIn,
  stepFallbackKg,
  stepRating,
  weightIsValid,
  type CheckInForm,
} from '../rules';

jest.mock('expo-asset', () => jest.requireActual('expo/node_modules/expo-asset'), { virtual: true });

const FORM: CheckInForm = {
  weightText: '',
  weightSkipped: false,
  rating: null,
  heightText: '',
  heightConfirmed: false,
  showHeightField: false,
};

const form = (patch: Partial<CheckInForm>): CheckInForm => ({ ...FORM, ...patch });

function weighIn(patch: Partial<WeighInState> = {}): WeighInState {
  return {
    due: true,
    lastWeightKg: 72.5,
    lastMeasuredAt: new Date('2026-10-12T08:00:00Z'),
    lastSource: 'self_reported',
    heightCm: 178,
    heightMeasuredAt: new Date('2026-04-01T08:00:00Z'),
    heightConfirmDue: true,
    ...patch,
  };
}

function checkIn(patch: Partial<CheckInState> = {}): CheckInState {
  return { due: true, weekStartsOn: '2026-10-12', recentWeightKg: null, ...patch };
}

/** The body as the client would send it, checked against the contract's own schema. */
function expectBodyValid(body: object): void {
  expectRequestBodyValid('POST', '/health/checkin', JSON.parse(JSON.stringify(body)));
}

it('takes the body sheet\'s ranges (iOS BodyDetails)', () => {
  expect(CHECKIN_WEIGHT_RANGE).toEqual(BODY_WEIGHT_RANGE);
  expect(CHECKIN_HEIGHT_RANGE).toEqual(BODY_HEIGHT_RANGE);
});

describe('prefill', () => {
  it('a weight from the last three days fills the field AND skips it, in the weekly mode only', () => {
    const recent = checkIn({ recentWeightKg: 71.85 });
    const weekly = prefillCheckIn('weekly', weighIn(), recent, 'is');
    expect(weekly).toMatchObject({ weightText: '71,8', weightSkipped: true, rating: null });
    const logWeight = prefillCheckIn('weightOnly', weighIn(), recent, 'en');
    expect(logWeight).toMatchObject({ weightText: '71.8', weightSkipped: false });
  });

  it('otherwise the last weight fills it, unskipped; with neither the field opens empty', () => {
    expect(prefillCheckIn('weekly', weighIn({ lastWeightKg: 80 }), checkIn(), 'en')).toMatchObject({
      weightText: '80',
      weightSkipped: false,
    });
    expect(prefillCheckIn('weekly', weighIn({ lastWeightKg: null }), null, 'en')).toEqual(FORM);
    expect(prefillCheckIn('weekly', null, null, 'en')).toEqual(FORM);
  });

  it('a step starts from the last weigh-in, else 70 kg', () => {
    expect(stepFallbackKg(weighIn({ lastWeightKg: 64.2 }))).toBe(64.2);
    expect(stepFallbackKg(weighIn({ lastWeightKg: null }))).toBe(70);
    expect(stepFallbackKg(null)).toBe(70);
  });
});

describe('the weight field', () => {
  it('reads a comma and a dot alike, and refuses what is not one number', () => {
    expect(checkInWeight(form({ weightText: '72,5' }))).toBe(72.5);
    expect(checkInWeight(form({ weightText: '72.5' }))).toBe(72.5);
    expect(checkInWeight(form({ weightText: ' 72,5 ' }))).toBe(72.5);
    expect(checkInWeight(form({ weightText: '7.2.5' }))).toBeNull();
    expect(checkInWeight(form({ weightText: '72,5,5' }))).toBeNull();
    expect(checkInWeight(form({ weightText: '7 2' }))).toBeNull();
    expect(checkInWeight(form({ weightText: 'kg' }))).toBeNull();
  });

  it('is valid from 30 to 300 kg inclusive, empty, or skipped', () => {
    expect(weightIsValid(form({ weightText: '30' }))).toBe(true);
    expect(weightIsValid(form({ weightText: '300' }))).toBe(true);
    expect(weightIsValid(form({ weightText: '29,9' }))).toBe(false);
    expect(weightIsValid(form({ weightText: '300.1' }))).toBe(false);
    expect(weightIsValid(form({ weightText: '7.2.5' }))).toBe(false);
    expect(weightIsValid(form({ weightText: '' }))).toBe(true);
    expect(weightIsValid(form({ weightText: '7.2.5', weightSkipped: true }))).toBe(true);
  });

  it('sends nothing while skipped', () => {
    expect(checkInWeight(form({ weightText: '72,5', weightSkipped: true }))).toBeNull();
  });
});

describe('Save', () => {
  it('is live with a valid weight or a rating in the weekly mode', () => {
    expect(canSaveCheckIn(FORM, 'weekly')).toBe(false);
    expect(canSaveCheckIn(form({ weightText: '72' }), 'weekly')).toBe(true);
    expect(canSaveCheckIn(form({ rating: 'ok' }), 'weekly')).toBe(true);
    expect(canSaveCheckIn(form({ weightText: '72', weightSkipped: true }), 'weekly')).toBe(false);
    expect(canSaveCheckIn(form({ weightText: '72', weightSkipped: true, rating: 'tough' }), 'weekly')).toBe(true);
  });

  it('is held by an invalid weight even with a rating', () => {
    expect(canSaveCheckIn(form({ weightText: '400', rating: 'great' }), 'weekly')).toBe(false);
  });

  it('Log weight needs a valid weight', () => {
    expect(canSaveCheckIn(form({ rating: 'great' }), 'weightOnly')).toBe(false);
    expect(canSaveCheckIn(form({ weightText: '72,5' }), 'weightOnly')).toBe(true);
    expect(canSaveCheckIn(form({ weightText: '20' }), 'weightOnly')).toBe(false);
  });
});

describe('the height question', () => {
  it('is asked in the weekly mode, when due, about the height on record, beside a weight', () => {
    expect(heightQuestionCm('weekly', weighIn(), FORM)).toBe(178);
    expect(heightQuestionCm('weekly', weighIn(), form({ weightSkipped: true }))).toBeNull();
    expect(heightQuestionCm('weekly', weighIn({ heightConfirmDue: false }), FORM)).toBeNull();
    expect(heightQuestionCm('weekly', weighIn({ heightConfirmDue: null }), FORM)).toBeNull();
    expect(heightQuestionCm('weekly', weighIn({ heightCm: null }), FORM)).toBeNull();
    expect(heightQuestionCm('weightOnly', weighIn(), FORM)).toBeNull();
    expect(heightQuestionCm('weekly', null, FORM)).toBeNull();
  });
});

describe('the OP-23 body', () => {
  it('a weight and a rating', () => {
    const body = checkInBody(form({ weightText: '72,5', rating: 'great' }));
    expect(body).toEqual({ weekRating: 'great', weightKg: 72.5 });
    expectBodyValid(body);
  });

  it('a rating alone, with the weight skipped: no weight, and no height even if Yes was tapped before', () => {
    const body = checkInBody(form({ weightText: '72,5', weightSkipped: true, rating: 'ok', heightConfirmed: true }));
    expect(body).toEqual({ weekRating: 'ok' });
    expectBodyValid(body);
  });

  it('Yes confirms the height beside a weight', () => {
    const body = checkInBody(form({ weightText: '72', heightConfirmed: true }));
    expect(body).toEqual({ weightKg: 72, heightConfirmed: true });
    expectBodyValid(body);
  });

  it('a changed height is sent as heightCm, never with heightConfirmed', () => {
    const body = checkInBody(form({ weightText: '72', showHeightField: true, heightText: '181', heightConfirmed: true }));
    expect(body).toEqual({ weightKg: 72, heightCm: 181 });
    expect(body).not.toHaveProperty('heightConfirmed');
    expectBodyValid(body);
  });

  it('a Change field with no height in range sends neither height form', () => {
    for (const heightText of ['', '119', '231', '180.5', 'abc']) {
      const body = checkInBody(form({ weightText: '72', showHeightField: true, heightText }));
      expect(body).toEqual({ weightKg: 72 });
    }
  });

  it('never a height without a weight, and never both forms, over every combination', () => {
    const weights = ['', '72', '7.2.5'];
    const flags = [true, false];
    const heights = ['', '181', '300'];
    for (const weightText of weights)
      for (const weightSkipped of flags)
        for (const heightConfirmed of flags)
          for (const showHeightField of flags)
            for (const heightText of heights) {
              const body = checkInBody(form({ weightText, weightSkipped, heightConfirmed, showHeightField, heightText, rating: 'ok' }));
              expect('heightCm' in body && 'heightConfirmed' in body).toBe(false);
              if ('heightCm' in body || 'heightConfirmed' in body) expect(body.weightKg).toBeDefined();
            }
  });

  it('leaves out every field that is not set (no nulls on the wire)', () => {
    expect(JSON.stringify(checkInBody(form({ rating: 'tough' })))).toBe('{"weekRating":"tough"}');
  });
});

describe('the rating', () => {
  it('steps worst to best from OK, and stops at the ends', () => {
    expect(stepRating(null, 1)).toBe('great');
    expect(stepRating(null, -1)).toBe('tough');
    expect(stepRating('tough', 1)).toBe('ok');
    expect(stepRating('ok', 1)).toBe('great');
    expect(stepRating('great', 1)).toBe('great');
    expect(stepRating('tough', -1)).toBe('tough');
  });
});

describe('the line under the weight', () => {
  const en = (line: { key: string; params?: Record<string, string> } | null) =>
    line ? translate(line.key, 'en', line.params) : null;

  it('a skipped recent weight says the week\'s weight is optional', () => {
    const line = lastWeightLine({ weightSkipped: true }, weighIn(), checkIn({ recentWeightKg: 72 }), 'en');
    expect(line?.key).toBe('checkin.recent_weight');
  });

  it('the last weigh-in and its day otherwise, in the account language', () => {
    expect(en(lastWeightLine({ weightSkipped: false }, weighIn(), checkIn({ recentWeightKg: 72 }), 'en'))).toBe(
      'Last: 72.5 kg on Mon 12 Oct',
    );
    const is = lastWeightLine({ weightSkipped: false }, weighIn(), null, 'is');
    expect(is && translate(is.key, 'is', is.params)).toBe('Síðast: 72,5 kg þann mán., 12. okt.');
  });

  it('a weight synced from a wearable is named neutrally, never after Apple Health', () => {
    const line = lastWeightLine({ weightSkipped: false }, weighIn({ lastSource: 'wearable' }), null, 'en');
    expect(line?.key).toBe('checkin.from_health_app');
    expect(en(line)).toBe('From a connected health app on Mon 12 Oct');
    expect(en(line)).not.toMatch(/Apple/);
  });

  it('nothing without a last weigh-in', () => {
    expect(lastWeightLine({ weightSkipped: false }, weighIn({ lastWeightKg: null }), null, 'en')).toBeNull();
    expect(lastWeightLine({ weightSkipped: false }, weighIn({ lastMeasuredAt: null }), null, 'en')).toBeNull();
    expect(lastWeightLine({ weightSkipped: false }, null, null, 'en')).toBeNull();
  });
});
