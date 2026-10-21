/**
 * Route `FeedbackReport` (plan 3.0.2): one month's feedback or one note,
 * pushed on Plan's stack from the card, the history or a notification tap
 * (iOS `PlanRoute.feedbackReport`). The view (./FeedbackReportView.tsx) does
 * the reading; this screen hands it Plan's actions and links:
 *
 * - a line's action pops Plan to its first screen and goes where the member
 *   would go by hand (./actions.ts), carrying nothing from the report;
 * - "Feedback settings" opens Body and goals on its feedback section;
 * - "See past months" pushes the history.
 *
 * `periodMonth` without `reportId` opens that month's report; neither opens
 * the current one. The hardware back is the stack's own.
 */
import type { SharedRouteProps } from '../../navigation/types';

import { tapFeedbackAction, useFeedbackActionResolver } from './actions';
import FeedbackReportView from './FeedbackReportView';

export default function FeedbackReportScreen({ route, navigation }: SharedRouteProps<'FeedbackReport'>) {
  const resolveAction = useFeedbackActionResolver();
  return (
    <FeedbackReportView
      reportId={route.params?.reportId ?? null}
      periodMonth={route.params?.periodMonth ?? null}
      resolveAction={resolveAction}
      onAction={(action) => tapFeedbackAction(action, { fromPushedScreen: true })}
      onBack={() => navigation.goBack()}
      onOpenSettings={() => navigation.navigate('BodyAndGoals', { anchor: 'feedback' })}
      onOpenHistory={() => navigation.push('FeedbackHistory')}
      testID="feedback.detail"
    />
  );
}
