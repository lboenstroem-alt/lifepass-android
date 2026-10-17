// @f4-stub (plan 3.0.2): route `AttractionDetail`, filled by ATTR-1.
//
// A public sight's card, by slug.
// Keep the default export and its props type; replace the body (and this
// marker). Until then a development build shows a placeholder and a release
// build shows nothing.
import { StubScreen } from '../../navigation/stubs';
import type { SharedRouteProps } from '../../navigation/types';

export default function AttractionDetailScreen({ route }: SharedRouteProps<'AttractionDetail'>) {
  return <StubScreen route={route.name} owner="ATTR-1" />;
}
