/**
 * The session preview, for every Plan surface that opens it: the Today card
 * (a future day's Preview, the rest day's pull), and PLAN-4's programme
 * overview day rows and proposal week 1 (iOS SessionPreviewSheet's four
 * doors). Pass `canStart` from `canStartRunnerToday` (the runner on today's
 * planned session only) and `onPulled` into the shell's `applySessionAction`.
 */
export { default as SessionPreviewSheet, type SessionPreviewSheetProps } from './SessionPreviewSheet';
export { previewAction, pullFailure, PULL_REFUSALS, type PreviewAction, type PullFailure } from './previewRules';
export { canStartRunnerToday } from '../today/rules';
