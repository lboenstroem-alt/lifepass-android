/* eslint lifepass/no-literal-copy: "error" */
// The category strip (iOS CoachView.swift `CategoryStripView` and
// `CategoryPromptView`): six glass tiles with an icon and a localized label,
// between two chevrons that scroll to either end. A tile starts the venue
// wizard for its category directly (`startSearch`), under the tile's own
// label; it never sends a prompt.
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useRef } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { LPText } from '../../components/ui';
import { COACH_CATEGORY_TILES, type CoachCategoryTile } from '../../data/coachCategories';
import { coachPalette } from '../../features/coach/theme/palette';
import { useT } from '../../i18n';
import { AssistantText } from './MessageBubble';

type Props = { onSelect: (tile: CoachCategoryTile) => void };

export function CategoryStrip({ onSelect }: Props) {
  const { t } = useT();
  const scroll = useRef<ScrollView>(null);
  return (
    <View style={styles.strip}>
      <Pressable
        onPress={() => scroll.current?.scrollTo({ x: 0, animated: true })}
        style={styles.arrow}
        hitSlop={{ top: 10, bottom: 10, left: 6, right: 6 }}
        accessibilityRole="button"
        accessibilityLabel={t('coach.android.a11y.strip_back')}
      >
        <Ionicons name="chevron-back" size={14} color={coachPalette.textMeta} />
      </Pressable>

      <ScrollView
        ref={scroll}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.tiles}
        style={styles.scroll}
      >
        {COACH_CATEGORY_TILES.map((tile) => (
          <Pressable
            key={tile.id}
            onPress={() => onSelect(tile)}
            style={({ pressed }) => [styles.tile, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel={t(tile.labelKey)}
            testID={`coach.category.${tile.id}`}
          >
            <View style={styles.iconBox}>
              {tile.icon.family === 'ionicons' ? (
                <Ionicons name={tile.icon.name} size={24} color={coachPalette.tileIcon} />
              ) : (
                <MaterialCommunityIcons name={tile.icon.name} size={26} color={coachPalette.tileIcon} />
              )}
            </View>
            <LPText size={11} weight="medium" color={coachPalette.textSecondary} align="center" numberOfLines={2} style={styles.label}>
              {t(tile.labelKey)}
            </LPText>
          </Pressable>
        ))}
      </ScrollView>

      <Pressable
        onPress={() => scroll.current?.scrollToEnd({ animated: true })}
        style={styles.arrow}
        hitSlop={{ top: 10, bottom: 10, left: 6, right: 6 }}
        accessibilityRole="button"
        accessibilityLabel={t('coach.android.a11y.strip_more')}
      >
        <Ionicons name="chevron-forward" size={14} color={coachPalette.textMeta} />
      </Pressable>
    </View>
  );
}

/** The Coach's line with the strip under it ("What would you like to find nearby?"). */
export function CategoryPrompt({ intro, onSelect }: { intro: string } & Props) {
  return (
    <View style={styles.prompt}>
      <AssistantText text={intro} />
      <CategoryStrip onSelect={onSelect} />
    </View>
  );
}

const styles = StyleSheet.create({
  prompt: { gap: 4, alignSelf: 'stretch' },
  strip: { flexDirection: 'row', alignItems: 'center', paddingTop: 12, paddingBottom: 20 },
  arrow: { width: 28, minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  scroll: { flex: 1 },
  tiles: { gap: 12, paddingHorizontal: 8 },
  tile: { width: 92, alignItems: 'center', gap: 6 },
  pressed: { opacity: 0.8 },
  iconBox: {
    width: 82,
    height: 62,
    borderRadius: 12,
    backgroundColor: coachPalette.tile,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: { width: 82 },
});
