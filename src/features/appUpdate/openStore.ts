/**
 * Update: this app's page in Google Play. The Play Store app first
 * (`market://`, straight to the listing with its Update button), else the
 * listing on the web, which Android hands to the Play Store app when it is
 * installed and to the browser when it is not.
 */
import { Linking } from 'react-native';

import { ANDROID_PACKAGE_NAME, playStoreUrl } from '../../api/appVersion';

/** The Play Store app's link to the listing `storeUrl` names (this app's, by default). */
export function marketUrl(storeUrl: string): string {
  let id: string | null = null;
  try {
    id = new URL(playStoreUrl(storeUrl)).searchParams.get('id');
  } catch {
    id = null;
  }
  return `market://details?id=${encodeURIComponent(id || ANDROID_PACKAGE_NAME)}`;
}

/** Opens the listing; resolves false when neither link could be opened. Never throws. */
export async function openPlayStore(
  storeUrl: string,
  open: (url: string) => Promise<unknown> = (url) => Linking.openURL(url),
): Promise<boolean> {
  try {
    await open(marketUrl(storeUrl));
    return true;
  } catch {
    // No Play Store app (or it refused): the web listing.
  }
  try {
    await open(playStoreUrl(storeUrl));
    return true;
  } catch {
    return false;
  }
}
