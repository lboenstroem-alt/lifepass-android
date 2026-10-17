// @f4-stub (plan 3.0.2): route `MealEditor`, filled by MEAL-4.
//
// A saved meal's editor.
// Keep the default export and its props type; replace the body (and this
// marker). Until then a development build shows a placeholder and a release
// build shows nothing.
import { StubScreen } from '../../../navigation/stubs';
import type { SharedRouteProps } from '../../../navigation/types';

export default function MealEditorScreen({ route }: SharedRouteProps<'MealEditor'>) {
  return <StubScreen route={route.name} owner="MEAL-4" />;
}
