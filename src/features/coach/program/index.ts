/**
 * The programme wizard's door for the rest of the Coach, Adjust my plan
 * (COACH-5) above all. iOS keeps both flows in one view model; here Adjust
 * my plan reaches the wizard through these:
 *
 * - `installProgramAdjustHandoff({ begin })`: install Adjust my plan's
 *   `beginAdjust`, which the wizard's running-plan gate hands to (until it is
 *   installed the gate offers "Open Plan" and "Make a new plan").
 * - `startProgram(...)`: Adjust my plan's "Start a new plan", and its
 *   fallback when a gate is not passed (iOS `startProgram(entry: .chip,
 *   showUserBubble: false)`).
 * - `readProgramContext()`: the member's situation, read fresh.
 * - `applyFeedbackSafetyHook()`: the monthly feedback's safety hook after a
 *   local refusal.
 * - `appendProposalMessage(detail)`: a revision lands as the same card, and
 *   its outcome comes back through `setProposalOutcome`.
 * - The bubble builders, so every turn is in the health lane, and the chip
 *   values and answer models the menus are made of.
 */
export { canRevise, installProgramAdjustHandoff, programAdjustHandoff, type ProgramAdjustHandoff } from './adjustHandoff';
export {
  DEFAULT_PROGRAM_CONTEXT,
  kindsForUsage,
  programContextFromStores,
  readProgramContext,
  setProgramContextForTests,
  type ProgramContext,
} from './context';
export {
  appendProgramBubble,
  appendProgramQuestion,
  appendProgramUser,
  appendProposalMessage,
  isProgramQuestion,
  markProgramAnswered,
  ProgramMessageKind,
  type ProgramProposalPayload,
  type ProgramSummaryPayload,
} from './messages';
export {
  DAY_CHOICES,
  defaultTrainingDays,
  goalLabelKey,
  lengthLabelKey,
  PROGRAM_GOALS,
  PROGRAM_LENGTHS,
  ProgramOptionValue,
  type ProgramEntry,
  type ProgramGoal,
  type ProgramLength,
} from './model';
export {
  applyFeedbackSafetyHook,
  programStoreChanged,
  replaceProposal,
  setProposalOutcome,
  startProgram,
  weekdayList,
  type StartProgramOptions,
} from './wizard';
