// @f4-stub (plan 3.0.2): route `WriteReview`, filled by VENUE-2.
//
// Write a review (a root modal over the tab bar).
// Keep the default export and its props type; replace the body (and this
// marker). Until then a development build shows a placeholder and a release
// build shows nothing.
import { StubScreen } from '../../../navigation/stubs';
import type { RootModalProps } from '../../../navigation/types';

export default function WriteReviewScreen({ route }: RootModalProps<'WriteReview'>) {
  return <StubScreen route={route.name} owner="VENUE-2" />;
}
