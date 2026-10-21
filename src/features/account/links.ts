/**
 * Where the Account screen's links go, as iOS `AccountView` writes them.
 *
 * Support is support@lifepass.is here (the Help row and the footer's
 * Contact), not MerchantInfo's receipts mailbox; Terms and Privacy are
 * MerchantInfo's (the same documents every checkout stamps).
 */
import { Linking } from 'react-native';

import { MerchantInfo } from '../../config/merchantInfo';

/** The Help row's subtitle and the address behind Help and Contact. */
export const SUPPORT_EMAIL = 'support@lifepass.is';

export const SUPPORT_MAILTO = `mailto:${SUPPORT_EMAIL}`;

/** Terms of sale (one document with the cancellation policy). */
export const TERMS_URL = MerchantInfo.termsURL;

export const PRIVACY_URL = MerchantInfo.privacyURL;

/** The web dashboard, where a company plan is activated when the app could not read the context. */
export const COMPANY_DASHBOARD_URL = 'https://www.lifepass.is/dashboard';

/**
 * Opens a link outside the app (the browser, the mail app), as a SwiftUI
 * `Link` / `openURL` does. A phone with nothing to open it with (no mail app)
 * does nothing rather than throw: the address is on screen to copy.
 */
export async function openExternal(url: string): Promise<void> {
  try {
    await Linking.openURL(url);
  } catch {
    // Nothing handles this URL on the phone.
  }
}
