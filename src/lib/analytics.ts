/**
 * Analytics: the Android port of iOS `AnalyticsService`, `AnalyticsEvent` and
 * `AnalyticsParam` (Services/AnalyticsService.swift).
 *
 * NOTHING IS SENT. The API has no ingestion endpoint (`/analytics`,
 * `/analytics/events` and `/events` all 404), so `track` is a no-op in a
 * release build and a log line in a development build, exactly as on iOS.
 * The event names and call sites exist so that when ingestion ships, only
 * `track` changes. No third-party analytics or crash SDK may be added without
 * an owner decision and a Play Data safety change.
 *
 * TWO RULES TRAVEL WITH EVERY EVENT, and must survive the day one ships:
 *
 * 1. NO HEALTH VALUE IS EVER A PARAM. No weight, height, age, kcal, macro,
 *    food or exercise name, feeling, skip reason, safety answer, body part,
 *    sleep or heart number, measurement date. The rule is mechanical: a short
 *    allow-list of keys, no member-answer vocabulary as a value, and no bare
 *    numbers (`isForbidden`). A development build throws on a refused param,
 *    so the mistake is found before it ships, and the message names the KEY,
 *    never the value: a guard that prints the health value into the log has
 *    achieved nothing.
 * 2. Events marked (H) say a member USES the plan or the food log, which is
 *    itself health information. When ingestion ships they may go ONLY to a
 *    first-party LifePass endpoint: never to a third-party SDK, never into a
 *    marketing audience.
 *
 * No personal data (email, kennitala, phone, full name) ever goes in a param.
 */

/** Every event the app fires (snake_case, verb_object, as the web's `trackEvent`). */
export const ANALYTICS_EVENTS = [
  'venue_detail_viewed',
  'user_signed_up',
  'walk_in_check_in',
  'voucher_applied',
  'begin_checkout',
  'plan_selected',
  'kenni_verification_started',
  'kenni_verification_completed',
  /**
   * A load failure the UI handles silently (the app store's reads). Without a
   * breadcrumb a production outage looks like "member has no data". Always
   * with `op` (the loader) and `error` (the description).
   */
  'service_error',

  // Navigation and Home
  'nav_tab_selected',
  'profile_opened',
  'profile_hint_dismissed',
  'home_today_tapped',

  // Plan
  'plan_viewed',
  'plan_gate_cta_tapped',
  'plan_intro_cta_tapped',
  'plan_week_day_selected',
  'plan_class_book_opened',
  'plan_pool_picker_opened',
  'plan_sight_opened',
  'plan_soak_opened',
  'workout_marked_done', // H
  'workout_pulled', // H
  'workout_feeling_given',
  'workout_undo',
  'plan_extra_logged', // H: kind, entry, relative; never the minutes or the note
  'plan_extra_removed',
  'program_paused',
  'program_resumed',
  'program_ended',
  'training_days_changed',
  'review_prompt_opened',
  'plan_proposal_review_opened',
  'plan_adopted_banner_change',
  'plan_block_done_dismissed',
  'past_plan_opened',
  'workout_outbox_flushed', // H
  'meal_outbox_flushed', // H
  'outbox_item_discarded',
  'history_opened',
  'note_why_opened',

  // Consent and the programme wizard
  'health_consent_viewed',
  'health_consent_granted',
  'health_consent_dismissed',
  'health_consent_minor_refused',
  'program_wizard_started',
  'program_wizard_step',
  'program_summary_row_edited',
  'program_refused_local', // H, no params
  'program_build_tapped',
  'program_created',
  'program_proposal_action',
  'program_adopted',
  'program_adjust_started',
  'program_adjust_submitted',
  'target_weight_saved', // H: outcome, surface; never the weight

  // Changing the plan in chat (COACH-6, as iOS): fixed words only, never the
  // words typed, an exercise or a count (counts travel as band words).
  'plan_edit_sent', // H
  'plan_edit_preview', // H: kind, items, count_band
  'plan_edit_applied', // H: choice (single, ours, own)
  'plan_edit_undone', // H: entry (card, changes)
  'plan_edit_cancelled', // H
  'plan_edit_error', // H: reason (a problem code, or offline)

  // Body, runner, check-in
  'body_sheet_opened',
  'nutrition_goal_saved', // H
  'body_sheet_saved',
  'body_sheet_skipped',
  'workout_started', // H
  'rest_live_activity_action',
  'workout_exercise_swapped',
  'workout_exercise_skipped',
  'workout_finished',
  'workout_left',
  'workout_no_energy_opened',
  'workout_moved',
  'workout_move_refused',
  'workout_skipped',
  'weekly_checkin_opened',
  'weigh_in_logged',
  'weekly_review_viewed',

  // Body and goals, account
  'body_goals_opened',
  'health_consent_withdrawn',
  'health_export_requested',
  'reminder_setting_changed',
  'measurement_deleted',
  'account_deletion_viewed',
  'account_deletion_requested',
  'account_deletion_cancelled',

  // Scan and meals
  'scan_tab_viewed',
  'scan_meal_tapped',
  'qr_foreign_ignored',
  'qr_rescan_tapped',
  'meal_capture_opened',
  'meal_mode_switched',
  'meal_photo_taken',
  'meal_scan_result', // H
  'meal_describe_opened', // H: entry; never the words, never a count
  'meal_describe_submitted', // H
  'meal_describe_result', // H: outcome
  'barcode_scanned',
  'meal_capture_closed',
  'meal_tray_saved', // H
  'meal_estimate_opened',
  'meal_estimate_confirm_all',
  'meal_estimate_item_edited',
  'meal_estimate_discarded',
  'meal_estimate_kept',
  'barcode_result',
  'food_created',
  'off_product_link_opened',
  'food_search_performed',
  'food_filter_selected',
  'food_added', // H
  'food_mine_removed',
  'food_search_empty',
  'meal_editor_opened',
  'meal_item_edited',
  'meal_logged', // H
  'meal_update_undone', // H
  'meal_outbox_queued', // H
  'diary_copy_yesterday', // H
  'meal_updated',
  'meal_deleted',
  'meal_item_deleted',
  'diary_viewed',
  'diary_day_changed',
  'diary_add_tapped',

  // Wearables and the local wipe
  'apple_health_connect_viewed',
  'wearable_connected',
  'apple_health_brand_help_opened',
  'apple_health_sync_now',
  'wearable_disconnected',
  'apple_health_upload',
  'health_local_wiped',
  'notification_opened',

  // The monthly feedback: fixed words only, never a topic or anything a report says.
  'feedback_opened',
  'feedback_setting_changed',
  'feedback_note_dismissed',
  'feedback_action_tapped',
  'feedback_intro_closed',
] as const;

export type AnalyticsEvent = (typeof ANALYTICS_EVENTS)[number];

/**
 * Keys that already shipped on events that predate the health release and
 * carry no health value: ids, a venue name, a sign-up flag, an operation name
 * and an error string. Listed apart so nobody reads `venue_name` as a pattern
 * to follow, and so the numeric rule can skip exactly these (an id is
 * number-shaped and is not a fact about a body).
 */
export const PRE_RELEASE_PARAMS: ReadonlySet<string> = new Set([
  'op',
  'error',
  'venue_id',
  'venue_name',
  'plan',
  'plan_id',
  'has_nationality',
  'marketing_opt_in',
  'email_confirmation_required',
]);

/** The only param KEYS an event may carry. */
export const ALLOWED_PARAMS: ReadonlySet<string> = new Set([
  'entry',
  'mode',
  'source',
  'outcome',
  'kind',
  'step',
  'count_band',
  'items',
  'tab',
  'action',
  'cta',
  'state',
  'relative',
  'filter',
  'field',
  'choice',
  'camera',
  'brand',
  'from',
  'tray',
  'reason',
  'replaced',
  'future',
  'feeling_given',
  'with_rating',
  'quick',
  'edited',
  'deleted',
  // The target weight and Adjust my plan: fixed words only (`target` says
  // `set`, `cleared` or `unchanged`, never a weight).
  'change',
  'surface',
  'target',
  // The monthly feedback: which switch, and on or off.
  'setting',
  'value',
  ...PRE_RELEASE_PARAMS,
]);

/**
 * Values that are a MEMBER'S ANSWER rather than a fact about the UI: skip
 * reasons, the harder feelings, the safety answers and the body parts. Never
 * an analytics value under any key. ("easy", "ok" and "hard" alone are not
 * here: `outcome: ok` is a legitimate upload result.)
 */
export const MEMBER_ANSWER_VALUES: ReadonlySet<string> = new Set([
  'tired',
  'sore',
  'too_hard',
  'pregnant',
  'pregnant_or_breastfeeding',
  'eating',
  'eating_disorder_history',
  'injury',
  'injuries',
  'condition',
  'condition_or_medication',
  'back',
  'neck',
  'shoulder',
  'shoulders',
  'elbow',
  'wrist',
  'hip',
  'knee',
  'knees',
  'ankle',
  'foot',
  'lower_back',
]);

/** The keys a number may travel under: a position in a wizard, and the pre-release ids and names. */
const NUMERIC_EXEMPT: ReadonlySet<string> = new Set([...PRE_RELEASE_PARAMS, 'step']);

/**
 * What Swift's `Double(String)` reads as a number: decimal (with an optional
 * exponent), hexadecimal floating point, `inf`, `infinity` and `nan`, signed
 * or not, with nothing around it.
 */
const SWIFT_DOUBLE =
  /^[+-]?(?:(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?|0[xX](?:[0-9a-fA-F]+\.?[0-9a-fA-F]*|\.[0-9a-fA-F]+)(?:[pP][+-]?\d+)?|[iI][nN][fF](?:[iI][nN][iI][tT][yY])?|[nN][aA][nN])$/;

/** True when the text would parse as a number (and so is almost certainly a body value that slipped through). */
export function looksNumeric(value: string): boolean {
  return SWIFT_DOUBLE.test(value);
}

/**
 * True when this key and value must never be sent. Three rules: the key is on
 * the allow-list; the value is not a member's answer; and the value is not a
 * bare number, except under `step` and the pre-release keys.
 */
export function isForbidden(key: string, value: string): boolean {
  if (!ALLOWED_PARAMS.has(key)) return true;
  if (MEMBER_ANSWER_VALUES.has(value.toLowerCase())) return true;
  if (!NUMERIC_EXEMPT.has(key) && looksNumeric(value)) return true;
  return false;
}

/** Bucket a count so a number never travels as itself: 0, 1, 2-5, 6+. */
export function countBand(count: number): string {
  if (count < 1) return '0';
  if (count === 1) return '1';
  if (count <= 5) return '2-5';
  return '6+';
}

/** A param value. Anything that is not a string, number or boolean is checked by its key only. */
export type AnalyticsValue = string | number | boolean | Date | null | undefined;

export type AnalyticsParams = Readonly<Record<string, AnalyticsValue>>;

/** The value as text for the guard, or null for a value the guard cannot read back (a Date). */
function describe(value: AnalyticsValue): string | null {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return null;
}

/** The keys of `params` the guard refuses, key AND value. */
export function refusedParams(params: AnalyticsParams): string[] {
  const refused: string[] = [];
  for (const [key, value] of Object.entries(params)) {
    const text = describe(value);
    const forbidden = text === null ? !ALLOWED_PARAMS.has(key) : isForbidden(key, text);
    if (forbidden) refused.push(key);
  }
  return refused;
}

type Observer = (event: AnalyticsEvent, params: AnalyticsParams) => void;

let observer: Observer | null = null;

/**
 * Every event `track` accepts, handed to a test that wants to say what was
 * (and, more often, what was NOT) sent. Development builds only; `null`
 * removes it.
 */
export function setAnalyticsObserver(next: Observer | null): void {
  observer = next;
}

/**
 * Fire-and-forget. Never throws in a release build (where it does nothing at
 * all); a development build throws on a refused param, naming the keys.
 */
export function track(event: AnalyticsEvent, params: AnalyticsParams = {}): void {
  if (!__DEV__) return;
  const refused = refusedParams(params);
  if (refused.length > 0) {
    throw new Error(`analytics param refused: [${refused.sort().join(', ')}] on ${event}`);
  }
  if (observer) {
    observer(event, params);
  } else if (process.env.NODE_ENV !== 'test') {
    console.log(`[analytics] ${event} [${Object.keys(params).sort().join(', ')}]`);
  }
}

/** A failure's description for `service_error`'s `error` param (iOS `localizedDescription`). */
export function errorDescription(error: unknown): string {
  if (error instanceof Error) return error.message || error.name;
  return String(error);
}
