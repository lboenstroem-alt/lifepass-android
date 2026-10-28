// Android-only copy for PLAN-1: Plan tab shell, gate and intro, week strip.
//
// Owned by PLAN-1 (plan 3.0.3). Only words iOS never says go here; every
// iOS string comes from the generated tables through t()/tp(). The rules for
// a pack are in ./pack.ts.
//
// - plan.gate.b3_android: the gate's third bullet. iOS's (`plan.gate.b3`)
//   promises "your sleep and steps from Apple Health"; Android reads no
//   Health Connect (owner decision), so it names what the plan does give a
//   member every week: the review of their sessions, meals and weight.
import { definePack } from './pack';

export default definePack({
  en: {
    'plan.gate.b3_android': 'A weekly review of your sessions, meals and weight, next to your plan',
  },
  is: {
    'plan.gate.b3_android': 'Vikuleg yfirferð yfir æfingar, máltíðir og þyngd við hlið áætlunarinnar',
  },
});
