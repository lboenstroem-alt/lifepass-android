// @f4-stub (plan 3.0.2): route `ClassesDiscoveryModal`, filled by CLASS-1.
//
// The classes feed as a sheet, from Plan: it mounts `ClassesDiscovery` with `showsModeToggle={false}`.
// Keep the default export and its props type; replace the body (and this
// marker). Until then a development build shows a placeholder and a release
// build shows nothing.
import { StubScreen } from '../../navigation/stubs';
import type { RootModalProps } from '../../navigation/types';

export default function ClassesDiscoveryModalScreen({ route }: RootModalProps<'ClassesDiscoveryModal'>) {
  return <StubScreen route={route.name} owner="CLASS-1" />;
}
