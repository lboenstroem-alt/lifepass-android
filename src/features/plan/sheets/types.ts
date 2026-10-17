// @f4-stub (plan 3.0.3): what the Plan sheets need of a session, filled by PLAN-3.
//
// A session object from the health store satisfies it (it has an `id`);
// PLAN-3 may widen it to the health store's session type once F7 has landed.
export interface PlanSessionRef {
  readonly id: string;
  readonly title?: string | null;
}
