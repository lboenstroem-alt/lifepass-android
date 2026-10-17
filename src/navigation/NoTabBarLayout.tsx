/**
 * The layout of every page that covers the tab bar (the root modals and the
 * shared sheet): there is no tab bar under it.
 *
 * A screen that pads its bottom above the bar asks `useBottomTabBarHeight()`,
 * which THROWS outside the tabs ("Couldn't find the bottom tab bar height").
 * The first build's top-up page does, and it is what the Plans modal shows
 * until PLANS-1 lands, so opening Plans crashed. Here the hook answers the
 * system bar's inset instead: what that padding is for once no tab bar is
 * drawn (the app is edge to edge).
 */
import { BottomTabBarHeightContext } from '@react-navigation/bottom-tabs';
import type { ReactNode } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export default function NoTabBarLayout({ children }: { readonly children: ReactNode }) {
  const insets = useSafeAreaInsets();
  return <BottomTabBarHeightContext.Provider value={insets.bottom}>{children}</BottomTabBarHeightContext.Provider>;
}

/** For a navigator's or group's `screenLayout`. */
export function noTabBarScreenLayout({ children }: { readonly children: ReactNode }) {
  return <NoTabBarLayout>{children}</NoTabBarLayout>;
}
