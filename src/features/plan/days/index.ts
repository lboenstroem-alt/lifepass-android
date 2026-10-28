// The change-days sheet (plan 3.0.3, PLAN-4), for the plan overview, the
// programme overview, the proposal card, COACH-4 and COACH-5.
//
// iOS `ChangeDaysSheet(mode:daysPerWeek:selected:...)`: `select` picks days
// for a wizard (nothing is saved), `program` saves a programme's days
// (`POST /health/programs/{id}` with `trainingDays` only). `ChangeDaysHost`
// is mounted once by F4's tabs shell and draws what `openChangeDays` asks for.
//
//   openChangeDays({ kind: 'select', daysPerWeek: 3, selected: [1, 3, 5], onPicked: (days) => ... });
//   openChangeDays({ kind: 'program', programId, daysPerWeek, selected, onSaved: () => void reload() });
//
// RULES FOR CALLERS (./presenter.ts):
// - One sheet at a time. A request while one is on screen, or with no host
//   (signed out), is not shown and is answered at once with `onCancel`.
// - Every callback runs once the sheet has GONE from the screen, so the next
//   sheet or a page can be opened from it.
// - Save is enabled only with exactly `daysPerWeek` days.
import { presentChangeDays } from './presenter';
import type { ChangeDaysMode } from './types';

export { default as ChangeDaysHost } from './ChangeDaysHost';
export { isChangeDaysHostMounted } from './presenter';
export type { ChangeDaysMode, ChangeDaysSaved } from './types';
export { isValidSelection } from './daysRules';

/** Opens the sheet over whatever is showing (see the rules above). */
export function openChangeDays(mode: ChangeDaysMode): void {
  presentChangeDays(mode);
}
