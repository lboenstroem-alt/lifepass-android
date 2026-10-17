/**
 * The signed-out screens as the app mounts them: the real auth stack
 * (Onboarding, Log in, Sign up) under a NavigationContainer and the UI kit's
 * provider, with the set-new-password host beside it as the root has it.
 */
import { createNavigationContainerRef, NavigationContainer } from '@react-navigation/native';
import { act, render } from '@testing-library/react-native';

import { UiKitProvider } from '../../../components/ui';
import AuthNavigator from '../../../navigation/AuthNavigator';
import type { AuthStackParamList } from '../../../navigation/types';
import PasswordRecoveryHost from '../PasswordRecoveryHost';

export const authNavigation = createNavigationContainerRef<AuthStackParamList>();

export function AuthApp() {
  return (
    <NavigationContainer ref={authNavigation}>
      <UiKitProvider>
        <AuthNavigator />
        <PasswordRecoveryHost />
      </UiKitProvider>
    </NavigationContainer>
  );
}

export async function renderAuth() {
  const view = await render(<AuthApp />);
  await act(async () => undefined);
  return view;
}

/** The auth route on screen. */
export function currentAuthRoute(): string | undefined {
  return authNavigation.getCurrentRoute()?.name;
}

/** The routes in the auth stack, bottom first. */
export function authStack(): string[] {
  const state = authNavigation.getRootState();
  return state ? state.routes.map((route) => route.name) : [];
}
