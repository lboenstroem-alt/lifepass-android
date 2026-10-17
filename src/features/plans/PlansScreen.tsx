// @f4-stub (plan 3.0.2): root modal `Plans`, filled by PLANS-1.
//
// Opens over the tab bar from anywhere (`navigation.navigate('Plans')`, or a
// refusal's "View plans"). Keep the default export and its props type;
// replace the body (and this marker). Until then it shows the first build's
// top-up screen, which closes with `goBack`.
import LegacyTopUpScreen from '../../screens/account/TopUpScreen';
import type { RootModalProps } from '../../navigation/types';

export default function PlansScreen(_props: RootModalProps<'Plans'>) {
  return <LegacyTopUpScreen />;
}
