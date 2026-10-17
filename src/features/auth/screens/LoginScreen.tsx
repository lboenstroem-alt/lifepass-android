// @f4-stub (plan 3.0.2): auth route `Login`, filled by AUTH-1 (moving src/screens/auth here).
//
// Keep the default export and its props type; replace the body (and this
// marker). Until then it shows the first build's screen.
import LegacyLoginScreen from '../../../screens/auth/LoginScreen';
import type { AuthStackScreenProps } from '../../../navigation/types';

export default function LoginScreen(props: AuthStackScreenProps<'Login'>) {
  return <LegacyLoginScreen {...props} />;
}
