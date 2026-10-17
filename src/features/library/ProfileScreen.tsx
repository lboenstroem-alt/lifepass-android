// @f4-stub (plan 3.0.2): route `Profile` (bookings and saved, iOS LibraryView), filled by LIB-1.
//
// Behind the Home avatar and every person button; Account behind its gear.
// Keep the default export and its props type; replace the body (and this
// marker). Until then it shows the first build's Library screen, which reads
// `initialTab` from the same route.
import LegacyBookingsScreen from '../../screens/bookings/BookingsScreen';
import type { SharedRouteProps } from '../../navigation/types';

export default function ProfileScreen(_props: SharedRouteProps<'Profile'>) {
  return <LegacyBookingsScreen />;
}
