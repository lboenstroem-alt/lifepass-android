// @f4-stub (plan 3.0.2): route `BodyAndGoals`, filled by BODY-1.
//
// Body and goals (iOS BodyAndGoalsView), optionally opened on an anchor.
// Keep the default export and its props type; replace the body (and this
// marker). Until then a development build shows a placeholder and a release
// build shows nothing.
import { StubScreen } from '../../navigation/stubs';
import type { SharedRouteProps } from '../../navigation/types';

export default function BodyAndGoalsScreen({ route }: SharedRouteProps<'BodyAndGoals'>) {
  return <StubScreen route={route.name} owner="BODY-1" />;
}
