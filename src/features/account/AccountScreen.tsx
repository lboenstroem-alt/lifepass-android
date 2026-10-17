// @f4-stub (plan 3.0.2): route `Account`, filled by ACCT-1.
//
// Keep the default export and its props type; replace the body (and this
// marker). Until then it shows the first build's Account screen.
import LegacyAccountScreen from '../../screens/account/AccountScreen';
import type { SharedRouteProps } from '../../navigation/types';

export default function AccountScreen(_props: SharedRouteProps<'Account'>) {
  return <LegacyAccountScreen />;
}
