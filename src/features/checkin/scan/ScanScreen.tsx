/**
 * The Scan tab's first screen (`ScanMain`): the camera-first scanner with the
 * person button, the "Scan your meal" entry and check-in links (iOS
 * `CheckInView()` as tab 2). See ./CheckInScanView.tsx.
 */
import type { TabRootProps } from '../../../navigation/types';
import CheckInScanView from './CheckInScanView';

export default function ScanScreen(_props: TabRootProps<'ScanMain'>) {
  return <CheckInScanView pushed={false} />;
}
