// Android-only copy for COACH-6: changing the workout plan by talking to the
// Coach (OP-58 to OP-62), and the consent lines that name it.
//
// Owned by COACH-6. Only words iOS never says go here; every iOS string comes
// from the generated tables through t()/tp(). The rules for a pack are in
// ./pack.ts.
//
// Empty since the tables were regenerated from iOS 3.1.0: every word this
// package shows is iOS's own (LifePass 2/Services/LocalizationHealth+PlanEdit.swift,
// the planEdit pack, plus `plan.overview.cycle` in the plan pack), so it comes
// from strings.{en,is}.json and changes in iOS first.
//
// TWO OF THOSE KEYS ARE THE CONSENT TEXT 2026-09-v4 (`healthconsent.ai.plan_edit`,
// `healthconsent.ai.never_text_v4`): the words a member accepts, so they
// change only with a new consent version. They are the web's
// `health.consent.ai.plan_edit` and `health.consent.ai.never_text` of the
// same version WORD FOR WORD (monorepo apps/web common.{en,is}.json, pinned by
// health-i18n.test.ts): one text per consent version, whichever screen grants
// it.
//
// Everything the preview card says about the change itself (the summary,
// the day labels, each "before → after", the notes) is server text in the
// app language: only the app's frame is in the tables.
import { definePack } from './pack';

export default definePack({
  en: {},
  is: {},
});
