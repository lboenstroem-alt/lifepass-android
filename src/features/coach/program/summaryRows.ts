/**
 * The summary's rows (iOS `ProgramSummaryBubble.rows`): every answer the
 * build will carry, in the order it was asked, each one the question a tap on
 * it asks again.
 *
 * R16 took two questions out of the wizard (length and where) and put their
 * answers here as defaults, which is only honest if they are as easy to
 * change as they were to answer.
 */
import type { Lang, Params } from '../../../i18n';
import { weekdayAbbreviation } from '../../../i18n/format';
import {
  bodyPartLabelKey,
  defaultTrainingDays,
  experienceLabelKey,
  focusLabelKey,
  givesTarget,
  goalLabelKey,
  kindLabelKey,
  PROGRAM_KINDS,
  safetyLabelKey,
  type ProgramAnswers,
  type ProgramQuestion,
} from './model';

export interface ProgramSummaryRow {
  /** The question a tap on the row asks again. */
  readonly question: ProgramQuestion;
  readonly value: string;
}

type Translate = (key: string, params?: Params) => string;

/** "Mon, Wed, Fri" in `language`. */
export function weekdayListIn(isoWeekdays: readonly number[], language: Lang): string {
  return [...isoWeekdays]
    .sort((a, b) => a - b)
    .map((day) => weekdayAbbreviation(day, language))
    .join(', ');
}

/**
 * The body parts and the condition word, when either was given. Never a
 * pregnancy or an eating-disorder answer: the wizard refused on those and
 * kept nothing.
 */
export function careLine(answers: ProgramAnswers, t: Translate): string | null {
  const parts = answers.injuries.map((part) => t(bodyPartLabelKey(part)));
  if (answers.safety.conditionOrMedication) parts.push(t(safetyLabelKey('condition')));
  if (parts.length === 0) return null;
  return t('program.summary.care', { what: parts.join(', ') });
}

export function summaryRows(answers: ProgramAnswers, t: Translate, language: Lang): ProgramSummaryRow[] {
  const rows: ProgramSummaryRow[] = [];
  if (answers.goal) rows.push({ question: 'goal', value: t(goalLabelKey(answers.goal)) });
  if (answers.focus) rows.push({ question: 'focus', value: t(focusLabelKey(answers.focus)) });
  if (answers.daysPerWeek !== null) {
    const list = answers.trainingDays.length === 0 ? defaultTrainingDays(answers.daysPerWeek) : answers.trainingDays;
    rows.push({
      question: 'days',
      value: t('program.summary.days', { count: String(answers.daysPerWeek), days: weekdayListIn(list, language) }),
    });
  }
  const kinds = answers.kinds.length === 0 ? PROGRAM_KINDS : answers.kinds;
  rows.push({
    question: 'kinds',
    value: t('program.summary.where', { places: kinds.map((kind) => t(kindLabelKey(kind))).join(', ') }),
  });
  rows.push({ question: 'length', value: t('program.summary.length', { weeks: String(answers.weeks) }) });
  if (answers.experience) rows.push({ question: 'experience', value: t(experienceLabelKey(answers.experience)) });
  // With a target weight the row says so, never which one (`SPEC` 6.2).
  const bodyKey = answers.body
    ? givesTarget(answers.body)
      ? 'program.body.added_target'
      : 'program.summary.targets_yes'
    : 'program.summary.targets_no';
  rows.push({ question: 'body', value: t(bodyKey) });
  // Only when something was given: "Planned around: nothing" would print a
  // health answer nobody asked to see.
  const care = careLine(answers, t);
  if (care) rows.push({ question: 'safety', value: care });
  return rows;
}
