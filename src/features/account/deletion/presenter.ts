/**
 * The deletion sheet, opened from anywhere: a refusal's "Cancel deletion"
 * (src/navigation/refusalSteps.ts) opens it over the refusing screen, as iOS
 * `RefusalStepPresenter` presents `AccountDeletionSheet` for `.deletion`.
 * The Account row keeps its own sheet (../slots/DeletionRow.tsx), as iOS
 * `AccountView` does. No UI here, so navigation code can call it without
 * loading a screen.
 *
 * NO HOST, NO SHEET. The host (./AccountDeletionHost.tsx, mounted once by
 * the tabs shell) registers itself when it mounts. With none mounted,
 * `openAccountDeletion` answers false and leaves nothing pending, and the
 * refusal step takes the member to Account, where the same sheet lives.
 *
 * One request at a time, as iOS cannot present two sheets at once either:
 * while one is up (or still sliding away) a second answers false.
 */
import { create } from 'zustand';

export interface AccountDeletionOptions {
  /** The sheet closed. Called once, and only when this call opened the sheet. */
  readonly onClose: () => void;
}

interface PresenterState {
  /** The request on screen, kept while the sheet slides away so its content does not vanish. */
  readonly request: AccountDeletionOptions | null;
  readonly visible: boolean;
}

export const useAccountDeletionPresenter = create<PresenterState>()(() => ({ request: null, visible: false }));

/** How many hosts are mounted: the tabs shell's one (a test may render its own). */
let hostsMounted = 0;

/**
 * The host calls this when it mounts, and the answer when it unmounts. When
 * the last host goes (a sign-out takes the tabs away), whatever it was
 * showing goes with it.
 */
export function attachAccountDeletionHost(): () => void {
  hostsMounted += 1;
  let attached = true;
  return () => {
    if (!attached) return;
    attached = false;
    hostsMounted -= 1;
    if (hostsMounted === 0) useAccountDeletionPresenter.setState({ request: null, visible: false });
  };
}

/** Whether a host is mounted to draw what `openAccountDeletion` asks for. */
export function isAccountDeletionHostMounted(): boolean {
  return hostsMounted > 0;
}

/**
 * Opens the deletion sheet. Answers whether it did: false, and nothing
 * shown, when no host is mounted or a sheet is already up. When it did,
 * `onClose` runs once, after the sheet has gone (whatever the member did in
 * it), so a refusing screen re-checks its selection.
 */
export function openAccountDeletion(options: AccountDeletionOptions): boolean {
  if (hostsMounted === 0) return false;
  if (useAccountDeletionPresenter.getState().request) return false;
  useAccountDeletionPresenter.setState({ request: options, visible: true });
  return true;
}

/** Closes it (the sheet's own close does this). */
export function closeAccountDeletion(): void {
  useAccountDeletionPresenter.setState({ visible: false });
}

/**
 * The sheet has gone: the request is over and its `onClose` runs (once).
 * Called by the host.
 */
export function finishAccountDeletionRequest(): void {
  const { request } = useAccountDeletionPresenter.getState();
  useAccountDeletionPresenter.setState({ request: null, visible: false });
  if (!request) return;
  try {
    request.onClose();
  } catch {
    // The caller's re-check must never keep the next request from opening.
  }
}

/** Tests: nothing showing, nothing mounted. */
export function resetAccountDeletionPresenterForTests(): void {
  hostsMounted = 0;
  useAccountDeletionPresenter.setState({ request: null, visible: false });
}
