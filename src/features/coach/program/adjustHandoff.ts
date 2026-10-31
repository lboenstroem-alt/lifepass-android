/**
 * Where the programme wizard hands a member to Adjust my plan (COACH-5).
 *
 * iOS keeps both flows in one view model, so the wizard's gate simply calls
 * `beginAdjust(context:entry: "gate")`: "Adjust my plan" on the running-plan
 * bubble, and "Make a new plan" when a plan runs on a server that revises
 * (`SPEC` 6.6). Here Adjust my plan is another package's flow, so it
 * installs this door when its module loads:
 *
 *   installProgramAdjustHandoff({ begin: (context, entry) => beginAdjust(context, entry) });
 *
 * UNTIL IT IS INSTALLED the wizard treats the server as one that does not
 * revise: the gate offers "Open Plan" and "Make a new plan" (iOS's own answer
 * on such a server), never a chip that would lead nowhere.
 */
import type { ProgramContext } from './context';

export interface ProgramAdjustHandoff {
  /**
   * Opens Adjust my plan's menu on the running plan (iOS `beginAdjust`). The
   * gate's chip is already answered and, for "Adjust my plan", the member's
   * bubble is already on screen. `entry` is the analytics word.
   */
  begin(context: ProgramContext, entry: 'gate'): Promise<void> | void;
}

let installed: ProgramAdjustHandoff | null = null;

/** Adjust my plan installs itself (null takes it away again, for tests). */
export function installProgramAdjustHandoff(handoff: ProgramAdjustHandoff | null): void {
  installed = handoff;
}

export function programAdjustHandoff(): ProgramAdjustHandoff | null {
  return installed;
}

/**
 * A plan can be adjusted rather than replaced: the server revises AND the
 * flow that does it is in this build AND the running plan is not one the
 * member wrote (a custom plan refuses a revision, 409 `custom_plan_locked`).
 */
export function canRevise(context: Pick<ProgramContext, 'supportsPlanRevision'> & Partial<Pick<ProgramContext, 'liveProgram'>>): boolean {
  return context.supportsPlanRevision && installed !== null && context.liveProgram?.custom !== true;
}
