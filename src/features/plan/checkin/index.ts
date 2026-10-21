/**
 * The weekly check-in (PLAN-5), for whoever else opens it:
 *
 * - Body and goals' "Log weight" (BODY-1) draws the sheet itself, in the
 *   weight-only mode, with the Today read it holds:
 *
 *     import { WeeklyCheckInSheet } from '../plan/checkin';
 *     <WeeklyCheckInSheet visible={open} mode="weightOnly" weighIn={day?.weighIn ?? null}
 *       checkIn={day?.checkIn ?? null} onClose={() => setOpen(false)} onWeightLogged={() => reload()} />
 *
 * - Plan's three doors (the Today card's row, the review prompt card, the
 *   notification) go through Plan's bridge, which the review slot installs:
 *   `usePlanBridges.getState().weeklyCheckIn?.('plan')` (../shell/bridges).
 *   `openWeeklyCheckIn(entry)` is the same thing for code inside Plan.
 */
export { default as WeeklyCheckInSheet, type WeeklyCheckInSheetProps } from './WeeklyCheckInSheet';
export { openWeeklyCheckIn } from './presenter';
export { postWeeklyCheckIn, WEEK_RATINGS, type HealthCheckInBody, type WeekRating } from './api';
export { checkInBody, type CheckInForm, type WeeklyCheckInMode } from './rules';
