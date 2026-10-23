/**
 * What the plan-edit flow asks of the rest of the app: the UI kit's dialog
 * and toast, and the runner's "workout in progress" index.
 *
 * NOTHING LOADS AT IMPORT, for the reason ../program/platform.ts gives: the
 * Coach's store loads every flow with the sign-in and sign-out hooks, long
 * before any screen, and the UI kit and the runner bring their screens and
 * icons with them. Each is required when the flow first calls it.
 */
/* eslint-disable @typescript-eslint/no-require-imports -- loaded at call time (see above) */
import type * as UiKit from '../../../components/ui';
import type * as Runner from '../../runner';

/** The UI kit's alert (`showDialog`). */
export function presentDialog(options: UiKit.DialogOptions): void {
  (require('../../../components/ui') as typeof UiKit).showDialog(options);
}

/** The UI kit's toast (`showToast`), the health kind: a centred line, a few seconds. */
export function presentToast(message: string): void {
  (require('../../../components/ui') as typeof UiKit).showToast(message);
}

/** True while the runner holds a workout in progress for `sessionId` (`RunnerProgressIndex`). */
export function runnerOpenFor(sessionId: string): boolean {
  return (require('../../runner') as typeof Runner).RunnerProgressIndex.summaryFor(sessionId) !== null;
}
