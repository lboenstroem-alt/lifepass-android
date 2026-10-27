/**
 * The app root (iOS LifePassApp + ContentView).
 *
 * Once per process, before the first signed-in screen:
 * - the tab migration, the cold-launch tab and the tab bar's stored prefs
 *   (src/app/launchTab.ts);
 * - the session restore and first profile read (the app store's `bootstrap`,
 *   behind the launch screen);
 * - location at LAUNCH, not when Home appears: a link can open the app
 *   straight into another tab (F6 `startLocationAtLaunch`);
 * - the link router (check-in, auth, payment returns) and the notification
 *   tap router, both of which park what they receive until the tabs are up;
 * - the update check (src/features/appUpdate): below the owner's minimum
 *   version the app is blocked behind an Update button, and a newer version
 *   on Google Play is offered once. It fails open: no answer, no prompt.
 * - "Confirming your payment…" (src/payments/RecoveryProgressHost): when
 *   Android killed the app behind the payment page and the return link
 *   cold-starts it, the recovery confirms the payment while the member
 *   watches, with a Cancel, as iOS keeps the waiting screen up.
 *
 * Notification permission is NOT asked here: iOS never asks at launch, only
 * in context (a first booking, a reminder switch), and a member who has not
 * signed in has nothing to be reminded of.
 */
import 'react-native-url-polyfill/auto';
import 'react-native-gesture-handler';

import {
  Fraunces_400Regular,
  Fraunces_400Regular_Italic,
  Fraunces_500Medium,
  Fraunces_500Medium_Italic,
  Fraunces_600SemiBold,
  Fraunces_700Bold,
} from '@expo-google-fonts/fraunces';
import {
  InterTight_400Regular,
  InterTight_400Regular_Italic,
  InterTight_500Medium,
  InterTight_500Medium_Italic,
  InterTight_600SemiBold,
  InterTight_600SemiBold_Italic,
  InterTight_700Bold,
  InterTight_700Bold_Italic,
} from '@expo-google-fonts/inter-tight';
import { DefaultTheme, NavigationContainer, type Theme } from '@react-navigation/native';
import { useFonts } from 'expo-font';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { startDeepLinks } from './src/app/deepLinks';
import { prepareLaunchTab } from './src/app/launchTab';
import { startNotificationRouter } from './src/app/notificationRouter';
import { UiKitProvider } from './src/components/ui';
import { AppUpdateHost } from './src/features/appUpdate';
import { onUnhandledNavigationAction } from './src/navigation/legacyRoutes';
import { navigationRef } from './src/navigation/navigationRef';
import { setLaunchTab } from './src/navigation/navPrefs';
import RootNavigator from './src/navigation/RootNavigator';
import { RecoveryProgressHost } from './src/payments';
import { useAppStore } from './src/stores/appStore';
import { startLocationAtLaunch } from './src/stores/locationStore';
import { colors } from './src/theme';

/** Paper behind every screen, so a transition never flashes white. */
const navigationTheme: Theme = {
  ...DefaultTheme,
  colors: { ...DefaultTheme.colors, background: colors.ink, card: colors.ink, text: colors.paper, primary: colors.rust },
};

/** Launch work that runs once, whatever mounts first. */
let launched = false;

export function launchApp(): void {
  if (launched) return;
  launched = true;
  // The tab is decided alongside the session restore; the launch screen
  // waits for both (RootNavigator).
  void prepareLaunchTab().then(setLaunchTab, () => setLaunchTab('Explore'));
  void useAppStore.getState().bootstrap();
}

/** Back to a fresh process (tests). */
export function resetLaunchForTests(): void {
  launched = false;
}

export default function App() {
  const [fontsLoaded] = useFonts({
    InterTight_400Regular,
    InterTight_500Medium,
    InterTight_600SemiBold,
    InterTight_700Bold,
    InterTight_400Regular_Italic,
    InterTight_500Medium_Italic,
    InterTight_600SemiBold_Italic,
    InterTight_700Bold_Italic,
    Fraunces_400Regular,
    Fraunces_500Medium,
    Fraunces_600SemiBold,
    Fraunces_700Bold,
    Fraunces_400Regular_Italic,
    Fraunces_500Medium_Italic,
  });

  useEffect(() => {
    launchApp();
    const stopLinks = startDeepLinks();
    const stopNotifications = startNotificationRouter();
    const stopLocation = startLocationAtLaunch();
    return () => {
      stopLinks();
      stopNotifications();
      stopLocation();
    };
  }, []);

  // Hold the first frame until the custom fonts are ready so text doesn't
  // flash in the system face and reflow. The native splash covers this gap.
  if (!fontsLoaded) return null;

  return (
    <SafeAreaProvider>
      <NavigationContainer ref={navigationRef} theme={navigationTheme} onUnhandledAction={onUnhandledNavigationAction}>
        <StatusBar style="dark" />
        <UiKitProvider>
          <RootNavigator />
          {/* "Confirming your payment…" while a payment lost behind the page is
              confirmed after a cold start, over whichever tab the app landed on
              (its own window, as the UI kit's dialog). Here and not in the UI
              kit, so the kit never imports the payment rails. */}
          <RecoveryProgressHost />
        </UiKitProvider>
      </NavigationContainer>
      {/* Over everything, the sign-in screens and the launch screen too. */}
      <AppUpdateHost />
    </SafeAreaProvider>
  );
}
