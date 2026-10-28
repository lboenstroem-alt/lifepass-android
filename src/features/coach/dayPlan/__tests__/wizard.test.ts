/**
 * The day-plan wizard through COACH-1's store (iOS `CoachViewModel`'s plan
 * wizard): how it starts (the chip, typed words, "Plan something else"),
 * the derived questions, the last-open-question rule, typed words (dropped
 * with a hint once, except the class type, cut to 40 units), "Near me" (a
 * fix warmed on the tap, 4 s at submit, the capital without one), the ONE
 * intake call and every answer to it (a plan, no plan, a reply, 429, 503,
 * any other error, a lock before the call), the free fallback's category
 * and location, the venue rows loaded after the plan, refinements (no
 * intake, the lock sentence, the error sentence), and a New chat dropping
 * a late answer.
 *
 * Ports CoachPersistenceTests `testTypingDuringTheDayPlanWizardKeepsNothingTheMemberWrote`
 * and its request-body half ("a request body built after typing carries no
 * typed words").
 *
 * The programme wizard and Adjust my plan are held to the stub that takes
 * nothing, so this file tests the day plan whatever COACH-4 and COACH-5 add.
 */
import { api, Reply, type StubRequest } from '@test/server';

import { stubApiClientPerTest } from '../../../../api/testing';
import { decodeVenue, venueToApi } from '../../../../api/venues';
import { lookup, setCurrentLanguage, translate, type Params } from '../../../../i18n';
import { locationStore } from '../../../../stores/locationStore';
import { buildSession } from '../../persistence/sessions';
import { modelMessages } from '../../chat/modelMessages';
import { PARKED_SEND, resetCoachStoreForTests, useCoachStore } from '../../store/coachStore';
import { lastOpenQuestion, type CoachMessage } from '../../store/messages';
import { venueWizardFlow, venueWizardStateForTests } from '../../flows/venueWizard';
import {
  bookPlanClass,
  dayPlanStateForTests,
  openPlanSight,
  openPlanVenue,
  PLAN_MESSAGE_KIND,
  planPayloadOf,
  refineDayPlan,
  resetDayPlan,
  restartDayPlan,
  startDayPlanFromChip,
} from '../wizard';

jest.mock('../../flows/program', () => ({ programFlow: jest.requireActual('../../flows/types').inactiveFlow('program') }));
jest.mock('../../flows/adjust', () => ({ adjustFlow: jest.requireActual('../../flows/types').inactiveFlow('adjust') }));
// The class sheet is CLASS-2's (tested there); here only what the Book button hands it.
const mockBookCoachClass = jest.fn(async (_session: unknown, _options: unknown) => 'sheet' as const);
jest.mock('../../../classes/sheet', () => ({
  bookCoachClass: (session: unknown, options: unknown) => mockBookCoachClass(session, options),
}));

stubApiClientPerTest();

const coach = () => useCoachStore.getState();
const messages = () => coach().messages;
const texts = () => messages().map((message) => message.text);
const en = (key: string, params?: Params) => translate(key, 'en', params);

// ---------------------------------------------------------------------------
// Fixtures

const ACTIVITY = '6f1c2b3a-4d5e-4f60-8a7b-9c0d1e2f3a4b';

const PLAN = {
  id: 'plan_abc',
  intro: 'A calm evening by the water.',
  steps: [
    {
      slot: 'main',
      kind: 'venue',
      note: 'Soak for an hour.',
      venue: { slug: 'sky-lagoon', name: 'Sky Lagoon', city: 'Kópavogur', imageUrl: null, category: 'Lagoon', priceLabel: 'Included' },
      distance: { basis: 'straight_line', km: 4.2 },
    },
    {
      slot: 'before',
      kind: 'class',
      note: 'Loosen up first.',
      class: {
        id: 'cls_1',
        title: 'Yoga Flow',
        startsAt: '2026-10-22T17:00:00Z',
        endsAt: '2026-10-22T18:00:00Z',
        venueSlug: 'hress',
        venueName: 'Hress',
        booking: { kind: 'class', activityId: ACTIVITY, eventId: 4242 },
      },
    },
  ],
  chips: ['closer', 'Take it easier'],
  refinements: [{ change: 'closer', label: 'closer' }, { change: 'easier', label: 'Take it easier' }],
};

const SKY_LAGOON = decodeVenue({
  id: '00000000-0000-4000-8000-000000000012',
  slug: 'sky-lagoon',
  name: 'Sky Lagoon',
  city: 'Kópavogur',
  categories: ['Lagoon', 'Spa'],
  coordinates: { latitude: 64.1166, longitude: -21.9447 },
});
const LAUGARDALSLAUG = decodeVenue({
  id: '00000000-0000-4000-8000-000000000013',
  slug: 'laugardalslaug',
  name: 'Laugardalslaug',
  city: 'Reykjavík',
  categories: ['Pool'],
  coordinates: { latitude: 64.1468, longitude: -21.8796 },
});
const PILATES_STUDIO = decodeVenue({
  id: '00000000-0000-4000-8000-000000000014',
  slug: 'pilates-studio',
  name: 'Pilates Studio',
  city: 'Reykjavík',
  categories: ['Pilates', 'Yoga'],
  coordinates: { latitude: 64.14, longitude: -21.9 },
});
const AKUREYRI_SPA = decodeVenue({
  id: '00000000-0000-4000-8000-000000000015',
  slug: 'forest-lagoon',
  name: 'Forest Lagoon',
  city: 'Akureyri',
  categories: ['Spa'],
  coordinates: { latitude: 65.6835, longitude: -18.0878 },
});
const CATALOGUE = [SKY_LAGOON, LAUGARDALSLAUG, PILATES_STUDIO, AKUREYRI_SPA];

function serveVenues() {
  api.on('GET', '/venues', (request: StubRequest) => {
    const category = request.query.category?.toLowerCase();
    const rows = CATALOGUE.filter((row) => !category || (row.categories ?? []).some((c) => c.toLowerCase() === category));
    return Reply.ok({ data: rows.map(venueToApi), pagination: { nextCursor: null, hasMore: false, limit: 100 } });
  });
  api.on('GET', '/venues/by-slug/:slug', (request: StubRequest) => {
    const row = CATALOGUE.find((venue) => venue.slug === request.params.slug);
    return row ? Reply.ok(venueToApi(row)) : Reply.problem(404, 'not_found');
  });
}

// ---------------------------------------------------------------------------
// Location

const requestLocation = jest.fn(async () => undefined);
const initialLocation = locationStore.getState();

function setLocation(state: 'granted' | 'denied' | 'none') {
  locationStore.setState({
    permission: state === 'granted' ? 'granted' : state === 'denied' ? 'denied' : 'undetermined',
    permissionKnown: state !== 'none',
    currentLocation: state === 'granted' ? { latitude: 64.14657, longitude: -21.94263, accuracy: 20, timestamp: Date.now() } : null,
    requestLocation,
  });
}

// ---------------------------------------------------------------------------
// Helpers

async function settle() {
  for (let turn = 0; turn < 12; turn += 1) await new Promise((resolve) => setTimeout(resolve, 0));
}

function openQuestion(): CoachMessage {
  const question = lastOpenQuestion(messages());
  if (!question) throw new Error('no open question');
  return question;
}

async function tap(value: string) {
  const question = openQuestion();
  const option = question.options!.find((candidate) => candidate.value === value);
  if (!option) throw new Error(`no chip ${value} on "${question.text}"`);
  await coach().selectOption(question.id, option.value, option.label);
  await settle();
}

/**
 * Answers whatever the wizard asks from `answers`, until it stops asking or
 * asks something `answers` has no answer for (that question stays open).
 */
async function answerAll(answers: Record<string, string>) {
  const keys: Record<string, string> = {
    'coach.plan.q.goal': 'goal',
    'coach.plan.q.area': 'area',
    'coach.plan.q.when': 'when',
    'coach.plan.q.time': 'timeOfDay',
    'coach.plan.q.duration': 'duration',
    'coach.plan.q.intensity': 'intensity',
    'coach.plan.q.class_type': 'classType',
  };
  const byQuestion: Record<string, string> = {};
  for (const [key, question] of Object.entries(keys)) {
    byQuestion[lookup(key, 'en')] = question;
    byQuestion[lookup(key, 'is')] = question;
  }
  for (let guard = 0; guard < 10 && lastOpenQuestion(messages())?.flow === 'dayPlan'; guard += 1) {
    const question = byQuestion[openQuestion().text];
    if (!question) throw new Error(`unknown question "${openQuestion().text}"`);
    const value = answers[question];
    if (value === undefined) return;
    await tap(value);
  }
}

const planMessages = () => messages().filter((message) => message.kind === PLAN_MESSAGE_KIND);
const coachBodies = () => api.sentAll('/coach', 'POST').map((request) => request.body as Record<string, unknown>);

function fresh() {
  resetCoachStoreForTests();
  resetDayPlan();
  venueWizardFlow.reset();
}

beforeEach(() => {
  fresh();
  setCurrentLanguage('en');
  requestLocation.mockClear();
  mockBookCoachClass.mockClear();
  setLocation('none');
  serveVenues();
});

afterEach(() => {
  locationStore.setState(initialLocation, true);
  setCurrentLanguage('en');
});

// ---------------------------------------------------------------------------

describe('starting', () => {
  it('"Plan my day" posts the chip’s label and asks the goal, with the goals as chips', async () => {
    await coach().startPlan('coach.chip.plan_day');
    const [, user, question] = messages();
    expect(user).toMatchObject({ role: 'user', text: en('coach.chip.plan_day') });
    expect(question).toMatchObject({ role: 'assistant', text: en('coach.plan.q.goal'), flow: 'dayPlan' });
    expect(question!.options!.map((option) => [option.value, option.label])).toEqual([
      ['workout', en('coach.plan.goal.workout')],
      ['class', en('coach.plan.goal.class')],
      ['relax', en('coach.plan.goal.relax')],
      ['outdoors', en('coach.plan.goal.outdoors')],
      ['mix', en('coach.plan.goal.mix')],
    ]);
    // Nothing is asked for location until "Near me" is tapped.
    expect(requestLocation).not.toHaveBeenCalled();
  });

  it('an Icelandic member reads Icelandic, regions in the sight card’s words', async () => {
    setCurrentLanguage('is');
    await coach().startPlan('coach.chip.plan_day');
    expect(openQuestion().text).toBe(lookup('coach.plan.q.goal', 'is'));
    await tap('relax');
    const area = openQuestion();
    expect(area.text).toBe(lookup('coach.plan.q.area', 'is'));
    expect(area.options!.map((option) => option.label)).toEqual([
      lookup('coach.plan.area.near', 'is'),
      ...['capital', 'reykjanes', 'south', 'west', 'westfjords', 'north', 'east', 'highlands'].map((region) =>
        lookup(`attraction.region.${region}`, 'is'),
      ),
    ]);
    expect(messages().at(-2)).toMatchObject({ role: 'user', text: lookup('coach.plan.goal.relax', 'is') });
  });

  it('typed words that ask for a day start it with what they already say', async () => {
    await coach().send('a hike');
    expect(messages()[1]).toMatchObject({ role: 'user', text: 'a hike' });
    expect(openQuestion().text).toBe(en('coach.plan.q.area'));
    expect(dayPlanStateForTests()?.answers.goal).toBe('outdoors');
    expect(api.sentAll('/coach')).toHaveLength(0);
  });

  it('a prompt the app parked never starts it', async () => {
    await coach().send('Plan my day', PARKED_SEND);
    expect(dayPlanStateForTests()).toBeNull();
  });

  it('the chip abandons the venue wizard’s open question first', async () => {
    coach().startSearch('gyms', 'coach.cat.gyms');
    const venueQuestion = openQuestion();
    await coach().startPlan('coach.chip.plan_day');
    expect(venueWizardStateForTests()).toBeNull();
    expect(messages().find((message) => message.id === venueQuestion.id)?.answered).toBe(true);
    expect(openQuestion()).toMatchObject({ flow: 'dayPlan', text: en('coach.plan.q.goal') });
  });

  it('typed words answer the venue wizard’s open question before they can start a day plan (iOS send order)', async () => {
    coach().startSearch('gyms', 'coach.cat.gyms');
    await coach().send('plan my day');
    expect(venueWizardStateForTests()?.answers).toEqual(['plan my day']);
    expect(dayPlanStateForTests()).toBeNull();
  });

  it('a typed day request abandons whatever else was open, and its own question stays open', async () => {
    await coach().startPlan('coach.chip.plan_day');
    await tap('workout');
    // An open day-plan question drops typed words; once it is answered and
    // closed by something else, typed words start a new wizard.
    coach().abandonOpenQuestions();
    await coach().send('what should I do today');
    expect(openQuestion()).toMatchObject({ flow: 'dayPlan', text: en('coach.plan.q.goal') });
    expect(dayPlanStateForTests()?.answers.when).toBe('today');
  });

  it('"Plan something else" starts afresh under its own label, and never over a reply in flight', async () => {
    restartDayPlan();
    expect(messages().at(-2)).toMatchObject({ role: 'user', text: en('coach.plan.new') });
    expect(openQuestion().text).toBe(en('coach.plan.q.goal'));

    const busy = coach().busy();
    const before = messages().length;
    startDayPlanFromChip('coach.chip.plan_day');
    expect(messages()).toHaveLength(before);
    busy.end();
  });

  it('a quick second tap on "Plan something else" starts nothing more while the fresh goal question is open', async () => {
    restartDayPlan();
    restartDayPlan();
    expect(messages().filter((message) => message.role === 'user')).toHaveLength(1);
    const goals = messages().filter((message) => message.flow === 'dayPlan' && message.text === en('coach.plan.q.goal'));
    expect(goals).toHaveLength(1);
    expect(openQuestion().id).toBe(goals[0]!.id);

    // Once the wizard has an answer, the chip starts afresh again.
    await tap('relax');
    restartDayPlan();
    expect(messages().at(-2)).toMatchObject({ role: 'user', text: en('coach.plan.new') });
    expect(openQuestion().text).toBe(en('coach.plan.q.goal'));
    expect(dayPlanStateForTests()?.answers.goal).toBeNull();
  });
});

describe('the questions', () => {
  it('only the last open question answers; a value from another question changes nothing', async () => {
    await coach().startPlan('coach.chip.plan_day');
    const goal = openQuestion();
    await tap('class');
    // The goal bubble is closed with its label.
    expect(messages().find((message) => message.id === goal.id)).toMatchObject({ answered: true, selectedAnswer: en('coach.plan.goal.class') });
    const area = openQuestion();
    const count = messages().length;
    await coach().selectOption(goal.id, 'relax', 'Relax');
    await coach().selectOption(area.id, 'yesterday', 'Yesterday');
    expect(messages()).toHaveLength(count);
    expect(dayPlanStateForTests()?.answers.goal).toBe('class');
  });

  it('the class type offers the Classes tab’s types, Surprise me and a capped Other', async () => {
    api.on('POST', '/coach', Reply.ok({ reply: '' }));
    await coach().startPlan('coach.chip.plan_day');
    await answerAll({ goal: 'class', area: 'capital', when: 'now', duration: 'short' });
    const question = openQuestion();
    expect(question.text).toBe(en('coach.plan.q.class_type'));
    expect(question.options!.map((option) => option.label)).toEqual([
      ...['yoga', 'pilates', 'hiit', 'strength', 'boxing', 'cycling', 'swimming', 'dance'].map((type) => en(`classes.cat_${type}`)),
      en('coach.plan.class_type.any'),
      en('coach.other.label'),
    ]);
    expect(question.options!.at(-1)).toMatchObject({ isOther: true, maxLength: 40 });
  });

  it('"now" skips the time of day; relax asks neither intensity nor class type', async () => {
    api.on('POST', '/coach', Reply.ok({ reply: 'Try the lagoon.' }));
    await coach().startPlan('coach.chip.plan_day');
    const asked: string[] = [];
    const answers: Record<string, string> = {
      [en('coach.plan.q.goal')]: 'relax',
      [en('coach.plan.q.area')]: 'south',
      [en('coach.plan.q.when')]: 'now',
      [en('coach.plan.q.duration')]: 'short',
    };
    while (lastOpenQuestion(messages())?.flow === 'dayPlan') {
      asked.push(openQuestion().text);
      await tap(answers[openQuestion().text]!);
    }
    expect(asked).toEqual([en('coach.plan.q.goal'), en('coach.plan.q.area'), en('coach.plan.q.when'), en('coach.plan.q.duration')]);
  });
});

describe('typing during the wizard (P1)', () => {
  it('keeps nothing the member wrote: dropped, said once, the question asked again (CoachPersistenceTests)', async () => {
    api.on('POST', '/coach', Reply.ok({ reply: '', plan: PLAN }));
    await coach().startPlan('coach.chip.plan_day');
    const first = openQuestion();

    await coach().send('my knee hurts and I only have 30 minutes');
    const everything = texts().join(' ');
    expect(everything).not.toContain('knee hurts');
    expect(everything).not.toContain('30 minutes');
    expect(texts().filter((text) => text === en('coach.plan.typed_hint'))).toHaveLength(1);
    // The same question again, under the hint, and the old bubble closed.
    expect(messages().find((message) => message.id === first.id)?.answered).toBe(true);
    expect(openQuestion().text).toBe(en('coach.plan.q.goal'));
    expect(openQuestion().id).not.toBe(first.id);

    // Said once per wizard, not once per message.
    await coach().send('also my back');
    expect(texts().filter((text) => text === en('coach.plan.typed_hint'))).toHaveLength(1);

    // And the request body built afterwards carries none of it.
    await answerAll({ goal: 'relax', area: 'capital', when: 'now', duration: 'short' });
    const body = JSON.stringify(coachBodies());
    expect(coachBodies()).toHaveLength(1);
    expect(body).not.toContain('knee');
    expect(body).not.toContain('30 minutes');
    expect(body).not.toContain('back');
    expect(coachBodies()[0]).not.toHaveProperty('note');
    expect(coachBodies()[0]).not.toHaveProperty('messages');
  });

  it('the class-type question takes typed words as its answer, cut to 40 units', async () => {
    api.on('POST', '/coach', Reply.ok({ reply: 'Aerial it is.' }));
    await coach().startPlan('coach.chip.plan_day');
    await answerAll({ goal: 'class', area: 'capital', when: 'now', duration: 'short' });
    const typed = `Aerial silks ${'x'.repeat(60)}`;
    await coach().send(typed);
    await settle();
    expect(messages().some((message) => message.role === 'user' && message.text === typed)).toBe(true);
    expect((coachBodies()[0]!.intake as Record<string, unknown>).classType).toBe(typed.slice(0, 40));
    expect(texts()).not.toContain(en('coach.plan.typed_hint'));
  });

  it('the "Other" field answers the class type the same way', async () => {
    api.on('POST', '/coach', Reply.ok({ reply: 'Ok.' }));
    await coach().startPlan('coach.chip.plan_day');
    await answerAll({ goal: 'workout', area: 'capital', when: 'now', duration: 'short', intensity: 'hard' });
    const question = openQuestion();
    await coach().selectOption(question.id, 'Kettlebells', 'Kettlebells');
    await settle();
    expect(coachBodies()[0]!.intake).toMatchObject({ goal: 'workout', intensity: 'hard', classType: 'Kettlebells' });
  });
});

describe('the call', () => {
  it('ONE intake call with the answers, the typing dots meanwhile, and the plan drawn on arrival', async () => {
    api.on('POST', '/coach', Reply.delayed(30, Reply.ok({ reply: 'A calm evening by the water.', plan: PLAN })));
    await coach().startPlan('coach.chip.plan_day');
    await answerAll({ goal: 'class', area: 'capital', when: 'today', timeOfDay: 'evening', duration: 'short' });
    const question = openQuestion();
    const done = coach().selectOption(question.id, 'yoga', en('classes.cat_yoga'));
    expect(coach().isTyping).toBe(true);
    await done;
    await settle();
    expect(coach().isTyping).toBe(false);

    expect(coachBodies()).toEqual([
      {
        locale: 'en',
        intake: { goal: 'class', area: { kind: 'region', region: 'capital' }, when: 'today', timeOfDay: 'evening', duration: 'short', classType: 'yoga' },
      },
    ]);
    const [plan] = planMessages();
    expect(plan).toMatchObject({ role: 'assistant', text: PLAN.intro, flow: 'dayPlan', anchorTop: true });
    expect(planPayloadOf(plan)!.plan.steps.map((step) => step.kind)).toEqual(['class', 'venue']);
    expect(dayPlanStateForTests()).toBeNull();
  });

  it('an Icelandic member’s plan is asked for in Icelandic', async () => {
    setCurrentLanguage('is');
    api.on('POST', '/coach', Reply.ok({ reply: 'Hér.', plan: PLAN }));
    await coach().startPlan('coach.chip.plan_day');
    await answerAll({ goal: 'relax', area: 'north', when: 'now', duration: 'full_day' });
    expect(coachBodies()[0]!.locale).toBe('is');
  });

  it('loads the venue steps’ full rows after the plan is on screen', async () => {
    api.on('POST', '/coach', Reply.ok({ reply: '', plan: PLAN }));
    await coach().startPlan('coach.chip.plan_day');
    await answerAll({ goal: 'relax', area: 'capital', when: 'now', duration: 'short' });
    await settle();
    expect(api.sentAll('/venues/by-slug/sky-lagoon', 'GET')).toHaveLength(1);
    expect(planPayloadOf(planMessages()[0])!.venues['sky-lagoon']?.id).toBe(SKY_LAGOON.id);
  });

  it('a venue row that fails to load keeps the plan’s own card', async () => {
    api.on('GET', '/venues/by-slug/:slug', Reply.problem(500, 'internal_error'));
    api.on('POST', '/coach', Reply.ok({ reply: '', plan: PLAN }));
    await coach().startPlan('coach.chip.plan_day');
    await answerAll({ goal: 'relax', area: 'capital', when: 'now', duration: 'short' });
    await settle();
    expect(planPayloadOf(planMessages()[0])!.venues).toEqual({});
  });

  it('the intro falls back to the reply, then to the app’s own sentence', async () => {
    api.once('POST', '/coach', Reply.ok({ reply: ' The reply. ', plan: { ...PLAN, intro: '' } }));
    await coach().startPlan('coach.chip.plan_day');
    await answerAll({ goal: 'relax', area: 'capital', when: 'now', duration: 'short' });
    expect(planMessages().at(-1)!.text).toBe('The reply.');

    api.once('POST', '/coach', Reply.ok({ reply: '', plan: { ...PLAN, intro: '' } }));
    restartDayPlan();
    await answerAll({ goal: 'relax', area: 'capital', when: 'now', duration: 'short' });
    expect(planMessages().at(-1)!.text).toBe(en('coach.plan.intro_fallback'));
  });

  it('no plan and no reply says so; no plan but a reply is the chat’s reply', async () => {
    api.once('POST', '/coach', Reply.ok({ reply: '  ', plan: { ...PLAN, steps: [] } }));
    await coach().startPlan('coach.chip.plan_day');
    await answerAll({ goal: 'relax', area: 'capital', when: 'now', duration: 'short' });
    expect(texts().at(-1)).toBe(en('coach.plan.empty'));
    // The app's own sentence: no "Report this reply" on it (Android COACH-7).
    expect(messages().at(-1)!.aiReply).toBeUndefined();

    api.once('POST', '/coach', Reply.ok({ reply: 'Nothing fits, but Sky Lagoon is lovely tonight.' }));
    restartDayPlan();
    await answerAll({ goal: 'relax', area: 'capital', when: 'now', duration: 'short' });
    expect(messages().at(-1)).toMatchObject({ role: 'assistant', text: 'Nothing fits, but Sky Lagoon is lovely tonight.' });
    // The model's own words: they can be reported.
    expect(messages().at(-1)!.aiReply).toBe(true);
    expect(planMessages()).toHaveLength(0);
  });

  it('counts a free account’s messages from the answer', async () => {
    api.on('POST', '/coach', Reply.ok({ reply: '', plan: PLAN, freeMessages: { limit: 3, remaining: 1, windowDays: 30, resetsAt: null } }));
    await coach().startPlan('coach.chip.plan_day');
    await answerAll({ goal: 'relax', area: 'capital', when: 'now', duration: 'short' });
    expect(coach().freeMessages).toMatchObject({ limit: 3, remaining: 1 });
  });

  it('a New chat while the plan is on its way drops it', async () => {
    api.on('POST', '/coach', Reply.delayed(40, Reply.ok({ reply: '', plan: PLAN })));
    await coach().startPlan('coach.chip.plan_day');
    await answerAll({ goal: 'relax', area: 'capital', when: 'now', duration: 'short' });
    coach().resetChat();
    await new Promise((resolve) => setTimeout(resolve, 80));
    await settle();
    expect(planMessages()).toHaveLength(0);
    expect(messages()).toHaveLength(1);
  });
});

describe('"Near me"', () => {
  it('warms a fix on the tap (not before), and sends it to two decimals', async () => {
    setLocation('granted');
    api.on('POST', '/coach', Reply.ok({ reply: '', plan: PLAN }));
    await coach().startPlan('coach.chip.plan_day');
    await tap('relax');
    expect(requestLocation).not.toHaveBeenCalled();
    await tap('near');
    expect(requestLocation).toHaveBeenCalledTimes(1);
    await answerAll({ when: 'now', duration: 'short' });
    expect(coachBodies()[0]!.intake).toMatchObject({ area: { kind: 'near', latitude: 64.15, longitude: -21.94 } });
  });

  it('without a fix plans for the Capital Region and says so', async () => {
    setLocation('denied');
    api.on('POST', '/coach', Reply.ok({ reply: '', plan: PLAN }));
    await coach().startPlan('coach.chip.plan_day');
    await answerAll({ goal: 'relax', area: 'near', when: 'now', duration: 'short' });
    expect(texts()).toContain(en('coach.plan.no_location'));
    expect(coachBodies()[0]!.intake).toMatchObject({ area: { kind: 'region', region: 'capital' } });
    expect(JSON.stringify(coachBodies())).not.toContain('latitude');
  });
});

describe('the free fallback', () => {
  const lastVenueQuery = () => api.sentAll('/venues', 'GET').at(-1)?.query.category;
  const venueCards = () => messages().filter((message) => (message.venues ?? []).length > 0).at(-1)?.venues?.map((venue) => venue.name);

  it('at the daily cap: no call, the cap’s notice and the free list for the goal', async () => {
    useCoachStore.setState({ limitReached: true });
    await coach().startPlan('coach.chip.plan_day');
    await answerAll({ goal: 'relax', area: 'capital', when: 'now', duration: 'short' });
    expect(api.sentAll('/coach')).toHaveLength(0);
    expect(texts()).toContain(en('coach.plan.limit_fallback'));
    expect(lastVenueQuery()).toBe('Spa');
    expect(venueCards()).toEqual(['Sky Lagoon']);
  });

  it('at the free lock: its own notice', async () => {
    useCoachStore.setState({ freeLimitReached: true });
    await coach().startPlan('coach.chip.plan_day');
    await answerAll({ goal: 'workout', area: 'capital', when: 'now', duration: 'short', intensity: 'easy', classType: 'any' });
    expect(texts()).toContain(en('coach.plan.free_limit_fallback'));
    expect(lastVenueQuery()).toBe('Gym');
  });

  it('a 429 shows the server’s sentence, locks, then the list', async () => {
    api.on('POST', '/coach', Reply.problem(429, 'coach-daily-limit', { detail: "You have used all of today's coach messages." }));
    await coach().startPlan('coach.chip.plan_day');
    await answerAll({ goal: 'relax', area: 'capital', when: 'now', duration: 'short' });
    expect(texts()).toContain("You have used all of today's coach messages.");
    expect(coach().limitReached).toBe(true);
    expect(venueCards()).toEqual(['Sky Lagoon']);
  });

  it('a 503 busy says the Coach is busy (no lock), then the list', async () => {
    api.on('POST', '/coach', Reply.problem(503, 'coach-busy'));
    await coach().startPlan('coach.chip.plan_day');
    await answerAll({ goal: 'relax', area: 'capital', when: 'now', duration: 'short' });
    expect(texts()).toContain(en('coach.busy'));
    expect(coach().limitReached).toBe(false);
    expect(venueCards()).toEqual(['Sky Lagoon']);
  });

  it('any other error keeps the answers: the error notice, then the list', async () => {
    api.on('POST', '/coach', Reply.problem(400, 'invalid-coach-request'));
    await coach().startPlan('coach.chip.plan_day');
    await answerAll({ goal: 'relax', area: 'capital', when: 'now', duration: 'short' });
    expect(texts()).toContain(en('coach.plan.error_fallback'));
    expect(venueCards()).toEqual(['Sky Lagoon']);
  });

  it('searches the category the words named, not the goal’s', async () => {
    useCoachStore.setState({ limitReached: true });
    await coach().send('plan my day at the pool');
    await answerAll({ area: 'capital', when: 'now', duration: 'short' });
    expect(lastVenueQuery()).toBe('Pool');
    expect(venueCards()).toEqual(['Laugardalslaug']);
  });

  it('pilates narrows the list to Pilates studios', async () => {
    useCoachStore.setState({ limitReached: true });
    await coach().startPlan('coach.chip.plan_day');
    await answerAll({ goal: 'class', area: 'capital', when: 'now', duration: 'short', classType: 'pilates' });
    expect(lastVenueQuery()).toBe('Pilates');
    expect(venueCards()).toEqual(['Pilates Studio']);
  });

  it('the area filters the list where the venue wizard can (the Highlands cannot)', async () => {
    useCoachStore.setState({ limitReached: true });
    await coach().startPlan('coach.chip.plan_day');
    await answerAll({ goal: 'relax', area: 'north', when: 'now', duration: 'short' });
    expect(venueCards()).toEqual(['Forest Lagoon']);

    restartDayPlan();
    await answerAll({ goal: 'relax', area: 'highlands', when: 'now', duration: 'short' });
    expect(venueCards()).toEqual(['Sky Lagoon', 'Forest Lagoon']);
  });
});

describe('refinements', () => {
  async function withPlan() {
    api.on('POST', '/coach', Reply.ok({ reply: '', plan: PLAN }));
    await coach().startPlan('coach.chip.plan_day');
    await answerAll({ goal: 'relax', area: 'capital', when: 'now', duration: 'short' });
    await settle();
    return planMessages()[0]!;
  }

  it('posts the chip’s words, then refines the plan by id with NO intake', async () => {
    const plan = await withPlan();
    api.on('POST', '/coach', Reply.ok({ reply: '', plan: { ...PLAN, id: 'plan_def', intro: 'Closer to home.' } }));
    await refineDayPlan(plan.id, 'closer');
    await settle();
    // A bare change name is worded by the app.
    expect(messages().some((message) => message.role === 'user' && message.text === en('coach.plan.refine.closer'))).toBe(true);
    expect(coachBodies().at(-1)).toEqual({ locale: 'en', refine: { planId: 'plan_abc', change: 'closer' } });
    expect(planMessages().map((message) => message.text)).toEqual([PLAN.intro, 'Closer to home.']);

    // The next refinement refines the plan on screen, not the first one.
    await refineDayPlan(planMessages()[1]!.id, 'Take it easier');
    await settle();
    expect(coachBodies().at(-1)).toEqual({ locale: 'en', refine: { planId: 'plan_def', change: 'easier' } });
    expect(messages().some((message) => message.role === 'user' && message.text === 'Take it easier')).toBe(true);
  });

  it('at a lock: the input’s locked sentence, and no call', async () => {
    const plan = await withPlan();
    useCoachStore.setState({ limitReached: true });
    await refineDayPlan(plan.id, 'closer');
    expect(texts().at(-1)).toBe(en('coach.input.limit_reached'));
    useCoachStore.setState({ limitReached: false, freeLimitReached: true });
    await refineDayPlan(plan.id, 'closer');
    expect(texts().at(-1)).toBe(en('coach.input.free_limit'));
    expect(coachBodies()).toHaveLength(1);
  });

  it('an error says so, and never runs the venue list', async () => {
    const plan = await withPlan();
    const venueQueries = api.sentAll('/venues', 'GET').length;
    api.on('POST', '/coach', Reply.fail());
    await refineDayPlan(plan.id, 'closer');
    await settle();
    expect(texts().at(-1)).toBe(translate('error.network', 'en'));
    expect(api.sentAll('/venues', 'GET')).toHaveLength(venueQueries);

    api.on('POST', '/coach', Reply.problem(503, 'coach-busy'));
    await refineDayPlan(plan.id, 'closer');
    await settle();
    expect(texts().at(-1)).toBe(en('coach.busy'));
  });

  it('does nothing while a reply is in flight, or for a message that is not a plan', async () => {
    const plan = await withPlan();
    const busy = coach().busy();
    const count = messages().length;
    await refineDayPlan(plan.id, 'closer');
    expect(messages()).toHaveLength(count);
    busy.end();
    await refineDayPlan(messages()[0]!.id, 'closer');
    expect(messages()).toHaveLength(count);
  });

  it('abandons an open question first', async () => {
    const plan = await withPlan();
    restartDayPlan();
    const goal = openQuestion();
    api.on('POST', '/coach', Reply.ok({ reply: 'Ok.' }));
    await refineDayPlan(plan.id, 'closer');
    expect(messages().find((message) => message.id === goal.id)?.answered).toBe(true);
    expect(dayPlanStateForTests()).toBeNull();
  });
});

describe('the cards’ actions', () => {
  it('a venue and a sight open by slug through the Coach screen', () => {
    openPlanVenue('sky-lagoon');
    expect(coach().takeRoute()).toEqual({ kind: 'venue', slug: 'sky-lagoon' });
    openPlanSight('seljalandsfoss');
    expect(coach().takeRoute()).toEqual({ kind: 'sight', slug: 'seljalandsfoss' });
  });

  it('a class books through CLASS-2’s lookup, and its venue fallback opens the venue page by slug', async () => {
    const session = {
      id: 'cls_1',
      title: 'Yoga Flow',
      startsAt: new Date('2026-10-22T17:00:00Z'),
      endsAt: null,
      venueSlug: 'hress',
      venueName: 'Hress',
      booking: null,
    };
    await bookPlanClass(session);
    expect(mockBookCoachClass).toHaveBeenCalledWith(session, expect.objectContaining({ navigation: expect.anything() }));
    const { navigation } = mockBookCoachClass.mock.calls[0]![1] as { navigation: { navigate: (name: string, params: object) => void } };
    navigation.navigate('VenueDetail', { slug: 'hress' });
    expect(coach().takeRoute()).toEqual({ kind: 'venue', slug: 'hress' });
  });
});

describe('what is kept', () => {
  it('a saved chat keeps the plan as its intro text, and the model reads only that', async () => {
    api.on('POST', '/coach', Reply.ok({ reply: '', plan: PLAN }));
    await coach().startPlan('coach.chip.plan_day');
    await answerAll({ goal: 'relax', area: 'capital', when: 'now', duration: 'short' });
    const session = buildSession(messages(), null)!;
    const saved = session.messages.find((message) => message.text === PLAN.intro)!;
    expect(Object.keys(saved).sort()).toEqual(['id', 'role', 'text']);
    // Question bubbles never leave the phone; the intro does, as the Coach's words.
    expect(modelMessages(messages()).map((message) => message.content)).toContain(PLAN.intro);
    expect(modelMessages(messages()).map((message) => message.content)).not.toContain(en('coach.plan.q.goal'));
  });
});
