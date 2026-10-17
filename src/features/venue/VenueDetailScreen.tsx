// @f4-stub (plan 3.0.2): route `VenueDetail` ({ slug }), filled by VENUE-1.
//
// Keep the default export and its props type; replace the body (and this
// marker). Until every caller passes a slug, a legacy caller may still pass
// `{ venueId }`: read both with `venueDetailTarget(route.params)`.
//
// Until then it shows the first build's venue screen, which loads by id: a
// slug is looked up first (`GET /venues/by-slug/{slug}`).
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { fetchVenueBySlug } from '../../api/venues';
import { ErrorState } from '../../components/ui';
import { venueDetailTarget, type SharedRouteProps } from '../../navigation/types';
import LegacyVenueDetailScreen from '../../screens/venue/VenueDetailScreen';
import { colors } from '../../theme';

export default function VenueDetailScreen({ navigation, route }: SharedRouteProps<'VenueDetail'>) {
  const target = venueDetailTarget(route.params);
  const slug = 'slug' in target ? target.slug : null;
  const [venueId, setVenueId] = useState<string | null>('venueId' in target ? target.venueId : null);
  const [failed, setFailed] = useState(false);

  const resolve = useCallback(() => {
    if (slug === null) return () => undefined;
    let live = true;
    setFailed(false);
    fetchVenueBySlug(slug).then(
      (venue) => {
        if (live) setVenueId(venue.id);
      },
      () => {
        if (live) setFailed(true);
      },
    );
    return () => {
      live = false;
    };
  }, [slug]);

  useEffect(() => resolve(), [resolve]);

  if (venueId === null) {
    return (
      <View style={styles.page}>
        {failed ? <ErrorState onRetry={resolve} /> : <ActivityIndicator color={colors.rust} />}
      </View>
    );
  }

  return (
    <LegacyVenueDetailScreen
      navigation={{
        goBack: () => navigation.goBack(),
        navigate: (_screen, params) => navigation.navigate('BookingFlow', params),
      }}
      route={{ params: { venueId } }}
    />
  );
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
    backgroundColor: colors.ink,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
