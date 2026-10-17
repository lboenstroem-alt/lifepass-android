// @f4-stub (plan 3.0.2): route `Measurements`, filled by BODY-1.
//
// Measurements history.
// Keep the default export and its props type; replace the body (and this
// marker). Until then a development build shows a placeholder and a release
// build shows nothing.
import { StubScreen } from '../../navigation/stubs';
import type { SharedRouteProps } from '../../navigation/types';

export default function MeasurementsScreen({ route }: SharedRouteProps<'Measurements'>) {
  return <StubScreen route={route.name} owner="BODY-1" />;
}
