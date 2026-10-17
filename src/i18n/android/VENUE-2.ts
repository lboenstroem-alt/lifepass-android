// Android-only copy for VENUE-2: Reviews, favourites store, report review.
//
// Owned by VENUE-2 (plan 3.0.3). Only words iOS never says go here; every
// iOS string comes from the generated tables through t()/tp(). The rules for
// a pack are in ./pack.ts.
//
// - venue2.report.*  "Report review" (owner decision D5, Play's user-generated
//   content policy). iOS 2.5.6 has no report action yet; the reasons are the
//   API's (ReviewReportInput.reason).
// - venue2.a11y.*    what TalkBack says where iOS draws only stars or a heart
//   (an SF Symbol VoiceOver reads by its image name).
import { definePack } from './pack';

export default definePack({
  en: {
    'venue2.report.action': 'Report review',
    'venue2.report.title': 'Why are you reporting this review?',
    'venue2.report.reason.offensive': 'Offensive or abusive',
    'venue2.report.reason.personal_information': 'Shares personal information',
    'venue2.report.reason.not_genuine': 'Not a genuine visit',
    'venue2.report.reason.spam': 'Spam or advertising',
    'venue2.report.reason.other': 'Something else',
    'venue2.report.sent': 'Thanks for telling us. The LifePass team will take a look.',
    'venue2.report.already': "You've already reported this review. The LifePass team will take a look.",
    'venue2.report.own': "You can't report your own review.",
    'venue2.a11y.rating': '{count} out of 5 stars',
    'venue2.a11y.average': 'Average rating {average} out of 5',
    'venue2.a11y.distribution': 'Rated {star}: {count}',
    'venue2.a11y.favourite': 'Favourite',
  },
  is: {
    'venue2.report.action': 'Tilkynna umsögn',
    'venue2.report.title': 'Hvers vegna viltu tilkynna þessa umsögn?',
    'venue2.report.reason.offensive': 'Móðgandi eða særandi',
    'venue2.report.reason.personal_information': 'Birtir persónuupplýsingar',
    'venue2.report.reason.not_genuine': 'Ekki raunveruleg heimsókn',
    'venue2.report.reason.spam': 'Ruslefni eða auglýsing',
    'venue2.report.reason.other': 'Eitthvað annað',
    'venue2.report.sent': 'Takk fyrir ábendinguna. LifePass-teymið fer yfir umsögnina.',
    'venue2.report.already': 'Þú hefur þegar tilkynnt þessa umsögn. LifePass-teymið fer yfir hana.',
    'venue2.report.own': 'Þú getur ekki tilkynnt þína eigin umsögn.',
    'venue2.a11y.rating': '{count} af 5 stjörnum',
    'venue2.a11y.average': 'Meðaleinkunn {average} af 5',
    'venue2.a11y.distribution': 'Einkunn {star}: {count}',
    'venue2.a11y.favourite': 'Uppáhald',
  },
});
