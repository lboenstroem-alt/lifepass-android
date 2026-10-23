/* eslint lifepass/no-literal-copy: "error" */
/**
 * The change the Coach suggests, before anything changes (iOS
 * `PlanEditPreviewCard`, Views/Coach/PlanEditPreviewCard.swift):
 *
 *   Change to your plan                                   (serif)
 *   [Our exercise: Dumbbell bench press | Your own: ...]  (two variants only)
 *   Swap bench press for dumbbell bench press on Push days.
 *   Push, every time · 3 days
 *     Barbell bench press → Dumbbell bench press
 *     Zottman curls                          [Your exercise]
 *   Won't use: Cable machine
 *   (what makes the plan a cycle)
 *   Some of it couldn't be done:
 *     A 50-set dose was capped at 6.
 *   [Apply]  Cancel
 *
 * Every word of the change is the server's, in the app language (the
 * member's own exercise names and day titles as they wrote them): the card
 * adds only its title, the tags and the buttons. Apply waits while today's
 * workout is open in the runner; after it the card collapses to
 * "Changed · Undo" while the server says the change can be undone.
 */
import { memo } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { hiddenFromAccessibility, LPText } from '../../../components/ui';
import { useT } from '../../../i18n';
import { selectRunnerProgressFor, useRunnerProgress } from '../../runner';
import type { CoachMessageRendererProps } from '../flows/types';
import { coachPalette } from '../theme/palette';

import { applyCard, cancelCard, selectVariant, undoCard, type PlanEditCardPayload, type PlanEditNoticePayload } from './flow';
import { SINGLE_LINE_ITEM_TYPES, type PlanEditChangeItem, type PlanEditPreview } from './types';
import { isUndoable } from './undo';

type Translate = (key: string, params?: Readonly<Record<string, string | number>>) => string;

/** The variant's name on the switch: the server's label, else "Our exercise" / "Your own". */
export function variantLabel(variant: PlanEditPreview, index: number, t: Translate): string {
  return variant.label ?? t(index === 0 ? 'coach.planEdit.variantOurs' : 'coach.planEdit.variantOwn');
}

/** One change on one line: "before → after", or just what it becomes (a rest day, a title, the cycle, the days). */
export function itemLine(item: PlanEditChangeItem, t: Translate): string {
  if (SINGLE_LINE_ITEM_TYPES.has(item.type) || item.before === null || item.after === null) {
    return item.after ?? item.before ?? '';
  }
  return t('coach.planEdit.item', { before: item.before, after: item.after });
}

function PlanEditCard({ message, busy }: CoachMessageRendererProps) {
  const { t } = useT();
  const payload = message.payload as PlanEditCardPayload | undefined;
  const variant = payload?.variants[payload.selected];
  const runnerOpen = useRunnerProgress(selectRunnerProgressFor(variant?.touchesToday ? variant.todaySessionId : null)) !== null;
  if (!payload || !variant) return null;
  const { status } = payload;
  const pending = status === 'pending' || status === 'applying';
  const id = message.id;

  return (
    <View style={styles.root} testID="coach.planEdit.card">
      <View style={styles.card}>
        <LPText serif size={18} color={coachPalette.textPrimary} accessibilityRole="header">
          {t('coach.planEdit.cardTitle')}
        </LPText>

        {payload.variants.length > 1 && pending ? (
          <View style={styles.variants} accessibilityRole="radiogroup">
            {payload.variants.map((option, index) => {
              const selected = index === payload.selected;
              const label = variantLabel(option, index, t);
              return (
                <Pressable
                  key={option.editId}
                  onPress={() => selectVariant(id, index)}
                  disabled={status !== 'pending'}
                  accessibilityRole="radio"
                  accessibilityLabel={label}
                  accessibilityState={{ selected, disabled: status !== 'pending' }}
                  style={[styles.variant, selected && styles.variantSelected]}
                  testID={`coach.planEdit.variant.${index}`}
                >
                  <LPText size={13} weight={selected ? 'semibold' : 'medium'} color={coachPalette.textPrimary} align="center">
                    {label}
                  </LPText>
                </Pressable>
              );
            })}
          </View>
        ) : null}

        {variant.summary ? (
          <LPText size={14} color={coachPalette.textPrimary} testID="coach.planEdit.summary">
            {variant.summary}
          </LPText>
        ) : null}

        {variant.changes.map((group, groupIndex) => (
          <View key={`${group.label}-${groupIndex}`} style={styles.group}>
            {group.label ? (
              <LPText size={13} weight="semibold" color={coachPalette.textSecondary}>
                {group.label}
              </LPText>
            ) : null}
            {group.items.map((item, itemIndex) => (
              <View key={itemIndex} style={styles.item} testID={`coach.planEdit.item.${groupIndex}.${itemIndex}`}>
                <LPText size={14} color={coachPalette.textPrimary} style={styles.itemText}>
                  {itemLine(item, t)}
                </LPText>
                {item.own ? (
                  <View style={styles.tag}>
                    <LPText size={11} weight="semibold" color={coachPalette.textSecondary}>
                      {t('coach.planEdit.ownTag')}
                    </LPText>
                  </View>
                ) : null}
              </View>
            ))}
          </View>
        ))}

        {variant.exclusions.added.length > 0 ? (
          <LPText size={13} color={coachPalette.textSecondary} testID="coach.planEdit.wontUse">
            {t('coach.planEdit.wontUse', { labels: variant.exclusions.added.map((entry) => entry.label).join(', ') })}
          </LPText>
        ) : null}

        {variant.becomesCustomNote ? (
          <LPText size={12} color={coachPalette.textMeta} testID="coach.planEdit.customNote">
            {variant.becomesCustomNote}
          </LPText>
        ) : null}

        {variant.notApplied.length > 0 ? (
          <View style={styles.notApplied} testID="coach.planEdit.notApplied">
            {variant.notAppliedNote ? (
              <LPText size={12} color={coachPalette.textMeta}>
                {variant.notAppliedNote}
              </LPText>
            ) : null}
            {variant.notApplied.map((entry, index) => (
              <LPText key={index} size={12} color={coachPalette.textMeta}>
                {entry.text}
              </LPText>
            ))}
          </View>
        ) : null}

        <Footer
          payload={payload}
          busy={busy}
          runnerOpen={runnerOpen}
          onApply={() => void applyCard(id)}
          onCancel={() => cancelCard(id)}
          onUndo={() => void undoCard(id)}
        />

        {payload.errorKey && status !== 'stale' ? (
          <LPText size={13} color={coachPalette.textSecondary} accessibilityLiveRegion="polite" testID="coach.planEdit.error">
            {t(payload.errorKey)}
          </LPText>
        ) : null}
      </View>
    </View>
  );
}

function Footer({
  payload,
  busy,
  runnerOpen,
  onApply,
  onCancel,
  onUndo,
}: {
  payload: PlanEditCardPayload;
  busy: boolean;
  runnerOpen: boolean;
  onApply: () => void;
  onCancel: () => void;
  onUndo: () => void;
}) {
  const { t } = useT();
  switch (payload.status) {
    case 'pending':
    case 'applying': {
      const applying = payload.status === 'applying';
      const applyDisabled = applying || busy || runnerOpen;
      return (
        <View style={styles.footer}>
          <View style={styles.actions}>
            <Pressable
              onPress={onApply}
              disabled={applyDisabled}
              accessibilityRole="button"
              accessibilityLabel={t('coach.planEdit.apply')}
              accessibilityState={{ disabled: applyDisabled, busy: applying }}
              style={({ pressed }) => [styles.apply, applyDisabled && styles.dimmed, pressed && !applyDisabled && styles.pressed]}
              testID="coach.planEdit.apply"
            >
              {applying ? <ActivityIndicator size="small" color="#FFFFFF" /> : null}
              <LPText size={14} weight="semibold" color="#FFFFFF">
                {t('coach.planEdit.apply')}
              </LPText>
            </Pressable>
            <Pressable
              onPress={onCancel}
              disabled={applying}
              accessibilityRole="button"
              accessibilityLabel={t('coach.planEdit.cancel')}
              accessibilityState={{ disabled: applying }}
              style={({ pressed }) => [styles.secondary, pressed && !applying && styles.pressed]}
              testID="coach.planEdit.cancel"
            >
              <LPText size={13} weight="semibold" color={coachPalette.textSecondary}>
                {t('coach.planEdit.cancel')}
              </LPText>
            </Pressable>
          </View>
          {runnerOpen ? (
            <LPText size={12} color={coachPalette.textMeta} testID="coach.planEdit.runnerOpen">
              {t('coach.planEdit.runnerOpen')}
            </LPText>
          ) : null}
        </View>
      );
    }
    case 'applied':
    case 'undoing': {
      const undoing = payload.status === 'undoing';
      const canUndo = !!payload.applied && isUndoable(payload.applied);
      return (
        <View style={styles.actions} testID="coach.planEdit.changed">
          <LPText size={13} weight="semibold" color={coachPalette.textSecondary}>
            {t('coach.planEdit.changed')}
          </LPText>
          {canUndo || undoing ? (
            <>
              <View {...hiddenFromAccessibility}>
                <LPText size={13} color={coachPalette.textMeta}>
                  ·
                </LPText>
              </View>
              <Pressable
                onPress={onUndo}
                disabled={undoing || busy}
                accessibilityRole="button"
                accessibilityLabel={t('coach.planEdit.undo')}
                accessibilityState={{ disabled: undoing || busy, busy: undoing }}
                style={({ pressed }) => [styles.secondary, pressed && !undoing && styles.pressed]}
                testID="coach.planEdit.undo"
              >
                {undoing ? <ActivityIndicator size="small" color={coachPalette.textSecondary} /> : null}
                <LPText size={13} weight="semibold" color={coachPalette.accent}>
                  {t('coach.planEdit.undo')}
                </LPText>
              </Pressable>
            </>
          ) : null}
        </View>
      );
    }
    case 'undone':
      return <StatusLine textKey="coach.planEdit.undone" testID="coach.planEdit.undone" />;
    case 'cancelled':
      return <StatusLine textKey="coach.planEdit.cancelled" testID="coach.planEdit.cancelled" />;
    case 'superseded':
      return <StatusLine textKey="coach.planEdit.superseded" testID="coach.planEdit.superseded" />;
    case 'stale':
      return <StatusLine textKey={payload.errorKey ?? 'coach.planEdit.error.stale'} testID="coach.planEdit.stale" />;
  }
}

function StatusLine({ textKey, testID }: { textKey: string; testID: string }) {
  const { t } = useT();
  return (
    <LPText size={13} weight="semibold" color={coachPalette.textMeta} testID={testID}>
      {t(textKey)}
    </LPText>
  );
}

export default memo(PlanEditCard);

/** "Some of it couldn't be done": the server's lines for a request that changed nothing. */
export const PlanEditNotice = memo(function PlanEditNotice({ message }: CoachMessageRendererProps) {
  const payload = message.payload as PlanEditNoticePayload | undefined;
  if (!payload || payload.lines.length === 0) return null;
  return (
    <View style={styles.root} testID="coach.planEdit.notice">
      <View style={[styles.card, styles.notice]}>
        {payload.note ? (
          <LPText size={12} color={coachPalette.textMeta}>
            {payload.note}
          </LPText>
        ) : null}
        {payload.lines.map((line, index) => (
          <LPText key={index} size={13} color={coachPalette.textSecondary}>
            {line}
          </LPText>
        ))}
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  // Under the avatar's column, as the programme's bubbles sit (iOS `.padding(.leading, 34)`).
  root: { paddingLeft: 34, alignSelf: 'stretch' },
  card: {
    gap: 10,
    padding: 14,
    borderRadius: 14,
    backgroundColor: coachPalette.tile,
    borderWidth: 0.8,
    borderColor: coachPalette.stroke,
  },
  notice: { gap: 6 },
  variants: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  variant: {
    flexGrow: 1,
    flexBasis: '45%',
    minHeight: 40,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 0.8,
    borderColor: coachPalette.stroke,
    justifyContent: 'center',
  },
  variantSelected: { backgroundColor: coachPalette.userBubble, borderColor: coachPalette.userBubble },
  group: { gap: 4 },
  item: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  itemText: { flexShrink: 1 },
  tag: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    borderWidth: 0.8,
    borderColor: coachPalette.stroke,
  },
  notApplied: { gap: 3 },
  footer: { gap: 6 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
  apply: {
    minHeight: 48,
    paddingHorizontal: 20,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: 999,
    backgroundColor: coachPalette.accent,
  },
  secondary: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 6 },
  dimmed: { opacity: 0.5 },
  pressed: { opacity: 0.75 },
});
