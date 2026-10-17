import { View, Text, Image, StyleSheet } from 'react-native';
import { colors } from '../theme';
import BookItPill from './BookItPill';
import { priceLabel, isPremium } from '../types/venue';
import type { LegacyVenue as Venue } from '../types/venue';

type Props = {
  venue: Venue;
  /** Distance from the user in metres, shown next to the city when present. */
  distanceMeters?: number;
};

function formatDistance(m: number): string {
  if (m < 1000) return `${Math.round(m / 100) * 100} m`;
  return `${(m / 1000).toFixed(1)} km`;
}

export default function NearbyVenueCard({ venue, distanceMeters }: Props) {
  return (
    <View style={styles.card}>
      <View style={styles.imageWrapper}>
        <Image source={{ uri: venue.imageUrl }} style={styles.image} />
        {/* "Included" / "from ISK X" marker — sits on a dark pill over the
            photo, so it keeps the light accent tints. */}
        <View style={styles.priceBadge}>
          <Text
            style={[styles.priceText, { color: isPremium(venue) ? '#A8D8F0' : colors.blueMid }]}
          >
            {priceLabel(venue)}
          </Text>
        </View>
      </View>
      <View style={styles.info}>
        <View style={styles.infoText}>
          <Text style={styles.name} numberOfLines={1}>{venue.name}</Text>
          <Text style={styles.city} numberOfLines={1}>
            {venue.city}
            {distanceMeters != null ? ` · ${formatDistance(distanceMeters)}` : ''}
          </Text>
        </View>
        <BookItPill fullWidth />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    width: 170,
    backgroundColor: colors.ink2,
    borderRadius: 14,
    overflow: 'hidden',
    borderWidth: 0.5,
    borderColor: colors.line,
  },
  imageWrapper: {
    width: 170,
    height: 130,
  },
  image: {
    width: '100%',
    height: '100%',
  },
  priceBadge: {
    position: 'absolute',
    top: 8,
    right: 8,
    backgroundColor: 'rgba(15,23,42,0.75)',
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  priceText: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  info: {
    paddingHorizontal: 12,
    paddingVertical: 12,
    gap: 8,
  },
  infoText: {
    gap: 3,
  },
  name: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.paper,
    letterSpacing: -0.1,
  },
  city: {
    fontSize: 11,
    color: colors.paper3,
  },
});
