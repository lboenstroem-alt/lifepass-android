/**
 * Where typed words go while the plan can be changed in chat: the shared
 * router corpus, and the plan-edit rule (../intent.ts) on its own. The port
 * of iOS `PlanEditRouterTests`.
 *
 * THE CORPUS IS SHARED. `plan-edit-router-corpus.json` is the same bytes in
 * the monorepo (`docs/fixtures/`), the iOS tests and here, and each platform
 * asserts its hash and passes every case. Changing a case means changing all
 * three copies, and the three hashes together.
 */
import { sha256 } from '@noble/hashes/sha2';
import { bytesToHex } from '@noble/hashes/utils';
import fs from 'fs';
import path from 'path';

import { decodeHealthDay } from '../../../../health';
import { planIntentAnswers, programIntentMatches } from '../../routing/intents';
import { venueWizardCategory } from '../../routing/scheduleCue';
import { planEditIntentMatches, planEditTokens, planVocabularyFrom, vocabularyTokens } from '../intent';

const CORPUS_FILE = path.join(__dirname, 'fixtures', 'plan-edit-router-corpus.json');
const CORPUS_SHA256 = '70b2591bfea3a94b49773dd535ea2982f6b8402b118cfea41dd84293022034c0';

type Destination = 'planEdit' | 'program' | 'dayPlan' | 'venue' | 'chat';

interface Corpus {
  readonly name: string;
  readonly version: number;
  readonly vocabulary: readonly string[];
  readonly cases: readonly { readonly lang: string; readonly text: string; readonly expect: Destination }[];
}

const bytes = fs.readFileSync(CORPUS_FILE);
const corpus = JSON.parse(bytes.toString('utf8')) as Corpus;

/**
 * Where the pipeline sends words with nothing open in the chat and a plan
 * running (iOS `CoachTypedDestination.resolve`): the plan change, the
 * programme offer, the day plan, the venue wizard, the chat.
 */
function destination(text: string, planEditEnabled: boolean, vocabulary: readonly string[]): Destination {
  const trimmed = text.trim();
  if (planEditEnabled && planEditIntentMatches(trimmed, vocabulary)) return 'planEdit';
  if (programIntentMatches(trimmed)) return 'program';
  if (planIntentAnswers(trimmed) !== null) return 'dayPlan';
  if (venueWizardCategory(trimmed) !== null) return 'venue';
  return 'chat';
}

describe('the shared router corpus', () => {
  it('is the agreed one, byte for byte', () => {
    expect(bytesToHex(sha256(new Uint8Array(bytes)))).toBe(CORPUS_SHA256);
    expect(corpus.name).toBe('plan-edit-router-corpus');
    expect(corpus.version).toBe(2);
  });

  it('every message routes where it says (100%)', () => {
    expect(corpus.cases.length).toBeGreaterThanOrEqual(60);
    const wrong = corpus.cases
      .map((item) => ({ item, got: destination(item.text, true, corpus.vocabulary) }))
      .filter(({ item, got }) => got !== item.expect)
      .map(({ item, got }) => `[${item.lang}] "${item.text}": expected ${item.expect}, got ${got}`);
    expect(wrong).toEqual([]);
  });

  it('every language carries plan edits and advice for the chat', () => {
    for (const lang of ['en', 'is', 'de']) {
      const cases = corpus.cases.filter((item) => item.lang === lang);
      expect(cases.some((item) => item.expect === 'planEdit')).toBe(true);
      expect(cases.some((item) => item.expect === 'chat')).toBe(true);
    }
  });

  it('without the server feature nothing ever goes to the plan change', () => {
    for (const item of corpus.cases) expect(destination(item.text, false, corpus.vocabulary)).not.toBe('planEdit');
  });
});

describe('the rule', () => {
  it('an edit verb needs something of the plan', () => {
    expect(planEditIntentMatches('swap my exercise')).toBe(true);
    expect(planEditIntentMatches('swap the music')).toBe(false);
    expect(planEditIntentMatches('change gyms')).toBe(false);
  });

  it('"don\'t have" needs equipment or an exercise', () => {
    expect(planEditIntentMatches("I don't have a barbell")).toBe(true);
    expect(planEditIntentMatches("I don't have time today")).toBe(false);
    expect(planEditIntentMatches('ég er ekki með handlóð')).toBe(true);
    expect(planEditIntentMatches('ég er ekki með kortið')).toBe(false);
  });

  it('a question without an edit verb is advice for the chat; one with an edit verb is a change', () => {
    expect(planEditIntentMatches('which exercise is best for my back?')).toBe(false);
    expect(planEditIntentMatches('should I swap my workout for a rest day?')).toBe(true);
  });

  it('a booking is never the plan', () => {
    expect(planEditIntentMatches('move my booking to Saturday')).toBe(false);
    expect(planEditIntentMatches('færðu bókunina mína')).toBe(false);
  });

  it('the plan\'s own words count', () => {
    expect(planEditIntentMatches('swap Zottman for something else')).toBe(false);
    expect(planEditIntentMatches('swap Zottman for something else', ['Zottman curls'])).toBe(true);
  });

  it('folds as iOS does: apostrophes dropped, ß as ss, Icelandic letters spelled out', () => {
    expect(planEditTokens("Don't")).toEqual(['dont']);
    expect(planEditTokens('Fußball')).toEqual(['fussball']);
    expect(planEditTokens('Ég er ekki með þetta æfingu')).toEqual(['eg', 'er', 'ekki', 'med', 'thetta', 'aefingu']);
    expect(planEditTokens('Übung')).toEqual(['ubung']);
  });

  it('nothing typed is nothing', () => {
    expect(planEditIntentMatches('')).toBe(false);
    expect(planEditIntentMatches('   ?! ')).toBe(false);
  });
});

describe("the plan's words", () => {
  it('keeps the significant words of titles and names', () => {
    const words = vocabularyTokens(['Push (Brust & Trizeps)', 'Full body strength', 'Lat pulldown']);
    expect(words.has('push')).toBe(true);
    expect(words.has('pulldown')).toBe(true);
    expect(words.has('body')).toBe(false);
    expect(words.has('strength')).toBe(false);
  });

  it('reads them off the cached Today read of a live plan, once each', () => {
    const day = decodeHealthDay({
      date: '2026-10-23',
      program: { id: 'p1', status: 'active' },
      day: {
        date: '2026-10-23',
        session: { id: 's1', title: 'Pull (Rücken & Arme)', blocks: [{ blockNo: 1, exerciseId: 'lat-pulldown', name: 'Lat pulldown' }] },
      },
      week: { days: [{ date: '2026-10-24', title: 'Calisthenics' }, { date: '2026-10-25', title: 'calisthenics' }] },
      upcoming: [{ id: 's2', title: 'Push (Brust & Trizeps)' }],
    });
    expect(planVocabularyFrom(day)).toEqual(['Pull (Rücken & Arme)', 'Lat pulldown', 'Calisthenics', 'Push (Brust & Trizeps)']);
    expect(planVocabularyFrom(decodeHealthDay({ date: '2026-10-23', program: { id: 'p1', status: 'completed' } }))).toEqual([]);
    expect(planVocabularyFrom(null)).toEqual([]);
  });
});

describe('a new plan', () => {
  // "make" with "workout" is an edit ("make the workout shorter"), but not when
  // the member asks for a NEW plan: that is the programme offer (iOS
  // PlanEditRouterTests.testANewPlanIsTheProgrammeOfferNotAChange).
  it('is the programme offer, not a change', () => {
    expect(planEditIntentMatches('Make me a new workout plan')).toBe(false);
    expect(planEditIntentMatches('Gerðu nýja æfingaáætlun fyrir mig')).toBe(false);
    expect(planEditIntentMatches('Mach mir einen neuen Trainingsplan')).toBe(false);
    expect(destination('Make me a new workout plan', true, [])).toBe('program');
    expect(planEditIntentMatches('Add a new exercise to my plan')).toBe(true);
    expect(planEditIntentMatches('make the workout shorter')).toBe(true);
  });
});
