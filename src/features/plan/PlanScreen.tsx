// @f4-stub (plan 3.0.2): route `PlanMain`, filled by PLAN-1.
//
// The Plan tab's first screen (iOS PlanView).
// Keep the default export and its props type; replace the body (and this
// marker). Until then a development build shows a placeholder and a release
// build shows nothing.
import { StubScreen } from '../../navigation/stubs';
import type { TabRootProps } from '../../navigation/types';

export default function PlanScreen({ route }: TabRootProps<'PlanMain'>) {
  return <StubScreen route={route.name} owner="PLAN-1" />;
}
