// Android-only copy for BODY-1: Body and goals screen, weight history, delete everything, export, reminder settings.
//
// Owned by BODY-1 (plan 3.0.3). Only words iOS never says go here; every
// iOS string comes from the generated tables through t()/tp(). The rules for
// a pack are in ./pack.ts.
//
// WHY THESE EXIST. Android ships no Health Connect (owner decision,
// DECISIONS.md), and nothing on Body and goals may name Apple Health or
// Health Connect. Where the iOS line names Apple Health in a place Android
// shows, it is reworded here neutrally, saying the same thing about the same
// data: a member who once connected Apple Health on an iPhone still has those
// day summaries and weigh-ins on the server, and deleting everything still
// deletes them. Lines that only make sense with Apple Health on this phone
// (the Health app hint, "only if you connect it", "never sent to the AI")
// are hidden instead, as the consent sheet hides them.
import { definePack } from './pack';

export default definePack({
  en: {
    /** Account's row subtitle with tracking off (iOS `bodygoals.row_sub_off`). */
    'bodygoals.android.row_sub_off': 'Workout plan and food log',
    /** The delete-everything question (iOS `bodygoals.delete_body`). */
    'bodygoals.android.delete_body':
      "This turns off tracking and permanently deletes your weight entries, plans, workouts, weekly reviews, meals, calorie goal and daily health summaries. It can't be undone. Your membership is not affected.",
    /** What we store: how long each kind is kept (iOS `bodygoals.retention`). */
    'bodygoals.android.retention':
      "Meals, plans and weekly reviews are deleted after 12 months, photo estimates you didn't save after 30 days, weight entries after 24 months, and daily health summaries after 24 months. Your calorie goal stays until you change it.",
    /** The "Deleted" sheet's day summaries line (iOS `bodygoals.deleted.days`). */
    'bodygoals.android.deleted.days.one': '{count} daily health summary',
    'bodygoals.android.deleted.days.many': '{count} daily health summaries',
    /** Weight history: a weigh-in that came from a connected health app (iOS `bodygoals.source.wearable`). */
    'bodygoals.android.source.wearable': 'Connected app',
    /** Weight history: the delete question for such a weigh-in (iOS `bodygoals.delete_wearable_note`). */
    'bodygoals.android.delete_wearable_note':
      "This entry came from a connected health app. Once deleted, that day's weight won't be added again.",
  },
  is: {
    'bodygoals.android.row_sub_off': 'Æfingaáætlun og matardagbók',
    'bodygoals.android.delete_body':
      'Þetta slekkur á skráningu og eyðir varanlega þyngdarfærslum, áætlunum, æfingum, vikuyfirferðum, máltíðum, hitaeiningamarkmiði og daglegum heilsuyfirlitum. Það er ekki hægt að afturkalla. Áskriftin breytist ekki.',
    'bodygoals.android.retention':
      'Máltíðum, áætlunum og vikuyfirferðum er eytt eftir 12 mánuði, mati út frá myndum sem þú vistaðir ekki eftir 30 daga, þyngdarfærslum eftir 24 mánuði og daglegum heilsuyfirlitum eftir 24 mánuði. Hitaeiningamarkmiðið helst þar til þú breytir því.',
    'bodygoals.android.deleted.days.one': '{count} daglegt heilsuyfirlit',
    'bodygoals.android.deleted.days.many': '{count} dagleg heilsuyfirlit',
    'bodygoals.android.source.wearable': 'Tengt forrit',
    'bodygoals.android.delete_wearable_note':
      'Þessi færsla kom úr tengdu heilsuforriti. Eftir að henni er eytt verður þyngd þess dags ekki bætt við aftur.',
  },
});
