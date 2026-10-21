/**
 * The describe sheet's rules, apart from the sheet: iOS MealDescribeTests
 * `testNearTheCapTheWordsSentAreTheWordsTheServerTakes`, the model half of
 * `testTheFieldIsCappedByTheServersCountBetweenWholeCharacters`,
 * `testEveryProblemCodeHasItsAnswer`, `testNoFoodIsItsOwnLineAndKeepsTheCount`,
 * `testASpentAllowanceOrAPauseStopsEstimateWhateverTheWords`,
 * `testAnInvalidDescriptionSaysWhatIsWrongWithTheWords`,
 * `testEveryFailureButOfflineOffersSearch`, the three key tests, the three
 * consent tests, `testDescribeIsOffUntilTheServerAdvertisesIt` and
 * `testDescribeAnalyticsCarryNoWords`. (The request itself, the answer's
 * decoding, the drafts lists and the copy are MEAL-1's and F1's tests.)
 */
import { HttpStatusError, ProblemError, TransportError, type ApiError } from '../../../../api';
import { HealthConsentVersion, type ConsentResult } from '../../../../health';
import { lookup } from '../../../../i18n';
import { addServerDays, todayServerDay } from '../../../../i18n/format';
import { isForbidden } from '../../../../lib/analytics';
import { resetAppStoreForTests, selectSupportsMealDescribe, selectSupportsTargetWeight, useAppStore } from '../../../../stores/appStore';
import { fakeMealApi } from '../../api/testing';
import { decodeMealRecord, type MealDescribeBody, type MealDescribeResult, type MealRecord } from '../../types';
import { isDescribeOffered } from '../availability';
import {
  describeFailureAnalyticsOutcome,
  describeFailureCopyKey,
  describeFailureCopyParams,
  describeFailureFor,
  describeFailureOffersSearch,
  MEAL_DESCRIBE_FAILURES,
  MealDescribeModel,
  type DescribeConsentGrant,
  type MealDescribeFailure,
  type MealDescribeOutcome,
} from '../describeModel';
import { capDescribeText, cleanDescribeText, describeLength } from '../describeText';

/** iOS MealDescribeTests' `mealJSON`. */
const mealJSON = {
  id: 'meal-text-1',
  logDate: '2026-10-16',
  loggedAt: '2026-10-16T12:40:00.000Z',
  slot: 'lunch',
  source: 'text',
  confirmed: false,
  confidence: 'low',
  needsConfirm: true,
  hasEstimate: true,
  items: [
    {
      id: 'item-1',
      source: 'lifepass_estimate',
      basis: 'estimate',
      label: 'Focaccia sandwich with mozzarella and pesto',
      foodId: 'focaccia-sandwich-mozzarella-pesto',
      serving: { unit: 'g' },
      amount: 175,
      servingOptions: [{ unit: 'g' }],
      per100g: { kcal: 240, proteinG: 9.8, carbsG: 20.6, fatG: 11.8 },
      estimate: { grams: 175, kcalLow: 294, kcalHigh: 546, proteinG: 17.2, carbsG: 36.1, fatG: 20.7 },
      edited: [],
      confidence: 'high',
      confirmed: true,
      liquid: false,
    },
  ],
  totals: { kcalLow: 294, kcalHigh: 546, proteinG: 17.2, carbsG: 36.1, fatG: 20.7, mealCount: 1 },
  createdAt: '2026-10-16T12:40:00.000Z',
  updatedAt: '2026-10-16T12:40:00.123Z',
};

const draft: MealRecord = decodeMealRecord(mealJSON, 'meal');

function problem(status: number, slug: string): ProblemError {
  return new ProblemError({ type: `https://lifepass.is/problems/${slug}`, title: slug, status }, status);
}

function result(meal: MealRecord | null, describesLeftToday: number | null, noFood = false): MealDescribeResult {
  return { meal, noFood, needsConfirm: meal !== null, describesLeftToday, replayed: false };
}

type Answer = { ok: MealDescribeResult } | { error: unknown };

/** iOS `DescribeStub`: answers `describe` from a list, in order, and records what was sent. */
function describeStub(answers: Answer[]) {
  const keys: string[] = [];
  const bodies: MealDescribeBody[] = [];
  const queue = [...answers];
  const api = fakeMealApi({
    describe: async (body, key) => {
      keys.push(key);
      bodies.push(body);
      const next = queue.shift();
      if (!next) throw new TransportError('network');
      if ('ok' in next) return next.ok;
      throw next.error;
    },
  });
  return { api, keys, bodies };
}

function minting(prefix = 'k') {
  let minted = 0;
  return () => {
    minted += 1;
    return `${prefix}${minted}`;
  };
}

const failed = (failure: MealDescribeFailure): MealDescribeOutcome => ({ kind: 'failed', failure });

describe('the cap, in the model (testTheFieldIsCappedByTheServersCountBetweenWholeCharacters)', () => {
  it('caps words handed to the sheet the same way', () => {
    const model = new MealDescribeModel('🇮🇸'.repeat(100), { api: describeStub([]).api });
    expect(describeLength(model.cleanedText)).toBe(280);
    expect(model.canEstimate).toBe(true);
  });

  it('caps words typed into the field', () => {
    const model = new MealDescribeModel('', { api: describeStub([]).api });
    model.text = 'a'.repeat(400);
    expect(model.text).toBe('a'.repeat(280));
  });
});

it('sends near the cap exactly the words the server takes (testNearTheCapTheWordsSentAreTheWordsTheServerTakes)', async () => {
  const stub = describeStub([{ error: problem(502, 'coach_upstream_error') }]);
  const model = new MealDescribeModel('pizza', { api: stub.api });
  model.text = capDescribeText('pizza  <with> ' + '🍕'.repeat(200));
  await model.estimate('dinner', '2026-10-16', 'en');
  const sent = stub.bodies[0]!.text;
  expect(sent.startsWith('pizza with 🍕')).toBe(true);
  expect(describeLength(sent)).toBeLessThanOrEqual(280);
  expect(describeLength(sent)).toBeGreaterThanOrEqual(279);
  expect(cleanDescribeText(sent)).toBe(sent); // already clean
});

it('sends the five fields of the strict body, the locale from the account language', async () => {
  const stub = describeStub([{ ok: result(draft, 14) }]);
  const now = new Date(Date.UTC(2026, 9, 16, 12, 40, 0));
  const model = new MealDescribeModel('  skyr  með bláberjum ', { api: stub.api, now: () => now });
  await model.estimate('breakfast', '2026-10-16', 'is');
  expect(stub.bodies[0]).toEqual({
    text: 'skyr með bláberjum',
    slot: 'breakfast',
    logDate: '2026-10-16',
    loggedAt: expect.any(Date),
    locale: 'is',
  });
  await model.estimate('breakfast', '2026-10-16', 'de');
  expect(stub.bodies[1]?.locale).toBe('en');
});

describe('problem codes (testEveryProblemCodeHasItsAnswer)', () => {
  const cases: [ApiError, MealDescribeOutcome][] = [
    [problem(409, 'meal_describe_consent_required'), { kind: 'needsConsent' }],
    [problem(422, 'meal_describe_personal_data'), failed('personal')],
    [problem(400, 'invalid-meal-describe'), failed('tooShort')],
    [problem(429, 'meal_describe_limit'), failed('limit')],
    [problem(503, 'meal_describe_paused'), failed('paused')],
    [problem(502, 'coach_upstream_error'), failed('failed')],
    [problem(500, 'internal_error'), failed('failed')],
    [problem(429, 'rate_limited'), failed('rateLimited')],
    [problem(404, 'not_found'), { kind: 'featureOff' }],
    [new HttpStatusError(404, '<html>'), { kind: 'featureOff' }],
    [new TransportError('offline'), failed('offline')],
    [new TransportError('timeout'), failed('failed')],
    [problem(409, 'health_consent_required'), { kind: 'refused', error: problem(409, 'health_consent_required') }],
    [problem(403, 'no_active_plan_or_pass'), { kind: 'refused', error: problem(403, 'no_active_plan_or_pass') }],
    [problem(403, 'health_minor_blocked'), { kind: 'refused', error: problem(403, 'health_minor_blocked') }],
    [problem(409, 'account_pending_deletion'), { kind: 'refused', error: problem(409, 'account_pending_deletion') }],
  ];

  it.each(cases)('%s', async (error, expected) => {
    const model = new MealDescribeModel('pasta', { api: describeStub([{ error }]).api });
    const outcome = await model.estimate('dinner', '2026-10-16', 'en');
    if (expected.kind === 'refused') {
      expect(outcome.kind).toBe('refused');
      expect(outcome.kind === 'refused' && outcome.error.code).toBe(expected.error.code);
    } else {
      expect(outcome).toEqual(expected);
    }
    switch (expected.kind) {
      case 'failed':
        expect(model.phase).toEqual({ kind: 'failed', failure: expected.failure });
        break;
      case 'needsConsent':
        expect(model.phase).toEqual({ kind: 'needsConsent' });
        break;
      default:
        expect(model.phase).toEqual({ kind: 'editing' });
    }
  });

  it('a cancellation says nothing and goes back to editing', async () => {
    const model = new MealDescribeModel('pasta', { api: describeStub([{ error: new TransportError('cancelled') }]).api });
    expect(await model.estimate('dinner', '2026-10-16', 'en')).toEqual(failed('other'));
    expect(model.phase).toEqual({ kind: 'editing' });
  });

  it('anything that is not an API error is the catch-all line', async () => {
    const model = new MealDescribeModel('pasta', { api: describeStub([{ error: new Error('boom') }]).api });
    expect(await model.estimate('dinner', '2026-10-16', 'en')).toEqual(failed('other'));
    expect(model.phase).toEqual({ kind: 'failed', failure: 'other' });
  });
});

it('gives no food its own line and keeps the count (testNoFoodIsItsOwnLineAndKeepsTheCount)', async () => {
  const model = new MealDescribeModel('a walk in the park', { api: describeStub([{ ok: result(null, 9, true) }]).api });
  expect(await model.estimate('snack', '2026-10-16', 'en')).toEqual(failed('noFood'));
  expect(model.describesLeft).toBe(9);
  expect(describeFailureCopyKey('noFood')).toBe('meal.describe.err.no_food');
});

it('stops Estimate whatever the words once the allowance is spent or paused (testASpentAllowanceOrAPauseStopsEstimateWhateverTheWords)', async () => {
  for (const [slug, status, failure] of [
    ['meal_describe_limit', 429, 'limit'],
    ['meal_describe_paused', 503, 'paused'],
  ] as const) {
    const stub = describeStub([{ error: problem(status, slug) }]);
    const model = new MealDescribeModel('pasta', { api: stub.api });
    await model.estimate('dinner', '2026-10-16', 'en');
    expect(model.phase).toEqual({ kind: 'failed', failure });
    expect(model.canEstimate).toBe(false);
    model.text = 'pasta with pesto';
    model.textChanged();
    expect(model.phase).toEqual({ kind: 'failed', failure }); // new words do not lift it
    expect(model.canEstimate).toBe(false);
    expect(await model.estimate('dinner', '2026-10-16', 'en')).toEqual(failed('other'));
    expect(stub.keys).toHaveLength(1); // no second call
  }

  // A refusal about the words goes with the words.
  const model = new MealDescribeModel('lunch with anna@example.com', {
    api: describeStub([{ error: problem(422, 'meal_describe_personal_data') }]).api,
  });
  await model.estimate('lunch', '2026-10-16', 'en');
  expect(model.phase).toEqual({ kind: 'failed', failure: 'personal' });
  model.text = 'lunch';
  model.textChanged();
  expect(model.phase).toEqual({ kind: 'editing' });
  expect(model.canEstimate).toBe(true);
});

it('says what is wrong with invalid words, by the words sent (testAnInvalidDescriptionSaysWhatIsWrongWithTheWords)', async () => {
  const invalid = problem(400, 'invalid-meal-describe');
  expect(describeFailureFor(invalid, 'te')).toBe('tooShort');
  expect(describeFailureFor(invalid, 'a'.repeat(279))).toBe('tooLong');
  expect(describeFailureFor(invalid, '🇮🇸'.repeat(70))).toBe('tooLong');

  const model = new MealDescribeModel('pizza '.repeat(46), { api: describeStub([{ error: invalid }]).api });
  expect(await model.estimate('dinner', '2026-10-16', 'en')).toEqual(failed('tooLong'));
  expect(describeFailureCopyKey('tooLong')).toBe('meal.describe.err.long');
  expect(describeFailureCopyParams('tooLong')).toEqual({ max: '280' });
  expect(describeFailureCopyKey('tooShort')).toBe('meal.describe.err.short');
  expect(describeFailureCopyParams('tooShort')).toEqual({});
  expect(lookup('meal.describe.err.long', 'en').replace('{max}', '280')).toBe('Up to 280 characters.');

  model.text = 'pizza';
  model.textChanged();
  expect(model.phase).toEqual({ kind: 'editing' });
  expect(model.canEstimate).toBe(true);
});

it('offers search after every failure but a lost connection (testEveryFailureButOfflineOffersSearch)', () => {
  for (const failure of MEAL_DESCRIBE_FAILURES.filter((f) => f !== 'offline')) {
    expect([failure, describeFailureOffersSearch(failure)]).toEqual([failure, true]);
  }
  expect(describeFailureOffersSearch('offline')).toBe(false);
});

it('has a line for every failure', () => {
  const lines = Object.fromEntries(MEAL_DESCRIBE_FAILURES.map((failure) => [failure, describeFailureCopyKey(failure)]));
  expect(lines).toEqual({
    personal: 'meal.describe.err.personal',
    noFood: 'meal.describe.err.no_food',
    limit: 'meal.describe.err.limit',
    paused: 'meal.describe.err.paused',
    failed: 'meal.describe.err.failed',
    offline: 'meal.photo.err.offline',
    rateLimited: 'health.err.rate_limited',
    other: 'meal.describe.err.failed',
    tooShort: 'meal.describe.err.short',
    tooLong: 'meal.describe.err.long',
  });
});

describe('keys', () => {
  it('keeps the key for the same words and mints a new one for new words (testTheSameWordsKeepTheirKeyAndNewWordsGetANewOne)', async () => {
    const upstream = { error: problem(502, 'coach_upstream_error') };
    const stub = describeStub([upstream, upstream, upstream]);
    const model = new MealDescribeModel('pasta', { api: stub.api, makeKey: minting() });
    await model.estimate('dinner', '2026-10-16', 'en');
    await model.estimate('dinner', '2026-10-16', 'en');
    expect(stub.keys).toEqual(['k1', 'k1']); // a second tap on the same words is the same request
    model.text = 'pasta with pesto';
    model.textChanged();
    expect(model.phase).toEqual({ kind: 'editing' }); // the old refusal goes with the old words
    await model.estimate('dinner', '2026-10-16', 'en');
    expect(stub.keys).toEqual(['k1', 'k1', 'k2']);
    expect(stub.bodies[2]?.text).toBe('pasta with pesto');
  });

  it('keeps the key for words that clean to the same text', async () => {
    const upstream = { error: problem(502, 'coach_upstream_error') };
    const stub = describeStub([upstream, upstream]);
    const model = new MealDescribeModel('pasta', { api: stub.api, makeKey: minting() });
    await model.estimate('dinner', '2026-10-16', 'en');
    model.text = ' pasta  ';
    model.textChanged();
    await model.estimate('dinner', '2026-10-16', 'en');
    expect(stub.keys).toEqual(['k1', 'k1']);
  });

  it('uses up a key on a draft (testADraftUsesUpItsKey)', async () => {
    const stub = describeStub([{ ok: result(draft, 13) }, { ok: result(draft, 12) }]);
    const model = new MealDescribeModel('pasta', { api: stub.api, makeKey: minting() });
    const first = await model.estimate('lunch', '2026-10-16', 'en');
    expect(first).toEqual({ kind: 'draft', meal: draft });
    expect(model.describesLeft).toBe(13);
    expect(model.phase).toEqual({ kind: 'editing' });
    await model.estimate('lunch', '2026-10-16', 'en');
    expect(stub.keys).toEqual(['k1', 'k2']); // a discarded draft must not be replayed by the next tap
  });

  it('forgets the key whose draft was discarded (health_meal_deleted)', async () => {
    const stub = describeStub([{ error: problem(409, 'health_meal_deleted') }, { ok: result(draft, 2) }]);
    const model = new MealDescribeModel('pasta', { api: stub.api, makeKey: minting() });
    expect(await model.estimate('lunch', '2026-10-16', 'en')).toEqual(failed('failed'));
    await model.estimate('lunch', '2026-10-16', 'en');
    expect(stub.keys).toEqual(['k1', 'k2']);
  });

  it('retries a reused key once with a fresh one (testAReusedKeyIsRetriedOnceWithAFreshOne)', async () => {
    const stub = describeStub([{ error: problem(422, 'idempotency_key_reused') }, { ok: result(draft, 1) }]);
    const model = new MealDescribeModel('pasta', { api: stub.api, makeKey: minting() });
    expect(await model.estimate('lunch', '2026-10-16', 'is')).toEqual({ kind: 'draft', meal: draft });
    expect(stub.keys).toEqual(['k1', 'k2']);
    expect(stub.bodies[0]?.locale).toBe('is');
  });

  it('retries a reused key only once', async () => {
    const reused = { error: problem(422, 'idempotency_key_reused') };
    const stub = describeStub([reused, reused]);
    const model = new MealDescribeModel('pasta', { api: stub.api, makeKey: minting() });
    expect(await model.estimate('lunch', '2026-10-16', 'en')).toEqual(failed('other'));
    expect(stub.keys).toEqual(['k1', 'k2']);
  });

  it('sends nothing while a call is out', async () => {
    let release: (value: MealDescribeResult) => void = () => undefined;
    const keys: string[] = [];
    const api = fakeMealApi({
      describe: (_body, key) => {
        keys.push(key);
        return new Promise((resolve) => {
          release = resolve;
        });
      },
    });
    const model = new MealDescribeModel('pasta', { api, makeKey: minting() });
    const first = model.estimate('lunch', '2026-10-16', 'en');
    expect(model.isBusy).toBe(true);
    expect(model.canEstimate).toBe(false);
    expect(await model.estimate('lunch', '2026-10-16', 'en')).toEqual(failed('other'));
    release(result(draft, 3));
    await first;
    expect(keys).toEqual(['k1']);
  });
});

describe('the one-tap consent', () => {
  function grantRecorder(ageSource: string) {
    const grants: [string, boolean | null, string][] = [];
    const grant: DescribeConsentGrant = async (version, attested, key) => {
      grants.push([version, attested, key]);
      const answer: ConsentResult = {
        consent: null,
        deleted: null,
        optedIn: true,
        version,
        consentedAt: new Date('2026-10-16T12:00:00Z'),
        ageSource,
      };
      return answer;
    };
    return { grant, grants };
  }

  it('sends the describe text and retries with the SAME key (testTheConsentTapSendsTheDescribeTextAndRetriesWithTheSameKey)', async () => {
    const stub = describeStub([{ error: problem(409, 'meal_describe_consent_required') }, { ok: result(draft, 14) }]);
    const { grant, grants } = grantRecorder('kennitala');
    const model = new MealDescribeModel('skyr með bláberjum', { api: stub.api, grant, makeKey: minting() });
    expect(await model.estimate('breakfast', '2026-10-16', 'is')).toEqual({ kind: 'needsConsent' });
    expect(model.phase).toEqual({ kind: 'needsConsent' });

    const standing = { version: '2026-09-v1', consentedAt: new Date(), ageSource: 'kennitala' };
    const granted = await model.grantDescribeConsent(standing);
    expect(granted.kind).toBe('granted');
    expect(granted.kind === 'granted' && granted.consent.version).toBe('2026-09-v3');
    expect(grants).toHaveLength(1);
    expect(grants[0]![0]).toBe(HealthConsentVersion.withMealDescribe);
    expect(grants[0]![0]).toBe('2026-09-v3');
    expect(grants[0]![1]).toBeNull(); // a verified kennitala never claims an attestation

    expect(await model.estimate('breakfast', '2026-10-16', 'is')).toEqual({ kind: 'draft', meal: draft });
    expect(stub.keys).toHaveLength(2);
    expect(stub.keys[0]).toBe(stub.keys[1]); // the retry after the consent is the same request
    expect(grants[0]![2]).not.toBe(stub.keys[0]); // the consent has a key of its own
  });

  it('carries an attestation forward (testAnAttestedConsentCarriesItsAttestationForward)', async () => {
    const { grant, grants } = grantRecorder('attestation');
    const model = new MealDescribeModel('pasta', { api: describeStub([]).api, grant });
    await model.grantDescribeConsent({ version: '2026-09-v2', consentedAt: new Date(), ageSource: 'attestation' });
    expect(grants.map((g) => g[1])).toEqual([true]);
  });

  it('keeps one consent key for the sheet: a second tap writes one ledger row', async () => {
    let calls = 0;
    const keys: string[] = [];
    const grant: DescribeConsentGrant = async (_version, _attested, key) => {
      calls += 1;
      keys.push(key);
      if (calls === 1) throw new TransportError('offline');
      return { consent: null, deleted: null, optedIn: true, version: '2026-09-v3', consentedAt: null, ageSource: null };
    };
    const model = new MealDescribeModel('pasta', { api: describeStub([]).api, grant, makeKey: minting('c') });
    await model.grantDescribeConsent(null);
    await model.grantDescribeConsent(null);
    expect(keys).toEqual(['c1', 'c1']);
  });

  it('takes the server’s recorded consent, else what was sent', async () => {
    const now = new Date('2026-10-16T09:00:00Z');
    const grant: DescribeConsentGrant = async () => ({
      consent: null,
      deleted: null,
      optedIn: true,
      version: null,
      consentedAt: null,
      ageSource: null,
    });
    const model = new MealDescribeModel('pasta', { api: describeStub([]).api, grant, now: () => now });
    const outcome = await model.grantDescribeConsent({ version: '2026-09-v1', consentedAt: null, ageSource: 'kennitala' });
    expect(outcome).toEqual({ kind: 'granted', consent: { version: '2026-09-v3', consentedAt: now, ageSource: 'kennitala' } });
  });

  it('opens the full sheet on an age refusal, keeps other failures inline (testAnAgeRefusalOpensTheFullSheetAndOtherFailuresStayInline)', async () => {
    const ageModel = new MealDescribeModel('pasta', {
      api: describeStub([]).api,
      grant: async () => {
        throw problem(400, 'health_age_attestation_required');
      },
    });
    expect(await ageModel.grantDescribeConsent(null)).toEqual({ kind: 'needsFullSheet' });
    expect(ageModel.phase).toEqual({ kind: 'needsConsent' });

    const offlineModel = new MealDescribeModel('pasta', {
      api: describeStub([]).api,
      grant: async () => {
        throw new TransportError('offline');
      },
    });
    expect(await offlineModel.grantDescribeConsent(null)).toEqual({ kind: 'failed' });
    expect(offlineModel.consentErrorKey).toBe('health.offline.action_hint');
    expect(offlineModel.phase).toEqual({ kind: 'needsConsent' }); // the button stays for another tap

    const limitedModel = new MealDescribeModel('pasta', {
      api: describeStub([]).api,
      grant: async () => {
        throw problem(429, 'rate_limited');
      },
    });
    await limitedModel.grantDescribeConsent(null);
    expect(limitedModel.consentErrorKey).toBe('health.err.rate_limited');

    const minorModel = new MealDescribeModel('pasta', {
      api: describeStub([]).api,
      grant: async () => {
        throw problem(403, 'health_minor_blocked');
      },
    });
    const minor = await minorModel.grantDescribeConsent(null);
    expect(minor.kind).toBe('refused');
    expect(minor.kind === 'refused' && minor.error.code).toBe('health_minor_blocked');

    const oddModel = new MealDescribeModel('pasta', {
      api: describeStub([]).api,
      grant: async () => {
        throw new Error('boom');
      },
    });
    expect(await oddModel.grantDescribeConsent(null)).toEqual({ kind: 'failed' });
    expect(oddModel.consentErrorKey).toBe('common.error_body');
  });

  it('sends the describe text only when the server has it (testTheConsentSheetSendsTheDescribeTextOnlyWhenTheServerHasIt)', () => {
    expect(HealthConsentVersion.shown(false)).toBe('2026-09-v1');
    expect(HealthConsentVersion.shown(true)).toBe('2026-09-v3');
    expect(HealthConsentVersion.current).toBe('2026-09-v1');
  });
});

describe('the feature gate (testDescribeIsOffUntilTheServerAdvertisesIt)', () => {
  beforeEach(() => resetAppStoreForTests());
  afterAll(() => resetAppStoreForTests());

  it('is off until the server advertises meal_describe, and a 404 drops only that entry', () => {
    const app = () => useAppStore.getState();
    const today = todayServerDay();
    expect(selectSupportsMealDescribe(app())).toBe(false);
    app().noteServerFeatures(['target_weight']);
    expect(selectSupportsMealDescribe(app())).toBe(false); // no entry without meal_describe
    expect(isDescribeOffered(today)).toBe(false);
    app().noteServerFeatures(['target_weight', 'meal_describe']);
    expect(selectSupportsMealDescribe(app())).toBe(true);
    expect(isDescribeOffered(today)).toBe(true);
    expect(isDescribeOffered(addServerDays(today, -31)!)).toBe(false);

    app().dropServerFeature('meal_describe');
    expect(selectSupportsMealDescribe(app())).toBe(false);
    expect(selectSupportsTargetWeight(app())).toBe(true);
    expect(isDescribeOffered(today)).toBe(false);
  });
});

it('carries no words in analytics (testDescribeAnalyticsCarryNoWords)', () => {
  for (const failure of MEAL_DESCRIBE_FAILURES) {
    const outcome = describeFailureAnalyticsOutcome(failure);
    expect([outcome, isForbidden('outcome', outcome)]).toEqual([outcome, false]);
  }
  for (const outcome of ['ok', 'consent']) expect(isForbidden('outcome', outcome)).toBe(false);
  for (const entry of ['empty_search', 'closest', 'button', 'describe']) {
    expect(isForbidden('entry', entry)).toBe(false);
  }
});
