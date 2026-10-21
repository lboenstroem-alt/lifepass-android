/**
 * The monthly feedback on the Plan tab (iOS Views/Plan/FeedbackCard.swift,
 * `SPEC` 9.2): the mid-month note, the month's report, and the one-time
 * intro (or, for a member whose food and weight are off by default, the
 * one-time offer to include them).
 *
 * Drawn right after the weekly review, only while the server advertises
 * `health_feedback`, the member's consent stands and the strip shows today
 * (the Plan section decides that; this view draws a `FeedbackCardState`).
 * Every word of a report or a note is the server's, already in the member's
 * language; the card adds only its frame. None of it is ever passed to the
 * Coach, analytics or a notification.
 */
import { Ionicons } from '@expo/vector-icons';
import { useEffect } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import type { FeedbackAction, FeedbackMessage, FeedbackNote, FeedbackReportSummary } from '../../api/feedback';
import { Card, hiddenFromAccessibility, Kicker, LPText } from '../../components/ui';
import { HealthFormat, useT } from '../../i18n';
import { track } from '../../lib/analytics';
import { colors, hairline } from '../../theme';

import type { ShownFeedbackAction } from './actions';
import type { FeedbackCardState } from './cardState';
import { FeedbackActionButton, FeedbackFilledButton, FeedbackNewPill, FeedbackTextButton } from './parts';

export type FeedbackCardProps = {
  state: FeedbackCardState;
  /** Which action a line may offer this member right now (`SPEC` 9.6): null hides it. */
  resolveAction: (action: FeedbackAction | null) => ShownFeedbackAction | null;
  onOpenReport: (id: string) => void;
  onOpenHistory: () => void;
  onChooseSettings: () => void;
  onAction: (action: ShownFeedbackAction) => void;
  onDismissNote: (id: string) => void;
  onNoteSeen: (id: string) => void;
  /**
   * The card is on screen: Plan's tab is selected and nothing covers its
   * first screen. Defaults to true. Android keeps a visited tab, and the
   * screens under a pushed one, mounted, where iOS draws only what shows;
   * a note that lands while Plan is hidden waits for this before it is
   * marked seen.
   */
  onScreen?: boolean;
  onIntroClosed: () => void;
  onIncludeFood: () => void;
  onDeclineFood: () => void;
  testID?: string;
};

export default function FeedbackCard(props: FeedbackCardProps) {
  const { state } = props;
  const note = state.note;
  const message = note?.message ?? null;
  const noteText = message?.text && message.text.trim().length > 0 ? message.text : null;
  return (
    <View style={styles.stack} testID={props.testID ?? 'feedback.section'}>
      {note && message && noteText ? <NoteCard {...props} note={note} message={message} text={noteText} /> : null}
      {state.latest && state.monthly === 'full' ? <MonthlyCard {...props} latest={state.latest} /> : null}
      {state.latest && state.monthly === 'compact' ? <CompactRow {...props} latest={state.latest} /> : null}
      {state.showsFoodOffer ? <FoodOfferCard {...props} /> : state.showsIntro ? <IntroCard {...props} /> : null}
    </View>
  );
}

// 1. The note

function NoteCard({
  note,
  message,
  text,
  resolveAction,
  onAction,
  onDismissNote,
  onNoteSeen,
  onScreen = true,
}: FeedbackCardProps & { note: FeedbackNote; message: FeedbackMessage; text: string }) {
  const { t } = useT();
  const action = resolveAction(message.action);
  // Marked seen when it is shown (iOS `onAppear`), and only then: a seen note
  // is one the server no longer announces.
  const unseen = note.seenAt === null;
  useEffect(() => {
    if (unseen && onScreen) onNoteSeen(note.id);
    // Once per note shown; the store keeps it to once per id per session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [note.id, unseen, onScreen]);
  return (
    <Card style={[styles.margin, styles.padded]} testID="feedback.note">
      <Kicker text={t('feedback.note.kicker')} />
      <LPText serif size={17} color={colors.paper}>
        {text}
      </LPText>
      <View style={styles.row}>
        {action ? <FeedbackActionButton action={action} onPress={() => onAction(action)} /> : null}
        <View style={styles.spacer} />
        <FeedbackTextButton label={t('feedback.note.dismiss')} onPress={() => onDismissNote(note.id)} testID="feedback.note.dismiss" />
      </View>
    </Card>
  );
}

// 2. The month

function MonthlyCard({ latest, onOpenReport, onOpenHistory }: FeedbackCardProps & { latest: FeedbackReportSummary }) {
  const { t } = useT();
  return (
    <View style={styles.monthly} testID="feedback.card">
      <View style={styles.monthlyHeader}>
        <Kicker text={t('feedback.card.kicker')} />
        <View style={styles.titleRow}>
          <LPText serif size={22} color={colors.paper} accessibilityRole="header" style={styles.shrink}>
            {latest.title ?? t('feedback.detail.title')}
          </LPText>
          {latest.seenAt === null ? <FeedbackNewPill /> : null}
        </View>
      </View>
      <Card style={styles.margin}>
        {latest.highlights.map((line, index) => (
          <View key={`${index}-${line}`} testID="feedback.card.highlight">
            {index > 0 ? <View style={styles.rule} /> : null}
            <LPText size={14} color={colors.paper} style={styles.highlight}>
              {line}
            </LPText>
          </View>
        ))}
        {latest.highlights.length > 0 ? <View style={styles.rule} /> : null}
        <View style={[styles.row, styles.footerRow]}>
          <FeedbackFilledButton label={t('feedback.card.open')} onPress={() => onOpenReport(latest.id)} testID="feedback.card.open" />
          <View style={styles.spacer} />
          <FeedbackTextButton label={t('feedback.card.history')} onPress={onOpenHistory} testID="feedback.card.history" />
        </View>
      </Card>
    </View>
  );
}

/** A report the member has already read, more than a week old: one row. */
function CompactRow({ latest, onOpenReport }: FeedbackCardProps & { latest: FeedbackReportSummary }) {
  const { t } = useT();
  const title = latest.title ?? t('feedback.detail.title');
  const sub = t('feedback.card.row_sub');
  return (
    <Pressable
      onPress={() => onOpenReport(latest.id)}
      accessibilityRole="button"
      accessibilityLabel={`${title}, ${sub}`}
      style={({ pressed }) => [styles.margin, pressed && styles.pressed]}
      testID="feedback.card"
    >
      <Card style={styles.compact}>
        <View style={styles.compactTexts}>
          <LPText size={14} weight="medium" color={colors.paper}>
            {title}
          </LPText>
          <LPText size={12} color={colors.paper3}>
            {sub}
          </LPText>
        </View>
        <View {...hiddenFromAccessibility}>
          <Ionicons name="chevron-forward" size={13} color={colors.paper3} />
        </View>
      </Card>
    </Pressable>
  );
}

// 3. The intro, or the food and weight offer in its place

function IntroCard({ state, onIntroClosed, onChooseSettings }: FeedbackCardProps) {
  const { t } = useT();
  return (
    <Card style={[styles.margin, styles.padded]} testID="feedback.intro">
      <Kicker text={t('feedback.intro.kicker')} />
      <LPText serif size={22} color={colors.paper} accessibilityRole="header">
        {t('feedback.intro.title')}
      </LPText>
      <LPText size={14} color={colors.paper2} testID="feedback.intro.body">
        {t(state.introBodyKey)}
      </LPText>
      <FirstLine day={state.firstReportDay} />
      <View style={styles.row}>
        <FeedbackFilledButton
          label={t('feedback.intro.choose')}
          onPress={() => {
            track('feedback_intro_closed', { choice: 'choose' });
            onIntroClosed();
            onChooseSettings();
          }}
          testID="feedback.intro.choose"
        />
        <View style={styles.spacer} />
        <FeedbackTextButton
          label={t('feedback.intro.ok')}
          onPress={() => {
            track('feedback_intro_closed', { choice: 'ok' });
            onIntroClosed();
          }}
          testID="feedback.intro.ok"
        />
      </View>
    </Card>
  );
}

/**
 * For a member without a plan, food and weight start off (the safety
 * questions were never asked). This asks once, and never after a safety
 * answer: that answer makes the switch an explicit choice. Deliberately not
 * reported to analytics, like the switch itself.
 */
function FoodOfferCard({ state, onIncludeFood, onDeclineFood }: FeedbackCardProps) {
  const { t } = useT();
  return (
    <Card style={[styles.margin, styles.padded]} testID="feedback.offer">
      <Kicker text={t('feedback.offer.kicker')} />
      <LPText serif size={22} color={colors.paper} accessibilityRole="header">
        {t('feedback.offer.title')}
      </LPText>
      <LPText size={14} color={colors.paper2}>
        {t('feedback.offer.body')}
      </LPText>
      <FirstLine day={state.firstReportDay} />
      <View style={styles.row}>
        <FeedbackFilledButton label={t('feedback.offer.on')} onPress={onIncludeFood} testID="feedback.offer.on" />
        <View style={styles.spacer} />
        <FeedbackTextButton label={t('feedback.offer.not_now')} onPress={onDeclineFood} testID="feedback.offer.not_now" />
      </View>
    </Card>
  );
}

/** "Your first one arrives on 1 November." when the server expects to write it. */
function FirstLine({ day }: { day: string | null }) {
  const { t, language } = useT();
  if (!day) return null;
  return (
    <LPText size={13} color={colors.paper3} testID="feedback.intro.first">
      {t('feedback.intro.first', { date: HealthFormat.longDay(day, language) })}
    </LPText>
  );
}

const styles = StyleSheet.create({
  stack: { gap: 20 },
  margin: { marginHorizontal: 20 },
  padded: { padding: 14, gap: 12 },
  monthly: { gap: 14 },
  monthlyHeader: { gap: 10, paddingHorizontal: 24 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
  shrink: { flexShrink: 1 },
  highlight: { paddingHorizontal: 14, paddingVertical: 12 },
  rule: { height: hairline, backgroundColor: colors.line },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  footerRow: { paddingHorizontal: 14, paddingVertical: 10 },
  spacer: { flex: 1 },
  compact: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 14 },
  compactTexts: { flex: 1, gap: 2 },
  pressed: { opacity: 0.75 },
});
