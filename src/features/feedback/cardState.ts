/**
 * What the Plan card draws, and which action a line may offer: the pure
 * rules of iOS Views/Plan/FeedbackCard.swift (`FeedbackCardState`,
 * `FeedbackActionRule`, `FeedbackActionButton.labelKey`), ported 1:1 so they
 * can be tested without a view (FeedbackCardStateTests).
 */
import {
  anyFeedbackOn,
  foodAndWeightChosen,
  type FeedbackAction,
  type FeedbackNote,
  type FeedbackReportSummary,
  type FeedbackSummary,
} from '../../api/feedback';
import type { HealthAccess } from '../../api/profile';

/** The month's report as a full card, or shrunk to one row once read and older than a week. */
export type FeedbackMonthly = 'full' | 'compact';

export const INTRO_BODY_WITH_FOOD = 'feedback.intro.body';
export const INTRO_BODY_WITHOUT_FOOD = 'feedback.intro.body_no_food';

/** A report stays a full card while it is unread or under a week old. */
export const FULL_CARD_DAYS = 7;

export interface FeedbackCardState {
  readonly note: FeedbackNote | null;
  readonly latest: FeedbackReportSummary | null;
  readonly monthly: FeedbackMonthly | null;
  readonly showsIntro: boolean;
  /**
   * The intro's body: it names food and weight only while they are in the
   * member's feedback. A member who just answered a safety question (the
   * switch is off, or its food-off is still on its way) or who said "Not
   * now" to the offer reads the variant without them.
   */
  readonly introBodyKey: typeof INTRO_BODY_WITH_FOOD | typeof INTRO_BODY_WITHOUT_FOOD;
  readonly showsFoodOffer: boolean;
  /** `nextReport.readyOn` when the server expects to write it. */
  readonly firstReportDay: string | null;
}

export const EMPTY_CARD_STATE: FeedbackCardState = {
  note: null,
  latest: null,
  monthly: null,
  showsIntro: false,
  introBodyKey: INTRO_BODY_WITH_FOOD,
  showsFoodOffer: false,
  firstReportDay: null,
};

/** Nothing to draw: the card takes no row at all. */
export function isCardEmpty(state: FeedbackCardState): boolean {
  return state.note === null && state.monthly === null && !state.showsIntro && !state.showsFoodOffer;
}

export interface FeedbackCardInput {
  readonly summary: FeedbackSummary | null;
  readonly introDismissed: boolean;
  readonly foodOfferDismissed: boolean;
  readonly foodOffPending: boolean;
  readonly hasLivePlan: boolean;
  readonly now: Date;
}

/** iOS `FeedbackCardState.resolve`. */
export function resolveFeedbackCardState(input: FeedbackCardInput): FeedbackCardState {
  const { summary, introDismissed, foodOfferDismissed, foodOffPending, hasLivePlan, now } = input;
  const settings = summary?.settings;
  if (!summary || !settings) return EMPTY_CARD_STATE;

  let note: FeedbackNote | null = null;
  if (summary.note && summary.note.message && isShown(summary.note.message.text)) note = summary.note;

  let latest: FeedbackReportSummary | null = null;
  let monthly: FeedbackMonthly | null = null;
  if (summary.latest && summary.latest.current) {
    latest = summary.latest;
    const createdAt = latest.createdAt;
    const recent = createdAt !== null && now.getTime() - createdAt.getTime() < FULL_CARD_DAYS * 86_400_000;
    monthly = latest.seenAt === null || recent ? 'full' : 'compact';
  }

  let firstReportDay: string | null = null;
  const next = summary.nextReport;
  if (next && next.expected && next.readyOn !== null) firstReportDay = next.readyOn;

  // The offer: food and weight are off only because the member never chose
  // and no plan has asked them the safety questions. The server says so
  // (`foodAndWeightOffer`); an older answer without the field is read from
  // the settings. Never once it was closed here, or while a safety answer's
  // food-off is still on its way.
  const chosen = foodAndWeightChosen(settings);
  const serverOffers = summary.foodAndWeightOffer ?? (!settings.includeFoodAndWeight && !chosen && !hasLivePlan);
  const showsFoodOffer =
    serverOffers &&
    !settings.includeFoodAndWeight &&
    !chosen &&
    anyFeedbackOn(settings) &&
    !foodOfferDismissed &&
    !foodOffPending;
  const showsIntro = !showsFoodOffer && summary.latest === null && settings.monthlyReport && !introDismissed;
  const introBodyKey = !settings.includeFoodAndWeight || foodOffPending ? INTRO_BODY_WITHOUT_FOOD : INTRO_BODY_WITH_FOOD;
  if (!showsIntro && !showsFoodOffer) firstReportDay = null;
  if (summary.latest !== null) firstReportDay = null;

  return { note, latest, monthly, showsIntro, introBodyKey, showsFoodOffer, firstReportDay };
}

function isShown(text: string | null): boolean {
  return text !== null && text.trim().length > 0;
}

/**
 * Which action a line may offer this member right now (`SPEC` 9.6, iOS
 * `FeedbackActionRule`). `adjust_plan` needs a server that revises plans, a
 * live plan and an active membership, and falls back to `change_days` when
 * only that is allowed; `change_days` needs a live plan and a membership;
 * `log_meal` a membership. Anything else is hidden.
 */
export function resolveFeedbackAction(
  action: FeedbackAction | null | undefined,
  context: {
    readonly supportsPlanRevision: boolean;
    readonly hasLiveProgram: boolean;
    readonly access: HealthAccess;
    /**
     * The member's own cycle (COACH-6): it refuses both Adjust my plan and
     * Change days (409 `custom_plan_locked`), so neither is offered.
     */
    readonly isCustomPlan?: boolean;
  },
): Exclude<FeedbackAction, 'unknown'> | null {
  if (!action || context.access !== 'entitled') return null;
  switch (action) {
    case 'adjust_plan':
      if (context.isCustomPlan) return null;
      if (context.supportsPlanRevision && context.hasLiveProgram) return 'adjust_plan';
      return context.hasLiveProgram ? 'change_days' : null;
    case 'change_days':
      if (context.isCustomPlan) return null;
      return context.hasLiveProgram ? 'change_days' : null;
    case 'log_meal':
      return 'log_meal';
    case 'unknown':
      return null;
  }
}

/** A line's action, labelled the house way (iOS `FeedbackActionButton.labelKey`). */
export function feedbackActionLabelKey(action: FeedbackAction): string {
  switch (action) {
    case 'adjust_plan':
      return 'coach.chip.adjust_plan';
    case 'change_days':
      return 'feedback.action.change_days';
    case 'log_meal':
    case 'unknown':
      return 'feedback.action.log_meal';
  }
}
