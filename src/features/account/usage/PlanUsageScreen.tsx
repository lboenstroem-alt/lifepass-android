// @f4-stub (plan 3.0.2): route `PlanUsage`, filled by ACCT-2.
//
// Plan and usage (iOS CreditDetailView).
// Keep the default export and its props type; replace the body (and this
// marker). Until then a development build shows a placeholder and a release
// build shows nothing.
import { StubScreen } from '../../../navigation/stubs';
import type { SharedRouteProps } from '../../../navigation/types';

export default function PlanUsageScreen({ route }: SharedRouteProps<'PlanUsage'>) {
  return <StubScreen route={route.name} owner="ACCT-2" />;
}
