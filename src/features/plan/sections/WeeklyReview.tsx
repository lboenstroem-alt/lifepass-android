/**
 * Plan's weekly review slot (PLAN-5; iOS PlanView `reviewSection`): the
 * check-in prompt while the week is up and an entitled member has not
 * checked in, else last week's review, else nothing (../review/reviewRules.ts).
 * Drawn for the day on screen.
 *
 * It is the scroll and TalkBack target of the weekly check-in notification
 * (3.3 step 6): the card's heading is the element Plan moves TalkBack onto
 * (../shell/focusTargets.ts).
 *
 * THE CHECK-IN SHEET LIVES HERE TOO. Every Plan body that can offer the
 * check-in mounts this slot, so its host (../checkin/WeeklyCheckInHost.tsx)
 * is mounted exactly while there is something to check in from. The
 * opener goes into Plan's bridge as this module loads (Plan imports it), so
 * the Today card's row and the notification reach the same sheet. With no
 * host mounted, the notification's door lands on the review instead.
 */
import { installWeeklyCheckInOpener, requestPlanScroll, usePlanFocusTarget, usePlanView } from '../shell';
import { openWeeklyCheckIn } from '../checkin/presenter';
import WeeklyCheckInHost from '../checkin/WeeklyCheckInHost';
import { reviewSectionKind } from '../review/reviewRules';
import WeeklyReviewCard from '../review/WeeklyReviewCard';
import WeeklyReviewPromptCard from '../review/WeeklyReviewPromptCard';

/** Plan's three doors to the sheet (iOS `sheet = .weeklyCheckIn(entry:)`). */
export function openPlanWeeklyCheckIn(entry: Parameters<typeof openWeeklyCheckIn>[0]): void {
  if (!openWeeklyCheckIn(entry) && entry === 'notification') requestPlanScroll('review');
}

installWeeklyCheckInOpener(openPlanWeeklyCheckIn);

export default function WeeklyReviewSection() {
  const view = usePlanView();
  const focusTarget = usePlanFocusTarget('review');
  const day = view.shownDay;
  const kind = reviewSectionKind(day, view.access);
  return (
    <>
      {kind === 'prompt' ? (
        <WeeklyReviewPromptCard titleRef={focusTarget} onOpen={() => openPlanWeeklyCheckIn('review_card')} />
      ) : kind === 'review' && day?.review ? (
        <WeeklyReviewCard review={day.review} titleRef={focusTarget} />
      ) : null}
      <WeeklyCheckInHost />
    </>
  );
}
