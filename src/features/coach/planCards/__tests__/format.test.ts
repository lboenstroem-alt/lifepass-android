/**
 * What the plan cards print (iOS CoachPlanView.swift): the class card's
 * when-line in Reykjavík time, the sight card's credit (a photo only with
 * its photographer, never the plate), and its travel line (the step's own
 * distance first, a ferry, a road drive only where a road goes; a straight
 * line never with a car).
 */
import { translate, type Lang, type Params } from '../../../../i18n';
import {
  classDayLabel,
  classWhenLine,
  distanceIcon,
  planSightCreditLine,
  planSightImageUrl,
  planSightTravelLine,
} from '../format';

const t = (language: Lang) => (key: string, params?: Params) => translate(key, language, params);
const en = t('en');
const is = t('is');

// 22 Oct 2026, 23:30 in Reykjavík (UTC all year).
const NOW = new Date('2026-10-22T23:30:00Z');

describe('the class card’s when-line', () => {
  it('today and tomorrow on the Reykjavík calendar, with the times', () => {
    expect(classWhenLine({ startsAt: new Date('2026-10-22T18:00:00Z'), endsAt: new Date('2026-10-22T19:00:00Z') }, 'en', en, NOW)).toBe(
      `${en('library.today')} · 18:00–19:00`,
    );
    expect(classWhenLine({ startsAt: new Date('2026-10-23T07:30:00Z'), endsAt: null }, 'en', en, NOW)).toBe(
      `${en('library.tomorrow')} · 07:30`,
    );
    expect(classDayLabel(new Date('2026-10-23T07:30:00Z'), 'is', is, NOW)).toBe(is('library.tomorrow'));
  });

  it('a later day by its short name, in each language’s own form', () => {
    const startsAt = new Date('2026-10-24T10:00:00Z');
    const endsAt = new Date('2026-10-24T11:00:00Z');
    expect(classWhenLine({ startsAt, endsAt }, 'en', en, NOW)).toBe('Sat 24 Oct · 10:00–11:00');
    expect(classWhenLine({ startsAt, endsAt }, 'is', is, NOW)).toBe('lau. 24. okt. · 10:00–11:00');
  });

  it('is Reykjavík time whatever zone the phone is in (no daylight saving)', () => {
    // 00:30 UTC on the 23rd is tomorrow in Reykjavík even though a phone in
    // New York still reads the 22nd.
    expect(classDayLabel(new Date('2026-10-23T00:30:00Z'), 'en', en, NOW)).toBe(en('library.tomorrow'));
  });
});

describe('the sight card’s picture and credit', () => {
  const plate = { imageUrl: 'https://www.lifepass.is/attractions/plate/seljalandsfoss.png', imageCredit: null };
  const credited = { imageUrl: 'https://upload.example/falls.jpg', imageCredit: 'Jane Doe' };
  const uncredited = { imageUrl: 'https://upload.example/falls.jpg', imageCredit: null };

  it('draws the plate or a credited photo; an uncredited photo is not drawn at all', () => {
    expect(planSightImageUrl(plate)).toBe(plate.imageUrl);
    expect(planSightImageUrl(credited)).toBe(credited.imageUrl);
    expect(planSightImageUrl(uncredited)).toBeNull();
    expect(planSightImageUrl({ imageUrl: null, imageCredit: 'Jane Doe' })).toBeNull();
  });

  it('credits only a photograph on screen', () => {
    expect(planSightCreditLine(credited, false, en)).toBe(`${en('attraction.photo')}: Jane Doe`);
    expect(planSightCreditLine(credited, false, is)).toBe(`${is('attraction.photo')}: Jane Doe`);
    // The plate is ours, a failed photo is not there, an uncredited one is not drawn.
    expect(planSightCreditLine({ ...plate, imageCredit: 'Someone' }, false, en)).toBeNull();
    expect(planSightCreditLine(credited, true, en)).toBeNull();
    expect(planSightCreditLine(uncredited, false, en)).toBeNull();
  });
});

describe('the sight card’s travel line', () => {
  const road = { roadAccess: 'road' as const, driveFromReykjavik: { minutes: 95, km: 125 } };

  it('the step’s own distance first, with its own icon: a car only for a drive', () => {
    expect(planSightTravelLine(road, '12 min drive', 'drive', en)).toEqual({ text: '12 min drive', icon: 'car' });
    expect(planSightTravelLine(road, 'about 4 km away', 'straight_line', en)).toEqual({ text: 'about 4 km away', icon: 'pin' });
    expect(distanceIcon('straight_line')).toBe('pin');
    expect(distanceIcon(null)).toBe('pin');
  });

  it('then a ferry sight’s sentence', () => {
    expect(planSightTravelLine({ roadAccess: 'ferry', driveFromReykjavik: { minutes: 150, km: 140 } }, null, null, en)).toEqual({
      text: en('attraction.ferry_no_port'),
      icon: 'ferry',
    });
  });

  it('then the drive from Reykjavík, only where a road goes', () => {
    expect(planSightTravelLine(road, null, null, en)).toEqual({
      text: en('coach.plan.sight.from_reykjavik', { duration: '1 h 35 min' }),
      icon: 'car',
    });
    expect(planSightTravelLine({ roadAccess: 'road', driveFromReykjavik: { minutes: 45, km: 50 } }, null, null, is)?.text).toBe(
      is('coach.plan.sight.from_reykjavik', { duration: `45 ${is('attraction.minutes_short')}` }),
    );
    // An unknown access, or a road without a drive: no line at all.
    expect(planSightTravelLine({ roadAccess: null, driveFromReykjavik: { minutes: 95, km: 125 } }, null, null, en)).toBeNull();
    expect(planSightTravelLine({ roadAccess: 'road', driveFromReykjavik: null }, null, null, en)).toBeNull();
  });
});
