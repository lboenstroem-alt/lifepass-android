/**
 * The day plan's question bubbles (iOS `CoachViewModel.planQuestionDef`).
 *
 * Every chip's `value` is a wire value the answers understand
 * (./model.ts `recordPlanAnswer`); only the labels are translated. Regions
 * and class types reuse the labels the sight card and the Classes tab
 * already show (`attraction.region.*`, `classes.cat_*`), so the app never
 * names one thing two ways.
 */
import type { QuestionOption } from '../../../types/coach';
import {
  ANY_CLASS_TYPE,
  CLASS_TYPE_LIMIT,
  COACH_CLASS_TYPES,
  COACH_DURATIONS,
  COACH_GOALS,
  COACH_INTENSITIES,
  COACH_REGIONS,
  COACH_TIMES_OF_DAY,
  COACH_WHEN_WORDS,
  NEAR_CHOICE,
  type PlanQuestion,
} from './model';

export interface PlanQuestionDef {
  readonly text: string;
  readonly options: readonly QuestionOption[];
}

/** The bubble that asks `question`, in the Coach's language (`t`). */
export function planQuestionDef(question: PlanQuestion, t: (key: string) => string): PlanQuestionDef {
  switch (question) {
    case 'goal':
      return {
        text: t('coach.plan.q.goal'),
        options: COACH_GOALS.map((goal) => ({ label: t(`coach.plan.goal.${goal}`), value: goal })),
      };
    case 'area':
      return {
        text: t('coach.plan.q.area'),
        options: [
          { label: t('coach.plan.area.near'), value: NEAR_CHOICE },
          ...COACH_REGIONS.map((region) => ({ label: t(`attraction.region.${region}`), value: region })),
        ],
      };
    case 'when':
      return {
        text: t('coach.plan.q.when'),
        options: COACH_WHEN_WORDS.map((when) => ({ label: t(`coach.plan.when.${when}`), value: when })),
      };
    case 'timeOfDay':
      return {
        text: t('coach.plan.q.time'),
        options: COACH_TIMES_OF_DAY.map((time) => ({ label: t(`coach.plan.time.${time}`), value: time })),
      };
    case 'duration':
      return {
        text: t('coach.plan.q.duration'),
        options: COACH_DURATIONS.map((duration) => ({ label: t(`coach.plan.duration.${duration}`), value: duration })),
      };
    case 'intensity':
      return {
        text: t('coach.plan.q.intensity'),
        options: COACH_INTENSITIES.map((intensity) => ({ label: t(`coach.plan.intensity.${intensity}`), value: intensity })),
      };
    case 'classType':
      return {
        text: t('coach.plan.q.class_type'),
        options: [
          ...COACH_CLASS_TYPES.map((type) => ({ label: t(`classes.cat_${type}`), value: type })),
          { label: t('coach.plan.class_type.any'), value: ANY_CLASS_TYPE },
          // A typed class type goes to the server as `intake.classType`, which
          // it caps at 40: past that it refuses the whole request, so the
          // field cuts to the same number as the member types.
          { label: t('coach.other.label'), value: '', isOther: true, maxLength: CLASS_TYPE_LIMIT },
        ],
      };
  }
}
