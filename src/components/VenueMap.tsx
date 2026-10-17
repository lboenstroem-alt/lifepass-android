// Mapbox-backed venue map (native iOS/Android). Replaces the old react-native-maps
// MapView — Mapbox works on Android without a Google Maps key (which hard-crashed
// the app when missing) and degrades to a blank map, never a crash, if the
// runtime token is absent.
import { StyleSheet, TouchableOpacity, View, Image } from 'react-native';
import Mapbox, { MapView, Camera, MarkerView } from '@rnmapbox/maps';
import { colors } from '../theme';
import type { LegacyVenue as Venue } from '../types/venue';

// Public access token (pk.…). Inlined at build time from the environment; loading
// tiles simply fails to a blank map if it's unset — it does NOT crash.
Mapbox.setAccessToken(process.env.EXPO_PUBLIC_MAPBOX_TOKEN ?? null);

// Reykjavik — initial camera center, in Mapbox [longitude, latitude] order.
const REYKJAVIK: [number, number] = [-21.9426, 64.1466];

type Props = {
  venues: Venue[];
  selectedVenueId: string | null;
  onSelect: (venueId: string) => void;
};

export default function VenueMap({ venues, selectedVenueId, onSelect }: Props) {
  return (
    <MapView
      style={StyleSheet.absoluteFill}
      styleURL={Mapbox.StyleURL.Light}
      scaleBarEnabled={false}
      compassEnabled={false}
      logoPosition={{ bottom: 8, left: 8 }}
      attributionPosition={{ bottom: 8, left: 96 }}
    >
      <Camera defaultSettings={{ centerCoordinate: REYKJAVIK, zoomLevel: 11 }} />
      {venues
        .filter((v) => v.latitude != null && v.longitude != null)
        .map((venue) => (
          <MarkerView
            key={venue.id}
            coordinate={[venue.longitude as number, venue.latitude as number]}
            allowOverlap
          >
            <TouchableOpacity activeOpacity={0.9} onPress={() => onSelect(venue.id)}>
              <VenueMapMarker
                imageUrl={venue.imageUrl}
                isSelected={selectedVenueId === venue.id}
              />
            </TouchableOpacity>
          </MarkerView>
        ))}
    </MapView>
  );
}

// ─── Circular venue photo marker (mirrors iOS VenueMapMarker) ────────────────
function VenueMapMarker({ imageUrl, isSelected }: { imageUrl: string; isSelected: boolean }) {
  const outerSize = isSelected ? 48 : 40;
  const innerSize = isSelected ? 42 : 34;
  return (
    <View
      style={[
        markerStyles.outer,
        {
          width: outerSize,
          height: outerSize,
          borderRadius: outerSize / 2,
          backgroundColor: isSelected ? colors.blue : colors.paper,
        },
      ]}
    >
      <Image
        source={{ uri: imageUrl }}
        style={{ width: innerSize, height: innerSize, borderRadius: innerSize / 2 }}
      />
    </View>
  );
}

const markerStyles = StyleSheet.create({
  outer: {
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.35,
    shadowRadius: 6,
    elevation: 6,
  },
});
