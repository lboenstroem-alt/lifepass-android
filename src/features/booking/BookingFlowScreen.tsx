// @f4-stub (plan 3.0.2): route `BookingFlow` ({ venueId, activity, initialDate? }), filled by BOOK-1.
//
// Keep the default export and its props type; replace the body (and this
// marker). A legacy caller may still pass `{ venueId, activityId }` until it
// is rebuilt: tell them apart with `isLegacyBookingFlowParams`.
//
// Until then it shows the first build's booking screen, which reads
// `{ venueId, activityId }`.
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import {
  isLegacyBookingFlowParams,
  type HomeStackParamList,
  type SharedRouteProps,
} from '../../navigation/types';
import LegacyBookingFlowScreen from '../../screens/booking/BookingFlowScreen';

type LegacyProps = NativeStackScreenProps<HomeStackParamList, 'BookingFlow'>;

export default function BookingFlowScreen({ navigation, route }: SharedRouteProps<'BookingFlow'>) {
  const params = route.params;
  const legacyParams = isLegacyBookingFlowParams(params)
    ? params
    : { venueId: params.venueId, activityId: params.activity.id };
  // The first build's screen is typed against its own stack; at run time it
  // only calls navigate('TopUp'), popToTop and goBack on this navigation
  // (TopUp is translated to the Plans modal: src/navigation/legacyRoutes.ts).
  const legacyNavigation = navigation as unknown as LegacyProps['navigation'];
  const legacyRoute = { ...route, params: legacyParams } as unknown as LegacyProps['route'];
  return <LegacyBookingFlowScreen navigation={legacyNavigation} route={legacyRoute} />;
}
