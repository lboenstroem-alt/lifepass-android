/**
 * Whether the launch screen is up: until the session is resolved and the
 * first profile read has answered (the app store's `isLoading`) AND launch
 * has chosen its tab (src/app/launchTab.ts). RootNavigator draws
 * LaunchScreen while this is true; anything that must not appear over the
 * launch screen (the update prompt's "A new version is available") waits on
 * the same hook, so the two can never disagree.
 */
import { useAppStore } from '../stores/appStore';
import { useNavPrefs } from './navPrefs';

export function useLaunchScreenShowing(): boolean {
  const isLoading = useAppStore((s) => s.isLoading);
  const launchDecided = useNavPrefs((s) => s.launchTab !== null);
  return isLoading || !launchDecided;
}
