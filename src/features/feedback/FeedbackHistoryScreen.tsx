/**
 * Route `FeedbackHistory` (plan 3.0.2): "Your past months", pushed on Plan's
 * stack from the card and the report (iOS `PlanRoute.feedbackHistory`). A row
 * pushes its report, which offers its actions as on the Plan card. The
 * history in Body and goals is its own sheet (./FeedbackHistorySheet.tsx).
 *
 * The list stays mounted under the report, and reads its first page again
 * each time it shows again (iOS `.task` on every appearance), so a month just
 * opened comes back without its "New".
 */
import type { SharedRouteProps } from '../../navigation/types';

import FeedbackHistoryView from './FeedbackHistoryView';
import { useReappearCount } from './focus';

export default function FeedbackHistoryScreen({ navigation }: SharedRouteProps<'FeedbackHistory'>) {
  const reloadKey = useReappearCount();
  return (
    <FeedbackHistoryView
      onBack={() => navigation.goBack()}
      onOpen={(reportId) => navigation.push('FeedbackReport', { reportId })}
      reloadKey={reloadKey}
      testID="feedback.history"
    />
  );
}
