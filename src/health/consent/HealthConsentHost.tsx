/**
 * The consent sheet the app shell keeps mounted above the navigator, shown
 * by `openHealthConsent` (./presenter.ts) from anywhere.
 */
import { useEffect } from 'react';

import HealthConsentSheet from './HealthConsentSheet';
import { attachHealthConsentHost, closeHealthConsent, useHealthConsentPresenter } from './presenter';

export type HealthConsentHostProps = {
  /** Where "Open Account" goes (the app shell's navigation). */
  onOpenAccount?: () => void;
};

/** Mounted once, above the navigator, by the app shell. */
export default function HealthConsentHost({ onOpenAccount }: HealthConsentHostProps) {
  // Until this runs, `openHealthConsent` answers false: nothing would draw it.
  useEffect(() => attachHealthConsentHost(), []);
  const request = useHealthConsentPresenter((s) => s.request);
  const visible = useHealthConsentPresenter((s) => s.visible);
  if (!request) return null;
  return (
    <HealthConsentSheet
      visible={visible}
      entry={request.entry}
      onClose={closeHealthConsent}
      onGranted={request.onGranted}
      onOpenAccount={request.onOpenAccount ?? onOpenAccount}
    />
  );
}

