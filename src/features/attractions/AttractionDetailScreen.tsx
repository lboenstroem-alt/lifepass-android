/* eslint lifepass/no-literal-copy: "error" */
/**
 * A public sight's card (route `AttractionDetail { slug }`, plan 3.0.2): the
 * Android port of iOS `AttractionDetailView` and `AttractionDetailSheet`
 * (Views/Venues/AttractionDetailView.swift).
 *
 * Reached from Home's Outside card, the Explore map and search, the Coach's
 * plan sights and Plan's hike rows; pushed on the current tab's stack (or the
 * shared sheet over a modal), so the tab bar stays, as every shared route.
 *
 * THE SHEET'S STACK. On iOS the card is a sheet with its own navigation stack
 * and "Done" at the top: nearby sights, the walks to a sight and the soak
 * venues push onto it, and Done closes the lot, landing back on the exact map
 * or Home position. Here those pushes go on the tab's stack, and Done pops
 * the whole run of sight cards back to the screen that opened the first one.
 * The first card shows Done alone, as the sheet's root does; a card pushed
 * from another card also shows a back chevron, as a pushed iOS view does.
 * Hardware back steps back one card.
 *
 * Top to bottom: hero and credit, the top-pick badge, "KIND · REGION" (the
 * server's words), the name, the Icelandic name when it differs, the travel
 * line, the summary, the facts, the route, where the walk leads, the walks
 * that lead here, the body, getting there (with Directions), the soak, nearby
 * sights and the sources. The card never shows a check-in, booking or pass
 * claim for the sight itself: sights are not venues.
 *
 * While loading: a spinner. With nothing loaded, a failure shows the reason
 * and "Try again". Coming back to the card (from a sight, walk or venue pushed
 * on top) reads it again quietly, as iOS's `.task` does on reappear, keeping
 * the card on screen; the card holds nothing a restart must restore.
 *
 * Directions offers Google Maps and "another app" (a `geo:` pin): there is no
 * Apple Maps on Android (plan 5.6). `mapsLinks.apple` is not used.
 */
import { Ionicons } from '@expo/vector-icons';
import { BottomTabBarHeightContext } from '@react-navigation/bottom-tabs';
import { useCallback, useContext, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { AttractionDetail } from '../../api/attractions';
import { Dialog, LPText, type DialogButton } from '../../components/ui';
import { useT } from '../../i18n';
import type { SharedRouteProps } from '../../navigation/types';
import { colors, hairline } from '../../theme';
import {
  FactsSection,
  GettingThereSection,
  Hero,
  KindRegionKicker,
  NearbySection,
  RelatedTrailsSection,
  RouteSection,
  SoakSection,
  SourcesSection,
  TopPickBadge,
  TravelLine,
  WalkDestinationSection,
} from './detail/sections';
import { useAttractionDetail } from './detail/useAttractionDetail';
import { geoUrl, googleMapsUrl } from './model';

/** The route name, as the run of sight cards is found by it. */
const ROUTE = 'AttractionDetail';

/** Room under the sources beyond the tab bar (iOS `.padding(.bottom, 40)`). */
const CONTENT_TAIL = 40;

interface RouteLike {
  readonly key: string;
  readonly name: string;
}

/**
 * How many sight cards end at `index`: this card and every card directly
 * under it, back to the screen that opened the first one.
 */
export function sightRunLength(routes: readonly RouteLike[], index: number): number {
  let start = index;
  while (start > 0 && routes[start - 1].name === ROUTE) start -= 1;
  return index - start + 1;
}

/** Whether the card was pushed from another sight card (it then shows a back chevron). */
export function pushedFromSight(routes: readonly RouteLike[], index: number): boolean {
  return index > 0 && routes[index - 1].name === ROUTE;
}

/** Opens a URL, swallowing the rejection a missing handler gives (nothing to show). */
async function open(url: string): Promise<boolean> {
  try {
    await Linking.openURL(url);
    return true;
  } catch {
    return false;
  }
}

export default function AttractionDetailScreen({ navigation, route }: SharedRouteProps<'AttractionDetail'>) {
  const { slug } = route.params;
  const { t, language } = useT();
  const insets = useSafeAreaInsets();
  // The tab bar floats over the page; in the shared sheet there is none.
  const tabBarHeight = useContext(BottomTabBarHeightContext) ?? 0;
  const model = useAttractionDetail(slug, language);
  const { refresh } = model;
  const [directionsOpen, setDirectionsOpen] = useState(false);
  const scrollRef = useRef<ScrollView>(null);

  // Coming back to the card reads it again (iOS `.task` on reappear).
  useEffect(() => {
    let left = !navigation.isFocused();
    const offBlur = navigation.addListener('blur', () => {
      left = true;
    });
    const offFocus = navigation.addListener('focus', () => {
      if (!left) return;
      left = false;
      refresh();
    });
    return () => {
      offBlur();
      offFocus();
    };
  }, [navigation, refresh]);

  // Another sight in the same screen (params swapped in place) starts at its top.
  const shown = useRef(slug);
  useEffect(() => {
    if (shown.current === slug) return;
    shown.current = slug;
    setDirectionsOpen(false);
    scrollRef.current?.scrollTo({ y: 0, animated: false });
  }, [slug]);

  const routes = (navigation.getState()?.routes ?? []) as readonly RouteLike[];
  const index = routes.findIndex((r) => r.key === route.key);
  const showsBack = index >= 0 && pushedFromSight(routes, index);

  /** Done: back to the screen that opened the first sight card. */
  const done = useCallback(() => {
    const state = navigation.getState();
    const all = (state?.routes ?? []) as readonly RouteLike[];
    const at = all.findIndex((r) => r.key === route.key);
    if (at < 0) {
      navigation.goBack();
      return;
    }
    const count = sightRunLength(all, at);
    if (count <= at) {
      navigation.pop(count);
      return;
    }
    // The run starts at the bottom of its stack (the shared sheet): close it.
    const parent = navigation.getParent();
    if (parent?.canGoBack()) parent.goBack();
    else navigation.goBack();
  }, [navigation, route.key]);

  const openSight = useCallback((next: string) => navigation.push(ROUTE, { slug: next }), [navigation]);
  const openVenue = useCallback((venueSlug: string) => navigation.push('VenueDetail', { slug: venueSlug }), [navigation]);
  const openUrl = useCallback((url: string) => void open(url), []);

  const detail = model.detail;
  const directionsButtons: DialogButton[] = detail
    ? [
        { label: t('venue.maps_google'), onPress: () => void open(googleMapsUrl(detail)), testID: 'attraction.directions.google' },
        {
          label: t('attraction.android.maps_other'),
          onPress: () =>
            void (async () => {
              // No app takes `geo:` (rare): Google Maps on the web, so the
              // answer never does nothing.
              if (!(await open(geoUrl(detail)))) await open(googleMapsUrl(detail));
            })(),
          testID: 'attraction.directions.other',
        },
        { label: t('common.cancel'), role: 'cancel' },
      ]
    : [];

  return (
    <View style={styles.page} testID="attraction.page">
      <View style={[styles.bar, { paddingTop: insets.top }]}>
        <View style={styles.barRow}>
          {showsBack ? (
            <Pressable
              onPress={() => navigation.goBack()}
              accessibilityRole="button"
              accessibilityLabel={t('common.back')}
              hitSlop={6}
              style={({ pressed }) => [styles.circle, pressed && styles.pressed]}
              testID="attraction.back"
            >
              <Ionicons name="chevron-back" size={18} color={colors.paper2} />
            </Pressable>
          ) : (
            <View />
          )}
          <Pressable
            onPress={done}
            accessibilityRole="button"
            accessibilityLabel={t('common.done')}
            hitSlop={10}
            style={({ pressed }) => [styles.done, pressed && styles.pressed]}
            testID="attraction.done"
          >
            <LPText size={17} weight="semibold" color={colors.rust}>
              {t('common.done')}
            </LPText>
          </Pressable>
        </View>
      </View>

      <ScrollView
        ref={scrollRef}
        style={styles.scroll}
        contentContainerStyle={{ paddingBottom: CONTENT_TAIL + Math.max(tabBarHeight, insets.bottom) }}
        showsVerticalScrollIndicator={false}
        testID="attraction.scroll"
      >
        {detail ? (
          <Content detail={detail} onOpenSight={openSight} onOpenVenue={openVenue} onOpenUrl={openUrl} onDirections={() => setDirectionsOpen(true)} />
        ) : model.isLoading ? (
          <View style={styles.loading} accessible accessibilityLabel={t('a11y.loading')} testID="attraction.loading">
            <ActivityIndicator color={colors.paper} />
          </View>
        ) : (
          <View style={styles.failed} testID="attraction.failed">
            <LPText size={15} color={colors.paper2} align="center">
              {model.error ?? t('common.error_body')}
            </LPText>
            <Pressable
              onPress={model.load}
              accessibilityRole="button"
              accessibilityLabel={t('attraction.retry')}
              hitSlop={10}
              style={({ pressed }) => pressed && styles.pressed}
              testID="attraction.retry"
            >
              <LPText size={15} weight="semibold" color={colors.rust}>
                {t('attraction.retry')}
              </LPText>
            </Pressable>
          </View>
        )}
      </ScrollView>

      <Dialog
        visible={directionsOpen && detail !== null}
        onClose={() => setDirectionsOpen(false)}
        presentation="actionSheet"
        title={t('attraction.directions')}
        buttons={directionsButtons}
        testID="attraction.directions.dialog"
      />
    </View>
  );
}

function Content({
  detail,
  onOpenSight,
  onOpenVenue,
  onOpenUrl,
  onDirections,
}: {
  readonly detail: AttractionDetail;
  readonly onOpenSight: (slug: string) => void;
  readonly onOpenVenue: (slug: string) => void;
  readonly onOpenUrl: (url: string) => void;
  readonly onDirections: () => void;
}) {
  return (
    <View testID="attraction.content">
      <Hero detail={detail} onOpenUrl={onOpenUrl} />
      <View style={styles.header}>
        {detail.tier === 'top' ? <TopPickBadge /> : null}
        <KindRegionKicker detail={detail} />
        <LPText serif size={34} weight="semibold" color={colors.paper} accessibilityRole="header" testID="attraction.name">
          {detail.name}
        </LPText>
        {/* The Icelandic name always shows: it is what the road signs say. */}
        {detail.name !== detail.localName ? (
          <LPText size={14} color={colors.paper3} testID="attraction.local_name">
            {detail.localName}
          </LPText>
        ) : null}
        <TravelLine detail={detail} />
        {detail.summary !== null ? (
          <LPText size={16} color={colors.paper2}>
            {detail.summary}
          </LPText>
        ) : null}
      </View>
      <FactsSection detail={detail} />
      <RouteSection detail={detail} />
      <WalkDestinationSection detail={detail} onOpenSight={onOpenSight} />
      <RelatedTrailsSection detail={detail} onOpenSight={onOpenSight} />
      {detail.body ? (
        <LPText size={15} color={colors.paper2} style={styles.body} testID="attraction.body">
          {detail.body}
        </LPText>
      ) : null}
      <GettingThereSection detail={detail} onDirections={onDirections} />
      <SoakSection detail={detail} onOpenVenue={onOpenVenue} />
      <NearbySection detail={detail} onOpenSight={onOpenSight} />
      <SourcesSection detail={detail} onOpenUrl={onOpenUrl} />
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.ink },
  bar: { backgroundColor: colors.ink, borderBottomWidth: hairline, borderBottomColor: colors.line },
  barRow: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 8,
  },
  circle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.ink2,
    borderWidth: hairline,
    borderColor: colors.line,
    alignItems: 'center',
    justifyContent: 'center',
  },
  done: { minHeight: 36, justifyContent: 'center' },
  pressed: { opacity: 0.7 },
  scroll: { flex: 1 },
  header: { paddingHorizontal: 20, paddingTop: 18, gap: 14 },
  body: { paddingHorizontal: 20, paddingTop: 22 },
  loading: { paddingTop: 80, alignItems: 'center' },
  failed: { paddingHorizontal: 32, paddingTop: 80, gap: 12, alignItems: 'center' },
});
