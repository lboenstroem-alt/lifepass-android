// The root modal `Plans` (plan 3.0.2): the screen is ./PlansView.tsx.
//
// It is reached through the first build's path, src/screens/account/
// TopUpScreen.tsx (a re-export of ./PlansView), only because F4's shell tests
// stand in for that path by name; the indirection goes when QA-1 deletes the
// legacy file and those mocks together. Keep the default export and its
// props type.
import PlansView from '../../screens/account/TopUpScreen';
import type { RootModalProps } from '../../navigation/types';

export default function PlansScreen(props: RootModalProps<'Plans'>) {
  return <PlansView {...props} />;
}
