/**
 * Adjust my plan (COACH-5): the tap-to-choose revision of the running plan.
 * ../flows/adjust.ts is how the Coach's store runs it; this is what the rest
 * of the Coach may read of it.
 */
export {
  adjustCurrentFrom,
  AdjustOptionValue,
  changeAdjust,
  changeKinds,
  isEmpty,
  isTargetOnly,
  keyForSubmit,
  newAdjustFlow,
  revisionInput,
  summaryLines,
  targetOnlyValue,
  type AdjustChangeKind,
  type AdjustCurrent,
  type AdjustFlowState,
  type AdjustSummaryLine,
  type TargetChange,
} from './model';
export { beginAdjust, isAdjustActive, startAdjust } from './flow';
