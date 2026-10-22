/* eslint lifepass/no-literal-copy: "error" */
/**
 * Sights found by Explore's search box, as their own group (plan 3.0.3 slot,
 * filled by ATTR-2; mounted by EXPL-1 above the map and the list, in Venues
 * mode, while a query is typed and no sight has been opened from it). The
 * port of iOS SearchMapView `sightSearchResults`.
 *
 * SEPARATE, never mixed into the venue results: a waterfall in a list of
 * pools reads as one more place the pass opens. It sits above the map and the
 * list alike, so a sight typed by name is found whichever is showing.
 *
 *   - Up to 5 matches once the query folds to 2 characters or more
 *     (`matchSights`: Icelandic and English names, "thingvellir" finds
 *     Þingvellir; a name that starts with the query first, then the tier,
 *     then the score).
 *   - Each row: the sight's ring, its name (Icelandic in Icelandic, else the
 *     English exonym where there is one), "Waterfall · South Iceland · Top
 *     pick", and a chevron.
 *   - The rows scroll inside at most 30 % of the space below the search row
 *     (between 72 and 180 points): while a name is typed the keyboard takes
 *     half a small phone, and five full rows would leave the map a sliver.
 *     The heading and the OpenStreetMap credit stay put, so the credit is on
 *     screen whenever a sight name is.
 *   - Typing starts (or joins) the marker load: the list never loads the
 *     sights on its own.
 *   - A tap closes the keyboard and opens the sight; Explore folds the group
 *     away for that query and, on the map, brings the sight into view with
 *     the layer on (`onOpenSight`'s `at`).
 */
import { Ionicons } from '@expo/vector-icons';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Keyboard, Pressable, ScrollView, StyleSheet, View, useWindowDimensions, type KeyboardEvent } from 'react-native';

import type { AttractionMarker } from '../../api/attractions';
import { hiddenFromAccessibility, Kicker, LPText } from '../../components/ui';
import { useT } from '../../i18n';
import type { Coordinate } from '../../lib/geo';
import { colors } from '../../theme';
import AttractionRing from './AttractionRing';
import { sightDetailLine } from './map/words';
import { attractionMarkersStore, loadAttractionMarkers, useAttractionMarkers } from './markersStore';
import { isHike, sightDisplayName } from './model';
import { matchSights, rankedForMap } from './rules';

/** The most sights the group lists. */
export const MAX_SIGHT_MATCHES = 5;

/**
 * How much of the space below the search row the rows may take: a share
 * rather than a fixed height, because that space is not fixed. The floor
 * keeps a row and a half in view (the half row says the group scrolls); the
 * ceiling keeps a tall phone's map the larger part.
 */
export const SIGHT_ROWS = { share: 0.3, floor: 72, ceiling: 180 } as const;

/** The rows' height limit for the space below the search row. */
export function sightRowsMaxHeight(areaHeight: number): number {
  return Math.min(SIGHT_ROWS.ceiling, Math.max(SIGHT_ROWS.floor, areaHeight * SIGHT_ROWS.share));
}

export interface SightsSearchGroupProps {
  /** What the member typed (folded the Icelandic-aware way inside). */
  readonly query: string;
  /** Open a sight's card; `at` is where the sight is, for the map to bring it into view. */
  readonly onOpenSight: (slug: string, at?: Coordinate) => void;
}

export default function SightsSearchGroup({ query, onOpenSight }: SightsSearchGroupProps) {
  const { t, language } = useT();
  const trimmed = query.trim();

  // Search finds sights too, and the list never loads them on its own. A
  // load already out (the map's) is joined; a feed already held is enough.
  useEffect(() => {
    if (!trimmed || attractionMarkersStore.getState().page !== null) return;
    void loadAttractionMarkers(language);
  }, [trimmed, language]);

  const markers = useAttractionMarkers();
  const ranked = useMemo(() => rankedForMap(markers), [markers]);
  const matches = useMemo(() => matchSights(trimmed, ranked, MAX_SIGHT_MATCHES), [trimmed, ranked]);

  // The space below the search row: from the group's top down to the
  // keyboard's top while it is up, else to the foot of the screen (the map
  // runs under the tab bar). Until the group has been measured, the floor.
  const group = useRef<View>(null);
  const scroll = useRef<ScrollView>(null);
  const [groupTop, setGroupTop] = useState<number | null>(null);
  const areaBottom = useAreaBottom();
  const maxRowsHeight = sightRowsMaxHeight(groupTop === null ? 0 : areaBottom - groupTop);

  // A new set of rows: show that they scroll, if they do.
  useEffect(() => {
    if (matches.length > 0) scroll.current?.flashScrollIndicators();
  }, [matches.length]);

  const open = useCallback(
    (sight: AttractionMarker) => {
      Keyboard.dismiss();
      onOpenSight(sight.slug, { latitude: sight.latitude, longitude: sight.longitude });
    },
    [onOpenSight],
  );

  if (matches.length === 0) return null;

  return (
    <View
      ref={group}
      style={styles.group}
      onLayout={() => group.current?.measureInWindow((_x, y) => setGroupTop(y))}
      testID="explore.sights"
    >
      <Kicker text={t('attraction.search_group')} color={colors.paper3} style={styles.heading} accessibilityRole="header" />
      {/* At most `maxRowsHeight`, and no taller than the rows: one match
          never sits in a box built for five. */}
      <ScrollView
        ref={scroll}
        style={[styles.rows, { maxHeight: maxRowsHeight }]}
        nestedScrollEnabled
        keyboardShouldPersistTaps="handled"
        testID="explore.sights.rows"
      >
        {matches.map((sight, index) => (
          <SightRow
            key={sight.slug}
            sight={sight}
            name={sightDisplayName(sight, language)}
            detail={sightDetailLine(sight, t)}
            divided={index > 0}
            onOpen={open}
          />
        ))}
      </ScrollView>
      {/* Sight names are OpenStreetMap data; the notice travels with them. */}
      <LPText size={10} color={colors.paper3} style={styles.credit} testID="explore.sights.credit">
        {t('attraction.data_credit')}
      </LPText>
    </View>
  );
}

/** Where the space below the search row ends: the keyboard's top while it is up, else the screen's foot. */
function useAreaBottom(): number {
  const { height } = useWindowDimensions();
  // The group appears on the first letter typed, with the keyboard already up.
  const [keyboardTop, setKeyboardTop] = useState<number | null>(() =>
    Keyboard.isVisible() ? (Keyboard.metrics()?.screenY ?? null) : null,
  );
  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', (event: KeyboardEvent) => setKeyboardTop(event.endCoordinates.screenY));
    const hide = Keyboard.addListener('keyboardDidHide', () => setKeyboardTop(null));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  return keyboardTop ?? height;
}

interface SightRowProps {
  readonly sight: AttractionMarker;
  readonly name: string;
  readonly detail: string;
  readonly divided: boolean;
  readonly onOpen: (sight: AttractionMarker) => void;
}

const SightRow = memo(function SightRow({ sight, name, detail, divided, onOpen }: SightRowProps) {
  return (
    <Pressable
      onPress={() => onOpen(sight)}
      accessibilityRole="button"
      accessibilityLabel={`${name}, ${detail}`}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
      testID={`explore.sights.row.${sight.slug}`}
    >
      {divided ? <View style={styles.divider} {...hiddenFromAccessibility} /> : null}
      <AttractionRing tier={sight.tier} isTrailhead={isHike(sight)} frame={28} />
      <View style={styles.words}>
        <LPText size={14} weight="semibold" color={colors.paper} numberOfLines={1}>
          {name}
        </LPText>
        <LPText size={11.5} color={colors.paper3} numberOfLines={1}>
          {detail}
        </LPText>
      </View>
      <Ionicons name="chevron-forward" size={12} color={colors.paper3} {...hiddenFromAccessibility} />
    </Pressable>
  );
});

const styles = StyleSheet.create({
  group: {
    marginHorizontal: 20,
    marginBottom: 10,
    backgroundColor: colors.ink2,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
    overflow: 'hidden',
  },
  heading: { paddingHorizontal: 14, paddingTop: 10, paddingBottom: 4 },
  rows: { flexGrow: 0 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 8,
    // Android's touch target; iOS rows are 44.
    minHeight: 48,
  },
  pressed: { backgroundColor: colors.ink3 },
  divider: {
    position: 'absolute',
    top: 0,
    left: 52,
    right: 0,
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.line,
  },
  words: { flex: 1, gap: 1 },
  credit: { paddingHorizontal: 14, paddingTop: 4, paddingBottom: 10 },
});
