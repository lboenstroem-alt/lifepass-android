// @f4-stub (plan 3.0.3): Home's Today row, filled by PLAN-2; mounted by HOME-1.
//
// iOS `HomeTodayRow(upcomingBookingId:onOpenPlan:onStart:)`: only an
// entitled member with consent and a live programme sees it; one element
// with a hint, and a Start that names the session it starts. The row reads
// the profile itself; Home owns where the taps go (Plan, or Plan's
// `startWorkout` action).
// Keep the default export and its props; replace the body (and this marker).
// Renders nothing until PLAN-2 lands.

export interface HomeTodayRowProps {
  /** The booking Home's upcoming card already shows, so one booking is never announced twice. */
  readonly upcomingBookingId: string | null;
  readonly onOpenPlan: () => void;
  /** Start today's session (its id). */
  readonly onStart: (sessionId: string) => void;
}

export default function HomeTodayRow(_props: HomeTodayRowProps) {
  return null;
}
