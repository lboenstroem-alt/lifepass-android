// What the feed shows instead of classes (iOS ClassesDiscoveryView `feed`,
// `plainEmptyState`, `nextMatchEmptyState`, `nextMatchCard`). Each state sits
// under the filter rows, so the filters stay reachable in every state, and
// is given room of its own (`STATE_HEIGHT`).
//
// A selected day with nothing for these filters names the next day that has
// something ("No Pilates today. Next: Mon 5 Oct · Hress 06:00") and offers
// to jump there.
import { Ionicons } from '@expo/vector-icons';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { EmptyState, LPText } from '../../../components/ui';
import { useT } from '../../../i18n';
import { colors, radius } from '../../../theme';
import type { NextMatchRequest, NextMatchState } from '../feed/nextMatch';
import {
  accessibilityLabel as nextMatchAccessibilityLabel,
  headline,
  nextLine,
  noneInWindowLines,
  showDayAccessibilityLabel,
  showDayTitle,
} from '../feed/nextMatchCopy';

/** A state's own room (iOS `stateHeight`): a list offers its content no height to centre in. */
export const STATE_HEIGHT = 340;

export function LoadingState() {
  const { t } = useT();
  return (
    <View style={styles.state} testID="classes.loading">
      <ActivityIndicator color={colors.paper3} accessibilityLabel={t('a11y.loading')} />
    </View>
  );
}

export function ErrorFeedState({ onRetry }: { readonly onRetry: () => void }) {
  const { t } = useT();
  return (
    <View style={styles.state} testID="classes.error">
      <EmptyState icon="cloud-offline-outline" message={t('classes.load_error')} actionLabel={t('venue.try_again')} actionIcon="retry" onAction={onRetry} />
    </View>
  );
}

export function PlainEmptyState({ nearMeEnabled }: { readonly nearMeEnabled: boolean }) {
  const { t } = useT();
  return (
    <View style={styles.state} testID="classes.empty">
      <EmptyState icon="body-outline" message={t(nearMeEnabled ? 'classes.empty_nearby' : 'classes.empty')} />
    </View>
  );
}

export interface NextMatchEmptyStateProps {
  readonly request: NextMatchRequest;
  readonly state: NextMatchState;
  readonly now: Date;
  readonly nearMeEnabled: boolean;
  readonly onRetry: () => void;
  readonly onShowDay: () => void;
}

export function NextMatchEmptyState({ request, state, now, nearMeEnabled, onRetry, onShowDay }: NextMatchEmptyStateProps) {
  const { t, language } = useT();
  switch (state.kind) {
    case 'checkingDay':
      // Not empty yet: the day's later pages are still being read.
      return (
        <View style={styles.state} testID="classes.next_match.checking">
          <ActivityIndicator color={colors.paper3} accessibilityLabel={t('classes.next_searching')} />
        </View>
      );
    case 'failed':
      // The feed's own error UI; "Try again" asks the look-ahead again.
      return <ErrorFeedState onRetry={onRetry} />;
    case 'gaveUp':
      return <PlainEmptyState nearMeEnabled={nearMeEnabled} />;
    default:
      break;
  }

  const title = headline(request, false, now, language);
  return (
    <View style={styles.state}>
      <View style={styles.card}>
        <Ionicons
          name={state.kind === 'noneInWindow' ? 'calendar-outline' : 'calendar-number-outline'}
          size={44}
          color={colors.paper4}
          accessibilityElementsHidden
          importantForAccessibility="no"
        />
        {state.kind === 'found' ? (
          <>
            <View
              testID="classes.next_match"
              style={styles.lines}
              accessible
              accessibilityLabel={nextMatchAccessibilityLabel(title, state.item, language)}
            >
              <LPText size={15} weight="medium" color={colors.paper3} align="center">
                {title}
              </LPText>
              <LPText size={15} weight="semibold" align="center">
                {nextLine(state.item, language)}
              </LPText>
            </View>
            <Pressable
              testID="classes.next_match.show"
              onPress={onShowDay}
              accessibilityRole="button"
              accessibilityLabel={showDayAccessibilityLabel(state.item, language)}
              accessibilityHint={t('classes.next_show_hint')}
              style={({ pressed }) => [styles.showButton, pressed && styles.pressed]}
            >
              <LPText size={13} weight="semibold" color={colors.onAccent}>
                {showDayTitle(state.item, language)}
              </LPText>
              <Ionicons name="arrow-forward" size={12} color={colors.onAccent} />
            </Pressable>
          </>
        ) : state.kind === 'searching' ? (
          <View
            testID="classes.next_match.searching"
            style={styles.searching}
            accessible
            accessibilityLabel={`${title} ${t('classes.next_searching')}`}
          >
            <LPText size={15} weight="medium" color={colors.paper3} align="center">
              {title}
            </LPText>
            <View style={styles.spinnerLine}>
              <ActivityIndicator size="small" color={colors.paper3} />
              <LPText size={13} color={colors.paper3}>
                {t('classes.next_searching')}
              </LPText>
            </View>
          </View>
        ) : (
          // Nothing in the fortnight after the day: "in the next two weeks"
          // from today, the day plus "nothing later yet" from a later day.
          <View testID="classes.next_match.none" style={styles.lines} accessible>
            {noneInWindowLines(request, now, language).map((line) => (
              <LPText key={line} size={15} weight="medium" color={colors.paper3} align="center">
                {line}
              </LPText>
            ))}
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  state: { minHeight: STATE_HEIGHT, justifyContent: 'center', alignItems: 'stretch' },
  card: { alignItems: 'center', gap: 16, padding: 40 },
  lines: { alignItems: 'center', gap: 6 },
  searching: { alignItems: 'center', gap: 10 },
  spinnerLine: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  showButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 20,
    paddingVertical: 10,
    minHeight: 44,
    borderRadius: radius.small,
    backgroundColor: colors.rust,
  },
  pressed: { opacity: 0.85 },
});
