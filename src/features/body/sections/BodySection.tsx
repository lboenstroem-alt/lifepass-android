/**
 * 2. Your body, with consent only (iOS `bodySection`):
 *
 * - the latest weigh-in, "72,5 kg · 178 cm" (or "Add weight and height"),
 *   which opens the body sheet to update it;
 * - the 12-week chart, from two weeks with an average, the target dashed;
 * - Log weight (the weight-only check-in);
 * - Calorie goal, "Lose weight: about 1,750 to 1,950 kcal a day";
 * - Target weight, on a server that has them and when a target is set or a
 *   goal could take one, with the reached note under it;
 * - Weight history;
 * - and, when the page's own reads failed, the error with Try again.
 *
 * The three rows that WRITE need an active membership and say so when it has
 * lapsed ("Needs an active membership"); every read stays.
 */
import { Pressable, StyleSheet, View } from 'react-native';

import { LPText } from '../../../components/ui';
import { useT } from '../../../i18n';
import { colors, radius } from '../../../theme';
import { AccountRowButton, AccountRowDivider, AccountSection } from '../../account';

import type { WeightTrendWeek } from '../api';
import WeightTrendChart from '../chart/WeightTrendChart';
import { CardMessageRow } from '../ui/parts';

export type BodySectionProps = {
  readonly isEntitled: boolean;
  readonly latestTitle: string;
  /** The chart's weeks (two or more with an average), or null for no chart. */
  readonly chart: { readonly weeks: readonly WeightTrendWeek[]; readonly direction: string | null; readonly targetKg: number | null } | null;
  readonly goalSubtitle: string;
  /** The target row, or null when it is not shown. */
  readonly target: { readonly subtitle: string; readonly reached: boolean } | null;
  readonly loadFailed: boolean;
  readonly onUpdateBody: () => void;
  readonly onLogWeight: () => void;
  readonly onGoal: () => void;
  readonly onTarget: () => void;
  readonly onHistory: () => void;
  readonly onRetry: () => void;
};

export default function BodySection(props: BodySectionProps) {
  const { t } = useT();
  const { isEntitled, target } = props;
  const needMembership = t('bodygoals.need_membership');
  return (
    <AccountSection kicker={t('bodygoals.sec.body')} testID="bodygoals.body">
      <AccountRowButton
        title={props.latestTitle}
        subtitle={isEntitled ? null : needMembership}
        isEnabled={isEntitled}
        onPress={props.onUpdateBody}
        testID="bodygoals.latest"
      />

      {props.chart ? (
        <View>
          <AccountRowDivider />
          <WeightTrendChart weeks={props.chart.weeks} direction={props.chart.direction} targetKg={props.chart.targetKg} />
        </View>
      ) : null}

      <AccountRowButton
        title={t('bodygoals.log_weight')}
        subtitle={isEntitled ? null : needMembership}
        isEnabled={isEntitled}
        onPress={props.onLogWeight}
        testID="bodygoals.logWeight.row"
      />

      <AccountRowButton
        title={t('bodygoals.goal')}
        // A dead row says why, like the two above it; the goal line itself
        // is still readable in the sentence.
        subtitle={props.goalSubtitle}
        isEnabled={isEntitled}
        onPress={props.onGoal}
        testID="bodygoals.goal"
      />

      {target ? (
        <View>
          <AccountRowButton
            title={t('bodygoals.target')}
            subtitle={isEntitled ? target.subtitle : `${target.subtitle} · ${needMembership}`}
            isEnabled={isEntitled}
            onPress={props.onTarget}
            testID="bodygoals.target"
          />
          {target.reached ? <TargetReachedNote isEntitled={isEntitled} onSetNew={props.onTarget} /> : null}
        </View>
      ) : null}

      <AccountRowButton title={t('bodygoals.history')} onPress={props.onHistory} testID="bodygoals.history" />

      {props.loadFailed ? (
        <CardMessageRow
          message={t('common.error_body')}
          actionLabel={t('health.retry')}
          onAction={props.onRetry}
          testID="bodygoals.loadFailed"
        />
      ) : null}
    </AccountSection>
  );
}

/**
 * The target was reached: the range now keeps the weight steady, and the way
 * to a new target is right here (iOS `targetReachedNote`).
 */
function TargetReachedNote({ isEntitled, onSetNew }: { readonly isEntitled: boolean; readonly onSetNew: () => void }) {
  const { t } = useT();
  const cta = t('target.reached.cta');
  return (
    <View style={styles.reached} testID="bodygoals.target.reached">
      <LPText size={14} weight="semibold" color={colors.paper}>
        {t('target.reached.title')}
      </LPText>
      <LPText size={13} color={colors.paper2}>
        {t('target.reached.body')}
      </LPText>
      <Pressable
        onPress={onSetNew}
        disabled={!isEntitled}
        accessibilityRole="button"
        accessibilityLabel={cta}
        accessibilityState={{ disabled: !isEntitled }}
        style={({ pressed }) => [styles.reachedCta, !isEntitled && styles.disabled, pressed && styles.pressed]}
        testID="bodygoals.target.reached.cta"
      >
        <LPText size={13} weight="semibold" color={colors.accentText}>
          {cta}
        </LPText>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  reached: {
    gap: 6,
    padding: 12,
    marginHorizontal: 16,
    marginBottom: 12,
    borderRadius: radius.field,
    backgroundColor: colors.ink3,
  },
  reachedCta: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' },
  disabled: { opacity: 0.45 },
  pressed: { opacity: 0.6 },
});
