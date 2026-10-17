import { View, Text, Image, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../theme';
import { priceLabel } from '../types/venue';
import type { LegacyVenue as Venue } from '../types/venue';

type Props = {
  venue: Venue;
  isFavourited: boolean;
  onBook: () => void;
  onToggleFavourite: () => void;
};

export default function PopularVenueRow({ venue, isFavourited, onBook, onToggleFavourite }: Props) {
  const subtitle = venue.description
    ? venue.description.split('.')[0]           // first sentence of description
    : venue.category.slice(0, 3).join(', ');    // fallback: category tags

  return (
    <View style={styles.card}>
      {/* Left — venue image */}
      <Image source={{ uri: venue.imageUrl }} style={styles.image} />

      {/* Right — content */}
      <View style={styles.content}>
        {/* Top row: name + favourite */}
        <View style={styles.topRow}>
          <Text style={styles.name} numberOfLines={2}>{venue.name}</Text>
          <TouchableOpacity
            onPress={onToggleFavourite}
            activeOpacity={0.7}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Ionicons
              name={isFavourited ? 'heart' : 'heart-outline'}
              size={22}
              color={isFavourited ? colors.blue : colors.paper3}
            />
          </TouchableOpacity>
        </View>

        {/* Subtitle */}
        <Text style={styles.subtitle} numberOfLines={2}>{subtitle}</Text>

        {/* Bottom row: book + price */}
        <View style={styles.bottomRow}>
          <TouchableOpacity style={styles.bookBtn} onPress={onBook} activeOpacity={0.8}>
            <Text style={styles.bookBtnText}>Book</Text>
          </TouchableOpacity>
          <View style={styles.creditsPill}>
            <Text style={styles.creditsText}>{priceLabel(venue)}</Text>
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    backgroundColor: colors.ink2,
    borderRadius: 16,
    borderWidth: 0.5,
    borderColor: colors.line,
    overflow: 'hidden',
    minHeight: 180,
  },
  image: {
    width: 140,
    alignSelf: 'stretch',
  },
  content: {
    flex: 1,
    padding: 14,
    gap: 6,
    justifyContent: 'space-between',
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 8,
  },
  name: {
    flex: 1,
    fontSize: 17,
    fontWeight: '600',
    color: colors.paper,
    letterSpacing: -0.3,
    lineHeight: 22,
  },
  subtitle: {
    fontSize: 13,
    color: colors.paper3,
    lineHeight: 18,
  },
  bottomRow: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
    marginTop: 4,
  },
  bookBtn: {
    backgroundColor: colors.ink3,
    borderRadius: 999,
    paddingHorizontal: 20,
    paddingVertical: 8,
    borderWidth: 0.5,
    borderColor: colors.line2,
  },
  bookBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.paper,
  },
  creditsPill: {
    backgroundColor: colors.ink3,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderWidth: 0.5,
    borderColor: colors.line2,
  },
  creditsText: {
    fontSize: 13,
    fontWeight: '500',
    color: colors.paper2,
  },
});
