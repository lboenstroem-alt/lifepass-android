/**
 * `useAppNavigation()`: what a screen anywhere in the signed-in app
 * navigates with, typed for its own tab's stack (shared routes push there,
 * keeping the tab bar), the tabs and the root modals (`navigate('Plans')`
 * bubbles up to the root).
 */
import { useNavigation } from '@react-navigation/native';

import type { AppNavigation } from './types';

export function useAppNavigation(): AppNavigation {
  return useNavigation<AppNavigation>();
}
