// @f4-stub (plan 3.0.2): route `Capture`, filled by MEAL-2.
//
// The meal page's first screen (full screen, its own stack). Back with a tray asks keep or discard.
// Keep the default export and its props type; replace the body (and this
// marker). Until then a development build shows a placeholder and a release
// build shows nothing.
import { StubScreen } from '../../../navigation/stubs';
import type { MealCaptureScreenProps } from '../../../navigation/types';

export default function MealCaptureScreen({ route }: MealCaptureScreenProps<'Capture'>) {
  return <StubScreen route={route.name} owner="MEAL-2" />;
}
