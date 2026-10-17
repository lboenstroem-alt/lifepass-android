// @f4-stub (plan 3.0.3): draws the change-days sheet `openChangeDays` asks for, filled by PLAN-4.
// Mounted once by F4's tabs shell. Renders nothing until then.
// The host sits in the tabs shell, outside any screen: a page it opens goes
// through `openSharedRoute(navigation, ...)` (src/navigation/sharedSheet.ts),
// which finds the current tab, or the shared sheet over a root modal. Close
// the sheet first: UI-kit sheets are drawn over every page.

export default function ChangeDaysHost() {
  return null;
}
