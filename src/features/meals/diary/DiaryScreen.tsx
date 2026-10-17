// @f4-stub (plan 3.0.2): route `Diary`, filled by MEAL-5.
//
// The food diary for one day.
// Keep the default export and its props type; replace the body (and this
// marker). Until then a development build shows a placeholder and a release
// build shows nothing.
import { StubScreen } from '../../../navigation/stubs';
import type { SharedRouteProps } from '../../../navigation/types';

export default function DiaryScreen({ route }: SharedRouteProps<'Diary'>) {
  return <StubScreen route={route.name} owner="MEAL-5" />;
}
