/**
 * The signed-out screens (iOS OnboardingFlow): onboarding, log in, sign up.
 * Owner of the screens: AUTH-1 (src/features/auth/screens).
 */
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import LoginScreen from '../features/auth/screens/LoginScreen';
import OnboardingScreen from '../features/auth/screens/OnboardingScreen';
import SignUpScreen from '../features/auth/screens/SignUpScreen';
import type { AuthStackParamList } from './types';

const Stack = createNativeStackNavigator<AuthStackParamList>();

export default function AuthNavigator() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="Onboarding" component={OnboardingScreen} />
      <Stack.Screen name="Login" component={LoginScreen} />
      <Stack.Screen name="SignUp" component={SignUpScreen} />
    </Stack.Navigator>
  );
}
