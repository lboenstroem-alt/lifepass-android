import { View, Text, Image, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../theme';
import BookItPill from './BookItPill';
import type { LegacyVenue as Venue } from '../types/venue';

type Props = {
  venue: Venue;
  isFavourited: boolean;
  onToggleFavourite: () => void;
};

export default function CuratedVenueRow({ venue, isFavourited, onToggleFavourite }: Props) {
  return (
    <View style={styles.row}>
      <Image source={{ uri: venue.imageUrl }} style={styles.image} />
      <View style={styles.info}>
        <Text style={styles.name}>{venue.name}</Text>
        <Text style={styles.city}>{venue.city}</Text>
        {venue.category.length > 0 && (
          <View style={styles.chips}>
            {venue.category.slice(0, 2).map((cat) => (
              <View key={cat} style={styles.chip}>
                <Text style={styles.chipText}>{cat}</Text>
              </View>
            ))}
          </View>
        )}
      </View>
      {/* Favourite heart + Book it CTA, trailing-aligned */}
      <View style={styles.right}>
        <TouchableOpacity
          onPress={onToggleFavourite}
          activeOpacity={0.7}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Ionicons
            name={isFavourited ? 'heart' : 'heart-outline'}
            size={20}
            color={isFavourited ? colors.blue : colors.paper3}
          />
        </TouchableOpacity>
        <BookItPill />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 10,
    backgroundColor: colors.ink2,
    borderRadius: 14,
    borderWidth: 0.5,
    borderColor: colors.line,
  },
  image: {
    width: 72,
    height: 72,
    borderRadius: 10,
  },
  info: {
    flex: 1,
    gap: 4,
  },
  name: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.paper,
  },
  city: {
    fontSize: 12,
    color: colors.paper3,
  },
  chips: {
    flexDirection: 'row',
    gap: 6,
    marginTop: 2,
  },
  chip: {
    backgroundColor: colors.ink4,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  chipText: {
    fontSize: 10,
    fontWeight: '500',
    color: colors.paper2,
    letterSpacing: 0.4,
  },
  right: {
    alignItems: 'flex-end',
    gap: 8,
  },
});
