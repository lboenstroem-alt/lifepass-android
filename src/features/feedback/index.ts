// @f4-stub (plan 3.0.3): the monthly feedback's public contract, filled by FEED-1; used by COACH-4 and COACH-5.
//
// `turnOffFoodForSafety()`: a safety answer in a wizard turns food and weight
// out of the monthly feedback (iOS `FeedbackStore.turnOffFoodAndWeightForSafety`,
// SPEC 9.8). Fire and forget: it keeps trying on its own, and a sign-out
// gives it one short last try.
// Keep the exported names and signatures; replace the bodies (and this marker).

/** Turns food and weight off in the monthly feedback after a safety answer. A no-op until FEED-1 lands. */
export function turnOffFoodForSafety(): Promise<void> {
  return Promise.resolve();
}
