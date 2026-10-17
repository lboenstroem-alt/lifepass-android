// The UI kit's app-wide pieces, mounted once by the app shell (F4), directly
// INSIDE the NavigationContainer and around the root navigator:
//
//   <NavigationContainer>
//     <UiKitProvider>
//       <RootNavigator />
//     </UiKitProvider>
//   </NavigationContainer>
//
// It MUST be mounted before any screen opens a <Sheet>: without
// BottomSheetModalProvider the library throws on the first sheet, and
// showDialog / showToast draw nothing (they only warn in development).
// Until F4 mounts it in App.tsx (contract request), nothing does.
//
// - GestureHandlerRootView: bottom sheets are gesture-driven.
// - BottomSheetModalProvider: the host every <Sheet> renders into. Its portal
//   host is drawn AFTER the app's screens, as their sibling, so a sheet's
//   content sees only the contexts above this provider (the navigation
//   container's theme and root ref among them). The Sheet itself carries the
//   presenting screen's navigation and route across (Sheet.tsx, SCREEN
//   CONTEXT); any other screen-level context must reach a sheet as props.
// - The screens' layer: while a sheet is up it is hidden from TalkBack, so the
//   sheet is modal as an iOS sheet is to VoiceOver (the tab bar and the Book
//   or Pay button behind it cannot be reached by swiping). The sheet itself,
//   the toast and the dialog are outside this layer and stay reachable.
// - ToastHost: draws showToast() over the screens (under any open sheet, as
//   iOS draws its toasts over the tab view, not over sheets).
// - DialogHost: draws showDialog(), above everything (its own window).
//
// Both hosts outlive a sign-out (they sit above the navigator); resetUiKit()
// (./reset.ts) clears them and must be registered as a sign-out cleaner.
import { BottomSheetModalProvider } from '@gorhom/bottom-sheet';
import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { DialogHost } from './Dialog';
import { useSheetOpen } from './Sheet';
import { ToastHost } from './Toast';

export type UiKitProviderProps = {
  children: ReactNode;
  /** Where every toast sits above the bottom edge; omitted, each kind sits where iOS draws it. */
  toastBottomOffset?: number;
};

export default function UiKitProvider({ children, toastBottomOffset }: UiKitProviderProps) {
  return (
    <GestureHandlerRootView style={styles.root}>
      <BottomSheetModalProvider>
        <ScreensLayer>{children}</ScreensLayer>
        <ToastHost bottomOffset={toastBottomOffset} />
        <DialogHost />
      </BottomSheetModalProvider>
    </GestureHandlerRootView>
  );
}

/** The app's screens, hidden from TalkBack while a sheet is up. */
function ScreensLayer({ children }: { children: ReactNode }) {
  const sheetOpen = useSheetOpen();
  return (
    <View
      style={styles.root}
      // Always a real view, so the switch never re-parents the screens.
      collapsable={false}
      importantForAccessibility={sheetOpen ? 'no-hide-descendants' : 'auto'}
      accessibilityElementsHidden={sheetOpen}
      testID="uikit.screens"
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
});
