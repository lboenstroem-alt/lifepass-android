/**
 * Route `Drafts`: estimates waiting to be checked (iOS DraftsListView,
 * `ios-ux.md` 3.10, drafts row): photo estimates, and from 2.5.6 the
 * estimates made from a meal description, newest first, each opening the
 * meal editor.
 *
 * Drafts are dated by the day they belong to, not the day the photo was
 * taken, and they can be up to 30 days old: a member who scanned a plate on
 * holiday and never confirmed it should find it here rather than have it
 * counted silently or dropped. Read from the Today read (`pendingDrafts`
 * and `pendingTextDrafts`, merged by `allPendingDrafts`), so the list and
 * Plan's row always agree.
 */
import { Ionicons } from '@expo/vector-icons';
import { BottomTabBarHeightContext } from '@react-navigation/bottom-tabs';
import { useContext, useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Card, hiddenFromAccessibility, LPText, TopBar } from '../../../components/ui';
import { allPendingDrafts, useHealthStore } from '../../../health';
import { useT } from '../../../i18n';
import type { SharedRouteProps } from '../../../navigation/types';
import { colors, hairline } from '../../../theme';

import { draftRowLine, isTextDraft } from './draftRows';

/** iOS leaves 140 pt under the list: the tab bar floats over pushed screens too. */
const BOTTOM_ROOM = 64;

export default function DraftsScreen({ navigation }: SharedRouteProps<'Drafts'>) {
  const { t, language } = useT();
  const insets = useSafeAreaInsets();
  const tabBarHeight = useContext(BottomTabBarHeightContext) ?? insets.bottom;
  const today = useHealthStore((s) => s.today);
  const drafts = useMemo(() => (today ? allPendingDrafts(today) : []), [today]);

  return (
    <View style={styles.screen} testID="drafts.screen">
      <TopBar title={t('plan.nutrition.drafts_all')} onBack={() => navigation.goBack()} testID="drafts.topBar" />
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.content, { paddingBottom: tabBarHeight + BOTTOM_ROOM }]}
        showsVerticalScrollIndicator={false}
        testID="drafts.scroll"
      >
        {drafts.length === 0 ? (
          <LPText size={14} color={colors.paper2} style={styles.empty} testID="drafts.empty">
            {t('plan.nutrition.none_yet')}
          </LPText>
        ) : (
          <Card style={styles.card}>
            {drafts.map((draft, index) => {
              const line = draftRowLine(draft, language);
              const label = t(line.key, line.params);
              return (
                <View key={draft.id}>
                  {index > 0 ? <View style={styles.rule} /> : null}
                  <Pressable
                    onPress={() => navigation.navigate('MealEditor', { mode: 'stored', mealId: draft.id })}
                    accessibilityRole="button"
                    accessibilityLabel={label}
                    style={({ pressed }) => [styles.row, pressed && styles.pressed]}
                    testID={`drafts.row.${draft.id}`}
                  >
                    <View style={styles.icon} {...hiddenFromAccessibility}>
                      <Ionicons
                        name={isTextDraft(draft) ? 'chatbubble-ellipses-outline' : 'scan-outline'}
                        size={16}
                        color={colors.rust}
                      />
                    </View>
                    <LPText size={15} color={colors.paper} style={styles.flex}>
                      {label}
                    </LPText>
                    <View {...hiddenFromAccessibility}>
                      <Ionicons name="chevron-forward" size={13} color={colors.paper3} />
                    </View>
                  </Pressable>
                </View>
              );
            })}
          </Card>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.ink },
  scroll: { flex: 1 },
  content: { paddingTop: 16, gap: 14 },
  empty: { paddingHorizontal: 24 },
  card: { marginHorizontal: 20 },
  rule: { height: hairline, backgroundColor: colors.line },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, minHeight: 56 },
  icon: { width: 22, height: 22, alignItems: 'center', justifyContent: 'center' },
  flex: { flex: 1 },
  pressed: { opacity: 0.75 },
});
