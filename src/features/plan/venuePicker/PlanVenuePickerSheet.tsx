/**
 * Somewhere to swim, for a swim session (iOS `PlanVenuePickerSheet`,
 * `ios-ux.md` 3.7): opened by "Find a pool" on a pool day.
 *
 * A list, not a map: the member has already decided to swim and needs the
 * nearest pool their membership opens, which is one tap, not an exploration.
 * Up to 40 venues of the category `Pool` from `GET /venues`, nearest first
 * when the phone has a fix the member granted (the distance in the account
 * language), the catalogue's order and the city otherwise (./poolOrder.ts).
 * The picker never asks for a location, and none is sent anywhere.
 *
 * Read again on every opening (iOS `.task`), with a skeleton and an error
 * state with Try again. A tap hands the venue's slug to the host, which
 * closes the picker and opens the venue page once it has gone.
 */
import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, View, type Text } from 'react-native';

import { isCancellation } from '../../../api';
import { fetchVenues } from '../../../api/venues';
import { Card, ErrorState, hiddenFromAccessibility, LPText, Sheet, SkeletonCard } from '../../../components/ui';
import { useT } from '../../../i18n';
import { useGrantedLocation } from '../../../stores/locationStore';
import { colors, hairline } from '../../../theme';
import type { Venue } from '../../../types/venue';

import { POOL_CATEGORY, POOL_LIMIT, poolDistanceLabel, sortPools } from './poolOrder';

export type PlanVenuePickerSheetProps = {
  visible: boolean;
  onClose: () => void;
  onClosed?: () => void;
  /** A pool was tapped: the host closes the picker and opens its page. */
  onOpenVenue: (slug: string) => void;
  /** The venue category to list (iOS `category`, `Pool` for a swim day). */
  category?: string;
  testID?: string;
};

type LoadState = { kind: 'loading' } | { kind: 'failed' } | { kind: 'loaded'; venues: readonly Venue[] };

export default function PlanVenuePickerSheet({
  visible,
  onClose,
  onClosed,
  onOpenVenue,
  category = POOL_CATEGORY,
  testID = 'plan.poolPicker',
}: PlanVenuePickerSheetProps) {
  const { t, language } = useT();
  const titleRef = useRef<Text>(null);
  const origin = useGrantedLocation();
  const [state, setState] = useState<LoadState>({ kind: 'loading' });
  const request = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setState({ kind: 'loading' });
    try {
      const venues = await fetchVenues({ category, limit: POOL_LIMIT }, { signal: controller.signal });
      if (request.current === controller) setState({ kind: 'loaded', venues });
    } catch (error) {
      if (isCancellation(error) || request.current !== controller) return;
      setState({ kind: 'failed' });
    }
  }, [category]);

  // Each opening reads the list again; a close stops a read in flight.
  useEffect(() => {
    if (!visible) return undefined;
    void load();
    return () => {
      request.current?.abort();
      request.current = null;
    };
  }, [visible, load]);

  const sorted = useMemo(() => (state.kind === 'loaded' ? sortPools(state.venues, origin) : []), [state, origin]);

  return (
    <Sheet visible={visible} onClose={onClose} onClosed={onClosed} initialFocusRef={titleRef} testID={testID}>
      <View style={styles.content}>
        <LPText ref={titleRef} serif size={24} color={colors.paper} accessibilityRole="header">
          {t('plan.swim.find_pool')}
        </LPText>
        {state.kind === 'loading' ? <SkeletonCard rows={4} showsHeader={false} testID={`${testID}.loading`} /> : null}
        {state.kind === 'failed' ? <ErrorState onRetry={() => void load()} testID={`${testID}.error`} /> : null}
        {state.kind === 'loaded' && sorted.length > 0 ? (
          <Card>
            {sorted.map((venue, index) => {
              const second = poolDistanceLabel(venue, origin, language);
              return (
                <View key={venue.id}>
                  {index > 0 ? <View style={styles.rule} /> : null}
                  <Pressable
                    onPress={() => onOpenVenue(venue.slug)}
                    accessibilityRole="button"
                    accessibilityLabel={second ? `${venue.name}, ${second}` : venue.name}
                    style={({ pressed }) => [styles.row, pressed && styles.pressed]}
                    testID={`${testID}.venue.${venue.slug}`}
                  >
                    <View style={styles.texts}>
                      <LPText size={15} color={colors.paper}>
                        {venue.name}
                      </LPText>
                      {second ? (
                        <LPText size={12} color={colors.paper2}>
                          {second}
                        </LPText>
                      ) : null}
                    </View>
                    <View {...hiddenFromAccessibility}>
                      <Ionicons name="chevron-forward" size={13} color={colors.paper3} />
                    </View>
                  </Pressable>
                </View>
              );
            })}
          </Card>
        ) : null}
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  content: { gap: 14, paddingTop: 4, paddingBottom: 40 },
  rule: { height: hairline, backgroundColor: colors.line },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, minHeight: 56 },
  texts: { flex: 1, gap: 3, paddingVertical: 8 },
  pressed: { opacity: 0.75 },
});
