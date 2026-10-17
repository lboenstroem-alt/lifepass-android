/**
 * The deletion sheet the tabs shell keeps mounted, shown by
 * `openAccountDeletion` (./presenter.ts) from anywhere: a refusal's "Cancel
 * deletion" opens it over the refusing screen, as on iOS.
 */
import { useEffect } from 'react';

import AccountDeletionSheet from './AccountDeletionSheet';
import {
  attachAccountDeletionHost,
  closeAccountDeletion,
  finishAccountDeletionRequest,
  useAccountDeletionPresenter,
} from './presenter';

/** Mounted once, beside the other app-wide sheet hosts, by the tabs shell. */
export default function AccountDeletionHost() {
  // Until this runs, `openAccountDeletion` answers false: nothing would draw it.
  useEffect(() => attachAccountDeletionHost(), []);
  const hasRequest = useAccountDeletionPresenter((s) => s.request !== null);
  const visible = useAccountDeletionPresenter((s) => s.visible);
  if (!hasRequest) return null;
  return (
    <AccountDeletionSheet
      visible={visible}
      onClose={closeAccountDeletion}
      onClosed={finishAccountDeletionRequest}
      testID="deletion.host.sheet"
    />
  );
}
