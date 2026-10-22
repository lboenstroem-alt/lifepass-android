/**
 * Typed questions about classes or a time go to the chat, which reads the
 * class timetable on the server, even when they name a venue type; plain
 * venue finding keeps the free venue wizard (`venueWizardCategory`).
 *
 * Ported verbatim from iOS LifePassTests/CoachProgramIntentTests.swift,
 * `CoachScheduleRoutingTests` (the pure cases; the two view-model cases are
 * in ../../flows/__tests__/venueWizard.test.ts). Every schedule question
 * below names a venue type, so `detectVenueCategory` alone would have opened
 * the wizard on it, and the chat never saw it (the "classes in Akureyri"
 * report, monorepo docs/12_COACH.md 5.2).
 */
import { detectVenueCategory } from '../../../../data/coachQuestions';
import { planIntentAnswers } from '../intents';
import { hasScheduleCue, venueWizardCategory } from '../scheduleCue';

function expectToTheChat(texts: readonly string[], namesVenueType: boolean) {
  for (const text of texts) {
    if (namesVenueType) expect({ text, category: detectVenueCategory(text) }).not.toEqual({ text, category: null });
    expect({ text, cue: hasScheduleCue(text) }).toEqual({ text, cue: true });
    expect({ text, category: venueWizardCategory(text) }).toEqual({ text, category: null });
  }
}

function expectTheWizard(cases: readonly (readonly [string, string])[]) {
  for (const [text, category] of cases) {
    expect({ text, cue: hasScheduleCue(text) }).toEqual({ text, cue: false });
    expect({ text, category: venueWizardCategory(text) }).toEqual({ text, category });
  }
}

describe('to the chat', () => {
  it('English schedule questions go to the chat', () => {
    expectToTheChat(
      [
        'yoga classes in Akureyri',
        'a workout today at 9',
        'spinning tomorrow',
        'pilates tonight',
        'gym class at 6',
        'group fitness tonight',
        'any yoga on Saturday?',
        'crossfit after 5',
        'hot yoga 17:30',
        'spinning at 6pm',
        'spinning at 9 o’clock',
        'is there a yoga timetable?',
        'swimming lessons schedule',
        'pilates this evening',
        'MMA classes in Reykjavík',
        'a workout at 7:30 tomorrow morning',
        'crossfit before 7',
        'what time is yoga at Sporthúsið',
        'yoga times in Akureyri',
        'when is spinning at Hress?',
        'when’s the next pilates?',
        'spinning at 9.',
      ],
      true,
    );
  });

  it('Icelandic schedule questions go to the chat, with and without an Icelandic keyboard', () => {
    expectToTheChat(
      [
        'spinning tímar á morgun',
        'yoga í kvöld',
        'crossfit kl. 17',
        'crossfit kl 17:30',
        'pilates á laugardaginn',
        'hóptímar í gym',
        'spinning í fyrramálið',
        'yoga tími á föstudag',
        'gym klukkan sex',
        'spinning 17.30',
        'Hvaða spinning tímar eru í dag?',
        'pilates á fimmtudegi',
        'yoga annað kvöld',
        'yoga stundaskrá',
        'yoga a morgun',
        'spinning i kvold',
        'crossfit a laugardaginn',
        'gym timar i dag',
        'pilates a thridjudaginn',
        'Hvenær er spinning?',
        'hvenaer er yoga',
      ],
      true,
    );
  });

  it('schedule questions without a venue type stay with the chat (the owner’s own examples)', () => {
    expectToTheChat(
      [
        'I want to work out today at 9, what are the options near me?',
        'this is the schedule for today',
        'Are there any classes in Akureyri?',
        'Hvaða tímar eru á morgun?',
        'World Class classes today',
      ],
      false,
    );
  });

  it('a weekend, a part of the day, a course, a lesson or a session asks about classes too', () => {
    expectToTheChat(
      [
        'spinning this weekend',
        'yoga um helgina',
        'spinning in the morning',
        'a workout after work',
        'yoga eftir vinnu',
        'yoga at noon',
        'crossfit at lunch',
        'spinning í hádeginu',
        'yoga námskeið',
        'yoga namskeid',
        'pilates course',
        'yoga sessions near me',
        'swimming lessons for kids',
      ],
      true,
    );
  });
});

describe('to the venue wizard', () => {
  it('English venue searches keep the wizard', () => {
    expectTheWizard([
      ['find me a gym', 'gym'],
      ['gym near me', 'gym'],
      ['pool near me', 'swimming'],
      ['sauna', 'spa'],
      ['a quiet yoga studio', 'yoga'],
      ['hot yoga in Reykjavík', 'yoga'],
      ['a crossfit box in Kópavogur', 'gym'],
      ['swimming pool with a slide', 'swimming'],
      ['a gym open 24/7', 'gym'],
      ['a pool with a 50 m lane', 'swimming'],
      ['a gym within 5 km', 'gym'],
      ['pilates studio for beginners', 'yoga'],
      ['World Class gym near me', 'gym'],
      ['a pool at Laugardalur', 'swimming'],
      ['a gym at 101 Reykjavík', 'gym'],
      ['back to the gym after 3 months off', 'gym'],
      ['a 1.25 km swim in a pool', 'swimming'],
      ['a spa for 2 people', 'spa'],
      ['geothermal lagoon', 'lagoon'],
      ['golf course near Selfoss', 'golf'],
      ['9 amazing gyms', 'gym'],
      ['yoga studio near me', 'yoga'],
      ['gym in Akureyri', 'gym'],
      ['a gym I can go to 3 times a week', 'gym'],
    ]);
  });

  it('Icelandic venue searches keep the wizard', () => {
    expectTheWizard([
      ['gym nálægt mér', 'gym'],
      ['crossfit í Kópavogi', 'gym'],
      ['pool í Laugardal', 'swimming'],
      ['gym í Laugardalnum', 'gym'],
      ['sauna í Hafnarfirði', 'spa'],
      ['yoga fyrir byrjendur', 'yoga'],
      ['spinning stöð í Reykjavík', 'gym'],
      ['gym nalaegt mer', 'gym'],
    ]);
  });

  it('words that look like a class or a clock but are not one keep the wizard (no Coach message spent)', () => {
    expectTheWizard([
      ['a world-class spa', 'spa'],
      ['first class gym', 'gym'],
      ['a high-class spa', 'spa'],
      ['top-class yoga studio', 'yoga'],
      ['a classic sauna', 'spa'],
      ['yoga timing', 'yoga'],
      ['of course, a gym near me', 'gym'],
      ['a sauna session in Reykjavík', 'spa'],
      ['gym at 100 metres from Hlemmur', 'gym'],
      ['a 25m pool', 'swimming'],
      ['a pool with 10.50 m lanes', 'swimming'],
      ['a pool at 10.50 m deep', 'swimming'],
      ['gym at 10 locations', 'gym'],
      ['gym sem er opinn allan tímann', 'gym'],
      ['hvað tekur langan tíma að komast í gym', 'gym'],
    ]);
    // Named no venue type before, so it went to the chat; it still does.
    expect(hasScheduleCue('where can I swim')).toBe(false);
    expect(venueWizardCategory('where can I swim')).toBeNull();
  });

  it('nothing typed has no cue', () => {
    expect(hasScheduleCue('')).toBe(false);
    expect(hasScheduleCue('   ')).toBe(false);
    expect(venueWizardCategory('')).toBeNull();
  });

  it('the plan wizard still reads the venue type from a day request with a time in it', () => {
    expect(planIntentAnswers('plan my day tomorrow with a yoga class')?.searchCategory).toBe('yoga');
    expect(detectVenueCategory('plan my day tomorrow with a yoga class')).toBe('yoga');
  });
});

describe('Android only: the clock patterns', () => {
  // The iOS patterns use a lookbehind and ICU's Unicode word boundary; the
  // port spells both out. These pin the edges of each pattern.
  it.each([
    ['yoga 5:30', true],
    ['yoga 117:30', false],
    ['yoga 24:00', false],
    ['spinning 05.45', true],
    ['spinning 2.50', false],
    ['gym 7.30pm', true],
    ['gym 7 p.m.', true],
    ['spinning at 23', true],
    ['spinning at 24', false],
    ['pool at 25m', false],
    ['spa at 5 %', false],
    ['gym at 9 kr', false],
  ])('%s has a schedule cue: %s', (text, cue) => {
    expect(hasScheduleCue(text)).toBe(cue);
  });

  it('an Icelandic letter right after "mma" is part of the word, as iOS reads it', () => {
    // ICU sees no word boundary between "mma" and "æ"; JavaScript's ASCII \b would.
    expect(detectVenueCategory('mmaæfing')).toBeNull();
    expect(detectVenueCategory('mma æfing')).toBe('gym');
  });
});
