/**
 * Week totals (API 0.35.0; iOS LogWorkoutTests, the WeekTotalsCopy cases):
 * the week and the review read `extrasDone` and `workoutsDone` fail-soft and
 * an older server still decodes; the totals survive the cache; without an
 * extra the strip and the review keep the plan's line; an extra adds to the
 * total in front of it, in the website's words and the Icelandic plural
 * rule; the plan's progress never counts an extra; a total the server left
 * out is the sum, never less than the line.
 */
import {
  decodeCachedHealthDay,
  decodeHealthDay,
  decodeWeeklyReview,
  decodeWeekView,
  encodeHealthDay,
  type WeeklyReviewView,
  type WeekView,
} from '../../../../health';
import { lookup, translate, translatePlural, type Lang } from '../../../../i18n';
import { weekReviewLine, weekStripLine, weekTotalsLine } from '../weekTotals';

function translator(language: Lang) {
  return {
    t: (key: string, params?: Record<string, string | number>) => translate(key, language, params),
    tp: (base: string, count: number, params?: Record<string, string | number>) => translatePlural(base, count, language, params),
  };
}
const en = translator('en');
const icelandic = translator('is');

function week(extra: Record<string, unknown> = {}): WeekView {
  return decodeWeekView(
    {
      programId: 'prog-1',
      weekNo: 2,
      weeks: 4,
      weekStartsOn: '2026-10-12',
      days: [],
      planned: 3,
      done: 3,
      skipped: 0,
      missed: 0,
      canGoBack: true,
      canGoForward: false,
      ...extra,
    },
    'week',
  );
}

function review(extra: Record<string, unknown> = {}): WeeklyReviewView {
  return decodeWeeklyReview(
    { id: 'rev-1', weekStartsOn: '2026-10-05', programId: 'prog-1', hasPlan: true, sessionsPlanned: 3, sessionsDone: 3, streakWeeks: 2, ...extra },
    'review',
  );
}

function stripLine(done: number, planned: number, extras: number | null, total: number | null, language: Lang): string {
  return weekTotalsLine(
    { done, planned, extrasDone: extras, workoutsDone: total },
    { plainKey: 'plan.week.progress', extrasKey: 'plan.week.progress_extras' },
    language === 'en' ? en : icelandic,
  );
}

describe('decoding', () => {
  it('the week and the review read the totals, and an older server still decodes', () => {
    const old = week();
    expect(old.extrasDone).toBeNull();
    expect(old.workoutsDone).toBeNull();
    expect(old.done).toBe(3);

    const current = week({ extrasDone: 1, workoutsDone: 4 });
    expect(current.extrasDone).toBe(1);
    expect(current.workoutsDone).toBe(4);
    expect(current.done).toBe(3); // the plan's own count is unchanged
    expect(current.planned).toBe(3);

    const odd = week({ extrasDone: 'one', workoutsDone: null });
    expect(odd.extrasDone).toBeNull(); // an odd value costs that value
    expect(odd.planned).toBe(3); // never the week
    expect(week({ extrasDone: 1.5 }).extrasDone).toBeNull();

    expect(review().extrasDone).toBeNull();
    const currentReview = review({ extrasDone: 2, workoutsDone: 5 });
    expect(currentReview.extrasDone).toBe(2);
    expect(currentReview.workoutsDone).toBe(5);
    expect(currentReview.sessionsDone).toBe(3);
    expect(currentReview.streakWeeks).toBe(2);
    expect(review({ workoutsDone: 'five' }).workoutsDone).toBeNull();
  });

  it('the totals survive the cache round trip', () => {
    const day = decodeHealthDay(
      {
        contractVersion: '2026-09-v1',
        date: '2026-10-14',
        today: '2026-10-14',
        locale: 'en',
        access: 'entitled',
        week: { weekStartsOn: '2026-10-12', planned: 3, done: 3, extrasDone: 1, workoutsDone: 4 },
        review: { id: 'rev-1', sessionsPlanned: 3, sessionsDone: 3, extrasDone: 1, workoutsDone: 4 },
        upcoming: [],
      },
    );
    const cached = decodeCachedHealthDay(encodeHealthDay(day));
    expect(cached?.week).toEqual(day.week);
    expect(cached?.week?.extrasDone).toBe(1);
    expect(cached?.review).toEqual(day.review);
    expect(cached?.review?.workoutsDone).toBe(4);
  });
});

describe('the strip', () => {
  it("without an extra it says the plan's line as before", () => {
    expect(weekStripLine(week(), en)).toBe('3 of 3 sessions done this week'); // an older server
    expect(weekStripLine(week({ extrasDone: 0, workoutsDone: 3 }), en)).toBe('3 of 3 sessions done this week');
    expect(weekStripLine(week({ extrasDone: 0, workoutsDone: 3 }), icelandic)).toBe('3 af 3 æfingum lokið í vikunni');
  });

  it("an extra adds to the total in the website's words", () => {
    expect(weekStripLine(week({ extrasDone: 1, workoutsDone: 4 }), en)).toBe('4 workouts this week: 3 of 3 planned + 1 extra');
    expect(weekStripLine(week({ extrasDone: 1, workoutsDone: 4 }), icelandic)).toBe('4 æfingar í vikunni: 3 af 3 á áætlun + 1 aukaæfing');
    expect(stripLine(1, 3, 2, 3, 'en')).toBe('3 workouts this week: 1 of 3 planned + 2 extra');
    expect(stripLine(1, 3, 2, 3, 'is')).toBe('3 æfingar í vikunni: 1 af 3 á áætlun + 2 aukaæfingar');
    expect(stripLine(0, 3, 1, 1, 'en')).toBe('1 workout this week: 0 of 3 planned + 1 extra');
    expect(stripLine(0, 3, 1, 1, 'is')).toBe('1 æfing í vikunni: 0 af 3 á áætlun + 1 aukaæfing');
    // Icelandic takes the singular for 21 too, as the website's ICU rule.
    expect(stripLine(0, 0, 21, 21, 'is')).toBe('21 æfing í vikunni: 0 af 0 á áætlun + 21 aukaæfing');
    expect(stripLine(0, 0, 11, 11, 'is')).toBe('11 æfingar í vikunni: 0 af 0 á áætlun + 11 aukaæfingar');
  });

  it("the plan's progress never counts an extra: it can never read 4 of 3", () => {
    const languages: [Lang, string][] = [
      ['en', 'of'],
      ['is', 'af'],
    ];
    for (let planned = 0; planned <= 5; planned += 1) {
      for (let done = 0; done <= planned; done += 1) {
        for (let extras = 0; extras <= 5; extras += 1) {
          for (const [language, of] of languages) {
            const line = stripLine(done, planned, extras, done + extras, language);
            expect(line).toContain(`${done} ${of} ${planned}`);
            if (extras > 0) {
              expect(line.startsWith(`${done + extras} `)).toBe(true);
              expect(line).not.toContain(`${done + extras} ${of} ${planned}`);
            }
          }
        }
      }
    }
  });

  it('a total the server left out is the sum, and never less than the line', () => {
    expect(stripLine(3, 3, 1, null, 'en')).toBe('4 workouts this week: 3 of 3 planned + 1 extra');
    expect(stripLine(3, 3, 1, 2, 'en')).toBe('4 workouts this week: 3 of 3 planned + 1 extra');
  });
});

describe('the review', () => {
  it('counts the extras only when there are some', () => {
    expect(weekReviewLine(review(), en)).toBe('3 of 3 sessions done');
    expect(weekReviewLine(review({ extrasDone: 0, workoutsDone: 3 }), icelandic)).toBe('3 af 3 æfingum lokið');
    const extra = review({ extrasDone: 1, workoutsDone: 4 });
    expect(weekReviewLine(extra, en)).toBe('4 workouts: 3 of 3 planned + 1 extra');
    expect(weekReviewLine(extra, icelandic)).toBe('4 æfingar: 3 af 3 á áætlun + 1 aukaæfing');
    const noCounts = decodeWeeklyReview({ id: 'r', hasPlan: true, extrasDone: 1 }, 'review');
    expect(weekReviewLine(noCounts, en)).toBeNull();
  });
});

it('every week totals key is in both languages with the same placeholders', () => {
  const keys = [
    'plan.week.progress_extras',
    'review.sessions_extras',
    'plan.week.workouts.one',
    'plan.week.workouts.many',
    'plan.week.extras.one',
    'plan.week.extras.many',
  ];
  const placeholders = (value: string) => new Set(value.match(/\{[a-z]+\}/g) ?? []);
  for (const key of keys) {
    const english = lookup(key, 'en');
    const icelandicValue = lookup(key, 'is');
    expect(english).not.toBe(key);
    // Icelandic falls back to English when it is missing: each is its own words.
    expect(icelandicValue).not.toBe(english);
    expect(placeholders(english)).toEqual(placeholders(icelandicValue));
  }
});
