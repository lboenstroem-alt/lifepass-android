// @f4-stub (plan 3.0.2): route `FeedbackReport`, filled by FEED-1.
//
// A monthly feedback report: the one named, the month's, or the current one.
// Keep the default export and its props type; replace the body (and this
// marker). Until then a development build shows a placeholder and a release
// build shows nothing.
import { StubScreen } from '../../navigation/stubs';
import type { SharedRouteProps } from '../../navigation/types';

export default function FeedbackReportScreen({ route }: SharedRouteProps<'FeedbackReport'>) {
  return <StubScreen route={route.name} owner="FEED-1" />;
}
