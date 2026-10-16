// The words of the features whose copy F1 delivers (attraction.*, coach.*
// and program.*, the runner pack, the meals pack, logworkout.*, the class
// feed): every key in both languages, placeholders and plurals intact, and
// the lines iOS pins word for word. Ports the dictionary half of
// MealDescribeTests, CoachFreeTierTests.testNoFreeTierLineSaysTomorrow,
// PlanSectionTests.testEveryRunnerKeyExistsInBothLanguagesWithoutADashOrEmoji,
// LogWorkoutTests.testEveryLogWorkoutKeyIsInBothLanguages,
// ClassDistanceTests and ClassesNextMatchTests' copy checks, and the
// attractions copy checks from the parity analysis.
import { lookup, pluralKey, translatePlural } from '..';
import { app, hasDash, hasEmoji, healthPacks, LANGS, mergedHealth, placeholders } from './dictionaries';

const { en, is } = app;

const keysWithPrefix = (prefix: string, table: Readonly<Record<string, string>> = en) =>
  Object.keys(table).filter((key) => key.startsWith(prefix));

describe('attractions (attraction.*)', () => {
  it('has the same keys in both languages, none blank, no dash or emoji', () => {
    const english = keysWithPrefix('attraction.');
    expect(english.length).toBeGreaterThanOrEqual(76);
    expect(keysWithPrefix('attraction.', is).sort()).toEqual(english.sort());
    const problems: string[] = [];
    for (const key of english) {
      for (const lang of LANGS) {
        const value = app[lang][key]!;
        if (!value.trim()) problems.push(`${key} (${lang}) is blank`);
        if (hasDash(value) || hasEmoji(value)) problems.push(`${key} (${lang}): ${value}`);
      }
      if (placeholders(en[key]!).join() !== placeholders(is[key]!).join()) problems.push(`${key} placeholders differ`);
    }
    expect(problems).toEqual([]);
  });

  it('names every kind and region with the server’s labels, word for word', () => {
    const kinds: Record<string, [string, string]> = {
      waterfall: ['Waterfall', 'Foss'],
      hot_spring: ['Hot spring', 'Hver'],
      geyser: ['Geyser', 'Goshver'],
      hike: ['Hike', 'Gönguleið'],
      viewpoint: ['Viewpoint', 'Útsýnisstaður'],
      canyon: ['Canyon', 'Gljúfur'],
      glacier: ['Glacier', 'Jökull'],
      beach: ['Beach', 'Strönd'],
      cave: ['Cave', 'Hellir'],
      volcano: ['Volcano', 'Eldfjall'],
      lake: ['Lake', 'Vatn'],
      geothermal_area: ['Geothermal area', 'Jarðhitasvæði'],
      national_park: ['National park', 'Þjóðgarður'],
      nature_reserve: ['Nature reserve', 'Friðland'],
      mountain: ['Mountain', 'Fjall'],
      lighthouse: ['Lighthouse', 'Viti'],
      other: ['Sight', 'Áhugaverður staður'],
    };
    const regions: Record<string, [string, string]> = {
      capital: ['Capital Region', 'Höfuðborgarsvæðið'],
      reykjanes: ['Reykjanes', 'Reykjanes'],
      south: ['South Iceland', 'Suðurland'],
      west: ['West Iceland', 'Vesturland'],
      westfjords: ['Westfjords', 'Vestfirðir'],
      north: ['North Iceland', 'Norðurland'],
      east: ['East Iceland', 'Austurland'],
      highlands: ['The Highlands', 'Hálendið'],
    };
    expect(keysWithPrefix('attraction.kind.').sort()).toEqual(Object.keys(kinds).map((k) => `attraction.kind.${k}`).sort());
    expect(keysWithPrefix('attraction.region.').sort()).toEqual(Object.keys(regions).map((k) => `attraction.region.${k}`).sort());
    for (const [kind, words] of Object.entries(kinds)) {
      expect([lookup(`attraction.kind.${kind}`, 'en'), lookup(`attraction.kind.${kind}`, 'is')]).toEqual(words);
    }
    for (const [region, words] of Object.entries(regions)) {
      expect([lookup(`attraction.region.${region}`, 'en'), lookup(`attraction.region.${region}`, 'is')]).toEqual(words);
    }
  });

  it('calls a top pick a top pick, never “Mælt með”', () => {
    expect(lookup('attraction.top_pick', 'en')).toBe('Top pick');
    expect(lookup('attraction.top_pick', 'is')).toBe('Hápunktur');
    expect(Object.entries(is).filter(([k, v]) => k.startsWith('attraction.') && v.includes('Mælt með'))).toEqual([]);
  });

  it('offers Android’s second maps choice where iOS offers Apple Maps', () => {
    expect([lookup('venue.maps_google', 'en'), lookup('venue.maps_other', 'en')]).toEqual([
      'Open in Google Maps',
      'Open in another maps app',
    ]);
    expect([lookup('venue.maps_google', 'is'), lookup('venue.maps_other', 'is')]).toEqual([
      'Opna í Google Maps',
      'Opna í öðru kortaforriti',
    ]);
  });

  it('keeps {duration}, {km} and {distance} in Icelandic', () => {
    for (const [key, wanted] of [
      ['attraction.drive_from_reykjavik', ['{duration}', '{km}']],
      ['attraction.nearest_road', ['{km}']],
      ['attraction.one_way', ['{distance}']],
      ['attraction.there_and_back', ['{duration}']],
    ] as const) {
      for (const placeholder of wanted) expect([key, lookup(key, 'is').includes(placeholder)]).toEqual([key, true]);
    }
  });
});

describe('Coach and programme copy (coach.*, program.*)', () => {
  it('has every key in both languages', () => {
    for (const prefix of ['coach.', 'program.']) {
      const english = keysWithPrefix(prefix);
      expect(english.length).toBeGreaterThan(100);
      expect(keysWithPrefix(prefix, is).sort()).toEqual(english.sort());
    }
  });

  it('picks .one and .many of the free messages line in both languages', () => {
    expect(translatePlural('coach.free.left', 1, 'en')).toBe(lookup('coach.free.left.one', 'en').replace('{count}', '1'));
    expect(translatePlural('coach.free.left', 2, 'en')).toBe('2 free messages left this month');
    expect(pluralKey('coach.free.left', 21, 'is')).toBe('coach.free.left.one');
    expect(lookup('coach.free.left.one', 'is')).toContain('{count}');
    expect(lookup(pluralKey('coach.free.left', 2, 'en'), 'en')).toBe('{count} free messages left this month');
  });

  it('never says tomorrow in a free tier line (testNoFreeTierLineSaysTomorrow)', () => {
    const keys = [
      'coach.free.left.one', 'coach.free.left.many', 'coach.free.limit.title',
      'coach.free.limit.body', 'coach.free.limit.next', 'coach.free.limit.cta',
      'coach.input.free_limit', 'coach.plan.free_limit_fallback', 'coach.busy',
    ];
    for (const lang of LANGS) {
      for (const key of keys) {
        const text = lookup(key, lang);
        expect([key, lang, text === key]).toEqual([key, lang, false]);
        expect([key, lang, text.toLowerCase().includes('tomorrow') || text.toLowerCase().includes('á morgun')]).toEqual([
          key,
          lang,
          false,
        ]);
      }
    }
  });

  it('greets with the health release’s words (the one intentional override)', () => {
    expect(mergedHealth('en')['coach.greeting']).toBe(en['coach.greeting']);
    expect(mergedHealth('is')['coach.greeting']).toBe(is['coach.greeting']);
  });
});

describe('the runner pack', () => {
  const runner = healthPacks.find((pack) => pack.name === 'runner')!;

  it('has every key in both languages without a dash or emoji (testEveryRunnerKeyExistsInBothLanguagesWithoutADashOrEmoji)', () => {
    expect(Object.keys(runner.is).sort()).toEqual(Object.keys(runner.en).sort());
    const problems: string[] = [];
    for (const lang of LANGS) {
      for (const [key, value] of Object.entries(runner[lang])) {
        if (hasDash(value) || hasEmoji(value)) problems.push(`${key} (${lang})`);
      }
    }
    // Icelandic 21 is singular, so every .one keeps {count}.
    for (const key of Object.keys(runner.en).filter((k) => k.endsWith('.one'))) {
      if (!runner.is[key]?.includes('{count}')) problems.push(`${key}: the Icelandic .one lost {count}`);
    }
    expect(problems).toEqual([]);
  });

  it('says 21 repetitions in the Icelandic singular', () => {
    expect(translatePlural('runner.dose.reps', 21, 'is')).toBe('21 endurtekning');
    expect(translatePlural('runner.dose.reps', 11, 'is')).toBe('11 endurtekningar');
    expect(translatePlural('runner.dose.reps', 1, 'en')).toBe('1 rep');
  });
});

describe('meals (MealDescribeTests copy)', () => {
  const DESCRIBE_KEYS = [
    'meal.describe.cta', 'meal.describe.open', 'meal.describe.title', 'meal.describe.placeholder', 'meal.describe.hint',
    'meal.describe.submit', 'meal.describe.estimating', 'meal.describe.ready',
    'meal.describe.remaining.one', 'meal.describe.remaining.many', 'meal.describe.consent.cta',
    'meal.describe.notice', 'meal.describe.err.personal', 'meal.describe.err.no_food',
    'meal.describe.err.limit', 'meal.describe.err.failed', 'meal.describe.err.paused',
    'meal.describe.err.short', 'meal.describe.err.long', 'meal.describe.search_instead',
    'meal.describe.banner', 'meal.describe.accuracy', 'meal.describe.check_amount_body', 'meal.item.about_ml',
    'diary.draft_row_text', 'diary.draft_row_text_dated', 'food.search.closest',
    'plan.nutrition.drafts_any.one', 'plan.nutrition.drafts_any.many', 'healthconsent.ai.describe',
  ];
  const english = mergedHealth('en');
  const icelandic = mergedHealth('is');

  it('has the describe copy in both languages, written in Icelandic (testTheDescribeCopyExistsInBothLanguages)', () => {
    const problems: string[] = [];
    for (const key of DESCRIBE_KEYS) {
      if (!english[key]) problems.push(`EN ${key}`);
      if (!icelandic[key]) problems.push(`IS ${key}`);
      if (english[key] === icelandic[key]) problems.push(`${key} is copied, not written in Icelandic`);
    }
    expect(problems).toEqual([]);
  });

  it('never says plan in the Icelandic describe copy (testTheIcelandicDescribeCopyNeverSaysPlan)', () => {
    for (const key of DESCRIBE_KEYS) {
      const value = (icelandic[key] ?? '').toLowerCase();
      expect([key, value.includes('áætl') || value.includes('aætl')]).toEqual([key, false]);
    }
    expect((icelandic['meal.describe.banner'] ?? '').toLowerCase()).toContain('lýsing');
    expect(icelandic['diary.draft_row_text']).toContain('Mat');
  });

  it('says what the website’s describe panel says (testTheDescribeCopyIsTheWebsites)', () => {
    const pairs: [string, string, string][] = [
      ['meal.describe.cta', 'Describe it instead', 'Lýstu því frekar'],
      ['meal.describe.open', 'Describe a meal', 'Lýsa máltíð'],
      ['meal.describe.title', 'Describe what you ate', 'Lýstu því sem þú borðaðir'],
      ['meal.describe.placeholder', 'Focaccia sandwich with mozzarella and pesto', 'Flatkaka með hangikjöti'],
      ['meal.describe.hint', 'Describe only the food.', 'Lýstu aðeins matnum.'],
      ['meal.describe.submit', 'Estimate', 'Meta'],
      ['meal.describe.estimating', 'One moment', 'Augnablik'],
      ['meal.describe.consent.cta', 'Use AI estimate', 'Nota mat með gervigreind'],
      ['meal.describe.notice', 'Your description goes to Anthropic to make the estimate.', 'Lýsingin fer til Anthropic til að gera matið.'],
      [
        'meal.describe.err.personal',
        'Leave out emails, links, phone numbers, kennitala, weight and height.',
        'Slepptu netföngum, tenglum, símanúmerum, kennitölu, þyngd og hæð.',
      ],
      ['meal.describe.err.no_food', "We couldn't find any food in that.", 'Við fundum engan mat í þessu.'],
      ['meal.describe.err.limit', "You've used today's descriptions. Search instead.", 'Þú hefur notað lýsingar dagsins. Leitaðu frekar.'],
      ['meal.describe.err.failed', "We couldn't estimate that. Try search.", 'Við gátum ekki metið þetta. Prófaðu leit.'],
      [
        'meal.describe.err.paused',
        'Estimates from descriptions are paused for now. Search instead.',
        'Mat út frá lýsingu er í hléi í bili. Leitaðu frekar.',
      ],
      ['meal.describe.err.short', 'Write a little more.', 'Skrifaðu aðeins meira.'],
      ['meal.describe.err.long', 'Up to {max} characters.', 'Mest {max} stafir.'],
      ['meal.describe.search_instead', 'Search instead', 'Leita frekar'],
    ];
    for (const [key, englishWords, icelandicWords] of pairs) {
      expect([key, lookup(key, 'en'), lookup(key, 'is')]).toEqual([key, englishWords, icelandicWords]);
    }
  });

  it('keeps {count} in the Icelandic singular (testTheIcelandicPluralsKeepTheirCount)', () => {
    expect(icelandic['meal.describe.remaining.one']).toContain('{count}');
    expect(icelandic['plan.nutrition.drafts_any.one']).toContain('{count}');
  });

  it('says what the privacy notice says (testTheConsentLineIsThePlansText)', () => {
    expect(lookup('healthconsent.ai.describe', 'en')).toBe(
      "A meal you describe goes to Anthropic only to make the estimate. We don't keep your words, only the foods you save.",
    );
    expect(lookup('healthconsent.ai.describe', 'is')).toBe(
      'Máltíð sem þú lýsir fer til Anthropic eingöngu til að gera matið. Við geymum ekki orðin þín, aðeins matvælin sem þú vistar.',
    );
  });

  it('has the whole meals pack in both languages without a dash or emoji', () => {
    const meals = healthPacks.find((pack) => pack.name === 'meals')!;
    expect(Object.keys(meals.en).length).toBe(245);
    expect(Object.keys(meals.is).sort()).toEqual(Object.keys(meals.en).sort());
  });
});

describe('log a workout (LogWorkoutTests)', () => {
  it('has every logworkout key in both languages (testEveryLogWorkoutKeyIsInBothLanguages)', () => {
    const english = keysWithPrefix('logworkout.');
    expect(english.length).toBeGreaterThan(0);
    expect(keysWithPrefix('logworkout.', is).sort()).toEqual(english.sort());
    for (let weekday = 1; weekday <= 7; weekday += 1) expect(is[`logworkout.weekday_gen.${weekday}`]).toBeDefined();
    // Every ExtraWorkoutKind but .unknown has a label, the kinds that are not
    // chips (walk, mobility: a watch workout can be either) included.
    const kinds = ['strength', 'cardio', 'walk', 'hike', 'swim', 'mobility', 'class', 'other'];
    for (const kind of kinds) {
      const key = `logworkout.kind.${kind}`;
      expect([key, en[key] !== undefined, is[key] !== undefined]).toEqual([key, true, true]);
    }
  });

  it('labels the six chips of the plan (testTheChipsAreTheSixOfThePlan)', () => {
    const chips = ['strength', 'class', 'swim', 'cardio', 'hike', 'other'].map((kind) => `logworkout.kind.${kind}`);
    expect(chips.map((key) => lookup(key, 'en'))).toEqual(['Gym', 'Class', 'Swim', 'Run or walk', 'Outdoors', 'Other']);
    expect(chips.map((key) => lookup(key, 'is'))).toEqual(['Ræktin', 'Hóptími', 'Sund', 'Hlaup eða ganga', 'Útivist', 'Annað']);
  });
});

describe('the class feed (ClassDistanceTests, ClassesNextMatchTests)', () => {
  it('says what the card’s distance is (testTheCardDistanceHasASpokenLabelInBothLanguages)', () => {
    expect(lookup('classes.distance_a11y', 'en')).toBe('{distance} away');
    expect(lookup('classes.distance_a11y', 'is')).toBe('í {distance} fjarlægð');
  });

  it('no longer promises distances in the fallback note (testTheFallbackNoteNoLongerPromisesDistances)', () => {
    const english = lookup('classes.location_fallback', 'en');
    const icelandic = lookup('classes.location_fallback', 'is');
    expect(english).toContain('Near me');
    expect(icelandic).toContain('Nálægt mér');
    expect(english.toLowerCase()).not.toContain('distances');
    expect(icelandic).not.toContain('fjarlægðir');
    expect(hasDash(english) || hasDash(icelandic)).toBe(false);
  });

  it('has every next-class hint in both languages without dashes (testEveryHintStringExistsInBothLanguagesWithoutDashes)', () => {
    const keys = keysWithPrefix('classes.next_');
    expect(keys).toHaveLength(24);
    for (const key of keys) {
      expect([key, is[key] !== undefined]).toEqual([key, true]);
      expect([key, (is[key] ?? '').length > 0]).toEqual([key, true]);
      expect([key, hasDash(en[key]!) || hasDash(is[key]!)]).toEqual([key, false]);
    }
    // Every featured chip (ClassesViewModel.featuredCategories) has a noun in both languages.
    for (const slug of ['yoga', 'pilates', 'hiit', 'strength', 'boxing', 'cycling', 'swimming', 'dance']) {
      const key = `classes.next_what_${slug}`;
      expect([key, en[key] !== undefined, is[key] !== undefined]).toEqual([key, true, true]);
    }
  });
});

describe('monthly feedback notifications (FeedbackNotificationPlannerTests)', () => {
  it('carry no digit and no health detail in either language', () => {
    for (const lang of LANGS) {
      for (const key of ['notif.feedback.monthly.title', 'notif.feedback.monthly.body', 'notif.feedback.note.title', 'notif.feedback.note.body']) {
        const text = lookup(key, lang);
        expect([key, lang, text !== key, /\p{Nd}/u.test(text)]).toEqual([key, lang, true, false]);
        for (const word of ['sleep', 'weight', 'kcal', 'svefn', 'þyngd', 'hitaeining']) {
          expect([key, lang, word, text.toLowerCase().includes(word)]).toEqual([key, lang, word, false]);
        }
      }
    }
  });
});
