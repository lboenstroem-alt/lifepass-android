// Android-only copy for PLAN-4: This plan, change days, programme overview, proposal and adopt, history.
//
// Owned by PLAN-4 (plan 3.0.3). Only words iOS never says go here; every
// iOS string comes from the generated tables through t()/tp(). The rules for
// a pack are in ./pack.ts.
//
// - plan4.reminder_time: TalkBack's name for the proposal card's reminder
//   time menu. iOS's Menu is labelled by the time it shows ("07:00"), which
//   VoiceOver reads with the button; TalkBack would read the time twice (the
//   name and the value), so the menu is named for what it sets and the time
//   is its value.
// - plan4.done_source.synced: the history's source line for a workout a
//   wearable counted. iOS says "Counted from a workout in Apple Health"
//   (`plan.done_source.apple_health`); Android reads no Health Connect (owner
//   decision), so a workout synced from a member's other phone is named
//   without the brand.
import { definePack } from './pack';

export default definePack({
  en: {
    'plan4.reminder_time': 'Reminder time',
    'plan4.done_source.synced': 'Counted from a workout in a health app',
  },
  is: {
    'plan4.reminder_time': 'Tími áminningar',
    'plan4.done_source.synced': 'Talið út frá æfingu í heilsuforriti',
  },
});
