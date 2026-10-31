// The map legend (iOS `AttractionMapLegend`, Views/Search/SearchMapView.swift).
// Not decoration: it is what makes the venue / sight distinction accessible
// to anyone who cannot rely on hue.
//
// Since 2.5.5 the venues are listed as their TYPES: what each ring colour and
// form means, under the venues' own name ("LifePass venues"), only the types
// on the map, in the scheme's order, coming soon last, each swatch drawn by
// the same `VenueRing` as the pins, and a caption ("Ring colour shows the
// type of venue").
//
// On a phone the type list folds behind "Venue types" with its first three
// swatches and a chevron, like the web below 640 px, keeping the heading in
// view; TalkBack hears its state as iOS says it ("Expanded" / "Collapsed",
// "Opið" / "Lokað"). A tablet lists the types open.
//
// The sights entries (a ring, "Sights"; a line, "Hiking trails" only while
// trails are drawn at this zoom) stay in view, folded or not. The legend
// shows with the sights off as well: the rings are on the map either way. A
// legend entry for something the map is not drawing teaches the member to
// look for it, so the map passes the sight flags only while it draws them.
import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, View } from 'react-native';

import { hiddenFromAccessibility, LPText } from '../../../components/ui';
import { useT } from '../../../i18n';
import { legendLabel, type LegendEntry } from '../../../lib/venueMarkerType';
import { colors } from '../../../theme';
import VenueRing from './VenueRing';

/** Below this window width the type list folds (iOS: a compact size class; the web: 640 px). */
export const LEGEND_FOLD_BELOW_WIDTH = 600;

/** How many swatches the folded toggle shows. */
const FOLDED_SWATCHES = 3;

export interface MapLegendProps {
  /** The venue types on the map (`legendEntries`). */
  readonly entries: readonly LegendEntry[];
  /** Fold the type list behind a toggle (a phone). */
  readonly folds: boolean;
  /** The folded list is open. */
  readonly open: boolean;
  readonly onChangeOpen: (open: boolean) => void;
  /** The sights layer is on and drawing: its ring entry. */
  readonly showsSights?: boolean;
  /** Trails are drawn at this zoom: their line entry. */
  readonly showsTrails?: boolean;
}

export default function MapLegend({
  entries,
  folds,
  open,
  onChangeOpen,
  showsSights = false,
  showsTrails = false,
}: MapLegendProps) {
  const { t, language } = useT();
  if (entries.length === 0 && !showsSights && !showsTrails) return null;

  const venuesTitle = (
    <LPText size={12} weight="semibold" color={colors.paper} accessibilityRole="header" testID="explore.legend.title">
      {t('map.legend_venues')}
    </LPText>
  );

  const sightEntries = (
    <>
      {showsSights ? (
        <View style={styles.entry} accessible accessibilityLabel={t('attraction.legend_sights')} testID="explore.legend.sights">
          <View style={styles.sightSwatch} />
          <LPText size={11} color={colors.paper2}>
            {t('attraction.legend_sights')}
          </LPText>
        </View>
      ) : null}
      {showsTrails ? (
        <View style={styles.entry} accessible accessibilityLabel={t('attraction.legend_trails')} testID="explore.legend.trails">
          <View style={styles.trailCasing}>
            <View style={styles.trailLine} />
          </View>
          <LPText size={11} color={colors.paper2}>
            {t('attraction.legend_trails')}
          </LPText>
        </View>
      ) : null}
    </>
  );
  const sightRow = showsSights || showsTrails ? <View style={styles.sightRow}>{sightEntries}</View> : null;

  let body;
  if (entries.length === 0) {
    body = sightRow;
  } else if (folds && !open) {
    // The venues' name stays in view beside the disclosure. One row where it
    // fits, wrapped where it does not: a clipped legend no longer states the
    // difference in words.
    body = (
      <View style={styles.foldedRow}>
        <View style={styles.titleAndToggle}>
          {venuesTitle}
          <Pressable
            onPress={() => onChangeOpen(true)}
            accessibilityRole="button"
            accessibilityLabel={t('map.legend_toggle')}
            accessibilityValue={{ text: t('map.legend_collapsed') }}
            style={styles.toggle}
            testID="explore.legend.venueTypes"
          >
            <View style={styles.swatches} {...hiddenFromAccessibility}>
              {entries.slice(0, FOLDED_SWATCHES).map((entry, index) => (
                <View key={entry} style={index > 0 && styles.overlap}>
                  <Swatch entry={entry} />
                </View>
              ))}
            </View>
            <LPText size={11.5} weight="semibold" color={colors.paper}>
              {t('map.legend_toggle')}
            </LPText>
            <Ionicons name="chevron-down" size={10} color={colors.paper2} {...hiddenFromAccessibility} />
          </Pressable>
        </View>
        {sightEntries}
      </View>
    );
  } else {
    body = (
      <>
        <View style={styles.typesSection} testID="explore.legend.types">
          <View style={styles.titleRow}>
            {venuesTitle}
            {folds ? (
              <Pressable
                onPress={() => onChangeOpen(false)}
                accessibilityRole="button"
                accessibilityLabel={t('map.legend_toggle')}
                accessibilityValue={{ text: t('map.legend_expanded') }}
                hitSlop={8}
                style={styles.close}
                testID="explore.legend.venueTypes.close"
              >
                <Ionicons name="chevron-up" size={11} color={colors.paper2} />
              </Pressable>
            ) : null}
          </View>
          <LPText size={11} color={colors.paper2}>
            {t('map.legend_caption')}
          </LPText>
          <View style={styles.flow}>
            {entries.map((entry) => {
              const label = legendLabel(entry, language);
              return (
                <View key={entry} style={styles.entry} accessible accessibilityLabel={label} testID={`explore.legend.entry.${entry}`}>
                  <Swatch entry={entry} />
                  <LPText size={11} color={colors.paper2}>
                    {label}
                  </LPText>
                </View>
              );
            })}
          </View>
        </View>
        {sightRow}
      </>
    );
  }

  return (
    <View style={styles.plate} testID="explore.legend">
      {body}
    </View>
  );
}

/** A miniature pin: the type's ring over the grey stand-in; coming soon is the dashed ring over a gym's. */
function Swatch({ entry }: { readonly entry: LegendEntry }) {
  return entry === 'comingSoon' ? (
    <VenueRing type="gym" comingSoon size="legend" />
  ) : (
    <VenueRing type={entry} comingSoon={false} size="legend" />
  );
}

const styles = StyleSheet.create({
  plate: {
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    // lpInk at 94 %: the map shows faintly through, the words stay legible.
    backgroundColor: 'rgba(248,246,241,0.94)',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.line,
  },
  foldedRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: 14, rowGap: 5 },
  titleAndToggle: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: 10, rowGap: 5 },
  toggle: { flexDirection: 'row', alignItems: 'center', gap: 7, minHeight: 32 },
  swatches: { flexDirection: 'row', alignItems: 'center' },
  overlap: { marginLeft: -5 },
  typesSection: { gap: 5 },
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  close: { width: 32, height: 28, alignItems: 'center', justifyContent: 'center' },
  flow: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 12, rowGap: 6 },
  entry: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  sightRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: 14, rowGap: 5 },
  sightSwatch: {
    width: 10,
    height: 10,
    borderRadius: 5,
    borderWidth: 2.5,
    borderColor: colors.attraction,
    backgroundColor: '#FFFFFF',
  },
  trailCasing: { padding: 1.5, borderRadius: 3, backgroundColor: '#FFFFFF' },
  trailLine: { width: 14, height: 3, borderRadius: 1.5, backgroundColor: colors.attraction },
});
