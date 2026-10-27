/**
 * The day plan's lossy decoder (iOS `CoachResponse`, `CoachPlan`,
 * `CoachPlanStep` and their cards, Models/CoachPlan.swift): a malformed step
 * costs only that step, an all-bad plan becomes no plan but keeps the reply,
 * an offshore sight is dropped, chips dedupe and cap at 3, a hole in the
 * chips never shifts the refinements, and a straight line is never printed
 * as a drive. Also the `/coach` contract for both bodies.
 */
import { expectRequestBodyValid } from '@test/contract';
import { api, Reply } from '@test/server';

import { stubApiClientPerTest } from '../../../../api/testing';
import { translate, type Lang, type Params } from '../../../../i18n';
import { coachPlanBody, postCoachPlan } from '../api';
import {
  decodeClassBooking,
  decodeCoachPlan,
  decodeCoachPlanResponse,
  decodePlanClass,
  decodePlanDistance,
  decodePlanStep,
  planChangeForChip,
  planDistanceLabel,
  planVenueSlugs,
} from '../decode';
import { makeIntake } from '../model';

stubApiClientPerTest();

const ACTIVITY = '6f1c2b3a-4d5e-4f60-8a7b-9c0d1e2f3a4b';

const venueStep = (slot: string, slug = 'sky-lagoon', extra: Record<string, unknown> = {}) => ({
  slot,
  kind: 'venue',
  note: ' Warm up first. ',
  venue: { slug, name: 'Sky Lagoon', city: 'Kópavogur', imageUrl: 'https://cdn.example/sky.jpg', category: 'Lagoon', priceLabel: 'Included' },
  ...extra,
});

const classStep = (slot: string, extra: Record<string, unknown> = {}) => ({
  slot,
  kind: 'class',
  note: 'An hour of flow.',
  class: {
    id: 'cls_1',
    title: 'Yoga Flow',
    startsAt: '2026-10-22T18:00:00Z',
    endsAt: '2026-10-22T19:00:00.000Z',
    venueSlug: 'hress',
    venueName: 'Hress',
    booking: { kind: 'class', activityId: ACTIVITY, eventId: 4242 },
  },
  ...extra,
});

const sightStep = (slot: string, sight: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) => ({
  slot,
  kind: 'sight',
  note: 'A short walk to the falls.',
  sight: {
    slug: 'seljalandsfoss',
    name: 'Seljalandsfoss',
    kind: 'waterfall',
    region: 'south',
    imageUrl: 'https://www.lifepass.is/attractions/plate/seljalandsfoss.png',
    imageCredit: null,
    driveFromReykjavik: { minutes: 95, km: 125 },
    roadAccess: 'road',
    ...sight,
  },
  ...extra,
});

const plan = (overrides: Record<string, unknown> = {}) => ({
  id: 'plan_abc',
  intro: ' A calm evening. ',
  steps: [sightStep('after'), venueStep('main'), classStep('before')],
  chips: ['Somewhere closer', 'Take it easier', 'Later'],
  refinements: [
    { change: 'closer', label: 'Somewhere closer' },
    { change: 'easier', label: 'Take it easier' },
    { change: 'later', label: 'Later' },
  ],
  ...overrides,
});

const en = (key: string, params?: Params) => translate(key, 'en', params);
const is = (key: string, params?: Params) => translate(key, 'is', params);

describe('the plan', () => {
  it('reads every field, trims the intro and notes, and orders the steps before, main, after', () => {
    const decoded = decodeCoachPlan(plan());
    expect(decoded.id).toBe('plan_abc');
    expect(decoded.intro).toBe('A calm evening.');
    expect(decoded.steps.map((step) => `${step.slot}:${step.kind}`)).toEqual(['before:class', 'main:venue', 'after:sight']);
    expect(decoded.steps[1]).toMatchObject({ id: 'main-venue-sky-lagoon', note: 'Warm up first.' });
    expect(decoded.steps[0]!.id).toBe('before-class-cls_1');
    expect(decoded.steps[2]!.id).toBe('after-sight-seljalandsfoss');
  });

  it('keeps the wire order within one slot', () => {
    const decoded = decodeCoachPlan(plan({ steps: [venueStep('main', 'b'), venueStep('main', 'a'), venueStep('before', 'c')] }));
    expect(decoded.steps.map((step) => step.id)).toEqual(['before-venue-c', 'main-venue-b', 'main-venue-a']);
  });

  it('a malformed step costs only that step', () => {
    const decoded = decodeCoachPlan(
      plan({
        steps: [
          venueStep('main'),
          null,
          'garbage',
          { slot: 'during', kind: 'venue', venue: venueStep('main').venue },
          { slot: 'after', kind: 'spa', venue: venueStep('main').venue },
          { slot: 'after', kind: 'venue' },
          { slot: 'after', kind: 'venue', venue: { slug: '  ', name: 'Blank' } },
          { slot: 'after', kind: 'class', class: { ...classStep('after').class, startsAt: 'yesterday' } },
          { slot: 'after', kind: 'sight', sight: { slug: 'x', name: 'X' } },
          sightStep('after', { slug: 'eldey', roadAccess: 'offshore' }),
          sightStep('after'),
        ],
      }),
    );
    expect(decoded.steps.map((step) => step.id)).toEqual(['main-venue-sky-lagoon', 'after-sight-seljalandsfoss']);
  });

  it('the card that matches the kind is the one read', () => {
    // A venue step that also carries a sight is a venue step.
    const step = decodePlanStep({ ...venueStep('main'), sight: sightStep('main').sight });
    expect(step.kind).toBe('venue');
    // A class step with only a venue card has no card to draw.
    expect(() => decodePlanStep({ slot: 'main', kind: 'class', venue: venueStep('main').venue })).toThrow();
  });

  it('an offshore sight is never proposed; a ferry or unknown access stays (no travel line for the unknown)', () => {
    expect(() => decodePlanStep(sightStep('main', { roadAccess: 'offshore' }))).toThrow();
    const ferry = decodePlanStep(sightStep('main', { roadAccess: 'ferry' }));
    expect(ferry.kind === 'sight' && ferry.sight.roadAccess).toBe('ferry');
    const unknown = decodePlanStep(sightStep('main', { roadAccess: 'tunnel' }));
    expect(unknown.kind === 'sight' && unknown.sight.roadAccess).toBeNull();
  });

  it('a sight’s drive is read leniently (a bad one is none), its region defaults to ""', () => {
    const step = decodePlanStep(sightStep('main', { driveFromReykjavik: { minutes: 'far' }, region: undefined }));
    expect(step.kind === 'sight' && step.sight.driveFromReykjavik).toBeNull();
    expect(step.kind === 'sight' && step.sight.region).toBe('');
  });

  it('a plan without an id is no plan; a missing intro is ""', () => {
    expect(() => decodeCoachPlan(plan({ id: undefined }))).toThrow();
    expect(() => decodeCoachPlan(plan({ id: 7 }))).toThrow();
    expect(decodeCoachPlan(plan({ intro: null })).intro).toBe('');
  });

  it('steps that are not a list are no steps', () => {
    expect(decodeCoachPlan(plan({ steps: { 0: venueStep('main') } })).steps).toEqual([]);
  });
});

describe('the class card', () => {
  it('reads the booking handle', () => {
    const session = decodePlanClass(classStep('main').class);
    expect(session).toEqual({
      id: 'cls_1',
      title: 'Yoga Flow',
      startsAt: new Date('2026-10-22T18:00:00Z'),
      endsAt: new Date('2026-10-22T19:00:00Z'),
      venueSlug: 'hress',
      venueName: 'Hress',
      room: null,
      booking: { kind: 'class', activityId: ACTIVITY, eventId: 4242 },
    });
  });

  it('reads the class room exactly as sent; absent (a cached answer from before 0.44.0), null or blank is none', () => {
    expect(decodePlanClass({ ...classStep('main').class, room: 'Salur 3' }).room).toBe('Salur 3');
    expect(decodePlanClass({ ...classStep('main').class, room: 'Salur 1 - 1. hæð' }).room).toBe('Salur 1 - 1. hæð');
    expect(decodePlanClass({ ...classStep('main').class, room: null }).room).toBeNull();
    expect(decodePlanClass({ ...classStep('main').class, room: '  ' }).room).toBeNull();
    // A malformed room never costs the class: it is just no room.
    expect(decodePlanClass({ ...classStep('main').class, room: 3 }).room).toBeNull();
  });

  it('a numeric id is read as text; no id, no start or no venue drops the class', () => {
    expect(decodePlanClass({ ...classStep('main').class, id: 31 }).id).toBe('31');
    expect(() => decodePlanClass({ ...classStep('main').class, id: '' })).toThrow();
    expect(() => decodePlanClass({ ...classStep('main').class, id: 3.5 })).toThrow();
    expect(() => decodePlanClass({ ...classStep('main').class, startsAt: null })).toThrow();
    expect(() => decodePlanClass({ ...classStep('main').class, venueSlug: ' ' })).toThrow();
    expect(() => decodePlanClass({ ...classStep('main').class, venueName: undefined })).toThrow();
  });

  it('an untitled class keeps no title; an end not after the start is none', () => {
    const session = decodePlanClass({ ...classStep('main').class, title: '  ', endsAt: '2026-10-22T18:00:00Z' });
    expect(session.title).toBeNull();
    expect(session.endsAt).toBeNull();
  });

  it('a handle of a kind this build does not know, an Abler class without its event, or a bad activity id is no handle', () => {
    expect(decodeClassBooking({ kind: 'waitlist', activityId: ACTIVITY })).toBeNull();
    expect(decodeClassBooking({ kind: 'class', activityId: ACTIVITY })).toBeNull();
    expect(decodeClassBooking({ kind: 'class', activityId: 'not-a-uuid', eventId: 1 })).toBeNull();
    expect(decodeClassBooking({ kind: 'slot', activityId: ACTIVITY })).toEqual({ kind: 'slot', activityId: ACTIVITY, eventId: null });
    expect(decodeClassBooking(null)).toBeNull();
    // The class itself still decodes, looked up in the feed instead.
    expect(decodePlanClass({ ...classStep('main').class, booking: { kind: 'class', activityId: ACTIVITY } }).booking).toBeNull();
  });
});

describe('chips and refinements', () => {
  it('pairs each chip with the change at its index', () => {
    const decoded = decodeCoachPlan(plan());
    expect(decoded.chips).toEqual(['Somewhere closer', 'Take it easier', 'Later']);
    expect(planChangeForChip(decoded, 'Somewhere closer')).toBe('closer');
    expect(planChangeForChip(decoded, 'Take it easier')).toBe('easier');
    expect(planChangeForChip(decoded, 'Later')).toBe('later');
  });

  it('dedupes, drops blanks and caps at 3', () => {
    const decoded = decodeCoachPlan(plan({ chips: [' Closer ', 'Closer', '', '  ', 'Easier', 'Harder', 'Later'], refinements: [] }));
    expect(decoded.chips).toEqual(['Closer', 'Easier', 'Harder']);
  });

  it('a hole in the chips does not shift the refinements onto the wrong label', () => {
    const decoded = decodeCoachPlan(
      plan({
        chips: [42, 'Push it', 'Go later'],
        refinements: [
          { change: 'closer', label: 'Somewhere closer' },
          { change: 'harder', label: 'Push it' },
          { change: 'later' },
        ],
      }),
    );
    expect(decoded.chips).toEqual(['Push it', 'Go later']);
    expect(decoded.chipChanges).toEqual({ 'Push it': 'harder', 'Go later': 'later' });
  });

  it('a hole in the refinements leaves its chip to its wording', () => {
    const decoded = decodeCoachPlan(
      plan({ chips: ['Nær mér', 'Something new'], refinements: ['bad', { change: 'easier', label: 'Something new' }] }),
    );
    expect(decoded.chipChanges).toEqual({ 'Something new': 'easier' });
    expect(planChangeForChip(decoded, 'Nær mér')).toBe('closer');
  });

  it('a label that disagrees with its chip drops the pairing; an unknown change leaves the wording', () => {
    const decoded = decodeCoachPlan(
      plan({
        chips: ['Somewhere closer', 'Take it easier'],
        refinements: [
          { change: 'harder', label: 'Push harder' },
          { change: 'teleport', label: 'Take it easier' },
        ],
      }),
    );
    expect(decoded.chipChanges).toEqual({});
    expect(planChangeForChip(decoded, 'Somewhere closer')).toBe('closer');
    expect(planChangeForChip(decoded, 'Take it easier')).toBe('easier');
  });

  it('a change is read in any case', () => {
    const decoded = decodeCoachPlan(plan({ chips: ['Go'], refinements: [{ change: ' CLOSER ', label: 'Go' }] }));
    expect(planChangeForChip(decoded, 'Go')).toBe('closer');
  });
});

describe('the response', () => {
  it('a plan, the reply and the count', () => {
    const response = decodeCoachPlanResponse({
      reply: 'A calm evening.',
      plan: plan(),
      freeMessages: { limit: 3, remaining: 1, windowDays: 30, resetsAt: null },
    });
    expect(response.reply).toBe('A calm evening.');
    expect(response.plan?.id).toBe('plan_abc');
    expect(response.freeMessages).toEqual({ limit: 3, remaining: 1, windowDays: 30, resetsAt: undefined });
  });

  it('an all-bad plan becomes no plan, and the reply is kept', () => {
    const response = decodeCoachPlanResponse({ reply: 'Here is something.', plan: plan({ steps: [null, { slot: 'x' }] }) });
    expect(response.plan).toBeNull();
    expect(response.reply).toBe('Here is something.');
  });

  it('an old server’s reply alone, a garbled plan, a garbled count: the reply always survives', () => {
    expect(decodeCoachPlanResponse({ reply: 'Hi.' })).toEqual({ reply: 'Hi.', plan: null, freeMessages: null });
    expect(decodeCoachPlanResponse({ reply: 'Hi.', plan: 'nope', freeMessages: [1] })).toEqual({
      reply: 'Hi.',
      plan: null,
      freeMessages: null,
    });
    expect(decodeCoachPlanResponse({ plan: plan() }).reply).toBe('');
    expect(decodeCoachPlanResponse(null)).toEqual({ reply: '', plan: null, freeMessages: null });
  });

  it('the venue slugs to load, once each, in order', () => {
    const decoded = decodeCoachPlan(plan({ steps: [venueStep('after', 'b'), venueStep('before', 'a'), venueStep('main', 'a'), classStep('main')] }));
    expect(planVenueSlugs(decoded)).toEqual(['a', 'b']);
  });
});

describe('the distance line', () => {
  const label = (raw: unknown, language: Lang = 'en') => {
    const distance = decodePlanDistance(raw);
    return distance ? planDistanceLabel(distance, language, language === 'is' ? is : en) : null;
  };

  it('a measured drive is minutes of driving', () => {
    expect(label({ basis: 'drive', minutes: 12 })).toBe(en('coach.plan.distance.drive', { minutes: '12' }));
    expect(label({ basis: 'drive', minutes: 11.5 })).toBe(en('coach.plan.distance.drive', { minutes: '12' }));
    expect(label({ basis: 'drive', minutes: 12 }, 'is')).toBe(is('coach.plan.distance.drive', { minutes: '12' }));
  });

  it('a straight line is "about N km away", never a drive time, even with minutes on it', () => {
    const text = label({ basis: 'straight_line', km: 12.34, minutes: 15 });
    expect(text).toBe(en('coach.plan.distance.straight', { km: '12' }));
    expect(text).not.toContain(en('coach.plan.distance.drive', { minutes: '15' }));
    expect(label({ basis: 'straight_line', km: 3.26 })).toBe(en('coach.plan.distance.straight', { km: '3.3' }));
    expect(label({ basis: 'straight_line', km: 3.26 }, 'is')).toBe(is('coach.plan.distance.straight', { km: '3,3' }));
    // Never "about 0 km": at least 100 m.
    expect(label({ basis: 'straight_line', km: 0 })).toBe(en('coach.plan.distance.straight', { km: '0.1' }));
  });

  it('minutes under 1 or not finite, or a drive without minutes, print no line', () => {
    expect(label({ basis: 'drive', minutes: 0.4 })).toBeNull();
    expect(label({ basis: 'drive', minutes: 0 })).toBeNull();
    expect(label({ basis: 'drive', minutes: -5 })).toBeNull();
    expect(label({ basis: 'drive', minutes: Number.POSITIVE_INFINITY })).toBeNull();
    expect(label({ basis: 'drive', minutes: '12' })).toBeNull();
    expect(label({ basis: 'drive' })).toBeNull();
    expect(label({ basis: 'drive', km: 10 })).toBeNull();
  });

  it('a straight line without a usable km prints none', () => {
    expect(label({ basis: 'straight_line' })).toBeNull();
    expect(label({ basis: 'straight_line', km: -1 })).toBeNull();
    expect(label({ basis: 'straight_line', km: Number.NaN })).toBeNull();
    expect(label({ basis: 'straight_line', km: 1e300 })).toBeNull();
  });

  it('an unknown basis is no distance (the step stays)', () => {
    expect(decodePlanDistance({ basis: 'walk', minutes: 5 })).toBeNull();
    const step = decodePlanStep({ ...venueStep('main'), distance: { basis: 'teleport' } });
    expect(step.distance).toBeNull();
    expect(step.kind).toBe('venue');
  });
});

describe('POST /coach', () => {
  const intake = makeIntake({
    goal: 'class',
    area: { kind: 'near', latitude: 64.15, longitude: -21.94 },
    when: 'tomorrow',
    timeOfDay: 'evening',
    duration: 'short',
    intensity: null,
    classType: 'yoga',
  });

  it('a first plan sends the locale and the intake, and matches the contract', async () => {
    api.on('POST', '/coach', Reply.ok({ reply: 'A calm evening.', plan: plan() }));
    const response = await postCoachPlan('is', { intake });
    expect(response.plan?.steps).toHaveLength(3);
    const sent = api.sent('/coach', 'POST');
    expectRequestBodyValid('POST', '/coach', sent.body);
    expect(sent.body).toEqual({
      locale: 'is',
      intake: {
        goal: 'class',
        area: { kind: 'near', latitude: 64.15, longitude: -21.94 },
        when: 'tomorrow',
        timeOfDay: 'evening',
        duration: 'short',
        classType: 'yoga',
      },
    });
    expect(sent.headers['idempotency-key']).toBeUndefined();
  });

  it('a refinement sends the plan id and the change, and NO intake (and never a note)', async () => {
    api.on('POST', '/coach', Reply.ok({ reply: 'Closer.', plan: plan({ id: 'plan_def' }) }));
    await postCoachPlan('en', { refine: { planId: 'plan_abc', change: 'closer' } });
    const sent = api.sent('/coach', 'POST');
    expectRequestBodyValid('POST', '/coach', sent.body);
    expect(sent.body).toEqual({ locale: 'en', refine: { planId: 'plan_abc', change: 'closer' } });
    expect(Object.keys(sent.body as object)).not.toContain('intake');
    expect(Object.keys(sent.body as object)).not.toContain('note');
  });

  it('every region body matches the contract', () => {
    for (const region of ['capital', 'reykjanes', 'south', 'west', 'westfjords', 'north', 'east', 'highlands']) {
      expectRequestBodyValid(
        'POST',
        '/coach',
        coachPlanBody('en', { intake: { ...intake, area: { kind: 'region', region } } }),
      );
    }
  });
});
