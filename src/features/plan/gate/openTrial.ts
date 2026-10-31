/**
 * The gate's "Try it free": the web trial page, which shows the trial terms
 * a member has to agree to (iOS has no trial flow of its own and opens the
 * page in the same `SafariCheckoutView` cover as every hosted page).
 *
 * IN THE APP'S OWN TASK, with F8's hosted-page options: a Custom Tab in a
 * task of its own (expo-web-browser's default on Android) is left out of
 * Recents and dropped as soon as the member switches to their bank's app to
 * approve the card for the trial (3-D Secure), so coming back would land on
 * Plan with the page gone. In the app's task the tab stays on top while they
 * are away, as iOS's cover does (src/payments/hostedPage.ts says why).
 */
import * as WebBrowser from 'expo-web-browser';

import type { Lang } from '../../../i18n';
import { HOSTED_PAGE_OPTIONS } from '../../../payments/hostedPage';

import { trialUrl } from './gateRules';

export function openTrialPage(language: Lang): void {
  void WebBrowser.openBrowserAsync(trialUrl(language), { ...HOSTED_PAGE_OPTIONS }).catch(() => undefined);
}
