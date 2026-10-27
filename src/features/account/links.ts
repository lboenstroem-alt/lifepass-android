/**
 * Where the Account screen's links go, as iOS `AccountView` writes them.
 *
 * Support is support@lifepass.is here (the Help row and the footer's
 * Contact), not MerchantInfo's receipts mailbox; Terms and Privacy are
 * MerchantInfo's (the same documents every checkout stamps).
 */
import { Linking } from 'react-native';

import { ANDROID_PACKAGE_NAME, PLAY_STORE_URL } from '../../api/appVersion';
import type { WhatsAppSupport } from '../../api/profile';
import { MerchantInfo } from '../../config/merchantInfo';
import type { Lang } from '../../i18n';

/** The Help row's subtitle and the address behind Help and Contact. */
export const SUPPORT_EMAIL = 'support@lifepass.is';

export const SUPPORT_MAILTO = `mailto:${SUPPORT_EMAIL}`;

/** Terms of sale (one document with the cancellation policy). */
export const TERMS_URL = MerchantInfo.termsURL;

export const PRIVACY_URL = MerchantInfo.privacyURL;

/** The web dashboard, where a company plan is activated when the app could not read the context. */
export const COMPANY_DASHBOARD_URL = 'https://www.lifepass.is/dashboard';

/**
 * The first line the WhatsApp support chat opens with, in the app language,
 * left open for the member to finish (iOS `WhatsAppSupport.greeting`; the
 * website prefills the same words). Nothing about the member goes in it.
 */
export function whatsAppGreeting(language: Lang): string {
  return language === 'is' ? 'Hæ LifePass, ég er með spurningu um ' : 'Hi LifePass, I have a question about ';
}

const WHATSAPP_NUMBER = /^[1-9]\d{7,14}$/;

/**
 * What the Account screen's WhatsApp row opens: the server's `url` with the
 * greeting as `?text=` (iOS `WhatsAppSupport.chatURL`), or null when there is
 * no chat (switched off, an older server) or the value is not exactly
 * `https://wa.me/<number>` for a full international number, so a bad value
 * (another host, another number) hides the row rather than opening the wrong
 * thing.
 */
export function whatsAppChatUrl(chat: WhatsAppSupport | null | undefined, language: Lang): string | null {
  if (!chat || !WHATSAPP_NUMBER.test(chat.number) || chat.url !== `https://wa.me/${chat.number}`) return null;
  return `${chat.url}?text=${encodeURIComponent(whatsAppGreeting(language))}`;
}

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

/**
 * "Rate LifePass" (API 0.46.0, docs/05 "Rating the app"): LifePass's page in
 * Google Play, where the member can rate the app whenever they like. The Play
 * Store app first (`market://`), else the listing on the web, which Android
 * hands to the Play Store app when it is installed and to the browser when
 * it is not. Not an ask: the row never counts towards the 4 months between
 * Google Play's review cards (src/features/storeReview).
 */
export const RATE_APP_MARKET_URL = `market://details?id=${ANDROID_PACKAGE_NAME}`;

/** The same page on the web. */
export const RATE_APP_WEB_URL = PLAY_STORE_URL;

/** Opens LifePass in Google Play; resolves false when neither link opened. Never throws. */
export async function openRateLifePass(
  open: (url: string) => Promise<unknown> = (url) => Linking.openURL(url),
): Promise<boolean> {
  try {
    await open(RATE_APP_MARKET_URL);
    return true;
  } catch {
    // No Play Store app (or it refused): the web listing.
  }
  try {
    await open(RATE_APP_WEB_URL);
    return true;
  } catch {
    return false;
  }
}
