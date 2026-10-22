/**
 * The weekly review's lines (iOS WeeklyReviewCard `lines`) and which card
 * the slot draws (iOS PlanView `reviewSection`): every line only for a value
 * the server sent, the weight as a seven-day average, Icelandic plurals for
 * 1, 11 and 21 check-ins and streak weeks.
 */
import type { WeeklyReviewView } from '../../../../health';
import { translate, translatePlural, type Lang, type Translator } from '../../../../i18n';
import { presentText, reviewLines, reviewSectionKind } from '../reviewRules';

function translator(language: Lang): Translator {
  return {
    language,
    t: (key, params) => translate(key, language, params),
    tp: (base, count, params) => translatePlural(base, count, language, params),
  };
}

const EMPTY: WeeklyReviewView = {
  id: 'r-1',
  weekStartsOn: '2026-10-12',
  programId: null,
  hasPlan: null,
  weekRating: null,
  sessionsPlanned: null,
  sessionsDone: null,
  weightAvgKg: null,
  weightDeltaKg: null,
  weightDirection: null,
  kcalAvg: null,
  proteinAvgG: null,
  checkInsCount: null,
  streakWeeks: null,
  insight: null,
  nextWeekChange: null,
  createdAt: null,
};

const review = (patch: Partial<WeeklyReviewView>): WeeklyReviewView => ({ ...EMPTY, ...patch });

describe('the lines', () => {
  it('nothing sent, nothing drawn', () => {
    expect(reviewLines(EMPTY, translator('en'))).toEqual([]);
  });

  it('every line, in iOS order, in English', () => {
    const lines = reviewLines(
      review({
        hasPlan: true,
        sessionsPlanned: 4,
        sessionsDone: 3,
        weightDirection: 'down',
        weightDeltaKg: -0.4,
        kcalAvg: 2180,
        proteinAvgG: 119.4,
        checkInsCount: 4,
        streakWeeks: 2,
      }),
      translator('en'),
    );
    expect(lines).toEqual([
      '3 of 4 sessions done',
      'Weight: down 0.4 kg (7-day average)',
      'Food: about 2,180 kcal and 119 g protein a day on logged days',
      '4 check-ins',
      '2 full weeks in a row',
    ]);
  });

  it('in Icelandic, with Icelandic numbers', () => {
    const lines = reviewLines(
      review({ weightDirection: 'up', weightDeltaKg: 1.25, kcalAvg: 1950, proteinAvgG: 88.6 }),
      translator('is'),
    );
    expect(lines).toEqual([
      'Þyngd: upp um 1,2 kg (7 daga meðaltal)',
      'Matur: um 1.950 kcal og 89 g prótein á dag þá daga sem þú skráðir',
    ]);
  });

  it('no plan this week replaces the sessions line', () => {
    expect(reviewLines(review({ hasPlan: false, sessionsPlanned: 0, sessionsDone: 0 }), translator('en'))).toEqual([
      'No plan this week',
    ]);
  });

  it('the sessions line needs both numbers; the weight line both its direction and its delta', () => {
    expect(reviewLines(review({ sessionsDone: 2 }), translator('en'))).toEqual([]);
    expect(reviewLines(review({ weightDirection: 'same' }), translator('en'))).toEqual([]);
    expect(reviewLines(review({ weightDeltaKg: 0.1 }), translator('en'))).toEqual([]);
    expect(reviewLines(review({ weightDirection: 'same', weightDeltaKg: 0.1 }), translator('en'))).toEqual([
      'Weight: about the same, 0.1 kg (7-day average)',
    ]);
  });

  it('a direction this build has no word for leaves the weight line out rather than print a key', () => {
    const lines = reviewLines(review({ weightDirection: 'sideways', weightDeltaKg: 0.5 }), translator('en'));
    expect(lines).toEqual([]);
  });

  it('food needs both averages; zero check-ins and a zero streak are no lines', () => {
    expect(reviewLines(review({ kcalAvg: 2000 }), translator('en'))).toEqual([]);
    expect(reviewLines(review({ checkInsCount: 0, streakWeeks: 0 }), translator('en'))).toEqual([]);
  });

  it.each([
    [1, '1 check-in', '1 innritun', '1 full week in a row', '1 heil vika í röð'],
    [11, '11 check-ins', '11 innritanir', '11 full weeks in a row', '11 heilar vikur í röð'],
    [21, '21 check-ins', '21 innritun', '21 full weeks in a row', '21 heil vika í röð'],
    [2, '2 check-ins', '2 innritanir', '2 full weeks in a row', '2 heilar vikur í röð'],
  ])('%i check-ins and streak weeks', (count, enCheckIns, isCheckIns, enStreak, isStreak) => {
    expect(reviewLines(review({ checkInsCount: count, streakWeeks: count }), translator('en'))).toEqual([enCheckIns, enStreak]);
    expect(reviewLines(review({ checkInsCount: count, streakWeeks: count }), translator('is'))).toEqual([isCheckIns, isStreak]);
  });

  it('server lines show only with words in them', () => {
    expect(presentText(null)).toBeNull();
    expect(presentText({ text: null })).toBeNull();
    expect(presentText({ text: '' })).toBeNull();
    expect(presentText({ text: 'Add one set next week.' })).toBe('Add one set next week.');
  });
});

describe('which card the slot draws', () => {
  const withReview = { review: review({ sessionsDone: 1, sessionsPlanned: 2 }) };

  it('the prompt while the check-in is due for an entitled member, never both', () => {
    expect(reviewSectionKind({ checkIn: { due: true, weekStartsOn: null, recentWeightKg: null }, ...withReview }, 'entitled')).toBe('prompt');
  });

  it('the review for anyone else, or once the check-in is done', () => {
    const due = { due: true, weekStartsOn: null, recentWeightKg: null };
    expect(reviewSectionKind({ checkIn: due, ...withReview }, 'past_due')).toBe('review');
    expect(reviewSectionKind({ checkIn: due, ...withReview }, 'not_member')).toBe('review');
    expect(reviewSectionKind({ checkIn: { ...due, due: false }, ...withReview }, 'entitled')).toBe('review');
    expect(reviewSectionKind({ checkIn: null, ...withReview }, 'entitled')).toBe('review');
  });

  it('nothing without a review and no prompt, or without a day', () => {
    expect(reviewSectionKind({ checkIn: null, review: null }, 'entitled')).toBeNull();
    expect(reviewSectionKind({ checkIn: { due: true, weekStartsOn: null, recentWeightKg: null }, review: null }, 'past_due')).toBeNull();
    expect(reviewSectionKind(null, 'entitled')).toBeNull();
  });
});
