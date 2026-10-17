/**
 * The consent sheet the app shell keeps mounted above the navigator, shown
 * by `openHealthConsent` (./presenter.ts) from anywhere.
 */
import HealthConsentSheet from './HealthConsentSheet';
import { closeHealthConsent, useHealthConsentPresenter } from './presenter';

export type HealthConsentHostProps = {
  /** Where "Open Account" goes (the app shell's navigation). */
  onOpenAccount?: () => void;
};

/** Mounted once, above the navigator, by the app shell. */
export default function HealthConsentHost({ onOpenAccount }: HealthConsentHostProps) {
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

