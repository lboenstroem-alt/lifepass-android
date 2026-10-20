/* eslint lifepass/no-literal-copy: "error" */
// DEPRECATED SHIM: the Kenni eID sheet is src/features/kenni/KenniSheet.tsx
// (AUTH-3). This module path stays only because two things outside AUTH-3
// still use it:
//   - the first build's plans screen (src/screens/account/TopUpScreen.tsx,
//     PLANS-1), which mounts it with `visible` / `onClose` / `onVerified`;
//   - F4's shell tests, which stand in for the sheet here, so the host
//     (src/features/kenni/KenniNudgeHost.tsx) renders through this path.
// Delete it once PLANS-1 has replaced the plans screen and the shell tests
// mock the feature's sheet (QA-1 removes leftovers).
//
// TODO(AUTH-3 contract requests, tracked for QA-1's no-shim check):
//   1. F4: src/navigation/__tests__/tabsShell.test.tsx and rootModals.test.tsx
//      mock '../../features/kenni/KenniSheet' instead of this path; then
//      KenniNudgeHost imports ./KenniSheet directly.
//   2. PLANS-1: TopUpScreen (or its replacement) calls `openKenniSheet({
//      bodyKey: 'kenni.body', onSeePasses, onClose })` instead of mounting
//      this, so one host shows every Kenni sheet.
//   Then delete this file.
// Until then a sheet mounted here still announces its close to
// `onKenniSheetClosed` (the sheet does that itself).
//
// `onVerified` keeps its first-build meaning, "the member is verified and the
// sheet is done", but now runs once the sheet has LEFT the screen, so the
// hosted checkout the plans screen opens next never collides with it. Every
// other prop is the sheet's own.
// Straight to the file, not the feature's index: the index exports the host,
// which imports this module.
import KenniSheet, { type KenniSheetProps } from '../features/kenni/KenniSheet';

export type KenniVerificationModalProps = KenniSheetProps & {
  /** The sheet closed verified (it has already re-read the profile). */
  onVerified?: () => void;
};

export default function KenniVerificationModal({ onVerified, onClosed, ...props }: KenniVerificationModalProps) {
  return (
    <KenniSheet
      {...props}
      onClosed={(outcome) => {
        onClosed?.(outcome);
        if (outcome.verified) onVerified?.();
      }}
    />
  );
}
