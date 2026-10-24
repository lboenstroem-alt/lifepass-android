/**
 * The plan-edit router (../intent.ts) against the shared router corpus, and
 * its rule on its own: an edit verb with a plan object, or "don't have" with
 * equipment or an exercise, and never a question without an edit verb.
 *
 * THE CORPUS is the same file iOS tests (spec "ROUTER CORPUS"): its sha256
 * is pinned here, so a copy that drifts from the other app's fails before
 * any case runs. When the monorepo's canonical
 * docs/fixtures/plan-edit-router-corpus.json lands, it replaces this copy
 * byte for byte and the pin moves with it.
 */
import { sha256 } from '@noble/hashes/sha2';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils';
import fs from 'fs';
import path from 'path';

import { detectVenueCategory } from '../../../../data/coachQuestions';
import { decodeHealthDay } from '../../../../health';
import { planIntentAnswers, programIntentMatches } from '../../routing/intents';
import { EMPTY_VOCABULARY, planEditIntentMatches, planVocabularyFrom, vocabularyOf } from '../intent';

const CORPUS_FILE = path.join(__dirname, 'fixtures', 'plan-edit-router-corpus.json');
const CORPUS_SHA256 = '53428d700f09e07b3b8240dce808d3fe1b1f8385d8e164d99eeecb41616e4c0f';

interface CorpusCase {
  readonly text: string;
  readonly lang: 'en' | 'is' | 'de';
  readonly expect: 'planEdit' | 'chat' | 'venue' | 'dayPlan' | 'program';
}

interface Corpus {
  readonly version: number;
  readonly vocabulary: readonly string[];
  readonly cases: readonly CorpusCase[];
}

const raw = fs.readFileSync(CORPUS_FILE, 'utf8');
const corpus = JSON.parse(raw) as Corpus;
const vocabulary = vocabularyOf(corpus.vocabulary);

describe('the shared router corpus', () => {
  it('is the copy both apps pin', () => {
    expect(bytesToHex(sha256(utf8ToBytes(raw)))).toBe(CORPUS_SHA256);
    expect(corpus.version).toBe(1);
  });

  it('has about sixty messages in English, Icelandic and German, every destination among them', () => {
    expect(corpus.cases.length).toBeGreaterThanOrEqual(60);
    for (const lang of ['en', 'is', 'de'] as const) {
      expect(corpus.cases.filter((c) => c.lang === lang && c.expect === 'planEdit').length).toBeGreaterThanOrEqual(9);
    }
    for (const destination of ['planEdit', 'chat', 'venue', 'dayPlan', 'program'] as const) {
      expect(corpus.cases.some((c) => c.expect === destination)).toBe(true);
    }
  });

  it('routes every message where the corpus says (100%)', () => {
    const wrong = corpus.cases
      .filter((c) => planEditIntentMatches(c.text, vocabulary) !== (c.expect === 'planEdit'))
      .map((c) => `${c.lang} "${c.text}" should ${c.expect === 'planEdit' ? '' : 'not '}go to the plan change`);
    expect(wrong).toEqual([]);
  });

  it('leaves the other destinations to the matchers that already own them', () => {
    const wrong: string[] = [];
    for (const c of corpus.cases) {
      if (c.expect === 'program' && !programIntentMatches(c.text)) wrong.push(`program: ${c.text}`);
      if (c.expect === 'dayPlan' && planIntentAnswers(c.text) === null) wrong.push(`dayPlan: ${c.text}`);
      if (c.expect === 'venue' && detectVenueCategory(c.text) === null) wrong.push(`venue: ${c.text}`);
    }
    expect(wrong).toEqual([]);
  });
});

describe('the rule', () => {
  it('an edit verb needs a plan object', () => {
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

  it('a question without an edit verb is the chat\'s, one with an edit verb is a change', () => {
    expect(planEditIntentMatches('which exercise is best for my back?')).toBe(false);
    expect(planEditIntentMatches("what if I don't have a cable machine?")).toBe(false);
    expect(planEditIntentMatches('should I swap my workout for a rest day?')).toBe(true);
  });

  it('"make" is a change only with a rest day or a dose', () => {
    expect(planEditIntentMatches('make Friday a rest day')).toBe(true);
    expect(planEditIntentMatches('make it 3 sets')).toBe(true);
    expect(planEditIntentMatches('make me a workout plan')).toBe(false);
  });

  it('reads Icelandic and German typed without their letters', () => {
    expect(planEditIntentMatches('faerdu aefinguna a laugardag')).toBe(true);
    expect(planEditIntentMatches('Ich habe keine Kurzhanteln')).toBe(true);
    expect(planEditIntentMatches('ich habe keine kurzhanteln')).toBe(true);
  });

  it('knows nothing of the plan without its vocabulary', () => {
    expect(planEditIntentMatches('swap bench press for push-ups', EMPTY_VOCABULARY)).toBe(false);
    expect(planEditIntentMatches('swap bench press for push-ups', vocabularyOf(['Barbell bench press']))).toBe(true);
  });

  it('nothing typed is nothing', () => {
    expect(planEditIntentMatches('')).toBe(false);
    expect(planEditIntentMatches('   ?! ')).toBe(false);
  });
});

describe("the plan's words", () => {
  it('names a day title by its words before the bracket, and an exercise by its runs of words, singular or plural', () => {
    const words = vocabularyOf(['Push (Brust & Trizeps)', 'Bodyweight squat', 'Barbell bench press']);
    expect(words.words.has('push')).toBe(true);
    expect(words.words.has('squat')).toBe(true);
    expect(words.words.has('squats')).toBe(true);
    expect(words.phrases).toContain('bench press');
    // Too common to stand for one exercise.
    expect(words.words.has('body')).toBe(false);
  });

  it('reads them off the cached Today read: today\'s exercises, the week\'s titles, the upcoming rows', () => {
    const day = decodeHealthDay({
      date: '2026-10-23',
      day: {
        date: '2026-10-23',
        session: { id: 's1', title: 'Pull (Rücken & Arme)', blocks: [{ blockNo: 1, exerciseId: 'lat-pulldown', name: 'Lat pulldown' }] },
      },
      week: { days: [{ date: '2026-10-24', title: 'Calisthenics' }] },
      upcoming: [{ id: 's2', title: 'Push (Brust & Trizeps)' }],
    });
    const words = planVocabularyFrom(day);
    expect(planEditIntentMatches('replace lat pulldown with pull-ups', words)).toBe(true);
    expect(planEditIntentMatches('swap Calisthenics and Pull', words)).toBe(true);
    expect(planEditIntentMatches('move Push to Sunday', words)).toBe(true);
    expect(planVocabularyFrom(null)).toBe(EMPTY_VOCABULARY);
  });
});
