// @f4-stub (F4, for the root): the set-new-password screen after a reset link, filled by AUTH-1.
//
// iOS ContentView presents `SetNewPasswordView` over WHATEVER is showing
// while `pendingPasswordRecovery` (the app store) is set: the recovery link
// signed the member in, and the exchange alone would leave them on the OLD
// password. It closes only through its own "Later" (no swipe, no back).
// F4 mounts this host once at the root (src/navigation/RootNavigator.tsx),
// above both the sign-in screens and the tabs. Not in plan 3.0.3: F4 added it
// so the screen has somewhere to appear. Keep the default export; replace
// the body (and this marker). Renders nothing until AUTH-1 lands.

export default function PasswordRecoveryHost() {
  return null;
}
