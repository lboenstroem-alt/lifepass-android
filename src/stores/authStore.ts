/**
 * The first Android build's auth flags, kept for the onboarding screen and
 * RootNavigator until AUTH-1 and F4 replace them. Who is signed in is NOT
 * here: that is the app store (src/stores/appStore.ts). `isAuthenticated`
 * below is unused and stays false; read `useAppStore((s) => s.isAuthenticated)`.
 */
import { create } from 'zustand';

type AuthStore = {
  /** @deprecated Unused; see `useAppStore`. */
  isAuthenticated: boolean;
  hasSeenOnboarding: boolean;
  /** @deprecated Unused; see `useAppStore`. */
  setAuthenticated: (value: boolean) => void;
  setHasSeenOnboarding: (value: boolean) => void;
};

export const useAuthStore = create<AuthStore>((set) => ({
  isAuthenticated: false,
  hasSeenOnboarding: false,
  setAuthenticated: (value) => set({ isAuthenticated: value }),
  setHasSeenOnboarding: (value) => set({ hasSeenOnboarding: value }),
}));
