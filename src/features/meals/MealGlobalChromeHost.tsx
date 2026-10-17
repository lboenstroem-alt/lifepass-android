// @f4-stub (plan 3.0.3, added in F4's fix round): the meal chrome over every tab, filled by MEAL-1 or MEAL-2.
//
// iOS `MainTabView` applies `.mealGlobalChrome()` (Views/Meals/MealCaptureView.swift
// `MealGlobalChrome`) over whichever tab is showing: the meal toasts ("Saved",
// "Your photo estimate is ready", with their "Food diary", "Undo" or "Check"
// action, drawn above the tab bar) and the membership gate (`MealGateSheet`)
// after a refusal. F4's tabs shell mounts this host once, next to the other
// app-wide sheet hosts, so the meal packages never edit the shell.
//
// Keep the default export (no props); replace the body (and this marker).
// The host sits outside any screen: a page it opens goes through
// `openSharedRoute(navigation, ...)` (src/navigation/sharedSheet.ts). Renders
// nothing until then.

export default function MealGlobalChromeHost() {
  return null;
}
