// @f4-stub (plan 3.0.3): the `dayPlan` Coach flow, filled by COACH-3; called by COACH-1's store.
//
// The day-plan wizard (Before, Main, After) and its plan cards.
// Keep the exported name and its `CoachFlow` shape (./types.ts); replace the
// value (and this marker). Takes nothing until COACH-3 lands.
import { inactiveFlow, type CoachFlow } from './types';

export const dayPlanFlow: CoachFlow = inactiveFlow('dayPlan');
