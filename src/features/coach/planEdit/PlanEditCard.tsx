/* eslint lifepass/no-literal-copy: "error" */
/**
 * The plan change, before it is the plan (OP-58), and what became of it:
 * iOS `PlanEditPreviewCard` (Views/Coach/PlanEditPreviewCard.swift).
 *
 *   CHANGE TO YOUR PLAN
 *   [Our exercise: Dumbbell bench press | Your own: Zottman curls]
 *   Push-ups instead of bench press on Push days.          (serif)
 *   Push, every time from Sat 24 Oct
 *     • Barbell bench press → Push-up
 *     • Zottman curls                          [Your exercise]
 *   Won't use: Barbell              Can use again: Cable
 *   (what turns the plan into a cycle)
 *   Some of it couldn't be done:
 *     A 50-set dose was capped at 6.
 *   (a refusal, or "Finish or close today's workout first.")
 *   [Apply]  Cancel
 *
 * then "Changed · Undo" (with the change's summary), "Undone", "Cancelled",
 * "Replaced by the newer suggestion" or "No longer open".
 *
 * NOTHING ON THIS CARD IS COMPOSED ON THE PHONE but its frame: the title,
 * the "Your exercise" tag, the buttons and the collapsed lines. The summary,
 * the labels, each before and after and the notes are server copy in the
 * app language; the member's own exercise names and day titles appear as
 * they wrote them.
 */
import { memo } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { hiddenFromAccessibility, Kicker, LPText } from '../../../components/ui';
import { useT } from '../../../i18n';
import { selectRunnerProgressFor, useRunnerProgress } from '../../runner';
import type { CoachMessageRendererProps } from '../flows/types';
import { coachPalette } from '../theme/palette';

import { applyCard, cancelCard, cardCanUndo, selectedVariant, selectVariant, undoCard, type PlanEditCardPayload } from './flow';
import { SINGLE_LINE_ITEM_TYPES, type PlanEditChangeItem, type PlanEditPreview } from './types';

type Translate = (key: string, params?: Readonly<Record<string, string | number>>) => string;

/** The server's label ("Our exercise: Dumbbell bench press"), or the app's two words when it sent none. */
export function variantLabel(variant: PlanEditPreview, index: number, t: Translate): string {
  if (variant.label) return variant.label;
  return t(variant.recommended || index === 0 ? 'coach.planEdit.variantOurs' : 'coach.planEdit.variantOwn');
}

/** "before → after", or the one side the server sent; a single-line change (a rest day, a title, the cycle) is its own sentence. */
export function itemText(item: PlanEditChangeItem): string | null {
  if (SINGLE_LINE_ITEM_TYPES.has(item.type)) return item.after ?? item.before;
  if (item.before !== null && item.after !== null) return `${item.before} → ${item.after}`;
  return item.after ?? item.before;
}

function PlanEditCard({ message, busy }: CoachMessageRendererProps) {
  const card = message.payload as PlanEditCardPayload | undefined;
  const variant = card ? selectedVariant(card) : null;
  const todaySession = variant?.touchesToday ? variant.todaySessionId : null;
  const waitsForRunner = useRunnerProgress(selectRunnerProgressFor(todaySession)) !== null;
  if (!card || !variant) return null;

  let body;
  switch (card.status) {
    case 'pending':
    case 'applying':
      body = <FullCard id={message.id} card={card} variant={variant} busy={busy} waitsForRunner={waitsForRunner} />;
      break;
    case 'applied':
    case 'undoing':
      body = <AppliedLine id={message.id} card={card} variant={variant} busy={busy} />;
      break;
    case 'undone':
      body = (
        <Collapsed lines={['coach.planEdit.undone', ...(card.keptRows > 0 ? ['coach.planEdit.keptRows'] : [])]} testID="coach.planEdit.undone" />
      );
      break;
    case 'cancelled':
      body = <Collapsed lines={['coach.planEdit.cancelled']} testID="coach.planEdit.cancelled" />;
      break;
    case 'superseded':
      body = <Collapsed lines={['coach.planEdit.superseded']} testID="coach.planEdit.superseded" />;
      break;
    case 'stale':
      body = <Collapsed lines={['coach.planEdit.staleCard']} testID="coach.planEdit.stale" />;
      break;
  }
  return (
    <View style={styles.root} testID="coach.planEdit.card">
      {body}
    </View>
  );
}

function FullCard({
  id,
  card,
  variant,
  busy,
  waitsForRunner,
}: {
  id: string;
  card: PlanEditCardPayload;
  variant: PlanEditPreview;
  busy: boolean;
  waitsForRunner: boolean;
}) {
  const { t } = useT();
  const applying = card.status === 'applying';
  const applyEnabled = card.status === 'pending' && !waitsForRunner && !busy;
  const added = variant.exclusions.added.map((entry) => entry.label);
  const removed = variant.exclusions.removed.map((entry) => entry.label);

  return (
    <View style={styles.card} accessibilityLabel={t('coach.planEdit.cardTitle')}>
      <Kicker text={t('coach.planEdit.cardTitle')} color={coachPalette.textMeta} />

      {card.variants.length > 1 ? (
        <View style={styles.variants} accessibilityRole="radiogroup" accessibilityLabel={t('coach.planEdit.variantPicker')}>
          {card.variants.map((option, index) => {
            const selected = index === card.selected;
            const label = variantLabel(option, index, t);
            return (
              <Pressable
                key={option.editId}
                onPress={() => selectVariant(id, index)}
                disabled={card.status !== 'pending'}
                accessibilityRole="radio"
                accessibilityLabel={label}
                accessibilityState={{ selected, disabled: card.status !== 'pending' }}
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
        <LPText serif size={19} color={coachPalette.textPrimary} testID="coach.planEdit.summary">
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
          {group.items.map((item, itemIndex) => {
            const text = itemText(item);
            if (!text) return null;
            return (
              <View key={itemIndex} style={styles.item} testID={`coach.planEdit.item.${groupIndex}.${itemIndex}`}>
                <View {...hiddenFromAccessibility} style={styles.dot} />
                <LPText size={14} color={coachPalette.textPrimary} style={styles.itemText}>
                  {text}
                </LPText>
                {item.own ? (
                  <View style={styles.tag}>
                    <LPText size={11} weight="semibold" color={coachPalette.textPrimary}>
                      {t('coach.planEdit.ownTag')}
                    </LPText>
                  </View>
                ) : null}
              </View>
            );
          })}
        </View>
      ))}

      {added.length > 0 ? (
        <LPText size={13} weight="medium" color={coachPalette.textSecondary} testID="coach.planEdit.wontUse">
          {t('coach.planEdit.wontUse', { labels: added.join(', ') })}
        </LPText>
      ) : null}
      {removed.length > 0 ? (
        <LPText size={13} weight="medium" color={coachPalette.textSecondary} testID="coach.planEdit.useAgain">
          {t('coach.planEdit.useAgain', { labels: removed.join(', ') })}
        </LPText>
      ) : null}

      {variant.becomesCustomNote ? (
        <LPText size={13} color={coachPalette.textSecondary} testID="coach.planEdit.customNote">
          {variant.becomesCustomNote}
        </LPText>
      ) : null}

      {variant.notAppliedNote || variant.notApplied.length > 0 ? (
        <View style={styles.notApplied} testID="coach.planEdit.notApplied">
          {variant.notAppliedNote ? (
            <LPText size={12} weight="semibold" color={coachPalette.textMeta}>
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

      {card.errorKey ? (
        <LPText size={13} color={coachPalette.textSecondary} accessibilityLiveRegion="polite" testID="coach.planEdit.error">
          {t(card.errorKey)}
        </LPText>
      ) : waitsForRunner ? (
        <LPText size={13} color={coachPalette.textSecondary} testID="coach.planEdit.runnerOpen">
          {t('coach.planEdit.runnerOpen')}
        </LPText>
      ) : null}

      <View style={styles.buttons}>
        <Pressable
          onPress={() => void applyCard(id)}
          disabled={!applyEnabled}
          accessibilityRole="button"
          accessibilityLabel={t('coach.planEdit.apply')}
          accessibilityState={{ disabled: !applyEnabled, busy: applying }}
          style={({ pressed }) => [styles.apply, !applyEnabled && !applying && styles.dimmed, pressed && applyEnabled && styles.pressed]}
          testID="coach.planEdit.apply"
        >
          {applying ? (
            <ActivityIndicator size="small" color="#FFFFFF" />
          ) : (
            <LPText size={15} weight="semibold" color="#FFFFFF">
              {t('coach.planEdit.apply')}
            </LPText>
          )}
        </Pressable>
        <Pressable
          onPress={() => cancelCard(id)}
          disabled={card.status !== 'pending'}
          accessibilityRole="button"
          accessibilityLabel={t('coach.planEdit.cancel')}
          accessibilityState={{ disabled: card.status !== 'pending' }}
          style={({ pressed }) => [styles.cancel, pressed && styles.pressed]}
          testID="coach.planEdit.cancel"
        >
          <LPText size={14} weight="semibold" color={coachPalette.textSecondary}>
            {t('coach.planEdit.cancel')}
          </LPText>
        </Pressable>
      </View>
    </View>
  );
}

/** "Changed · Undo", while the server says it can be undone; the change's summary under it. */
function AppliedLine({ id, card, variant, busy }: { id: string; card: PlanEditCardPayload; variant: PlanEditPreview; busy: boolean }) {
  const { t } = useT();
  const undoing = card.status === 'undoing';
  const canUndo = cardCanUndo(card);
  const summary = card.applied?.summary ?? variant.summary;
  const note = card.undoBlockedKey ?? card.errorKey;
  return (
    <View style={styles.collapsed} testID="coach.planEdit.changed">
      <View style={styles.appliedRow}>
        <LPText size={14} weight="semibold" color={coachPalette.textPrimary}>
          {t('coach.planEdit.changed')}
        </LPText>
        {undoing ? (
          <ActivityIndicator size="small" color={coachPalette.textPrimary} />
        ) : canUndo ? (
          <>
            <View {...hiddenFromAccessibility}>
              <LPText size={14} color={coachPalette.textMeta}>
                ·
              </LPText>
            </View>
            <Pressable
              onPress={() => void undoCard(id)}
              disabled={busy}
              accessibilityRole="button"
              accessibilityLabel={t('coach.planEdit.undo')}
              accessibilityState={{ disabled: busy }}
              style={({ pressed }) => [styles.undo, pressed && styles.pressed]}
              testID="coach.planEdit.undo"
            >
              <LPText size={14} weight="semibold" color={coachPalette.tileIcon}>
                {t('coach.planEdit.undo')}
              </LPText>
            </Pressable>
          </>
        ) : null}
      </View>
      {summary ? (
        <LPText size={13} color={coachPalette.textSecondary}>
          {summary}
        </LPText>
      ) : null}
      {note ? (
        <LPText size={12} color={coachPalette.textMeta} testID="coach.planEdit.note">
          {t(note)}
        </LPText>
      ) : null}
    </View>
  );
}

function Collapsed({ lines, testID }: { lines: readonly string[]; testID: string }) {
  const { t } = useT();
  return (
    <View style={styles.collapsed} testID={testID}>
      {lines.map((key, index) => (
        <LPText
          key={key}
          size={index === 0 ? 14 : 13}
          weight={index === 0 ? 'semibold' : 'regular'}
          color={index === 0 ? coachPalette.textPrimary : coachPalette.textSecondary}
        >
          {t(key)}
        </LPText>
      ))}
    </View>
  );
}

export default memo(PlanEditCard);

const styles = StyleSheet.create({
  // Under the avatar's column, as the programme's bubbles sit (iOS `.padding(.leading, 34)`).
  root: { paddingLeft: 34, alignSelf: 'stretch' },
  card: {
    gap: 12,
    padding: 14,
    borderRadius: 16,
    backgroundColor: coachPalette.tile,
    borderWidth: 0.8,
    borderColor: coachPalette.stroke,
  },
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
  group: { gap: 6 },
  item: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  dot: { width: 4, height: 4, borderRadius: 2, backgroundColor: coachPalette.accent },
  itemText: { flexShrink: 1 },
  tag: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.12)' },
  notApplied: { gap: 4 },
  buttons: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  apply: {
    flex: 1,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 999,
    backgroundColor: coachPalette.accent,
  },
  cancel: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  collapsed: {
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 14,
    backgroundColor: coachPalette.tile,
    borderWidth: 0.6,
    borderColor: coachPalette.glassStroke,
  },
  appliedRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  undo: { minHeight: 44, justifyContent: 'center' },
  dimmed: { opacity: 0.45 },
  pressed: { opacity: 0.75 },
});
