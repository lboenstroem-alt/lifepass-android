// @f4-stub (plan 3.0.2): the Scan tab's first screen (`ScanMain`), filled by CHECKIN-1.
//
// Keep the default export and its props type; replace the body (and this
// marker). CHECKIN-1 takes a parked check-in link here
// (`useIntentStore.takeScanVenue()`, then "Check in at <venue>?"), reports a
// live camera (`setScanCameraLive`) so the tab bar turns dark, and points
// the person button at Profile (`openProfile(navigation, 'scan')`).
//
// Until then it shows the first build's check-in screen. A check-in link
// still only parks its venue: this screen never checks anyone in from a link.
import LegacyCheckInScreen from '../../../screens/checkin/CheckInScreen';
import type { TabRootProps } from '../../../navigation/types';

export default function ScanScreen(_props: TabRootProps<'ScanMain'>) {
  return <LegacyCheckInScreen />;
}
