// @f4-stub (plan 3.0.2): route `ScanPushed` (the scanner pushed from a page, with a back button), filled by CHECKIN-1.
//
// Keep the default export and its props type; replace the body (and this
// marker). Until then it shows the first build's check-in screen.
import LegacyCheckInScreen from '../../../screens/checkin/CheckInScreen';
import type { SharedRouteProps } from '../../../navigation/types';

export default function ScanPushedScreen(_props: SharedRouteProps<'ScanPushed'>) {
  return <LegacyCheckInScreen />;
}
