/**
 * The detection order of a typed message, end to end through COACH-1's send
 * pipeline (iOS `CoachViewModel.send`): the programme intent, then an open
 * venue-wizard question, then the day-plan intent, then the venue wizard
 * (unless the words ask about classes or a time), then the chat.
 *
 * The programme and day-plan wizards are COACH-4's and COACH-3's flows; here
 * they are COACH-1's recording fakes that start on exactly this package's
 * matchers (`programIntentMatches`, `planIntentAnswers`), as those flows'
 * `startFrom` will. The venue wizard is the real one.
 */
import { api, Reply } from '@test/server';

import { stubApiClientPerTest } from '../../../../api/testing';
import { locationStore } from '../../../../stores/locationStore';
import { venueWizardFlow, venueWizardStateForTests } from '../../flows/venueWizard';
import { resetCoachStoreForTests, useCoachStore } from '../../store/coachStore';
import { clearFakeFlows, fake } from '../../store/__tests__/fakeFlows';
import { lastOpenQuestion } from '../../store/messages';
import { planIntentAnswers, programIntentMatches } from '../intents';

/* eslint-disable @typescript-eslint/no-require-imports */
jest.mock('../../flows/dayPlan', () => ({ dayPlanFlow: require('../../store/__tests__/fakeFlows').fakeFlow('dayPlan') }));
jest.mock('../../flows/program', () => ({ programFlow: require('../../store/__tests__/fakeFlows').fakeFlow('program') }));
jest.mock('../../flows/adjust', () => ({ adjustFlow: require('../../store/__tests__/fakeFlows').fakeFlow('adjust') }));
/* eslint-enable @typescript-eslint/no-require-imports */

stubApiClientPerTest();

const coach = () => useCoachStore.getState();
const initialLocation = locationStore.getState();

beforeEach(() => {
  resetCoachStoreForTests();
  venueWizardFlow.reset();
  clearFakeFlows();
  fake('program').startsOn = (text) => programIntentMatches(text);
  fake('dayPlan').startsOn = (text) => planIntentAnswers(text) !== null;
  locationStore.setState({ currentLocation: null, requestLocation: async () => undefined });
});

afterEach(() => {
  locationStore.setState(initialLocation, true);
});

/** Which flow started, if any. */
function started(): 'program' | 'dayPlan' | 'venueWizard' | null {
  if (fake('program').openQuestionId) return 'program';
  if (fake('dayPlan').openQuestionId) return 'dayPlan';
  if (venueWizardStateForTests()) return 'venueWizard';
  return null;
}

describe('typed words', () => {
  it.each([
    ['I want a workout plan', 'program'],
    ['ég vil léttast', 'program'],
    ['a 12 week plan for the gym', 'program'],
    ['plan my day', 'dayPlan'],
    ['plan my day tomorrow with a yoga class', 'dayPlan'],
    ['a hike near Reykjavik', 'dayPlan'],
    ['hvað á ég að gera í dag?', 'dayPlan'],
    ['find me a gym', 'venueWizard'],
    ['sauna í Hafnarfirði', 'venueWizard'],
  ] as const)('"%s" starts %s', async (text, flow) => {
    useCoachStore.setState({ limitReached: true });
    await coach().send(text);
    expect(started()).toBe(flow);
  });

  it('a question about classes or a time, or about the membership, starts nothing and goes to the chat', async () => {
    api.on('POST', '/coach', Reply.ok({ reply: 'Here you go.' }));
    for (const text of ['yoga classes in Akureyri', 'spinning á morgun', 'what does the Plus plan include?', 'hvað kostar áskriftin?']) {
      resetCoachStoreForTests();
      venueWizardFlow.reset();
      await coach().send(text);
      expect({ text, started: started() }).toEqual({ text, started: null });
    }
    expect(api.sentAll('/coach')).toHaveLength(4);
  });

  it('a programme request mid-wizard is offered the programme: the venue question is abandoned, never answered', async () => {
    useCoachStore.setState({ limitReached: true });
    coach().startSearch('gyms', 'coach.cat.gyms');
    const venueQuestion = lastOpenQuestion(coach().messages)!;
    await coach().send('I want a training plan');
    expect(started()).toBe('program');
    expect(venueWizardStateForTests()).toBeNull();
    expect(coach().messages.find((message) => message.id === venueQuestion.id)).toMatchObject({ answered: true });
    expect(coach().messages.find((message) => message.id === venueQuestion.id)!.selectedAnswer).toBeUndefined();
  });

  it('a day request mid-wizard answers the open venue question (iOS: the open question comes first)', async () => {
    useCoachStore.setState({ limitReached: true });
    coach().startSearch('gyms', 'coach.cat.gyms');
    await coach().send('plan my day');
    expect(fake('dayPlan').calls.filter((call) => call.startsWith('startFrom'))).toEqual([]);
    expect(venueWizardStateForTests()).toEqual({ category: 'gym', step: 1, answers: ['plan my day'] });
  });
});

describe('a prompt the app parked skips both kinds of detection', () => {
  it.each([
    ['Plan a perfect spa evening for me.', 'spa'],
    ['Suggest gym classes I should try this week.', 'gym'],
  ])('"%s" opens the %s wizard', async (text, category) => {
    // Both would start the day plan, or go to the chat, if typed.
    expect(planIntentAnswers(text) !== null || text.includes('classes')).toBe(true);
    useCoachStore.setState({ limitReached: true });
    await coach().sendParkedPrompt(text);
    expect(fake('program').calls.some((call) => call.startsWith('startFrom'))).toBe(false);
    expect(fake('dayPlan').calls.some((call) => call.startsWith('startFrom'))).toBe(false);
    expect(venueWizardStateForTests()?.category).toBe(category);
  });
});
