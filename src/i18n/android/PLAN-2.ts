// Android-only copy for PLAN-2: Today card, session preview, pool picker, Home Today row.
//
// Owned by PLAN-2 (plan 3.0.3). Only words iOS never says go here; every
// iOS string comes from the generated tables through t()/tp(). The rules for
// a pack are in ./pack.ts.
//
// - plan.done_source.wearable_android: the source line under a session a
//   wearable counted. iOS's (`plan.done_source.apple_health`) names Apple
//   Health; an Android phone reads no Health Connect (owner decision), but
//   the same account's session can still be counted from a watch through the
//   member's other phone, so the line names the device, not the platform.
import { definePack } from './pack';

export default definePack({
  en: {
    'plan.done_source.wearable_android': 'Counted from a workout your watch or phone recorded',
  },
  is: {
    'plan.done_source.wearable_android': 'Talið út frá æfingu sem úrið eða síminn skráði',
  },
});
