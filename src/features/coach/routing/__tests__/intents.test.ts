/**
 * Which typed words OFFER the four-week wizard, and which start the day-plan
 * wizard.
 *
 * The first half is iOS LifePassTests/CoachProgramIntentTests.swift
 * (`CoachProgramIntentTests`), verbatim. A false positive is not free: it
 * interrupts someone who asked a plain question with two chips about a plan
 * they did not want. A false negative costs nothing, because the wizard is a
 * tap away on the empty screen. So the matcher is narrow, matches whole
 * phrases, and always loses to a question about the MEMBERSHIP plan.
 *
 * The second half pins the day-plan intent (iOS `CoachPlanIntent.answers`)
 * on the examples its Swift documentation gives, which iOS has no test file
 * for: plan requests, trips, walks and the things that look like walks, and
 * membership questions.
 */
import { goalForSearchCategory, planIntentAnswers, programIntentMatches } from '../intents';
import { tokens } from '../tokens';

function expectProgramme(texts: readonly string[], matches: boolean) {
  for (const text of texts) {
    expect({ text, matches: programIntentMatches(text) }).toEqual({ text, matches });
  }
}

describe('CoachProgramIntent (iOS CoachProgramIntentTests)', () => {
  it('English programme requests match', () => {
    expectProgramme(
      [
        'can I get a workout plan?',
        'I want a training plan',
        'make me a workout programme',
        'gym program please',
        'I need a 4 week plan',
        'a 12 week plan for the gym',
        'a plan for the month',
        'I want to lose weight',
        'help me build muscle',
        'I want to get fitter',
      ],
      true,
    );
  });

  it('day plans and plain questions do not match', () => {
    expectProgramme(
      [
        'plan my day',
        'what should I do today?',
        'where can I swim tonight?',
        'is Sky Lagoon open late?',
        'a hike near Reykjavik',
        'recommend a yoga class',
        '',
      ],
      false,
    );
  });

  it('a membership question never offers the wizard, in either language', () => {
    expectProgramme(
      [
        'how much does the workout plan cost?',
        'is a training plan included in the subscription?',
        'what does the Plus plan include?',
        'hvad kostar askriftin?',
        // "monthly plan" is in the programme phrase table AND reads as a
        // membership ("monthly" is a plan TYPE word, as in a monthly rather
        // than an annual membership). The membership wins the tie, so this
        // goes to the chat and the member still has the chip on the empty
        // screen.
        'give me a monthly plan',
      ],
      false,
    );
  });

  it('Icelandic programme requests match, typed with an Icelandic keyboard', () => {
    expectProgramme(
      [
        'get ég fengið æfingaáætlun?',
        'mig langar í æfingaplan',
        'viltu gera mánaðaráætlun fyrir mig',
        'áætlun fyrir mánuðinn takk',
        'ég vil léttast',
        'ég vil þyngjast',
        'hjálpaðu mér að byggja upp vöðva',
        'ég vil koma mér í form',
      ],
      true,
    );
  });

  it('Icelandic programme requests match, typed without one', () => {
    expectProgramme(
      ['get eg fengid aefingaaaetlun', 'aefingaplan takk', 'manadaraaetlun', 'eg vil lettast', 'eg vil thyngjast'],
      true,
    );
  });

  it('Icelandic day plans do not match', () => {
    expectProgramme(['hvað á ég að gera í dag?', 'skipuleggðu daginn minn', 'hvar er best að synda?'], false);
  });

  it('the two matchers do not claim the same phrase (the programme matcher runs first)', () => {
    expect(programIntentMatches('I want a workout plan')).toBe(true);
    expect(planIntentAnswers('plan my day')).not.toBeNull();
    expect(programIntentMatches('plan my day')).toBe(false);
  });

  it('tokens fold Icelandic letters the way the phrase table expects', () => {
    expect(tokens('æfingaáætlun')).toEqual(['aefingaaaetlun']);
    expect(tokens('þyngjast')).toEqual(['thyngjast']);
    expect(tokens('vöðva')).toEqual(['vodva']);
    expect(tokens('mánaðaráætlun')).toEqual(['manadaraaetlun']);
  });
});

describe('tokens (Android only)', () => {
  it('split on anything that is not a letter or a number, upper case folded too', () => {
    expect(tokens('When’s the WORLD-class ÞÓRSMÖRK trip?')).toEqual(['when', 's', 'the', 'world', 'class', 'thorsmork', 'trip']);
    expect(tokens('  ')).toEqual([]);
    expect(tokens('5min walk, 17:30')).toEqual(['5min', 'walk', '17', '30']);
  });

  it('drop other accents the way iOS folds diacritics', () => {
    expect(tokens('Crème brûlée in São Paulo')).toEqual(['creme', 'brulee', 'in', 'sao', 'paulo']);
  });
});

describe('CoachPlanIntent.answers (the day plan)', () => {
  it.each([
    'plan my day',
    'plan something for Saturday',
    'planning a day out',
    'make me a plan',
    'can you make a plan',
    'a plan for tomorrow',
    'a plan for this weekend',
    'a day plan',
    'plan',
    'Skipuleggðu daginn',
    'gerðu plan fyrir mig',
    'geturðu gert plan',
    'búðu til plan',
  ])('"%s" asks for a day plan', (text) => {
    expect(planIntentAnswers(text)).toEqual({ goal: null, classType: null, when: null, searchCategory: null });
  });

  it.each([
    'I plan to swim',
    'planning to visit',
    'the best plan for me',
    'hello there',
    '',
  ])('"%s" keeps its old path', (text) => {
    expect(planIntentAnswers(text)).toBeNull();
  });

  it('"what should I do today" answers the day, in both languages', () => {
    for (const text of ['what should I do today?', 'hvað á ég að gera í dag', 'hvad a eg ad gera i dag']) {
      expect(planIntentAnswers(text)).toEqual({ goal: null, classType: null, when: 'today', searchCategory: null });
    }
  });

  it('a hike, a trail or a waterfall is an outdoor day, even next to a venue type', () => {
    expect(planIntentAnswers('a hike near Reykjavik')?.goal).toBe('outdoors');
    expect(planIntentAnswers('skoða foss')?.goal).toBe('outdoors');
    expect(planIntentAnswers('gönguleið á Esju')?.goal).toBe('outdoors');
    expect(planIntentAnswers('a hike and then a hot spring')).toEqual({
      goal: 'outdoors',
      classType: null,
      when: null,
      searchCategory: 'lagoon',
    });
  });

  it('a town is never a waterfall (whole words only)', () => {
    expect(planIntentAnswers('sund á Selfossi')).toBeNull();
    expect(planIntentAnswers('a day trip to Selfoss')).toBeNull();
  });

  it('a named venue type keeps the venue wizard unless the words ask for a day', () => {
    expect(planIntentAnswers('find me a pool')).toBeNull();
    expect(planIntentAnswers('a gym I can walk to')).toBeNull();
    expect(planIntentAnswers('a pool within walking distance')).toBeNull();
    expect(planIntentAnswers('plan a day at the spa')).toEqual({
      goal: 'relax',
      classType: null,
      when: null,
      searchCategory: 'spa',
    });
    expect(planIntentAnswers('what should I do today? maybe swimming')).toEqual({
      goal: 'relax',
      classType: null,
      when: 'today',
      searchCategory: 'swimming',
    });
  });

  it('a yoga venue type answers the class type too: pilates when the words say so', () => {
    expect(planIntentAnswers('plan my day tomorrow with a yoga class')).toEqual({
      goal: 'class',
      classType: 'yoga',
      when: null,
      searchCategory: 'yoga',
    });
    expect(planIntentAnswers('plan my day with pilates')?.classType).toBe('pilates');
  });

  it('golf has no plan shape: the goal stays unanswered, the category is kept', () => {
    expect(planIntentAnswers('plan a golf day')).toEqual({ goal: null, classType: null, when: null, searchCategory: 'golf' });
  });

  it.each([
    'a walk along the coast',
    'a 30 minute walk along the coast',
    'a 45 minute walk up Esja',
    'a walk out of town',
    'a 30 minute walk out of town',
    'a walk out of base camp',
    'a walk out on the pier',
    'ganga í dag',
    'ganga í kringum Tjörnina',
    'göngu út úr bænum',
    '30 mínútna ganga meðfram sjónum',
  ])('"%s" is a walk: an outdoor day', (text) => {
    expect(planIntentAnswers(text)?.goal).toBe('outdoors');
  });

  it.each([
    'walk-in',
    'walk me through it',
    'within walking distance',
    'a short walk from Hlemmur',
    'a 5 minute walk',
    'a minute’s walk',
    '5min walk',
    'a 10 minute walk around the corner',
    'walk out of my contract',
    'walk out of my existing annual contract',
    'walk out of the Plus plan',
    'walk out of Plus and move to Base',
    'walking out on LifePass',
    'ganga í World Class',
    'ganga inn',
    'ganga út úr samningnum',
    'ganga út úr þessum 12 mánaða samningi',
    '5 mínútna ganga',
    'innan við 5 mínútna göngu',
  ])('"%s" is not a walk', (text) => {
    expect(planIntentAnswers(text)).toBeNull();
  });

  it.each([
    'which plan has hiking?',
    'Is Sky Lagoon in the Plus plan?',
    'hvað kostar áskriftin?',
    'a plan for students to hike',
    'plan fyrir námsmenn',
    'is the plan worth it for a hike?',
    'what plan should I get for hiking',
    'ég vil segja upp',
  ])('"%s" is about the membership: never a day plan', (text) => {
    expect(planIntentAnswers(text)).toBeNull();
    expect(programIntentMatches(text)).toBe(false);
  });

  it('a venue type implies the goal a plan can serve', () => {
    expect(goalForSearchCategory('gym')).toBe('workout');
    expect(goalForSearchCategory('yoga')).toBe('class');
    expect(goalForSearchCategory('swimming')).toBe('relax');
    expect(goalForSearchCategory('spa')).toBe('relax');
    expect(goalForSearchCategory('lagoon')).toBe('relax');
    expect(goalForSearchCategory('golf')).toBeNull();
  });
});
