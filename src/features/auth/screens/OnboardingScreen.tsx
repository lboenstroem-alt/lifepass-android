// @f4-stub (plan 3.0.2): auth route `Onboarding`, filled by AUTH-1 (moving src/screens/auth here).
//
// Keep the default export and its props type; replace the body (and this
// marker). Until then it shows the first build's screen.
import LegacyOnboardingScreen from '../../../screens/auth/OnboardingScreen';
import type { AuthStackScreenProps } from '../../../navigation/types';

export default function OnboardingScreen(props: AuthStackScreenProps<'Onboarding'>) {
  return <LegacyOnboardingScreen {...props} />;
}
