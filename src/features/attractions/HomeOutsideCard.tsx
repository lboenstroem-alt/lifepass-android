/* eslint lifepass/no-literal-copy: "error" */
/**
 * Home's "Outside" card (plan 3.0.3 slot, mounted by HOME-1 after "Near you"
 * and before "Popular"): the port of iOS `HomeOutsideCard`
 * (Views/Home/HomeOutsideCard.swift) with the loading and pick rules of
 * HomeView (`loadOutsideMarkers`, `outsideOrigin`, `outsidePicks`).
 *
 * THE DATA. The card reads the marker feed itself (./markersStore.ts) in the
 * account language: when it mounts, again when the language changes, and
 * again at every Home read, which is each time Home comes to the front and
 * each pull to refresh (Home's `useOnHomeRead`; iOS calls
 * `loadOutsideMarkers` in Home's `.task` and in its `.refreshable`). Mount
 * and Home's first focus land in the same moment and make one request: the
 * store joins a read already on its way. A failure is silent and keeps what
 * is shown, so a failed first read leaves the card hidden until a later read
 * (a pull) succeeds. Picks are `picksForHome` (./rules.ts): top tier only, up
 * to six.
 *
 * THE ORIGIN. The member's position is used ONLY when location permission is
 * ALREADY granted and the fix is around Iceland (`useGrantedLocation`,
 * `isAroundIceland`). The card never asks for location and never uses the
 * Reykjavík fallback: that would put capital sights first for someone in
 * Akureyri under a heading that says "near you". Without an origin the
 * heading says "around Iceland" and no distance is shown, so the card never
 * claims a proximity the app does not have.
 *
 * Rings, never photographs: a photograph owes its photographer and licence a
 * line beside it, which a row this size cannot carry honestly, and the ring
 * is the mark the map already uses for a sight. Under the list, the ODbL
 * notice (the names are OpenStreetMap data) and, with distances, the note
 * that they are straight lines: a bare "40 km" reads as a drive.
 *
 * Where a tap goes is Home's: `onOpenSight` opens the sight's card,
 * `onSeeAllOnMap` parks the sights intent and switches to Explore. Each pick
 * also carries its heart (./SightHeart.tsx, API 0.45.0), beside the row
 * rather than inside it, so TalkBack reaches "open" and "save" one by one.
 */
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useEffect, useMemo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import type { AttractionMarker } from '../../api/attractions';
import { Kicker, LPText } from '../../components/ui';
import { useT } from '../../i18n';
import { useOnHomeRead } from '../home';
import { distanceMeters, type Coordinate } from '../../lib/geo';
import { useGrantedLocation } from '../../stores/locationStore';
import { colors, hairline, radius } from '../../theme';
import AttractionRing from './AttractionRing';
import { homeDistanceLabel } from './format';
import { loadAttractionMarkers, useAttractionMarkers } from './markersStore';
import { isHike, sightDisplayName } from './model';
import { isAroundIceland, kindRegionLine, picksForHome } from './rules';
import SightHeart from './SightHeart';

export interface HomeOutsideCardProps {
  /** Open a sight's card (`AttractionDetail`). */
  readonly onOpenSight: (slug: string) => void;
  /** "See all on the map": Explore's map with the sights showing. */
  readonly onSeeAllOnMap: () => void;
}

/** iOS's monospaced figures (`LPFont.mono`). */
const MONO = { fontFamily: 'monospace' } as const;

/**
 * Where the card measures from: a granted fix around Iceland, or null for the
 * country-wide pick.
 */
export function useOutsideOrigin(): Coordinate | null {
  const fix = useGrantedLocation();
  return useMemo(() => (fix && isAroundIceland(fix) ? { latitude: fix.latitude, longitude: fix.longitude } : null), [fix]);
}

export default function HomeOutsideCard({ onOpenSight, onSeeAllOnMap }: HomeOutsideCardProps) {
  const { t, language } = useT();
  const markers = useAttractionMarkers();
  const origin = useOutsideOrigin();

  // On mount and on every change of language (a switch re-reads the feed).
  useEffect(() => {
    void loadAttractionMarkers(language);
  }, [language]);
  // And at every Home read: each focus and each pull to refresh.
  // The latest callback runs, so a read asks in the language of the moment.
  useOnHomeRead(() => void loadAttractionMarkers(language));

  const picks = useMemo(() => picksForHome(markers, origin), [markers, origin]);
  if (picks.length === 0) return null;

  return (
    <View style={styles.card} testID="home.outside">
      <View style={styles.heading}>
        <Kicker text={t('attraction.outside')} color={colors.paper3} />
        <LPText
          serif
          size={22}
          color={colors.paper}
          tracking={-0.4}
          accessibilityRole="header"
          testID="home.outside.title"
        >
          {t(origin ? 'attraction.picks_near_you' : 'attraction.picks_around_iceland')}
        </LPText>
      </View>

      <View style={styles.list}>
        {picks.map((pick, index) => (
          <PickRow
            key={pick.slug}
            pick={pick}
            origin={origin}
            divided={index > 0}
            onPress={() => onOpenSight(pick.slug)}
          />
        ))}
        <Pressable
          onPress={onSeeAllOnMap}
          accessibilityRole="button"
          accessibilityLabel={t('attraction.see_all_on_map')}
          style={({ pressed }) => [styles.seeAll, pressed && styles.pressed]}
          testID="home.outside.see_all"
        >
          <MaterialCommunityIcons name="map-outline" size={15} color={colors.paper2} />
          <LPText size={13} weight="semibold" color={colors.paper2} style={styles.grow}>
            {t('attraction.see_all_on_map')}
          </LPText>
          <Ionicons name="arrow-forward" size={13} color={colors.paper2} />
        </Pressable>
      </View>

      <View style={styles.footer}>
        {origin ? (
          <LPText size={11} color={colors.paper3} testID="home.outside.straight_line">
            {t('attraction.nearby_straight_line')}
          </LPText>
        ) : null}
        <LPText size={11} color={colors.paper3} testID="home.outside.credit">
          {t('attraction.data_credit')}
        </LPText>
      </View>
    </View>
  );
}

function PickRow({
  pick,
  origin,
  divided,
  onPress,
}: {
  readonly pick: AttractionMarker;
  readonly origin: Coordinate | null;
  readonly divided: boolean;
  readonly onPress: () => void;
}) {
  const { t, language } = useT();
  const name = sightDisplayName(pick, language);
  const detail = kindRegionLine(pick, t);
  const distance = origin ? homeDistanceLabel(distanceMeters(origin, pick)) : null;
  return (
    <View style={[styles.pickRow, divided && styles.divided]}>
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={[name, detail, distance].filter(Boolean).join(', ')}
        style={({ pressed }) => [styles.row, pressed && styles.pressed]}
        testID={`home.outside.pick.${pick.slug}`}
      >
        <AttractionRing tier="top" isTrailhead={isHike(pick)} frame={32} />
        <View style={styles.texts}>
          <LPText size={15} weight="semibold" color={colors.paper} numberOfLines={1}>
            {name}
          </LPText>
          <LPText size={12} color={colors.paper3} numberOfLines={1}>
            {detail}
          </LPText>
        </View>
        {distance ? (
          <LPText size={10} color={colors.paper3} tracking={1.1} style={MONO} testID={`home.outside.distance.${pick.slug}`}>
            {distance}
          </LPText>
        ) : null}
        <Ionicons name="chevron-forward" size={13} color={colors.paper3} />
      </Pressable>
      <SightHeart slug={pick.slug} name={name} testID={`home.outside.heart.${pick.slug}`} />
    </View>
  );
}

const styles = StyleSheet.create({
  card: { gap: 14 },
  heading: { paddingHorizontal: 24, gap: 4 },
  list: {
    marginHorizontal: 20,
    backgroundColor: colors.ink2,
    borderRadius: radius.card,
    borderWidth: hairline,
    borderColor: colors.line,
    overflow: 'hidden',
  },
  pickRow: { flexDirection: 'row', alignItems: 'center', paddingRight: 12 },
  row: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingLeft: 14,
    paddingRight: 10,
    paddingVertical: 12,
  },
  divided: { borderTopWidth: hairline, borderTopColor: colors.line },
  // iOS: a Spacer(minLength: 8) between the names and the figures, inside a
  // 12 pt stack: at least 32 between them.
  texts: { flex: 1, gap: 2, marginRight: 20 },
  seeAll: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 13,
    borderTopWidth: hairline,
    borderTopColor: colors.line,
  },
  grow: { flex: 1 },
  footer: { paddingHorizontal: 24, gap: 2 },
  pressed: { opacity: 0.7 },
});
