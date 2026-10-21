/**
 * The meal chrome over every tab (iOS `MealGlobalChrome`,
 * Views/Meals/MealCaptureView.swift), mounted once by F4's tabs shell.
 *
 * iOS draws two things over whichever tab is showing:
 *
 * - the meal toasts ("Saved. About 1,460 kcal today." with Food diary,
 *   "Saved on this phone...", "Added" with Undo): on Android these are the UI
 *   kit's meal toasts (`showToast(..., { kind: 'meal' })`), drawn by the one
 *   ToastHost the app shell already mounts above the tab bar, so nothing more
 *   is needed here;
 * - the membership gate after a refusal, and the consent sheet a meal entry
 *   asks for: F7's presenters (`presentMealGate`, `openHealthConsent`) draw
 *   through the health host, which nothing else mounts yet (F7's own header
 *   asks F4 to). It is mounted here, with where its buttons lead: the Plans
 *   sheet, and Account on the current tab (or over a root modal).
 *
 * If the app shell ever mounts `HealthHost` itself, this must stop doing so,
 * or each presentation would be drawn twice.
 */
import { HealthHost } from '../../health/ui';
import { navigateInCurrentTab, openRootModal } from '../../navigation/navigationRef';

function seeMemberships(): void {
  openRootModal('Plans');
}

function openAccount(): void {
  navigateInCurrentTab('Account');
}

export default function MealGlobalChromeHost() {
  return <HealthHost onSeeMemberships={seeMemberships} onOpenAccount={openAccount} />;
}
