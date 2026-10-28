/**
 * The day plan's intake rules (iOS `CoachIntake`, `CoachPlanAnswers`,
 * `CoachRefineChange`, Models/CoachPlan.swift): which question comes next,
 * what a chip may answer, what the intake drops, the 40-unit class type, the
 * coarse position, the free fallback's tables, and how a refinement chip is
 * read and worded.
 */
import { lookup } from '../../../../i18n';
import { planIntentAnswers } from '../../routing/intents';
import {
  answersFromIntent,
  asksClassType,
  asksIntensity,
  asksTimeOfDay,
  CLASS_TYPE_LIMIT,
  coarseArea,
  EMPTY_PLAN_ANSWERS,
  fallbackCategory,
  fallbackLocationValue,
  fallbackVenueCategory,
  fallbackWizardAnswers,
  isChangeName,
  makeIntake,
  nextPlanQuestion,
  planIntake,
  recordPlanAnswer,
  refineChangeForChip,
  refineChipLabel,
  type PlanAnswers,
  type PlanQuestion,
} from '../model';

/** Records each [value, question] in turn; fails the test on a refused value. */
function answer(...steps: [string, PlanQuestion][]): PlanAnswers {
  let answers = EMPTY_PLAN_ANSWERS;
  for (const [value, question] of steps) {
    const next = recordPlanAnswer(answers, value, question);
    if (!next) throw new Error(`${value} refused for ${question}`);
    answers = next;
  }
  return answers;
}

/** Walks the wizard: answers whatever it asks next from `values`, in order. */
function walk(values: Partial<Record<PlanQuestion, string>>): { asked: PlanQuestion[]; answers: PlanAnswers } {
  let answers = EMPTY_PLAN_ANSWERS;
  const asked: PlanQuestion[] = [];
  for (let question = nextPlanQuestion(answers); question !== null; question = nextPlanQuestion(answers)) {
    asked.push(question);
    const value = values[question];
    if (value === undefined) throw new Error(`asked ${question} with no answer`);
    answers = recordPlanAnswer(answers, value, question)!;
  }
  return { asked, answers };
}

const REYKJAVIK = { latitude: 64.14657, longitude: -21.94263 };

describe('the next question', () => {
  it('asks every question for a workout later today', () => {
    const { asked } = walk({
      goal: 'workout',
      area: 'capital',
      when: 'today',
      timeOfDay: 'evening',
      duration: 'short',
      intensity: 'hard',
      classType: 'hiit',
    });
    expect(asked).toEqual(['goal', 'area', 'when', 'timeOfDay', 'duration', 'intensity', 'classType']);
  });

  it('skips the time of day for "now"', () => {
    const { asked, answers } = walk({ goal: 'relax', area: 'south', when: 'now', duration: 'half_day' });
    expect(asked).toEqual(['goal', 'area', 'when', 'duration']);
    expect(answers.timeOfDayAnswered).toBe(false);
  });

  it('asks intensity only for a workout or the outdoors', () => {
    for (const goal of ['class', 'relax', 'mix']) {
      const { asked } = walk({ goal, area: 'capital', when: 'now', duration: 'short', classType: 'yoga' });
      expect({ goal, intensity: asked.includes('intensity') }).toEqual({ goal, intensity: false });
    }
    for (const goal of ['workout', 'outdoors']) {
      const { asked } = walk({ goal, area: 'capital', when: 'now', duration: 'short', intensity: 'easy', classType: 'yoga' });
      expect({ goal, intensity: asked.includes('intensity') }).toEqual({ goal, intensity: true });
    }
  });

  it('asks the class type only for a class or a workout', () => {
    for (const goal of ['relax', 'outdoors', 'mix']) {
      const { asked } = walk({ goal, area: 'capital', when: 'now', duration: 'short', intensity: 'easy' });
      expect({ goal, classType: asked.includes('classType') }).toEqual({ goal, classType: false });
    }
    for (const goal of ['class', 'workout']) {
      const { asked } = walk({ goal, area: 'capital', when: 'now', duration: 'short', intensity: 'easy', classType: 'any' });
      expect({ goal, classType: asked.includes('classType') }).toEqual({ goal, classType: true });
    }
  });

  it('a preset goal (from typed words) skips the first question', () => {
    const answers = answer(['outdoors', 'goal']);
    expect(nextPlanQuestion(answers)).toBe('area');
  });

  it('the ask rules', () => {
    expect(asksTimeOfDay('now')).toBe(false);
    expect(asksTimeOfDay('weekend')).toBe(true);
    expect(asksIntensity('workout')).toBe(true);
    expect(asksIntensity('class')).toBe(false);
    expect(asksClassType('class')).toBe(true);
    expect(asksClassType('mix')).toBe(false);
  });
});

describe('recording an answer', () => {
  it('refuses a value that does not belong to the question, leaving the answers as they were', () => {
    expect(recordPlanAnswer(EMPTY_PLAN_ANSWERS, 'swim', 'goal')).toBeNull();
    expect(recordPlanAnswer(EMPTY_PLAN_ANSWERS, 'reykjavik', 'area')).toBeNull();
    expect(recordPlanAnswer(EMPTY_PLAN_ANSWERS, 'yesterday', 'when')).toBeNull();
    expect(recordPlanAnswer(EMPTY_PLAN_ANSWERS, 'night', 'timeOfDay')).toBeNull();
    expect(recordPlanAnswer(EMPTY_PLAN_ANSWERS, 'week', 'duration')).toBeNull();
    expect(recordPlanAnswer(EMPTY_PLAN_ANSWERS, 'extreme', 'intensity')).toBeNull();
    expect(recordPlanAnswer(EMPTY_PLAN_ANSWERS, '   ', 'classType')).toBeNull();
    // A wire value of another question is not this one's.
    expect(recordPlanAnswer(EMPTY_PLAN_ANSWERS, 'today', 'goal')).toBeNull();
  });

  it('"Near me" and every region answer the area', () => {
    for (const value of ['near', 'capital', 'reykjanes', 'south', 'west', 'westfjords', 'north', 'east', 'highlands']) {
      expect(recordPlanAnswer(EMPTY_PLAN_ANSWERS, value, 'area')?.areaChoice).toBe(value);
    }
  });

  it('"Any time" answers the time of day with nothing', () => {
    const answers = answer(['any', 'timeOfDay']);
    expect(answers.timeOfDay).toBeNull();
    expect(answers.timeOfDayAnswered).toBe(true);
  });

  it('"Surprise me" answers the class type with nothing', () => {
    const answers = answer(['any', 'classType']);
    expect(answers.classType).toBeNull();
    expect(answers.classTypeAnswered).toBe(true);
  });

  it('a typed class type is trimmed and cut to the server’s 40 UTF-16 units, never splitting a character', () => {
    const long = `  ${'a'.repeat(39)}🧘‍♀️ and more words  `;
    const answers = answer([long, 'classType']);
    expect(answers.classType).toBe('a'.repeat(39));
    expect(answers.classType!.length).toBeLessThanOrEqual(CLASS_TYPE_LIMIT);

    const exactly = 'b'.repeat(45);
    expect(answer([exactly, 'classType']).classType).toBe('b'.repeat(40));
    expect(answer(['Aerial yoga', 'classType']).classType).toBe('Aerial yoga');
  });
});

describe('the intake', () => {
  const full = (overrides: Partial<Record<PlanQuestion, string>> = {}) =>
    walk({
      goal: 'workout',
      area: 'capital',
      when: 'today',
      timeOfDay: 'evening',
      duration: 'short',
      intensity: 'hard',
      classType: 'hiit',
      ...overrides,
    }).answers;

  it('is null until every question is answered', () => {
    expect(planIntake(answer(['workout', 'goal'], ['capital', 'area']), null)).toBeNull();
  });

  it('a region goes as a region', () => {
    expect(planIntake(full(), null)).toEqual({
      goal: 'workout',
      area: { kind: 'region', region: 'capital' },
      when: 'today',
      timeOfDay: 'evening',
      duration: 'short',
      intensity: 'hard',
      classType: 'hiit',
    });
  });

  it('"Near me" needs a fix, and sends it to two decimals', () => {
    const answers = full({ area: 'near' });
    expect(planIntake(answers, null)).toBeNull();
    expect(planIntake(answers, REYKJAVIK)?.area).toEqual({ kind: 'near', latitude: 64.15, longitude: -21.94 });
  });

  it('coarse rounds half away from zero, like Swift', () => {
    expect(coarseArea(64.125, -21.875)).toEqual({ kind: 'near', latitude: 64.13, longitude: -21.88 });
    expect(coarseArea(65.6835, -18.0878)).toEqual({ kind: 'near', latitude: 65.68, longitude: -18.09 });
  });

  it('leaves out what was answered "any" (no key at all)', () => {
    const intake = planIntake(full({ timeOfDay: 'any', classType: 'any' }), null)!;
    expect('timeOfDay' in intake).toBe(false);
    expect('classType' in intake).toBe(false);
  });

  it('drops a stale intensity and class type when the goal does not ask them', () => {
    // Answered for a workout, then the goal became relax (e.g. a typed
    // request carried a class type the relax goal never asks).
    const stale: PlanAnswers = { ...full(), goal: 'relax' };
    const intake = planIntake(stale, null)!;
    expect(intake.goal).toBe('relax');
    expect('intensity' in intake).toBe(false);
    expect('classType' in intake).toBe(false);
  });

  it('drops a time of day for "now"', () => {
    expect(makeIntake({
      goal: 'mix',
      area: { kind: 'region', region: 'north' },
      when: 'now',
      timeOfDay: 'morning',
      duration: 'full_day',
      intensity: null,
      classType: null,
    })).toEqual({ goal: 'mix', area: { kind: 'region', region: 'north' }, when: 'now', duration: 'full_day' });
  });

  it('cuts a class type to 40 units on every path, the builder included', () => {
    const intake = makeIntake({
      goal: 'class',
      area: { kind: 'region', region: 'capital' },
      when: 'tomorrow',
      timeOfDay: null,
      duration: 'short',
      intensity: 'hard',
      classType: `  ${'x'.repeat(60)}  `,
    });
    expect(intake.classType).toBe('x'.repeat(40));
    // Intensity is not asked for a class.
    expect('intensity' in intake).toBe(false);
  });

  it('carries no note and nothing typed: only the answers’ keys', () => {
    const intake = planIntake(full(), null)!;
    expect(Object.keys(intake).sort()).toEqual(['area', 'classType', 'duration', 'goal', 'intensity', 'timeOfDay', 'when']);
  });
});

describe('a typed day request', () => {
  it('fills in what the words say, and keeps the category they named (never the words)', () => {
    const answers = answersFromIntent(planIntentAnswers('plan my day tomorrow with a yoga class')!);
    expect(answers.goal).toBe('class');
    expect(answers.classType).toBe('yoga');
    expect(answers.classTypeAnswered).toBe(true);
    expect(answers.searchCategory).toBe('yoga');
    expect(nextPlanQuestion(answers)).toBe('area');
    expect(JSON.stringify(answers)).not.toContain('tomorrow with');
  });

  it('"what should I do today" answers when', () => {
    const answers = answersFromIntent(planIntentAnswers('What should I do today?')!);
    expect(answers.when).toBe('today');
    expect(answers.goal).toBeNull();
    expect(nextPlanQuestion(answers)).toBe('goal');
  });

  it('a hike is the outdoors', () => {
    const answers = answersFromIntent(planIntentAnswers('a hike')!);
    expect(answers.goal).toBe('outdoors');
  });

  it('pilates is the class type for a yoga venue', () => {
    const answers = answersFromIntent(planIntentAnswers('plan my day with pilates')!);
    expect(answers.classType).toBe('pilates');
  });
});

describe('the free fallback', () => {
  it('searches what the member named before the goal’s category', () => {
    expect(fallbackVenueCategory({ ...EMPTY_PLAN_ANSWERS, goal: 'relax', searchCategory: 'swimming' })).toBe('swimming');
    expect(fallbackVenueCategory({ ...EMPTY_PLAN_ANSWERS, goal: 'relax' })).toBe('spa');
    expect(fallbackVenueCategory(EMPTY_PLAN_ANSWERS)).toBe('spa');
  });

  it('the goal table', () => {
    expect(fallbackCategory('workout', null)).toBe('gym');
    expect(fallbackCategory('class', 'yoga')).toBe('yoga');
    expect(fallbackCategory('class', 'pilates')).toBe('yoga');
    expect(fallbackCategory('class', 'hiit')).toBe('gym');
    expect(fallbackCategory('class', null)).toBe('gym');
    expect(fallbackCategory('relax', null)).toBe('spa');
    expect(fallbackCategory('outdoors', null)).toBe('spa');
    expect(fallbackCategory('mix', null)).toBe('spa');
  });

  it('the location table: the Highlands have no venue bucket', () => {
    expect(fallbackLocationValue('near')).toBe('drive15');
    expect(fallbackLocationValue('capital')).toBe('capital');
    expect(fallbackLocationValue('reykjanes')).toBe('capital');
    expect(fallbackLocationValue('south')).toBe('south');
    expect(fallbackLocationValue('west')).toBe('west');
    expect(fallbackLocationValue('westfjords')).toBe('west');
    expect(fallbackLocationValue('north')).toBe('north');
    expect(fallbackLocationValue('east')).toBe('east');
    expect(fallbackLocationValue('highlands')).toBeNull();
    expect(fallbackLocationValue(null)).toBeNull();
  });

  it('carries the location and pilates to the venue wizard', () => {
    expect(fallbackWizardAnswers({ ...EMPTY_PLAN_ANSWERS, areaChoice: 'near', classType: 'pilates' })).toEqual(['drive15', 'pilates']);
    expect(fallbackWizardAnswers({ ...EMPTY_PLAN_ANSWERS, areaChoice: 'highlands', classType: 'yoga' })).toEqual([]);
  });
});

describe('refinement chips', () => {
  it('a chip that is a change name is that change', () => {
    for (const change of ['closer', 'easier', 'harder', 'earlier', 'later', 'different']) {
      expect(refineChangeForChip(change)).toBe(change);
      expect(refineChangeForChip(` ${change.toUpperCase()} `)).toBe(change);
    }
  });

  it('a worded chip is read by keyword, in both languages', () => {
    expect(refineChangeForChip('Somewhere closer')).toBe('closer');
    expect(refineChangeForChip('Nær mér')).toBe('closer');
    expect(refineChangeForChip('Take it easier')).toBe('easier');
    expect(refineChangeForChip('Rólegra')).toBe('easier');
    expect(refineChangeForChip('Léttara')).toBe('easier');
    expect(refineChangeForChip('Push harder')).toBe('harder');
    expect(refineChangeForChip('Meira krefjandi')).toBe('harder');
    expect(refineChangeForChip('More of a challenge')).toBe('harder');
    expect(refineChangeForChip('In the morning')).toBe('earlier');
    expect(refineChangeForChip('Fyrir hádegi')).toBe('earlier');
    expect(refineChangeForChip('Fyrr')).toBe('earlier');
    expect(refineChangeForChip('Later on')).toBe('later');
    expect(refineChangeForChip('Í kvöld')).toBe('later');
    expect(refineChangeForChip('Síðar')).toBe('later');
  });

  it('anything else asks for something different', () => {
    expect(refineChangeForChip('Add a hot tub')).toBe('different');
    expect(refineChangeForChip('')).toBe('different');
  });

  it('only a bare change name is worded by the app; a label is the server’s own', () => {
    const t = (key: string) => lookup(key, 'en');
    expect(isChangeName('closer')).toBe(true);
    expect(isChangeName(' Harder ')).toBe(true);
    expect(isChangeName('Somewhere closer')).toBe(false);
    expect(refineChipLabel('closer', t)).toBe(lookup('coach.plan.refine.closer', 'en'));
    expect(refineChipLabel('Harder', (key) => lookup(key, 'is'))).toBe(lookup('coach.plan.refine.harder', 'is'));
    expect(refineChipLabel('Somewhere closer', t)).toBe('Somewhere closer');
  });
});
