// The Plan feature's public door (plan 3.0, the feature-boundaries rule):
// what packages that land after Plan may call. Today that is the bridge the
// workout and meal outboxes, the monthly feedback and the weekly check-in
// sheet install themselves into (iOS PlanOutboxBridge); see ./shell/bridges.
export {
  failedOutboxItems,
  installPlanFeedback,
  installPlanOutbox,
  installWeeklyCheckInOpener,
  installedOutboxes,
  type PlanFeedbackBridge,
  type PlanFeedbackLoadState,
  type PlanOutboxItem,
  type PlanOutboxKind,
  type PlanOutboxSource,
  type WeeklyCheckInEntry,
} from './shell/bridges';
