// The UI kit's app-wide pieces, mounted once by the app shell (F4), INSIDE
// the NavigationContainer so sheet content can still use navigation:
//
//   <NavigationContainer>
//     <UiKitProvider toastBottomOffset={110}>
//       <RootNavigator />
//     </UiKitProvider>
//   </NavigationContainer>
//
// - GestureHandlerRootView: bottom sheets are gesture-driven.
// - BottomSheetModalProvider: the host every <Sheet> renders into.
// - ToastHost: draws showToast() over the screens (under any open sheet, as
//   iOS draws its toasts over the tab view, not over sheets).
// - DialogHost: draws showDialog(), above everything (its own window).
import { BottomSheetModalProvider } from '@gorhom/bottom-sheet';
import type { ReactNode } from 'react';
import { StyleSheet } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { DialogHost } from './Dialog';
import { ToastHost } from './Toast';

export type UiKitProviderProps = {
  children: ReactNode;
  /** Where toasts sit above the bottom edge (over the tab bar). */
  toastBottomOffset?: number;
};

export default function UiKitProvider({ children, toastBottomOffset }: UiKitProviderProps) {
  return (
    <GestureHandlerRootView style={styles.root}>
      <BottomSheetModalProvider>
        {children}
        <ToastHost bottomOffset={toastBottomOffset} />
        <DialogHost />
      </BottomSheetModalProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
});
