// @f4-stub (plan 3.0.2): route `WorkoutDetail`, filled by PLAN-4.
//
// One finished workout.
// Keep the default export and its props type; replace the body (and this
// marker). Until then a development build shows a placeholder and a release
// build shows nothing.
import { StubScreen } from '../../../navigation/stubs';
import type { SharedRouteProps } from '../../../navigation/types';

export default function WorkoutDetailScreen({ route }: SharedRouteProps<'WorkoutDetail'>) {
  return <StubScreen route={route.name} owner="PLAN-4" />;
}
