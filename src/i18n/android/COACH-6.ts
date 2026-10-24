// Android copy for COACH-6: changing the workout plan by talking to the Coach
// (OP-58 to OP-62), and the consent lines that name it.
//
// THESE ARE iOS's WORDS AND KEYS (LifePass 2/Services/LocalizationHealth+PlanEdit.swift
// on lifepass-ios feat/coach-plan-edits), here only until the iOS
// dictionaries with them are regenerated into strings.{en,is}.json. Then the
// packs test reports every key of this file as defined twice (here and by
// iOS): delete those keys from here, never from the generated tables
// (./pack.ts). Change a word in iOS first.
//
// TWO KEYS ARE THE CONSENT TEXT 2026-09-v4 (`healthconsent.ai.plan_edit`,
// `healthconsent.ai.never_text_v4`): the words a member accepts, so they
// change only with a new consent version. They are the web's
// `health.consent.ai.plan_edit` and `health.consent.ai.never_text` of the
// same version WORD FOR WORD (monorepo apps/web common.{en,is}.json, pinned by
// health-i18n.test.ts): one text per consent version, whichever screen grants
// it. Their Icelandic awaits native review with the privacy edition.
//
// Everything the preview card says about the change itself (the summary,
// the day labels, each "before → after", the notes) is server text in the
// app language: only the app's frame is here.
import { definePack } from './pack';

export default definePack({
  en: {
    // Entry points
    'coach.planEdit.chip': 'Change my plan',
    'coach.planEdit.changeWithCoach': 'Change with Coach',
    'coach.planEdit.notHaveThis': "I don't have this",
    'coach.planEdit.notHavePrefill': "I don't have the equipment for {exercise}",
    'coach.planEdit.ask':
      "Tell me what to change, in your own words. For example: swap bench press for dumbbell press, or I don't have a cable machine. Nothing changes until you tap Apply.",
    'coach.planEdit.askSession': 'What would you like to change about {title}? Nothing changes until you tap Apply.',
    'coach.planEdit.askPrefilled': 'Send it as it is, or say it your own way. Nothing changes until you tap Apply.',

    // The preview card
    'coach.planEdit.cardTitle': 'Change to your plan',
    'coach.planEdit.wontUse': "Won't use: {labels}",
    'coach.planEdit.useAgain': 'Can use again: {labels}',
    'coach.planEdit.ownTag': 'Your exercise',
    'coach.planEdit.variantOurs': 'Our exercise',
    'coach.planEdit.variantOwn': 'Your own',
    'coach.planEdit.variantPicker': 'Choose a version',
    'coach.planEdit.apply': 'Apply',
    'coach.planEdit.cancel': 'Cancel',
    'coach.planEdit.cancelled': 'Cancelled',
    'coach.planEdit.superseded': 'Replaced by the newer suggestion',
    'coach.planEdit.staleCard': 'No longer open',
    'coach.planEdit.changed': 'Changed',
    'coach.planEdit.undo': 'Undo',
    'coach.planEdit.changedUndo': 'Changed · Undo',
    'coach.planEdit.undone': 'Undone',
    'coach.planEdit.updatedToast': 'Your plan is updated',
    'coach.planEdit.undoneToast': 'Change undone',
    'coach.planEdit.undoneToastKept': 'Change undone. Days you already did stay as they are.',
    'coach.planEdit.keptRows': 'Days you already did stay as they are.',
    'coach.planEdit.runnerOpen': "Finish or close today's workout first.",
    'coach.planEdit.noChange': "I couldn't change anything with that request.",
    'coach.planEdit.confirmCustom.title': 'Change how your plan repeats?',
    'coach.planEdit.confirmCustom.body': 'Your plan will repeat as a cycle of days instead of by weekday.',
    'coach.planEdit.confirmCustom.ok': 'Change plan',

    // The Changes list (OP-62)
    'coach.planEdit.changesList': 'Changes',
    'coach.planEdit.changes.empty': 'No changes made in chat yet.',
    'coach.planEdit.changes.loadFailed': "Couldn't load your changes.",

    // Adjust my plan after changes in chat
    'coach.planEdit.adjustWarning':
      "Adjusting rebuilds your plan. Changes you made in chat will be replaced, apart from equipment you don't have.",

    // Problems
    'coach.planEdit.error.personalData': 'Leave out emails, phone numbers, links and your own body measurements, then try again.',
    'coach.planEdit.error.limit':
      "You've reached today's limit for plan changes. Try again tomorrow, or change days and swap exercises in the Plan tab.",
    'coach.planEdit.error.paused': 'Plan changes in chat are paused for now. The Plan tab still works.',
    'coach.planEdit.error.upstream': "I couldn't work that out just now. Try again in a moment.",
    'coach.planEdit.error.stale': 'Your plan changed since I suggested this. Ask me again.',
    'coach.planEdit.error.undoWindow': 'This change can no longer be undone.',
    'coach.planEdit.error.undoChanged':
      "This change can't be undone because those days have changed since. Undo the later change first.",
    'coach.planEdit.error.notLive': "This plan has ended, so it can't be changed.",
    'coach.planEdit.error.planPaused': 'Resume your plan to change it.',
    'coach.planEdit.askAgain': 'Ask again',
    'coach.planEdit.retry': 'Try again',

    // The one-tap consent
    'coach.planEdit.consent.title': 'Change your plan in chat',
    'coach.planEdit.consent.cta': 'Turn on and continue',
    'coach.planEdit.consent.declined': 'Okay. Your plan stays as it is.',

    // The consent text, 2026-09-v4
    'healthconsent.ai.plan_edit':
      "If you ask the Coach to change your workout plan, your words and the plan (its exercises, sets and rest, and the names and notes you wrote for your own exercises) go to Anthropic only to make the change. Never your safety answers, body measurements or dates, and never your name, email or any account ID. Anthropic may not train on them and deletes them within 30 days, apart from the exceptions in our privacy policy. We don't keep your words. A change you apply is kept with your plan, including the names and notes you wrote for your own exercises, and a suggestion you don't apply is deleted within 24 hours.",
    'healthconsent.ai.never_text_v4':
      'Never notes or anything you type when a plan is made, apart from a change you ask the Coach to make (below). Coach chat messages are sent as you write them, so leave health details out of chat.',

    // Plan tab: a plan that repeats as a cycle
    'plan.overview.cycle': 'Repeats every {count} days',
  },
  is: {
    // Entry points
    'coach.planEdit.chip': 'Breyta áætluninni',
    'coach.planEdit.changeWithCoach': 'Breyta með ráðgjafanum',
    'coach.planEdit.notHaveThis': 'Ég er ekki með þetta',
    'coach.planEdit.notHavePrefill': 'Ég er ekki með búnaðinn fyrir {exercise}',
    'coach.planEdit.ask':
      'Segðu mér með þínum orðum hverju á að breyta. Til dæmis: skiptu bekkpressu út fyrir handlóðapressu, eða ég er ekki með kapalvél. Engu er breytt fyrr en þú pikkar á Staðfesta.',
    'coach.planEdit.askSession': 'Hverju viltu breyta í {title}? Engu er breytt fyrr en þú pikkar á Staðfesta.',
    'coach.planEdit.askPrefilled': 'Sendu þetta eins og það er eða orðaðu það á þinn hátt. Engu er breytt fyrr en þú pikkar á Staðfesta.',

    // The preview card
    'coach.planEdit.cardTitle': 'Breyting á áætluninni',
    'coach.planEdit.wontUse': 'Ekki notað: {labels}',
    'coach.planEdit.useAgain': 'Má nota aftur: {labels}',
    'coach.planEdit.ownTag': 'Þín æfing',
    'coach.planEdit.variantOurs': 'Okkar æfing',
    'coach.planEdit.variantOwn': 'Þín eigin',
    'coach.planEdit.variantPicker': 'Veldu útgáfu',
    'coach.planEdit.apply': 'Staðfesta',
    'coach.planEdit.cancel': 'Hætta við',
    'coach.planEdit.cancelled': 'Hætt við',
    'coach.planEdit.superseded': 'Nýrri tillaga kom í staðinn',
    'coach.planEdit.staleCard': 'Ekki lengur opin',
    'coach.planEdit.changed': 'Breytt',
    'coach.planEdit.undo': 'Afturkalla',
    'coach.planEdit.changedUndo': 'Breytt · Afturkalla',
    'coach.planEdit.undone': 'Afturkallað',
    'coach.planEdit.updatedToast': 'Áætlunin er uppfærð',
    'coach.planEdit.undoneToast': 'Breytingin var afturkölluð',
    'coach.planEdit.undoneToastKept': 'Breytingin var afturkölluð. Dagar sem þú hefur lokið haldast óbreyttir.',
    'coach.planEdit.keptRows': 'Dagar sem þú hefur lokið haldast óbreyttir.',
    'coach.planEdit.runnerOpen': 'Ljúktu eða lokaðu æfingu dagsins fyrst.',
    'coach.planEdit.noChange': 'Ég gat engu breytt með þessari beiðni.',
    'coach.planEdit.confirmCustom.title': 'Breyta því hvernig áætlunin endurtekur sig?',
    'coach.planEdit.confirmCustom.body': 'Áætlunin endurtekur sig þá sem lota af dögum í stað vikudaga.',
    'coach.planEdit.confirmCustom.ok': 'Breyta áætlun',

    // The Changes list (OP-62)
    'coach.planEdit.changesList': 'Breytingar',
    'coach.planEdit.changes.empty': 'Engar breytingar gerðar í spjalli enn.',
    'coach.planEdit.changes.loadFailed': 'Ekki tókst að sækja breytingarnar.',

    // Adjust my plan after changes in chat
    'coach.planEdit.adjustWarning':
      'Aðlögun byggir áætlunina upp á nýtt. Breytingar sem þú gerðir í spjalli hverfa, nema búnaður sem þú ert ekki með.',

    // Problems
    'coach.planEdit.error.personalData': 'Slepptu netföngum, símanúmerum, tenglum og þínum eigin líkamsmælingum og reyndu aftur.',
    'coach.planEdit.error.limit':
      'Þú hefur náð hámarki dagsins fyrir breytingar á áætlun. Reyndu aftur á morgun, eða breyttu dögum og skiptu æfingum í Áætlun.',
    'coach.planEdit.error.paused': 'Breytingar í spjalli liggja niðri í bili. Áætlun virkar áfram.',
    'coach.planEdit.error.upstream': 'Mér tókst það ekki í þetta sinn. Reyndu aftur eftir smá stund.',
    'coach.planEdit.error.stale': 'Áætlunin hefur breyst síðan ég stakk upp á þessu. Spurðu mig aftur.',
    'coach.planEdit.error.undoWindow': 'Ekki er lengur hægt að afturkalla þessa breytingu.',
    'coach.planEdit.error.undoChanged':
      'Ekki er hægt að afturkalla þessa breytingu því dagarnir hafa breyst síðan. Afturkallaðu nýrri breytinguna fyrst.',
    'coach.planEdit.error.notLive': 'Þessari áætlun er lokið og henni er ekki hægt að breyta.',
    'coach.planEdit.error.planPaused': 'Haltu áætluninni áfram til að breyta henni.',
    'coach.planEdit.askAgain': 'Spyrja aftur',
    'coach.planEdit.retry': 'Reyna aftur',

    // The one-tap consent
    'coach.planEdit.consent.title': 'Breyttu áætluninni í spjalli',
    'coach.planEdit.consent.cta': 'Kveikja og halda áfram',
    'coach.planEdit.consent.declined': 'Allt í lagi. Áætlunin helst óbreytt.',

    // The consent text, 2026-09-v4
    'healthconsent.ai.plan_edit':
      'Ef þú biður ráðgjafann að breyta æfingaáætluninni fara orðin þín og áætlunin (æfingar hennar, sett og hvíld, og nöfn og athugasemdir sem þú skrifaðir fyrir eigin æfingar) til Anthropic eingöngu til að gera breytinguna. Aldrei svör þín við öryggisspurningunum, líkamsmælingar eða dagsetningar, og aldrei nafnið þitt, netfang eða auðkenni aðgangs. Anthropic má ekki nota þau til þjálfunar og eyðir þeim innan 30 daga, með þeim undantekningum sem koma fram í persónuverndarstefnunni. Við geymum ekki orðin þín. Breyting sem þú staðfestir er geymd með áætluninni, þar á meðal nöfn og athugasemdir sem þú skrifaðir fyrir eigin æfingar, og tillögu sem þú staðfestir ekki er eytt innan sólarhrings.',
    'healthconsent.ai.never_text_v4':
      'Aldrei athugasemdir eða neitt sem þú skrifar þegar áætlun er búin til, nema breyting sem þú biður ráðgjafann að gera (sjá hér að neðan). Skilaboð í spjalli við ráðgjafann eru send eins og þú skrifar þau, svo slepptu heilsuupplýsingum þar.',

    // Plan tab: a plan that repeats as a cycle
    'plan.overview.cycle': 'Endurtekst á {count} daga fresti',
  },
});
