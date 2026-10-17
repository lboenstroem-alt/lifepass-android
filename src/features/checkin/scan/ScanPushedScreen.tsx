/**
 * Route `ScanPushed`: the scanner a venue's "Scan QR" pushes on its own stack
 * (iOS `CheckInView(showsBackButton: true)`): a back arrow in the bar, no meal
 * entry, and every refusal explained. See ./CheckInScanView.tsx.
 */
import type { SharedRouteProps } from '../../../navigation/types';
import CheckInScanView from './CheckInScanView';

export default function ScanPushedScreen(_props: SharedRouteProps<'ScanPushed'>) {
  return <CheckInScanView pushed />;
}
