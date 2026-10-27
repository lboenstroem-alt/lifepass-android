/* eslint lifepass/no-literal-copy: "error" */
// The chat's class cards (iOS Views/CoachClassCardsView.swift, API 0.36.0).
//
// A Coach reply about class times, with the classes it found as a pop-up
// list under it: time, class and venue, the plan-level price line and spots
// left when the server sent them, and Book on each class that can be booked
// now. Book opens the same class sheet a Classes row opens (`onBook`, the
// day plan's own Book), so the charge disclosure, card-less payment and the
// membership and trial gates are the booking flow's own, untouched.
//
// Book is offered only for an open class (or one the server gave no state);
// a full class, one whose registration opens later, one that has started
// since the answer came, or a state this build does not know show that state
// instead (src/features/coach/chat/classCards.ts says which). The list can be
// closed, and a small button brings it back.
import { Ionicons } from '@expo/vector-icons';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { LPText } from '../../components/ui';
import { hiddenFromAccessibility } from '../../components/ui/a11y';
import type { CoachPlanClass } from '../../features/classes/sheet';
import {
  classCardMetaLine,
  classCardState,
  classCardStateLabel,
  classCardWhenLine,
  type ClassCardState,
} from '../../features/coach/chat/classCards';
import { coachPalette } from '../../features/coach/theme/palette';
import { useT } from '../../i18n';
import { AssistantText } from './MessageBubble';

/**
 * The list's fill: the Coach's glass (rgb 10 20 46 at 0.72) laid over the
 * photo's ink (rgb 8 14 30 at 0.38), as iOS stacks the two backgrounds,
 * flattened into one colour (the plan cards' fill).
 */
const PANEL_FILL = 'rgba(10,19,44,0.83)';

/** How often a card left on screen is redrawn, so Book turns to Started at the class's start. */
const TICK_MS = 60_000;

type Props = {
  /** The reply above the list. */
  intro: string;
  classes: readonly CoachPlanClass[];
  hidden: boolean;
  onSetHidden: (hidden: boolean) => void;
  onBook: (session: CoachPlanClass) => Promise<void>;
  /** The clock the "started" state reads. A test passes its own; the chat passes nothing. */
  now?: () => Date;
};

export default function ClassCardsMessage({ intro, classes, hidden, onSetHidden, onBook, now = () => new Date() }: Props) {
  const { t } = useT();
  const showLabel = t('coach.classes.show', { count: String(classes.length) });
  return (
    <View style={styles.root} testID="coach.classes.message">
      <AssistantText text={intro} />
      {hidden ? (
        <Pressable
          onPress={() => onSetHidden(false)}
          style={({ pressed }) => [styles.show, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel={showLabel}
          testID="coach.classes.show"
        >
          <Ionicons name="calendar-outline" size={12} color={coachPalette.textPrimary} {...hiddenFromAccessibility} />
          <LPText size={13} weight="semibold" color={coachPalette.textPrimary}>
            {showLabel}
          </LPText>
        </Pressable>
      ) : (
        <ClassList classes={classes} onClose={() => onSetHidden(true)} onBook={onBook} now={now} />
      )}
    </View>
  );
}

function ClassList({
  classes,
  onClose,
  onBook,
  now,
}: {
  classes: readonly CoachPlanClass[];
  onClose: () => void;
  onBook: (session: CoachPlanClass) => Promise<void>;
  now: () => Date;
}) {
  const { t } = useT();
  // Redrawn every minute, so a card left on screen past its start turns from
  // Book to Started without the chat having to move.
  const [, setTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setTick((tick) => tick + 1), TICK_MS);
    return () => clearInterval(timer);
  }, []);
  const at = now();

  return (
    <View style={styles.panel} testID="coach.classes">
      <View style={styles.header}>
        <Ionicons name="calendar-outline" size={13} color={coachPalette.textPrimary} {...hiddenFromAccessibility} />
        <LPText size={14} weight="semibold" color={coachPalette.textPrimary} accessibilityRole="header" style={styles.flex}>
          {t('coach.classes.title')}
        </LPText>
        <Pressable
          onPress={onClose}
          style={styles.closeTarget}
          accessibilityRole="button"
          accessibilityLabel={t('coach.classes.close')}
          testID="coach.classes.close"
        >
          {({ pressed }) => (
            <View style={[styles.closeDisc, pressed && styles.pressed]}>
              <Ionicons name="close" size={14} color={coachPalette.textSecondary} {...hiddenFromAccessibility} />
            </View>
          )}
        </Pressable>
      </View>
      {classes.map((session, index) => (
        <View key={session.id}>
          {index > 0 ? <View style={styles.divider} {...hiddenFromAccessibility} /> : null}
          <ClassRow session={session} now={at} onBook={onBook} />
        </View>
      ))}
    </View>
  );
}

function ClassRow({ session, now, onBook }: { session: CoachPlanClass; now: Date; onBook: (session: CoachPlanClass) => Promise<void> }) {
  const { t, language } = useT();
  const state = classCardState(session, now);
  const when = classCardWhenLine(session, now, language, t);
  const title = session.title ?? t('classes.unnamed');
  const meta = classCardMetaLine(session, state, t);

  return (
    <View style={styles.row} testID={`coach.classes.row.${session.id}`}>
      <View style={styles.text} accessible>
        <LPText size={15} weight="bold" color={coachPalette.textPrimary} numberOfLines={1} style={styles.digits}>
          {when}
        </LPText>
        <LPText size={14} weight="semibold" color={coachPalette.textPrimary} numberOfLines={2}>
          {title}
        </LPText>
        <LPText size={12} color={coachPalette.textMeta} numberOfLines={1}>
          {session.venueName}
        </LPText>
        {meta ? (
          <LPText size={12} weight="medium" color={coachPalette.textSecondary} numberOfLines={2} testID={`coach.classes.row.${session.id}.meta`}>
            {meta}
          </LPText>
        ) : null}
      </View>
      <Trailing session={session} state={state} label={`${t('coach.plan.class.book')}, ${title}, ${when}`} onBook={onBook} />
    </View>
  );
}

function Trailing({
  session,
  state,
  label,
  onBook,
}: {
  session: CoachPlanClass;
  state: ClassCardState;
  label: string;
  onBook: (session: CoachPlanClass) => Promise<void>;
}) {
  const { t } = useT();
  // The class feed lookup can take a moment when a card carried no booking
  // handle; the button shows it and ignores a second tap.
  const [resolving, setResolving] = useState(false);
  const resolvingRef = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  if (state !== 'bookable') {
    const text = classCardStateLabel(state, t);
    if (!text) return null;
    return (
      <View style={styles.state} testID={`coach.classes.row.${session.id}.state`}>
        <LPText size={12} weight="semibold" color={coachPalette.textSecondary} align="center">
          {text}
        </LPText>
      </View>
    );
  }

  const book = () => {
    if (resolvingRef.current) return;
    resolvingRef.current = true;
    setResolving(true);
    void onBook(session).finally(() => {
      resolvingRef.current = false;
      if (mounted.current) setResolving(false);
    });
  };

  return (
    <Pressable
      onPress={book}
      style={styles.bookTarget}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ busy: resolving }}
      testID={`coach.classes.row.${session.id}.book`}
    >
      {({ pressed }) => (
        <View style={[styles.book, pressed && styles.pressed]}>
          <LPText size={13} weight="semibold" color="#FFFFFF" style={resolving ? styles.invisible : undefined}>
            {t('coach.plan.class.book')}
          </LPText>
          {resolving ? (
            <ActivityIndicator
              color="#FFFFFF"
              size="small"
              style={StyleSheet.absoluteFill}
              testID={`coach.classes.row.${session.id}.spinner`}
            />
          ) : null}
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { gap: 10, alignSelf: 'stretch' },
  flex: { flex: 1 },
  pressed: { opacity: 0.7 },
  invisible: { opacity: 0 },
  panel: {
    alignSelf: 'stretch',
    paddingBottom: 4,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: coachPalette.glassStroke,
    backgroundColor: PANEL_FILL,
    overflow: 'hidden',
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingLeft: 14, paddingRight: 4 },
  closeTarget: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  closeDisc: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  divider: { height: StyleSheet.hairlineWidth, marginLeft: 14, backgroundColor: coachPalette.glassStroke },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 10 },
  text: { flex: 1, gap: 3 },
  digits: { fontVariant: ['tabular-nums'] },
  bookTarget: { minHeight: 44, justifyContent: 'center' },
  book: {
    minWidth: 72,
    minHeight: 36,
    paddingHorizontal: 16,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: coachPalette.accent,
  },
  state: {
    minHeight: 30,
    paddingHorizontal: 10,
    borderRadius: 999,
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.10)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: coachPalette.stroke,
  },
  show: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 6,
    minHeight: 44,
    paddingHorizontal: 14,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: coachPalette.stroke,
    backgroundColor: coachPalette.tile,
  },
});
