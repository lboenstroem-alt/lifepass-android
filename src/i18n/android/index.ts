// The Android pack registry: every package's Android-only copy, in merge
// order (foundation first, then the feature packages in plan order).
//
// src/i18n/tables.ts merges these over the generated iOS tables. A key two
// packs define, or a pack key the iOS tables already have, is reported there
// (and fails src/i18n/__tests__/packs.test.ts): the Android version of the
// trap iOS's LPHealthStrings.merged springs in DEBUG.
//
// A package fills ITS OWN file (./<package-id>.ts); only F1 edits this list.
// F1's own pack holds the few Android-only words two packages share.
// Health Connect (HC-1, HC-2) is not built (owner decision), so it has no pack.
// Two came after the parity plan, in this order: COACH-6 (changing the plan
// in chat with the Coach) and UPDATE-1 (the update prompt).
import type { AndroidPack } from './pack';

import F1 from './F1';
import F2 from './F2';
import F3 from './F3';
import F4 from './F4';
import F5 from './F5';
import F6 from './F6';
import F7 from './F7';
import F8 from './F8';
import AUTH_1 from './AUTH-1';
import AUTH_2 from './AUTH-2';
import AUTH_3 from './AUTH-3';
import HOME_1 from './HOME-1';
import EXPL_1 from './EXPL-1';
import VENUE_1 from './VENUE-1';
import VENUE_2 from './VENUE-2';
import CHECKIN_1 from './CHECKIN-1';
import CHECKIN_2 from './CHECKIN-2';
import BOOK_1 from './BOOK-1';
import CLASS_1 from './CLASS-1';
import PLANS_1 from './PLANS-1';
import ACCT_1 from './ACCT-1';
import ACCT_2 from './ACCT-2';
import ACCT_3 from './ACCT-3';
import ACCT_4 from './ACCT-4';
import COACH_1 from './COACH-1';
import PLAN_1 from './PLAN-1';
import EXPL_2 from './EXPL-2';
import BOOK_2 from './BOOK-2';
import CLASS_2 from './CLASS-2';
import LIB_1 from './LIB-1';
import PLANS_2 from './PLANS-2';
import COACH_2 from './COACH-2';
import PLAN_2 from './PLAN-2';
import PLAN_4 from './PLAN-4';
import PLAN_5 from './PLAN-5';
import BODY_1 from './BODY-1';
import BODY_2 from './BODY-2';
import RUN_1 from './RUN-1';
import MEAL_1 from './MEAL-1';
import ATTR_1 from './ATTR-1';
import FEED_1 from './FEED-1';
import PLAN_3 from './PLAN-3';
import RUN_2 from './RUN-2';
import RUN_3 from './RUN-3';
import MEAL_2 from './MEAL-2';
import MEAL_3 from './MEAL-3';
import MEAL_4 from './MEAL-4';
import MEAL_5 from './MEAL-5';
import COACH_3 from './COACH-3';
import COACH_4 from './COACH-4';
import COACH_5 from './COACH-5';
import ATTR_2 from './ATTR-2';
import NOTIF_1 from './NOTIF-1';
import NOTIF_2 from './NOTIF-2';
import QA_1 from './QA-1';
import REL_1 from './REL-1';
import COACH_6 from './COACH-6';
import UPDATE_1 from './UPDATE-1';

export type { AndroidPack, PackTable } from './pack';
export { definePack } from './pack';

export type RegisteredPack = {
  /** The owning package (plan section 3 or 4). */
  readonly id: string;
  readonly pack: AndroidPack;
};

export const androidPacks: readonly RegisteredPack[] = [
  { id: 'F1', pack: F1 },
  { id: 'F2', pack: F2 },
  { id: 'F3', pack: F3 },
  { id: 'F4', pack: F4 },
  { id: 'F5', pack: F5 },
  { id: 'F6', pack: F6 },
  { id: 'F7', pack: F7 },
  { id: 'F8', pack: F8 },
  { id: 'AUTH-1', pack: AUTH_1 },
  { id: 'AUTH-2', pack: AUTH_2 },
  { id: 'AUTH-3', pack: AUTH_3 },
  { id: 'HOME-1', pack: HOME_1 },
  { id: 'EXPL-1', pack: EXPL_1 },
  { id: 'VENUE-1', pack: VENUE_1 },
  { id: 'VENUE-2', pack: VENUE_2 },
  { id: 'CHECKIN-1', pack: CHECKIN_1 },
  { id: 'CHECKIN-2', pack: CHECKIN_2 },
  { id: 'BOOK-1', pack: BOOK_1 },
  { id: 'CLASS-1', pack: CLASS_1 },
  { id: 'PLANS-1', pack: PLANS_1 },
  { id: 'ACCT-1', pack: ACCT_1 },
  { id: 'ACCT-2', pack: ACCT_2 },
  { id: 'ACCT-3', pack: ACCT_3 },
  { id: 'ACCT-4', pack: ACCT_4 },
  { id: 'COACH-1', pack: COACH_1 },
  { id: 'PLAN-1', pack: PLAN_1 },
  { id: 'EXPL-2', pack: EXPL_2 },
  { id: 'BOOK-2', pack: BOOK_2 },
  { id: 'CLASS-2', pack: CLASS_2 },
  { id: 'LIB-1', pack: LIB_1 },
  { id: 'PLANS-2', pack: PLANS_2 },
  { id: 'COACH-2', pack: COACH_2 },
  { id: 'PLAN-2', pack: PLAN_2 },
  { id: 'PLAN-4', pack: PLAN_4 },
  { id: 'PLAN-5', pack: PLAN_5 },
  { id: 'BODY-1', pack: BODY_1 },
  { id: 'BODY-2', pack: BODY_2 },
  { id: 'RUN-1', pack: RUN_1 },
  { id: 'MEAL-1', pack: MEAL_1 },
  { id: 'ATTR-1', pack: ATTR_1 },
  { id: 'FEED-1', pack: FEED_1 },
  { id: 'PLAN-3', pack: PLAN_3 },
  { id: 'RUN-2', pack: RUN_2 },
  { id: 'RUN-3', pack: RUN_3 },
  { id: 'MEAL-2', pack: MEAL_2 },
  { id: 'MEAL-3', pack: MEAL_3 },
  { id: 'MEAL-4', pack: MEAL_4 },
  { id: 'MEAL-5', pack: MEAL_5 },
  { id: 'COACH-3', pack: COACH_3 },
  { id: 'COACH-4', pack: COACH_4 },
  { id: 'COACH-5', pack: COACH_5 },
  { id: 'ATTR-2', pack: ATTR_2 },
  { id: 'NOTIF-1', pack: NOTIF_1 },
  { id: 'NOTIF-2', pack: NOTIF_2 },
  { id: 'QA-1', pack: QA_1 },
  { id: 'REL-1', pack: REL_1 },
  { id: 'COACH-6', pack: COACH_6 },
  { id: 'UPDATE-1', pack: UPDATE_1 },
];
