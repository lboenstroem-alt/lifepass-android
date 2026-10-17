/**
 * The app's real navigators (root stack, tabs, the five stacks, the shared
 * routes, the root modals) for the shell's tests, with the first build's
 * screens replaced by stand-ins that show their route (they read the network
 * at mount). Each test file mocks the legacy screen modules with
 * `standInScreen` (./standIn.tsx), then renders `<ShellApp />`.
 */
import { NavigationContainer } from '@react-navigation/native';
import { act, render } from '@testing-library/react-native';

import { UiKitProvider } from '../../components/ui';
import { resetAppStoreForTests, useAppStore } from '../../stores/appStore';
import { resetIntentStoreForTests } from '../../stores/intentStore';
import { resetNotificationRouterForTests } from '../../app/notificationRouter';
import { onUnhandledNavigationAction } from '../legacyRoutes';
import { currentTab, navigationRef } from '../navigationRef';
import { resetNavPrefsForTests, setLaunchTab, useNavPrefs } from '../navPrefs';
import RootNavigator from '../RootNavigator';
import type { MainTab } from '../types';

export function ShellApp() {
  return (
    <NavigationContainer ref={navigationRef} onUnhandledAction={onUnhandledNavigationAction}>
      <UiKitProvider>
        <RootNavigator />
      </UiKitProvider>
    </NavigationContainer>
  );
}

/** A fresh process, signed in, launch decided on `launchTab`. */
export function signedIn(launchTab: MainTab = 'Explore'): void {
  resetAppStoreForTests();
  resetIntentStoreForTests();
  resetNotificationRouterForTests();
  resetNavPrefsForTests();
  useNavPrefs.setState({ hydrated: true });
  setLaunchTab(launchTab);
  useAppStore.setState({ isLoading: false, isAuthenticated: true, userId: 'member-a' });
}

export async function renderShell() {
  const view = await render(<ShellApp />);
  await act(async () => undefined);
  return view;
}

/** The route on screen (deepest). */
export function currentRouteName(): string | undefined {
  return navigationRef.getCurrentRoute()?.name;
}

export { currentTab, navigationRef };
