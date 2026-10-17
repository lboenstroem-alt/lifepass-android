// @f4-stub (plan 3.0.2): route `WorkoutRunner`, filled by RUN-2.
//
// The workout runner (full screen). Back opens the Leave dialog (`useHardwareBack`).
// Keep the default export and its props type; replace the body (and this
// marker). Until then a development build shows a placeholder and a release
// build shows nothing.
import { StubScreen } from '../../../navigation/stubs';
import type { RootModalProps } from '../../../navigation/types';

export default function WorkoutRunnerScreen({ route }: RootModalProps<'WorkoutRunner'>) {
  return <StubScreen route={route.name} owner="RUN-2" />;
}
