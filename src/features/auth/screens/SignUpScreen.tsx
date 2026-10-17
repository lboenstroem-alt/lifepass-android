// @f4-stub (plan 3.0.2): auth route `SignUp`, filled by AUTH-1 (moving src/screens/auth here).
//
// Keep the default export and its props type; replace the body (and this
// marker). Until then it shows the first build's screen.
import LegacySignUpScreen from '../../../screens/auth/SignUpScreen';
import type { AuthStackScreenProps } from '../../../navigation/types';

export default function SignUpScreen(props: AuthStackScreenProps<'SignUp'>) {
  return <LegacySignUpScreen {...props} />;
}
