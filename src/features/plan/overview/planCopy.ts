/**
 * The lines the plan overview, the programme overview, the proposal card and
 * the history print identically (the programme half of iOS `PlanCopy`,
 * PlanTodayCard.swift, and the copy helpers of PlanOverviewCard.swift and
 * ProgramProposalCard.swift). One place, because "Mon, Wed, Fri" on the
 * overview and "Mon,Wed,Fri" on the proposal is two apps to a member.
 *
 * Pure: every function takes its translator and language, so the screens
 * and the tests call the same code.
 *
 * NO TIME SHIFTING. Dates are the server's `YYYY-MM-DD` strings in Iceland
 * time and stay strings (src/i18n/format.ts).
 */
import type { Feeling, ProgramSummary, SessionBrief, SessionStatusView } from '../../../health';
import { duration, integer, decimal, longDay, weekdayAbbreviation } from '../../../i18n/format';
import { pluralKey, type Lang, type Params } from '../../../i18n';
import { statusWord } from '../week/weekRules';

export type Translate = (key: string, params?: Params) => string;

/**
 * "17 September to 14 October", or null while a proposal has no dates (iOS
 * `PlanCopy.dateRange`).
 */
export function dateRange(
  program: Pick<ProgramSummary, 'startsOn' | 'endsOn'>,
  t: Translate,
  lang: Lang,
): string | null {
  if (!program.startsOn || !program.endsOn) return null;
  return t('plan.overview.dates', { start: longDay(program.startsOn, lang), end: longDay(program.endsOn, lang) });
}

/**
 * "Mon, Wed, Fri": the training days in weekday order, whatever order the
 * server sent them in (iOS `weekdayList` / the proposal's `metaLine`).
 */
export function weekdayList(trainingDays: readonly number[] | null | undefined, lang: Lang): string {
  return [...(trainingDays ?? [])]
    .sort((a, b) => a - b)
    .map((day) => weekdayAbbreviation(day, lang))
    .join(', ');
}

/**
 * A custom plan's days (COACH-6): "Repeats every 4 days", from the cycle the
 * member wrote, never the padded weekdays the server keeps for its own
 * rules. A plan with no cycle length falls back to its weekdays.
 */
export function cycleDaysLine(
  program: Pick<ProgramSummary, 'cycleDays' | 'trainingDays'>,
  t: Translate,
  lang: Lang,
): string {
  const days = program.cycleDays;
  if (days === null || days < 1) return t('plan.overview.days', { days: weekdayList(program.trainingDays, lang) });
  return t(pluralKey('plan.overview.cycle_days', days, lang), { count: integer(days, lang) });
}

/**
 * The proposal's meta line, "Mon, Wed, Fri · about 40 min". A plan that
 * names no typical length says 40, as iOS does.
 */
export function proposalMetaLine(
  program: Pick<ProgramSummary, 'trainingDays' | 'typicalMinutes'>,
  t: Translate,
  lang: Lang,
): string {
  return t('program.proposal.meta', {
    days: weekdayList(program.trainingDays, lang),
    minutes: String(program.typicalMinutes ?? 40),
  });
}

/**
 * Which line a plan's targets row says (`ios-ux.md` 3.9.1 item 3, in this
 * order): a withheld target, a gentle plan, a real target, or the invitation
 * to add the numbers that would make one. A withheld reason this build does
 * not know (`unknown`) is not a withheld target, as on iOS.
 */
export type TargetsLine =
  | { readonly kind: 'withheld' }
  | { readonly kind: 'gentle' }
  | { readonly kind: 'targets'; readonly low: number; readonly high: number; readonly protein: number }
  | { readonly kind: 'none' };

export function targetsLine(program: Pick<ProgramSummary, 'targetsWithheld' | 'planType' | 'targets'>): TargetsLine {
  if (program.targetsWithheld && program.targetsWithheld !== 'unknown') return { kind: 'withheld' };
  if (program.planType === 'gentle') return { kind: 'gentle' };
  const targets = program.targets;
  if (targets && targets.kcalLow !== null && targets.kcalHigh !== null && targets.proteinG !== null) {
    return { kind: 'targets', low: targets.kcalLow, high: targets.kcalHigh, protein: targets.proteinG };
  }
  return { kind: 'none' };
}

/** The words of a targets line ("About 1,800 to 2,100 kcal a day, 120 g protein"). */
export function targetsText(line: TargetsLine, t: Translate, lang: Lang): string {
  switch (line.kind) {
    case 'withheld':
      return t('plan.targets.withheld');
    case 'gentle':
      return t('plan.overview.gentle');
    case 'targets':
      return t('plan.overview.targets', {
        low: integer(line.low, lang),
        high: integer(line.high, lang),
        protein: decimal(line.protein, lang, 0),
      });
    case 'none':
      return t('plan.overview.no_targets');
  }
}

/** A row's weekday: the session's own, else its place in the week (iOS `weekday ?? index + 1`). */
export function rowWeekday(day: Pick<SessionBrief, 'weekday'>, index: number): number {
  return day.weekday ?? index + 1;
}

/** A row's title: the session's, else "Rest day". */
export function rowTitle(day: Pick<SessionBrief, 'title'>, t: Translate): string {
  return day.title ?? t('plan.today.rest_title');
}

/** A row that cannot be opened: a rest day (or a row with no kind, which iOS reads as rest). */
export function isRestRow(day: Pick<SessionBrief, 'kind'>): boolean {
  return (day.kind ?? 'rest') === 'rest';
}

/**
 * One TalkBack element per week row: weekday, what it is, how long, and the
 * status as a WORD (3.18: status is never colour alone). iOS
 * `PlanCopy.dayRowLabel`.
 */
export function dayRowLabel(
  day: Pick<SessionBrief, 'weekday' | 'title' | 'minutes' | 'status'>,
  index: number,
  t: Translate,
  lang: Lang,
): string {
  const parts = [weekdayAbbreviation(rowWeekday(day, index), lang), rowTitle(day, t)];
  if (day.minutes !== null && day.minutes > 0) parts.push(duration(day.minutes, lang));
  const word = statusWord(day.status, (key) => t(key));
  if (word) parts.push(word);
  return parts.join(', ');
}

/**
 * The proposal card's row label: weekday, title and length, with no status
 * (a proposal's rows have none yet). iOS `ProgramProposalCard.rowLabel`.
 */
export function proposalRowLabel(
  day: Pick<SessionBrief, 'weekday' | 'title' | 'minutes'>,
  index: number,
  t: Translate,
  lang: Lang,
): string {
  const weekday = weekdayAbbreviation(rowWeekday(day, index), lang);
  const title = rowTitle(day, t);
  if (day.minutes === null || day.minutes <= 0) return `${weekday}, ${title}`;
  return `${weekday}, ${title}, ${duration(day.minutes, lang)}`;
}

/** The feeling as a word, or null for none (iOS `PlanCopy.feelingWord`). */
export function feelingWord(feeling: Feeling | null | undefined, t: Translate): string | null {
  if (!feeling || feeling === 'unknown') return null;
  return t(`plan.feeling.${feeling}`);
}

/** The status word of a session row (shared with the week strip). */
export function sessionStatusWord(status: SessionStatusView | null | undefined, t: Translate): string | null {
  return statusWord(status, (key) => t(key));
}
