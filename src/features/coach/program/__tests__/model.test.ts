/**
 * The programme wizard's answers: what it asks next, what it refuses on the
 * phone, and when a build is a retry rather than a new plan. A port of iOS
 * `ProgramAnswersTests` (its programme cases; the nutrition-goal body cases
 * belong to the body sheet), plus the multi-select's rules and the summary.
 *
 * The key rule is the one with money in it. `POST /coach` with a `program`
 * body spends one of the member's ten daily Coach questions, and the server
 * answers a reused Idempotency-Key with the plan it already built. So reusing
 * the key after an EDIT would show the member the plan they just edited, and
 * minting a new one after no edit would spend a second question on a retry.
 * The rule is exactly: any answer that CHANGED clears the key.
 */
import type { BodyDetails } from '../../../body/sheets';
import { lookup } from '../../../../i18n';
import { kindsForUsage } from '../context';
import {
  changeFlow,
  defaultTrainingDays,
  EMPTY_ANSWERS,
  keyForBuild,
  newFlow,
  nextQuestion,
  isComplete,
  questionAnalyticsField,
  questionStepNumber,
  recordAnswer,
  recordBody,
  recordInjuries,
  recordKinds,
  recordSafety,
  recordTrainingDays,
  requestBody,
  safetyFrom,
  type ProgramAnswers,
  type SafetyOption,
} from '../model';
import { toggleSelection, type ProgramMultiSelect } from '../multiSelect';
import { careLine, summaryRows } from '../summaryRows';

// expo-font (behind @expo/vector-icons, which the feedback door loads) imports
// expo-asset, which npm left nested under expo/ where Jest cannot see it.
jest.mock('expo-asset', () => jest.requireActual('expo/node_modules/expo-asset'), { virtual: true });

function must<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error('expected a value');
  return value;
}

function safety(answers: ProgramAnswers, options: SafetyOption[]): ProgramAnswers {
  const result = recordSafety(answers, new Set(options));
  return must(result.answers);
}

/** iOS `completeAnswers()`. */
function completeAnswers(): ProgramAnswers {
  let answers = EMPTY_ANSWERS;
  answers = must(recordAnswer(answers, 'build_muscle', 'goal'));
  answers = must(recordAnswer(answers, 'full', 'focus'));
  answers = must(recordAnswer(answers, '3', 'days'));
  answers = must(recordAnswer(answers, 'some', 'experience'));
  answers = safety(answers, ['nothing']);
  answers = recordBody(answers, null);
  answers = must(recordTrainingDays(answers, [1, 3, 5]));
  return { ...answers, kinds: ['gym', 'classes', 'pool', 'outdoors'] };
}

function body(overrides: Partial<BodyDetails> = {}): BodyDetails {
  return {
    weightKg: 80,
    heightCm: 170,
    ageBand: null,
    sex: null,
    activity: 'light',
    targetWeightKg: null,
    targetWeightTouched: false,
    ...overrides,
  };
}

/** The body as it travels: `JSON.stringify` is what the API client sends. */
function json(answers: ProgramAnswers, previous: string | null = null, includeTarget = true): Record<string, unknown> {
  return JSON.parse(JSON.stringify(must(requestBody(answers, previous, includeTarget)))) as Record<string, unknown>;
}

describe('the order of the questions', () => {
  it('asks in order and skips what is answered', () => {
    let answers = EMPTY_ANSWERS;
    expect(nextQuestion(answers)).toBe('goal');
    answers = must(recordAnswer(answers, 'build_muscle', 'goal'));
    expect(nextQuestion(answers)).toBe('focus');
    answers = must(recordAnswer(answers, 'full', 'focus'));
    expect(nextQuestion(answers)).toBe('days');
    answers = must(recordAnswer(answers, '3', 'days'));
    expect(nextQuestion(answers)).toBe('experience');
    answers = must(recordAnswer(answers, 'some', 'experience'));
    expect(nextQuestion(answers)).toBe('safety');
    answers = safety(answers, ['nothing']);
    // No injury, so 5b is not asked.
    expect(nextQuestion(answers)).toBe('body');
    answers = recordBody(answers, null);
    expect(nextQuestion(answers)).toBe('trainingDays');
    answers = must(recordTrainingDays(answers, [1, 3, 5]));
    expect(nextQuestion(answers)).toBeNull();
    expect(isComplete(answers)).toBe(true);
  });

  it('asks where an injury is once it is ticked', () => {
    let answers: ProgramAnswers = { ...completeAnswers(), injuries: [], injuriesAnswered: false };
    answers = safety(answers, ['injury']);
    expect(nextQuestion(answers)).toBe('injuryWhere');
    answers = must(recordInjuries(answers, ['knee']));
    expect(nextQuestion(answers)).toBeNull();
  });

  it('drops a day picking made for another number of days', () => {
    const answers = completeAnswers();
    expect(answers.trainingDays).toEqual([1, 3, 5]);
    const changed = must(recordAnswer(answers, '4', 'days'));
    expect(changed.trainingDays).toEqual([]);
    expect(nextQuestion(changed)).toBe('trainingDays');
  });

  it('keeps the picking when the same number is chosen again', () => {
    const changed = must(recordAnswer(completeAnswers(), '3', 'days'));
    expect(changed.trainingDays).toEqual([1, 3, 5]);
    expect(changed.trainingDaysAnswered).toBe(true);
  });

  it('takes training days only when they match the number of days', () => {
    const answers = completeAnswers();
    expect(recordTrainingDays(answers, [1, 3])).toBeNull();
    expect(recordTrainingDays(answers, [1, 3, 5, 6])).toBeNull();
    expect(recordTrainingDays(answers, [6, 2, 4])?.trainingDays).toEqual([2, 4, 6]);
    expect(recordTrainingDays(answers, [0, 3, 5])).toBeNull();
    expect(recordTrainingDays(answers, [1, 3, 8])).toBeNull();
  });

  it('refuses a value that does not belong to the question and leaves the answers alone', () => {
    const answers = completeAnswers();
    expect(recordAnswer(answers, 'nonsense', 'goal')).toBeNull();
    expect(recordAnswer(answers, '6', 'days')).toBeNull();
    expect(recordAnswer(answers, ' 3', 'days')).toBeNull();
    expect(recordAnswer(answers, '5', 'length')).toBeNull();
    expect(recordAnswer(answers, 'knee', 'safety')).toBeNull();
    expect(recordAnswer(answers, '8', 'length')?.weeks).toBe(8);
  });

  it('numbers the steps and names the fields as analytics may say them', () => {
    expect(questionStepNumber('goal')).toBe(1);
    expect(questionStepNumber('injuryWhere')).toBe(5);
    expect(questionStepNumber('trainingDays')).toBe(7);
    expect(questionStepNumber('kinds')).toBeNull();
    expect(questionStepNumber('length')).toBeNull();
    expect(questionAnalyticsField('injuryWhere')).toBe('safety');
    expect(questionAnalyticsField('kinds')).toBe('where');
    expect(questionAnalyticsField('trainingDays')).toBe('training_days');
  });
});

describe('the two refusals that never leave the phone', () => {
  it('refuses an injury plus an eating disorder locally and stores nothing', () => {
    const answers: ProgramAnswers = { ...completeAnswers(), safetyAnswered: false };
    const result = recordSafety(answers, new Set<SafetyOption>(['injury', 'eating']));
    expect(result.refusal).toBe('eating');
    expect(result.answers).toBeNull();
    // Nothing about the answer was recorded on the answers the flow holds.
    expect(answers.safetyAnswered).toBe(false);
    expect(answers.safety.eatingDisorderHistory).toBe(false);
    expect(answers.safety.injury).toBe(false);
  });

  it('answers pregnancy first: it is the one with a date on it', () => {
    const answers: ProgramAnswers = { ...completeAnswers(), safetyAnswered: false };
    const result = recordSafety(answers, new Set<SafetyOption>(['pregnant', 'condition']));
    expect(result.refusal).toBe('pregnant');
    expect(answers.safety.conditionOrMedication).toBe(false);
    expect(answers.safety.pregnantOrBreastfeeding).toBe(false);
    expect(recordSafety(answers, new Set<SafetyOption>(['pregnant', 'eating'])).refusal).toBe('pregnant');
  });

  /** The schema HAS fields for both answers; this asserts the app never fills them. */
  it('sends neither refusing answer in the request body', () => {
    let answers: ProgramAnswers = { ...completeAnswers(), safetyAnswered: false };
    answers = safety(answers, ['condition', 'injury']);
    answers = must(recordInjuries(answers, ['knee', 'back']));
    const built = must(requestBody(answers, null));
    expect(built.safety.conditionOrMedication).toBe(true);
    expect(built.safety.injuries).toEqual(['back', 'knee']);
    const text = JSON.stringify(built);
    expect(text).not.toContain('pregnant');
    expect(text).not.toContain('eatingDisorder');
    expect(Object.keys(built.safety).sort()).toEqual(['conditionOrMedication', 'injuries']);
  });

  it('sends three body parts and refuses a fourth', () => {
    const answers = must(recordInjuries(completeAnswers(), ['knee', 'back', 'shoulder']));
    expect(answers.injuries).toHaveLength(3);
    expect(recordInjuries(answers, ['knee', 'back', 'shoulder', 'neck'])).toBeNull();
  });

  it('clears the injury parts when the injury is unticked', () => {
    let answers = safety({ ...completeAnswers(), safetyAnswered: false }, ['injury']);
    answers = must(recordInjuries(answers, ['knee']));
    answers = safety(answers, ['condition']);
    expect(answers.injuries).toEqual([]);
    expect(answers.injuriesAnswered).toBe(false);
  });

  it('reads Nothing alone as Nothing, and an empty pick as Nothing', () => {
    expect(safetyFrom(new Set<SafetyOption>(['nothing'])).nothing).toBe(true);
    expect(safetyFrom(new Set<SafetyOption>()).nothing).toBe(true);
    const mixed = safetyFrom(new Set<SafetyOption>(['nothing', 'injury']));
    expect(mixed.nothing).toBe(false);
    expect(mixed.injury).toBe(true);
  });
});

describe('the multi-select', () => {
  const parts: ProgramMultiSelect = {
    question: 'injuryWhere',
    text: '',
    noteKey: null,
    options: ['shoulder', 'back', 'knee', 'hip', 'wrist', 'ankle', 'neck'].map((value) => ({ value, labelKey: value })),
    maxSelection: 3,
    selection: [],
    closed: false,
    showsMaxHint: false,
  };

  it('refuses a fourth pick and asks the bubble to say why', () => {
    let state = parts;
    for (const value of ['knee', 'back', 'shoulder']) {
      const result = toggleSelection(state, value);
      expect(result.accepted).toBe(true);
      state = result.state;
    }
    const fourth = toggleSelection(state, 'neck');
    expect(fourth.accepted).toBe(false);
    expect(fourth.state.selection).toHaveLength(3);
    // Untick one, and the fourth fits.
    state = toggleSelection(state, 'back').state;
    expect(toggleSelection(state, 'neck').state.selection).toEqual(['knee', 'shoulder', 'neck']);
  });

  it('keeps Nothing exclusive both ways', () => {
    let state: ProgramMultiSelect = {
      ...parts,
      question: 'safety',
      maxSelection: null,
      options: [
        { value: 'nothing', labelKey: '', isExclusive: true },
        { value: 'injury', labelKey: '' },
        { value: 'condition', labelKey: '' },
      ],
    };
    state = toggleSelection(state, 'injury').state;
    state = toggleSelection(state, 'condition').state;
    expect([...state.selection].sort()).toEqual(['condition', 'injury']);
    state = toggleSelection(state, 'nothing').state;
    expect(state.selection).toEqual(['nothing']);
    state = toggleSelection(state, 'injury').state;
    expect(state.selection).toEqual(['injury']);
  });

  it('takes nothing once it is closed', () => {
    const closed = { ...parts, closed: true };
    const result = toggleSelection(closed, 'knee');
    expect(result.accepted).toBe(true);
    expect(result.state.selection).toEqual([]);
  });
});

describe('the Idempotency-Key rule', () => {
  it('reuses the key for Try again with no edits', () => {
    const first = keyForBuild(newFlow('chip', completeAnswers()));
    expect(keyForBuild(first.flow).key).toBe(first.key);
  });

  it('mints a new key after an edited answer', () => {
    const first = keyForBuild(newFlow('chip', completeAnswers()));
    const edited = must(changeFlow(first.flow, (answers) => recordAnswer(answers, 'get_fitter', 'goal')));
    expect(edited.idempotencyKey).toBeNull();
    expect(keyForBuild(edited).key).not.toBe(first.key);
  });

  it('keeps the key when the same answer is recorded again', () => {
    const first = keyForBuild(newFlow('chip', completeAnswers()));
    const same = must(changeFlow(first.flow, (answers) => recordAnswer(answers, 'build_muscle', 'goal')));
    expect(same.idempotencyKey).toBe(first.key);
  });

  it('leaves the answers and the key alone when a change is refused', () => {
    const first = keyForBuild(newFlow('chip', completeAnswers()));
    expect(changeFlow(first.flow, (answers) => recordAnswer(answers, 'nonsense', 'goal'))).toBeNull();
    expect(first.flow.idempotencyKey).toBe(first.key);
  });

  it('mints a key the server accepts', () => {
    expect(keyForBuild(newFlow('chip')).key).toMatch(/^[A-Za-z0-9_.:-]{8,128}$/);
  });
});

describe('defaults and the body', () => {
  it('mirrors the contract default training days', () => {
    expect(defaultTrainingDays(2)).toEqual([1, 4]);
    expect(defaultTrainingDays(3)).toEqual([1, 3, 5]);
    expect(defaultTrainingDays(4)).toEqual([1, 2, 4, 6]);
    expect(defaultTrainingDays(5)).toEqual([1, 2, 3, 4, 5]);
  });

  it('carries a body sheet answer into the request', () => {
    const answers = recordBody(
      completeAnswers(),
      body({ weightKg: 72.5, heightCm: 174, ageBand: '35_44', sex: 'female', activity: 'light' }),
    );
    expect(json(answers).body).toEqual({ weightKg: 72.5, heightCm: 174, ageBand: '35_44', sex: 'female', activity: 'light' });
  });

  it('leaves an age band and a sex that were not given out of the body', () => {
    const answers = recordBody(completeAnswers(), body());
    expect(json(answers).body).toEqual({ weightKg: 80, heightCm: 170, activity: 'light' });
  });

  it('builds no request from an incomplete answer set', () => {
    expect(requestBody(must(recordAnswer(EMPTY_ANSWERS, 'lose_weight', 'goal')), null)).toBeNull();
  });

  it('sends the default days when none were picked, every place when none were set, and the previous block', () => {
    const answers: ProgramAnswers = { ...completeAnswers(), trainingDays: [], kinds: [] };
    const sent = json(answers, '6f9c1f9e-3c51-4a76-9c5b-1d0f1a6b9e20');
    expect(sent.trainingDays).toEqual([1, 3, 5]);
    expect(sent.kinds).toEqual(['gym', 'classes', 'pool', 'outdoors']);
    expect(sent.previousProgramId).toBe('6f9c1f9e-3c51-4a76-9c5b-1d0f1a6b9e20');
    expect(sent.weeks).toBe(4);
  });
});

describe('the target weight (SPEC 2.5, 6.2)', () => {
  const loseAnswers = (details: BodyDetails | null) =>
    recordBody(must(recordAnswer(completeAnswers(), 'lose_weight', 'goal')), details);

  it('leaves an untouched target out: a 2.4.0-shaped body, key for key', () => {
    const sent = json(loseAnswers(body({ sex: 'female', targetWeightKg: 72, targetWeightTouched: false })));
    expect('targetWeightKg' in sent).toBe(false);
    expect(Object.keys(sent).sort()).toEqual(
      ['goal', 'focus', 'daysPerWeek', 'weeks', 'kinds', 'experience', 'safety', 'body', 'trainingDays'].sort(),
    );
  });

  it('sends a touched target as a number, rounded to one decimal', () => {
    expect(json(loseAnswers(body({ targetWeightKg: 72.46, targetWeightTouched: true }))).targetWeightKg).toBe(72.5);
  });

  it('sends a cleared prefill as null, not absent', () => {
    const text = JSON.stringify(must(requestBody(loseAnswers(body({ targetWeightKg: null, targetWeightTouched: true })), null)));
    expect(text).toContain('"targetWeightKg":null');
  });

  it('sends no target to a server without the feature', () => {
    const sent = json(loseAnswers(body({ targetWeightKg: 72, targetWeightTouched: true })), null, false);
    expect('targetWeightKg' in sent).toBe(false);
  });

  it('drops the target when the goal changes to one without a target', () => {
    const answers = must(recordAnswer(loseAnswers(body({ targetWeightKg: 72, targetWeightTouched: true })), 'build_muscle', 'goal'));
    expect(answers.body?.targetWeightKg).toBeNull();
    expect(answers.body?.targetWeightTouched).toBe(false);
    expect(answers.body?.weightKg).toBe(80);
    expect('targetWeightKg' in json(answers)).toBe(false);
  });

  it('drops it from lose to gain, and keeps it from lose to lose', () => {
    let answers = loseAnswers(body({ targetWeightKg: 72, targetWeightTouched: true }));
    answers = must(recordAnswer(answers, 'lose_weight', 'goal'));
    expect(answers.body?.targetWeightKg).toBe(72);
    answers = must(recordAnswer(answers, 'gain_weight', 'goal'));
    expect(answers.body?.targetWeightKg).toBeNull();
  });
});

describe('the summary', () => {
  const t = (key: string, params?: Readonly<Record<string, string | number>>) => {
    let text = lookup(key, 'en');
    for (const [name, value] of Object.entries(params ?? {})) text = text.replace(`{${name}}`, String(value));
    return text;
  };

  it('lists every answer in the order asked, the days with their weekdays', () => {
    const rows = summaryRows(completeAnswers(), t, 'en');
    expect(rows.map((row) => row.question)).toEqual(['goal', 'focus', 'days', 'kinds', 'length', 'experience', 'body']);
    expect(rows.map((row) => row.value)).toEqual([
      'Build muscle',
      'Full body',
      t('program.summary.days', { count: '3', days: 'Mon, Wed, Fri' }),
      t('program.summary.where', { places: 'Gym, Classes, Pool, Outdoors' }),
      'Length: 4 weeks',
      'Some experience',
      'Without calorie targets',
    ]);
  });

  it('says a target was given, never which', () => {
    const withTarget = recordBody(
      must(recordAnswer(completeAnswers(), 'lose_weight', 'goal')),
      body({ targetWeightKg: 72, targetWeightTouched: true }),
    );
    const bodyRow = summaryRows(withTarget, t, 'en').find((row) => row.question === 'body');
    expect(bodyRow?.value).toBe(lookup('program.body.added_target', 'en'));
    expect(bodyRow?.value).not.toContain('72');
    const withoutTarget = recordBody(completeAnswers(), body());
    expect(summaryRows(withoutTarget, t, 'en').find((row) => row.question === 'body')?.value).toBe(
      lookup('program.summary.targets_yes', 'en'),
    );
  });

  it('shows what the plan is built around only when something was given', () => {
    expect(careLine(completeAnswers(), t)).toBeNull();
    let answers = safety({ ...completeAnswers(), safetyAnswered: false }, ['injury', 'condition']);
    answers = must(recordInjuries(answers, ['knee']));
    const rows = summaryRows(answers, t, 'en');
    expect(rows[rows.length - 1]).toEqual({
      question: 'safety',
      value: t('program.summary.care', { what: 'Knee, A health condition or medication' }),
    });
  });

  it('speaks Icelandic weekdays to an Icelandic member', () => {
    const isT = (key: string, params?: Readonly<Record<string, string | number>>) => {
      let text = lookup(key, 'is');
      for (const [name, value] of Object.entries(params ?? {})) text = text.replace(`{${name}}`, String(value));
      return text;
    };
    const days = summaryRows(completeAnswers(), isT, 'is').find((row) => row.question === 'days')?.value ?? '';
    expect(days).not.toContain('Mon');
  });
});

describe('the places the membership covers', () => {
  const lane = (cap: number) => ({ used: 0, cap, resetsAt: null });
  const usage = (network: number | null, pools: number | null) =>
    ({
      tier: 'base',
      network: network === null ? null : lane(network),
      pools: pools === null ? null : lane(pools),
      daily: null,
      concurrent: { open: 0, cap: null },
      topup: { available: false, prices: { gym: null, studio: null, pool: null } },
      passes: [],
      block: { until: null },
      strikes: { active: 0, threshold: 3 },
    }) as const;

  it('is everything without a usage block', () => {
    expect(kindsForUsage(null)).toEqual(['gym', 'classes', 'pool', 'outdoors']);
  });

  it('leaves out a lane whose cap is zero, and keeps one the block leaves out', () => {
    expect(kindsForUsage(usage(0, 8))).toEqual(['pool', 'outdoors']);
    expect(kindsForUsage(usage(12, 0))).toEqual(['gym', 'classes', 'outdoors']);
    expect(kindsForUsage(usage(null, null))).toEqual(['gym', 'classes', 'pool', 'outdoors']);
  });

  it('keeps the summary row in the canonical order', () => {
    expect(recordKinds(completeAnswers(), ['outdoors', 'gym'])?.kinds).toEqual(['gym', 'outdoors']);
    expect(recordKinds(completeAnswers(), [])).toBeNull();
  });
});
