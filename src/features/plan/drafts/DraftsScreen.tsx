// @f4-stub (plan 3.0.2): route `Drafts`, filled by PLAN-5.
//
// Meal drafts.
// Keep the default export and its props type; replace the body (and this
// marker). Until then a development build shows a placeholder and a release
// build shows nothing.
import { StubScreen } from '../../../navigation/stubs';
import type { SharedRouteProps } from '../../../navigation/types';

export default function DraftsScreen({ route }: SharedRouteProps<'Drafts'>) {
  return <StubScreen route={route.name} owner="PLAN-5" />;
}
