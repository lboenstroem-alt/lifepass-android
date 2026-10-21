/**
 * The venue wizard through COACH-1's store (iOS `CoachViewModel`'s Q&A
 * wizard): how it starts (a tile, typed words, a parked prompt), the
 * questions in the member's language, the last-open-question rule,
 * `abandonOpenQuestions`, the location warm-up at the start, the venue query
 * and its sentences, the straight-line "15-min drive" (D11), and that it
 * never calls the model, so it works at either Coach lock.
 *
 * Ports the two view-model cases of iOS `CoachScheduleRoutingTests`
 * (a typed schedule question reaches the chat and a venue search the
 * wizard; a parked Home prompt keeps its wizard).
 *
 * The other three flows are held to the stub that takes nothing, so this
 * file tests the venue wizard alone whatever COACH-3 to COACH-5 add.
 */
import { api, Reply, type StubRequest } from '@test/server';

import { stubApiClientPerTest } from '../../../../api/testing';
import * as venuesApi from '../../../../api/venues';
import { decodeVenue, venueToApi } from '../../../../api/venues';
import { LocationValue } from '../../../../data/coachQuestions';
import { lookup, setCurrentLanguage, type Lang } from '../../../../i18n';
import { locationStore } from '../../../../stores/locationStore';
import type { Venue } from '../../../../types/venue';
import { resetCoachStoreForTests, useCoachStore } from '../../store/coachStore';
import { coachHost } from '../../store/host';
import { GREETING_ID, lastOpenQuestion, type CoachMessage } from '../../store/messages';
import { MAX_VENUE_CARDS, venueWizardFlow, venueWizardStateForTests } from '../venueWizard';

jest.mock('../dayPlan', () => ({ dayPlanFlow: jest.requireActual('../types').inactiveFlow('dayPlan') }));
jest.mock('../program', () => ({ programFlow: jest.requireActual('../types').inactiveFlow('program') }));
jest.mock('../adjust', () => ({ adjustFlow: jest.requireActual('../types').inactiveFlow('adjust') }));

stubApiClientPerTest();

const coach = () => useCoachStore.getState();
const messages = () => coach().messages;
const en = (key: string) => lookup(key, 'en');

// ---------------------------------------------------------------------------
// Venues

let venueNumber = 0;

function venue(name: string, latitude: number | null, longitude: number | null, categories: string[]): Venue {
  venueNumber += 1;
  return decodeVenue({
    id: `00000000-0000-4000-8000-${String(venueNumber).padStart(12, '0')}`,
    slug: name.toLowerCase().replace(/[^a-z]+/g, '-'),
    name,
    categories,
    ...(latitude !== null && longitude !== null ? { coordinates: { latitude, longitude } } : {}),
  });
}

const WORLD_CLASS = venue('World Class Laugar', 64.1468, -21.8796, ['Gym']);
const MJOLNIR = venue('Mjolnir', 64.1309, -21.9001, ['Gym', 'MMA']);
const SPORTHUSID = venue('Sporthusid', 64.1, -21.888, ['Gym']);
const AKUREYRI_GYM = venue('Akureyri Gym', 65.6835, -18.0878, ['Gym']);
const SELFOSS_POOL = venue('Selfoss Pool', 63.9331, -20.9971, ['Pool']);
const NO_POSITION_GYM = venue('Nowhere Gym', null, null, ['Gym']);
const CATALOGUE = [WORLD_CLASS, MJOLNIR, SPORTHUSID, AKUREYRI_GYM, SELFOSS_POOL, NO_POSITION_GYM];

/** Answers `GET /venues?category=` from the catalogue, as the API does (one category, ignoring case). */
function serveCatalogue(catalogue: readonly Venue[] = CATALOGUE) {
  api.on('GET', '/venues', (request: StubRequest) => {
    const category = request.query.category?.toLowerCase();
    const rows = catalogue.filter((row) => !category || (row.categories ?? []).some((c) => c.toLowerCase() === category));
    return Reply.ok({ data: rows.map(venueToApi), pagination: { nextCursor: null, hasMore: false, limit: 100 } });
  });
}

// ---------------------------------------------------------------------------
// Location

const requestLocation = jest.fn(async () => undefined);
const initialLocation = locationStore.getState();

function setFix(fix: { latitude: number; longitude: number } | null) {
  locationStore.setState({
    permission: fix ? 'granted' : 'undetermined',
    permissionKnown: true,
    currentLocation: fix ? { ...fix, accuracy: 20, timestamp: Date.now() } : null,
    requestLocation,
  });
}

// ---------------------------------------------------------------------------
// Helpers

/** Lets the store's awaits (and the stub network) run. */
async function settle() {
  for (let turn = 0; turn < 10; turn += 1) await new Promise((resolve) => setTimeout(resolve, 0));
}

function openQuestion(): CoachMessage {
  const question = lastOpenQuestion(messages());
  if (!question) throw new Error('no open question');
  return question;
}

/** Taps the chip with this value on the open question. */
async function tap(value: string) {
  const question = openQuestion();
  const option = question.options!.find((candidate) => candidate.value === value);
  if (!option) throw new Error(`no chip ${value} on "${question.text}"`);
  await coach().selectOption(question.id, option.value, option.label);
  await settle();
}

const texts = () => messages().map((message) => message.text);
const cardsOf = (message: CoachMessage | undefined) => (message?.venues ?? []).map((row) => row.name);

/** A fresh Coach: the store, and the wizard's own state (the store's test reset leaves the flows alone). */
function fresh() {
  resetCoachStoreForTests();
  venueWizardFlow.reset();
}

beforeEach(() => {
  fresh();
  setCurrentLanguage('en');
  requestLocation.mockClear();
  setFix(null);
});

afterEach(() => {
  locationStore.setState(initialLocation, true);
  setCurrentLanguage('en');
  jest.restoreAllMocks();
});

// ---------------------------------------------------------------------------

describe('starting the wizard', () => {
  it('a category tile starts it under the tile’s label, and only then warms a location fix', () => {
    expect(requestLocation).not.toHaveBeenCalled();
    coach().startSearch('gyms', 'coach.cat.gyms');
    const [, user, question] = messages();
    expect(user).toMatchObject({ role: 'user', text: en('coach.cat.gyms') });
    expect(question).toMatchObject({ role: 'assistant', text: en('coach.q.gym.type'), flow: 'venueWizard' });
    expect(question!.options!.map((option) => option.label)).toEqual([
      en('coach.opt.gym.weightlifting'),
      en('coach.opt.gym.mma'),
      en('coach.opt.gym.spinning'),
      en('coach.opt.gym.crossfit'),
      en('coach.opt.gym.pilates'),
      en('coach.other.label'),
    ]);
    expect(requestLocation).toHaveBeenCalledTimes(1);
    expect(venueWizardStateForTests()).toEqual({ category: 'gym', step: 0, answers: [] });
  });

  it('every tile opens its own category (wellness opens the spa wizard)', () => {
    const cases: [string, string][] = [
      ['pools', 'coach.q.swimming.after'],
      ['gyms', 'coach.q.gym.type'],
      ['wellness', 'coach.q.spa.type'],
      ['spa', 'coach.q.spa.type'],
      ['yoga', 'coach.q.yoga.style'],
      ['golf', 'coach.q.location'],
      ['lagoon', 'coach.q.lagoon.experience'],
    ];
    for (const [tile, questionKey] of cases) {
      fresh();
      coach().startSearch(tile, 'coach.cat.gyms');
      expect(openQuestion().text).toBe(en(questionKey));
    }
  });

  it('an Icelandic member reads Icelandic', () => {
    setCurrentLanguage('is');
    coach().startSearch('yoga', 'coach.cat.yoga');
    expect(messages()[1]!.text).toBe(lookup('coach.cat.yoga', 'is'));
    expect(openQuestion().text).toBe(lookup('coach.q.yoga.style', 'is'));
    expect(openQuestion().options![0]!.label).toBe(lookup('coach.opt.yoga.vinyasa', 'is'));
  });

  it('typed words that name a venue type start it; the words are the member’s bubble', async () => {
    await coach().send('find me a gym');
    expect(messages()[1]).toMatchObject({ role: 'user', text: 'find me a gym' });
    expect(openQuestion().text).toBe(en('coach.q.gym.type'));
    expect(requestLocation).toHaveBeenCalledTimes(1);
    expect(api.sentAll('/coach')).toHaveLength(0);
  });

  it('a typed schedule question reaches the chat, a venue search the wizard (iOS, at the daily cap)', async () => {
    for (const text of [
      'yoga classes in Akureyri',
      'a workout today at 9',
      'spinning á morgun',
      'I want to work out today at 9, what are the options near me?',
    ]) {
      fresh();
      useCoachStore.setState({ limitReached: true });
      await coach().send(text);
      expect({ text, wizard: venueWizardStateForTests() }).toEqual({ text, wizard: null });
      // Only the greeting: the chat path stopped at its lock.
      expect({ text, ids: messages().map((message) => message.id) }).toEqual({ text, ids: [GREETING_ID] });
    }

    fresh();
    useCoachStore.setState({ limitReached: true });
    await coach().send('find me a gym');
    expect(venueWizardStateForTests()?.category).toBe('gym');
  });

  it('a typed schedule question with the chat open goes to the model', async () => {
    api.on('POST', '/coach', Reply.ok({ reply: 'Yoga at Sólir starts at 17:30.' }));
    await coach().send('yoga classes in Akureyri');
    await settle();
    expect(venueWizardStateForTests()).toBeNull();
    expect(texts()).toEqual([en('coach.greeting'), 'yoga classes in Akureyri', 'Yoga at Sólir starts at 17:30.']);
  });

  it('a parked Home prompt keeps its wizard (iOS): its "classes" is the app’s own wording', async () => {
    useCoachStore.setState({ limitReached: true });
    await coach().sendParkedPrompt('Suggest gym classes I should try this week.');
    expect(venueWizardStateForTests()?.category).toBe('gym');
  });

  it('words naming no venue type do not start it', async () => {
    useCoachStore.setState({ limitReached: true });
    await coach().send('where can I swim');
    expect(venueWizardStateForTests()).toBeNull();
  });
});

describe('answering', () => {
  it('chips walk the questions in order; the last answer lists the venues and offers the strip', async () => {
    serveCatalogue();
    coach().startSearch('gyms', 'coach.cat.gyms');
    await tap('weightlifting');
    expect(venueWizardStateForTests()).toEqual({ category: 'gym', step: 1, answers: ['weightlifting'] });
    expect(openQuestion().text).toBe(en('coach.q.location'));
    await tap(LocationValue.capital);
    expect(openQuestion().text).toBe(en('coach.q.gym.amenities'));
    await tap('');

    expect(api.sent('/venues').query).toMatchObject({ category: 'Gym', limit: '100' });
    const all = messages();
    // Each answer is the member's bubble, under its closed question.
    expect(all.filter((message) => message.role === 'user').map((message) => message.text)).toEqual([
      en('coach.cat.gyms'),
      en('coach.opt.gym.weightlifting'),
      en('coach.loc.capital'),
      en('coach.opt.gym.no_pref'),
    ]);
    expect(all.filter((message) => message.options).every((message) => message.answered)).toBe(true);
    const results = all.at(-2)!;
    expect(results.text).toBe(lookup('coach.found.many', 'en').replace('{count}', '3').replace('{category}', en('coach.cat_name.gym')));
    expect(cardsOf(results)).toEqual(['World Class Laugar', 'Mjolnir', 'Sporthusid']);
    expect(all.at(-1)).toMatchObject({ text: en('coach.explore_else'), showCategoryStrip: true });
    expect(venueWizardStateForTests()).toBeNull();
    expect(coach().isTyping).toBe(false);
    expect(api.sentAll('/coach')).toHaveLength(0);
  });

  it('a chosen chip stays marked on its closed bubble', async () => {
    serveCatalogue();
    coach().startSearch('golf', 'coach.cat.golf');
    const question = openQuestion();
    await tap(LocationValue.south);
    const closed = messages().find((message) => message.id === question.id)!;
    expect(closed).toMatchObject({ answered: true, selectedAnswer: en('coach.loc.south') });
  });

  it('"MMA & Combat" queries MMA, and the sentence names what is shown', async () => {
    serveCatalogue();
    coach().startSearch('gyms', 'coach.cat.gyms');
    await tap('MMA and combat sports');
    await tap(LocationValue.capital);
    await tap('with a sauna');
    expect(api.sentAll('/venues').map((request) => request.query.category)).toEqual(['MMA']);
    const results = messages().at(-2)!;
    expect(results.text).toBe(lookup('coach.found.one', 'en').replace('{count}', '1').replace('{category}', 'MMA'));
    expect(cardsOf(results)).toEqual(['Mjolnir']);
  });

  it('an empty narrow category falls back to the broad one, and says the broad word', async () => {
    serveCatalogue();
    coach().startSearch('gyms', 'coach.cat.gyms');
    await tap('pilates');
    await tap(LocationValue.capital);
    await tap('');
    expect(api.sentAll('/venues').map((request) => request.query.category)).toEqual(['Pilates', 'Gym']);
    expect(messages().at(-2)!.text).toBe(
      lookup('coach.found.many', 'en').replace('{count}', '3').replace('{category}', en('coach.cat_name.gym')),
    );
  });

  it('nothing in the region: "no results" names what was asked for, then the strip', async () => {
    serveCatalogue();
    coach().startSearch('gyms', 'coach.cat.gyms');
    await tap('MMA and combat sports');
    await tap(LocationValue.east);
    await tap('');
    expect(messages().at(-2)).toMatchObject({ text: lookup('coach.no_results', 'en').replace('{wanted}', 'MMA') });
    expect(messages().at(-2)!.venues).toBeUndefined();
    expect(messages().at(-1)).toMatchObject({ showCategoryStrip: true });
  });

  it('at most 10 cards', async () => {
    const many = Array.from({ length: 14 }, (_, index) => venue(`Pool ${index}`, 64.14, -21.9, ['Pool']));
    serveCatalogue(many);
    coach().startSearch('pools', 'coach.cat.pools');
    await tap('lap swimming lanes');
    await tap(LocationValue.capital);
    await tap('');
    expect(messages().at(-2)!.venues).toHaveLength(MAX_VENUE_CARDS);
    expect(messages().at(-2)!.text).toContain('10');
  });

  it('typed words answer the open question, as typed (value and label)', async () => {
    serveCatalogue();
    coach().startSearch('gyms', 'coach.cat.gyms');
    // Typed "pilates" is the gym type's own value: it narrows like the chip.
    await coach().send('pilates');
    expect(venueWizardStateForTests()).toEqual({ category: 'gym', step: 1, answers: ['pilates'] });
    expect(messages().at(-2)).toMatchObject({ role: 'user', text: 'pilates' });
    // A venue type typed mid-wizard is an answer, not a new wizard.
    await coach().send('pool near me');
    expect(venueWizardStateForTests()).toEqual({ category: 'gym', step: 2, answers: ['pilates', 'pool near me'] });
    expect(api.sentAll('/coach')).toHaveLength(0);
  });

  it('"Other" answers with the typed words', async () => {
    serveCatalogue();
    coach().startSearch('spa', 'coach.cat.spa');
    await coach().selectOption(openQuestion().id, 'infrared sauna', 'infrared sauna');
    expect(venueWizardStateForTests()).toEqual({ category: 'spa', step: 1, answers: ['infrared sauna'] });
  });

  it('keeps working at either Coach lock: it never calls the model', async () => {
    serveCatalogue();
    useCoachStore.setState({ freeLimitReached: true, limitReached: true });
    coach().startSearch('gyms', 'coach.cat.gyms');
    await tap('CrossFit');
    await tap(LocationValue.capital);
    await tap('open in the evening');
    expect(cardsOf(messages().at(-2))).toHaveLength(3);
    expect(api.sentAll('/coach')).toHaveLength(0);
  });
});

describe('only the last open question answers', () => {
  it('a chip on an earlier bubble never injects its value into the current wizard', async () => {
    coach().startSearch('yoga', 'coach.cat.yoga');
    const yoga = openQuestion();
    // Another tile: the store abandons every open question first.
    coach().startSearch('gyms', 'coach.cat.gyms');
    expect(messages().find((message) => message.id === yoga.id)!.answered).toBe(true);
    expect(venueWizardStateForTests()).toEqual({ category: 'gym', step: 0, answers: [] });

    // Even if the old bubble could still be tapped, it is not this wizard's question.
    coachHost().update(yoga.id, (message) => ({ ...message, answered: false }));
    await coach().selectOption(yoga.id, 'hot yoga', en('coach.opt.yoga.hot'));
    await venueWizardFlow.selectOption!(yoga.id, 'hot yoga', en('coach.opt.yoga.hot'));
    expect(venueWizardStateForTests()).toEqual({ category: 'gym', step: 0, answers: [] });
    expect(messages().filter((message) => message.role === 'user').map((message) => message.text)).toEqual([
      en('coach.cat.yoga'),
      en('coach.cat.gyms'),
    ]);
  });

  it('the wizard’s own question answers only while it is the last open one', async () => {
    coach().startSearch('gyms', 'coach.cat.gyms');
    const gym = openQuestion();
    // Something opened under it (another flow's question): the gym question is no longer current.
    coachHost().append({ role: 'assistant', text: 'Another question', options: [{ label: 'Yes', value: 'yes' }] });
    expect(venueWizardFlow.hasOpenQuestion()).toBe(false);
    await venueWizardFlow.selectOption!(gym.id, 'CrossFit', 'CrossFit');
    expect(venueWizardStateForTests()).toEqual({ category: 'gym', step: 0, answers: [] });
  });

  it('abandonOpenQuestions ends the wizard and closes its bubble; typed words then start afresh', async () => {
    useCoachStore.setState({ limitReached: true });
    coach().startSearch('gyms', 'coach.cat.gyms');
    const gym = openQuestion();
    coach().abandonOpenQuestions();
    expect(venueWizardStateForTests()).toBeNull();
    expect(venueWizardFlow.isActive()).toBe(false);
    expect(messages().find((message) => message.id === gym.id)!.answered).toBe(true);

    await coach().send('a quiet yoga studio');
    expect(venueWizardStateForTests()).toEqual({ category: 'yoga', step: 0, answers: [] });
  });

  it('"What’s nearby?" abandons an open wizard', () => {
    coach().startSearch('gyms', 'coach.cat.gyms');
    coach().showCategoryPicker('coach.chip.nearby');
    expect(venueWizardStateForTests()).toBeNull();
    expect(lastOpenQuestion(messages())).toBeNull();
  });

  it('New chat and sign-out forget the wizard', () => {
    coach().startSearch('gyms', 'coach.cat.gyms');
    coach().resetChat();
    expect(venueWizardStateForTests()).toBeNull();
    coach().startSearch('gyms', 'coach.cat.gyms');
    coach().resetForSignOut();
    expect(venueWizardStateForTests()).toBeNull();
  });
});

describe('"15-min drive": a straight line on the phone (D11)', () => {
  /** Nothing in the catalogue is within 15 km of Egilsstaðir. */
  const EGILSSTADIR = { latitude: 65.2653, longitude: -14.3948 };

  async function driveSearch() {
    coach().startSearch('gyms', 'coach.cat.gyms');
    await tap('weightlifting');
    await tap(LocationValue.drive);
    await tap('');
    return messages().at(-2)!;
  }

  it('with a fix: the venues within 15 km, nearest first, under "Found N"', async () => {
    serveCatalogue();
    setFix({ latitude: 64.1, longitude: -21.888 }); // at Sporthusid
    const results = await driveSearch();
    expect(cardsOf(results)).toEqual(['Sporthusid', 'Mjolnir', 'World Class Laugar']);
    expect(results.text).toBe(lookup('coach.found.many', 'en').replace('{count}', '3').replace('{category}', en('coach.cat_name.gym')));
    // The position never leaves the phone.
    expect(api.sent('/venues').query).toEqual({ category: 'Gym', limit: '100' });
  });

  it('with a fix and nothing within 15 km: the closest, with the note', async () => {
    serveCatalogue();
    setFix(EGILSSTADIR);
    const results = await driveSearch();
    expect(cardsOf(results)[0]).toBe('Akureyri Gym');
    expect(results.venues).toHaveLength(4);
    expect(results.text).toBe(en('coach.note.nothing_nearby'));
  });

  it('without a fix: measured from Reykjavík centre, and the note says so', async () => {
    serveCatalogue();
    const results = await driveSearch();
    expect(cardsOf(results)).toEqual(['Mjolnir', 'World Class Laugar', 'Sporthusid']);
    expect(results.text).toBe(en('coach.note.no_location'));
  });

  it('a fix that arrives while the questions are answered is the one used', async () => {
    serveCatalogue();
    coach().startSearch('gyms', 'coach.cat.gyms');
    await tap('weightlifting');
    await tap(LocationValue.drive);
    setFix(EGILSSTADIR);
    await tap('');
    expect(messages().at(-2)!.text).toBe(en('coach.note.nothing_nearby'));
  });
});

describe('errors and timing', () => {
  it('a server error shows the API’s sentence, and no strip', async () => {
    api.on('GET', '/venues', Reply.problem(500, 'internal_error'));
    coach().startSearch('golf', 'coach.cat.golf');
    await tap(LocationValue.south);
    const last = messages().at(-1)!;
    expect(last.role).toBe('assistant');
    expect(last.text.length).toBeGreaterThan(0);
    expect(last.showCategoryStrip).toBeFalsy();
    expect(coach().isTyping).toBe(false);
    // A venue error never locks the Coach.
    expect(coach().limitReached).toBe(false);
  });

  it.each<Lang>(['en', 'is'])('a page that does not decode reads as the API’s own sentence (%s)', async (lang) => {
    setCurrentLanguage(lang);
    api.on('GET', '/venues', Reply.ok({ data: 'not a list' }));
    coach().startSearch('golf', 'coach.cat.golf');
    await tap(LocationValue.south);
    const text = messages().at(-1)!.text;
    expect(text).not.toBe('');
    expect(text).not.toMatch(/^coach\./);
    expect(text).not.toBe(lookup('coach.venues_error', lang));
  });

  it.each<Lang>(['en', 'is'])('anything else reads as "couldn’t load venues" (%s)', async (lang) => {
    setCurrentLanguage(lang);
    jest.spyOn(venuesApi, 'fetchVenues').mockRejectedValue(new Error('boom'));
    coach().startSearch('golf', 'coach.cat.golf');
    await tap(LocationValue.south);
    expect(messages().at(-1)).toMatchObject({ role: 'assistant', text: lookup('coach.venues_error', lang) });
    expect(coach().isTyping).toBe(false);
  });

  it('the typing dots show while the venues load', async () => {
    let release: () => void = () => undefined;
    api.on('GET', '/venues', () => new Promise((resolve) => {
      release = () => resolve(Reply.ok({ data: [], pagination: { nextCursor: null, hasMore: false, limit: 100 } }));
    }));
    coach().startSearch('golf', 'coach.cat.golf');
    const done = coach().selectOption(openQuestion().id, LocationValue.south, en('coach.loc.south'));
    await settle();
    expect(coach().isTyping).toBe(true);
    release();
    await done;
    await settle();
    expect(coach().isTyping).toBe(false);
  });

  it('a New chat while the venues load: the answer never lands in the new chat', async () => {
    let release: () => void = () => undefined;
    api.on('GET', '/venues', () => new Promise((resolve) => {
      release = () => resolve(Reply.ok({ data: [venueToApi(SELFOSS_POOL)], pagination: { nextCursor: null, hasMore: false, limit: 100 } }));
    }));
    coach().startSearch('pools', 'coach.cat.pools');
    await tap('lap swimming lanes');
    await tap(LocationValue.south);
    const done = coach().selectOption(openQuestion().id, '', en('coach.opt.swimming.no_pref'));
    await settle();
    coach().resetChat();
    release();
    await done;
    await settle();
    expect(messages().map((message) => message.id)).toEqual([GREETING_ID]);
    expect(coach().isTyping).toBe(false);
  });
});

describe('the result sentences in Icelandic', () => {
  it('"Found" and the category word are the member’s language', async () => {
    setCurrentLanguage('is');
    serveCatalogue();
    coach().startSearch('pools', 'coach.cat.pools');
    await tap('outdoor heated pool');
    await tap(LocationValue.south);
    await tap('with a sauna');
    expect(messages().at(-2)!.text).toBe(
      lookup('coach.found.one', 'is').replace('{count}', '1').replace('{category}', lookup('coach.cat_name.swimming', 'is')),
    );
    expect(messages().at(-1)!.text).toBe(lookup('coach.explore_else', 'is'));
  });
});
