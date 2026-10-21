/**
 * Route `FeedbackHistory` (plan 3.0.2): "Your past months", pushed on Plan's
 * stack from the card and the report (iOS `PlanRoute.feedbackHistory`). A row
 * pushes its report, which offers its actions as on the Plan card. The
 * history in Body and goals is its own sheet (./FeedbackHistorySheet.tsx).
 */
import type { SharedRouteProps } from '../../navigation/types';

import FeedbackHistoryView from './FeedbackHistoryView';

export default function FeedbackHistoryScreen({ navigation }: SharedRouteProps<'FeedbackHistory'>) {
  return (
    <FeedbackHistoryView
      onBack={() => navigation.goBack()}
      onOpen={(reportId) => navigation.push('FeedbackReport', { reportId })}
      testID="feedback.history"
    />
  );
}
