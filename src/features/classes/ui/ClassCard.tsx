// One class on the feed (iOS ClassesDiscoveryView `classRow` / `classCard`):
// the name (or "Class"), "06:00–07:00 · instructor" in Reykjavík time, the
// venue (with the class's room after it, "World Class Laugar & Pool · Salur
// 4", when the class has one: API 0.44.0) with its distance and any
// surcharge, and the registration chip.
//
// A row opens the class sheet for its own session. A booking kind this build
// does not know stays a plain card that cannot be pressed.
//
// THE VENUE LINE. On one line when the whole venue name fits beside the
// distance and the surcharge; otherwise the venue gets its own line (up to
// two) and the facts go under it, so a long venue name is never cut to a few
// letters to make room for "2.4 km" (iOS `ViewThatFits`). Here a wrapping
// row does the same: the facts move to the next line when they do not fit,
// and at large text they stack.
import { Ionicons } from '@expo/vector-icons';
import { memo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { LPText } from '../../../components/ui';
import { useT } from '../../../i18n';
import { colors, hairline, radius } from '../../../theme';
import type { FeedEntry } from '../feed/clientFilters';
import { chipCopy, classFeedChip, type ChipTone } from '../model/chip';
import { toOccurrence, type ClassOccurrence } from '../model/occurrence';
import { tint } from './color';
import { cardAccessibilityLabel, distanceText, surchargeText, timeLine, venueLine } from './labels';

export interface ClassCardProps {
  readonly entry: FeedEntry;
  readonly now: Date;
  readonly onOpen: (occurrence: ClassOccurrence) => void;
}

const TONES: Record<ChipTone, string> = {
  positive: colors.moss,
  negative: colors.destructive,
  quiet: colors.paper3,
};

function ClassCard({ entry, now, onOpen }: ClassCardProps) {
  const { t, language } = useT();
  const { item } = entry;
  const occurrence = toOccurrence(item);
  const distance = distanceText(entry.distanceKm, language);
  const surcharge = surchargeText(item, language);
  const copy = chipCopy(classFeedChip(item, now));
  const tone = TONES[copy.tone];
  const label = cardAccessibilityLabel(item, entry.distanceKm, now, language);

  const body = (
    <>
      <View style={styles.text}>
        <LPText size={14} weight="semibold" numberOfLines={2}>
          {item.name ?? t('classes.unnamed')}
        </LPText>
        <LPText size={12} color={colors.paper2}>
          {timeLine(item)}
        </LPText>
        <View style={styles.venueLine}>
          <View style={styles.venue}>
            <Ionicons name="location-outline" size={9} color={colors.paper3} style={styles.pin} />
            <LPText size={11} color={colors.paper3} numberOfLines={2} style={styles.venueName} testID="classes.row.venue">
              {venueLine(item)}
            </LPText>
          </View>
          {distance !== null || surcharge !== null ? (
            <View style={styles.facts}>
              {distance !== null ? (
                <LPText testID="classes.row.distance" size={11} color={colors.paper3}>
                  {distance}
                </LPText>
              ) : null}
              {surcharge !== null ? (
                <LPText size={11} color={colors.paper2}>
                  {surcharge}
                </LPText>
              ) : null}
            </View>
          ) : null}
        </View>
      </View>
      <View style={[styles.chip, { backgroundColor: tint(tone, 0.12), borderColor: tint(tone, 0.35) }]}>
        <LPText size={10.5} weight="semibold" color={tone} numberOfLines={1}>
          {t(copy.key, copy.params)}
        </LPText>
      </View>
    </>
  );

  if (!occurrence) {
    return (
      <View testID="classes.row.static" style={styles.card} accessible accessibilityLabel={label}>
        {body}
      </View>
    );
  }
  return (
    <Pressable
      testID="classes.row"
      onPress={() => onOpen(occurrence)}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={t('classsheet.row_hint')}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
    >
      {body}
    </Pressable>
  );
}

export default memo(ClassCard);

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    padding: 12,
    backgroundColor: colors.ink2,
    borderRadius: radius.field,
    borderWidth: hairline,
    borderColor: colors.line,
  },
  text: { flex: 1, gap: 3 },
  venueLine: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', columnGap: 8, rowGap: 2 },
  venue: { flexDirection: 'row', alignItems: 'baseline', gap: 3, maxWidth: '100%' },
  pin: { alignSelf: 'center' },
  venueName: { flexShrink: 1 },
  facts: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', columnGap: 8, rowGap: 2 },
  chip: {
    flexShrink: 0,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: radius.pill,
    borderWidth: hairline,
  },
  pressed: { opacity: 0.85 },
});
