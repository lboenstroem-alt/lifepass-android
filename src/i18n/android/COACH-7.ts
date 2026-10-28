// Android-only copy for COACH-7: "Report this reply" on the Coach's own
// replies (owner decision of 28 Oct 2026 for Android 3.1.0; Google Play's
// policy for AI-generated content asks for an in-app report). iOS has no
// report action yet, so none of these words is in the generated tables.
//
// Owned by COACH-7 (src/features/coach/report). The rules for a pack are in
// ./pack.ts. The tone follows "Report review" (VENUE-2): short, plain, no
// blame on the member.
//
// - coach.report.action      the "..." button, the long-press and TalkBack's action
// - coach.report.title       the sheet's title
// - coach.report.privacy     what is sent, and that nothing else of the chat is
// - coach.report.reasons     the reasons' heading (and their radio group's name)
// - coach.report.reason.*    the API's four reasons (offensive, harmful,
//                            inaccurate, other); the Icelandic agrees with
//                            "svarið" (neuter) and "ráð" (neuter plural)
// - coach.report.note        the optional note's placeholder and label
// - coach.report.send        Send
// - coach.report.sent        the toast once the report is in
// - coach.report.rate_limited  the server's 429 (20 reports a day per account)
import { definePack } from './pack';

export default definePack({
  en: {
    'coach.report.action': 'Report this reply',
    'coach.report.title': 'Report this reply',
    'coach.report.privacy': 'Only this reply and what you add here go to the LifePass team. Nothing else from your chat is sent.',
    'coach.report.reasons': "What's wrong with it?",
    'coach.report.reason.offensive': 'Offensive or hateful',
    'coach.report.reason.harmful': 'Harmful or unsafe advice',
    'coach.report.reason.inaccurate': 'Wrong or misleading',
    'coach.report.reason.other': 'Something else',
    'coach.report.note': 'Anything to add? (optional)',
    'coach.report.send': 'Send',
    'coach.report.sent': "Thanks. We'll look at it.",
    'coach.report.rate_limited': "You've sent a lot of reports. Please try again later.",
  },
  is: {
    'coach.report.action': 'Tilkynna þetta svar',
    'coach.report.title': 'Tilkynna þetta svar',
    'coach.report.privacy': 'Aðeins þetta svar og það sem þú bætir við hér fara til LifePass-teymisins. Ekkert annað úr spjallinu er sent.',
    'coach.report.reasons': 'Hvað er að svarinu?',
    'coach.report.reason.offensive': 'Móðgandi eða hatursfullt',
    'coach.report.reason.harmful': 'Skaðleg eða hættuleg ráð',
    'coach.report.reason.inaccurate': 'Rangt eða villandi',
    'coach.report.reason.other': 'Eitthvað annað',
    'coach.report.note': 'Viltu bæta einhverju við? (valfrjálst)',
    'coach.report.send': 'Senda',
    'coach.report.sent': 'Takk. Við skoðum þetta.',
    'coach.report.rate_limited': 'Þú hefur sent margar tilkynningar. Reyndu aftur síðar.',
  },
});
