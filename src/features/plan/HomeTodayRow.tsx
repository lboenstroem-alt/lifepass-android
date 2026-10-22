/**
 * One row on Home: what today's plan asks for, and a way into it (iOS
 * `HomeTodayRow`, Views/Home/HomeTodayRow.swift; plan 3.0.3: filled by
 * PLAN-2, mounted by HOME-1 directly under the hero).
 *
 * WHY A ROW AND NOT A CARD. Plan already owns today's workout with all of
 * its states; a second copy here would be two state machines to keep in step
 * and two screens that can disagree while one of them is mid-request. So the
 * row has no action of its own except Start, which hands off to Plan at once
 * (Home parks Plan's `startWorkout` and switches tabs; Plan opens the
 * runner). It renders from the `health` block of `GET /profile`, which Home
 * already loads, so it costs no extra read, and what it says is
 * `homeTodayRowState` (./today/homeTodayRowState.ts). With nothing to say it
 * renders nothing at all, and draws no spacing of its own.
 *
 * TalkBack reads the row as ONE element, "Today · week 2 of 4. Full body
 * strength, 40 min", with the hint "Opens Plan"; Start is its own button
 * and names the session it starts.
 */
import { Ionicons } from '@expo/vector-icons';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { Pressable, StyleSheet, View } from 'react-native';

import { hiddenFromAccessibility, Kicker, LPText } from '../../components/ui';
import { useHealthStore } from '../../health';
import { useT } from '../../i18n';
import { track } from '../../lib/analytics';
import { selectHasHealthConsent, useAppStore } from '../../stores/appStore';
import { colors, hairline, radius } from '../../theme';
import { selectHasPendingWorkout, useWorkoutOutbox } from '../runner';

import { sessionKindIcon } from './shell/sessionKindIcon';
import { homeTodayKicker, homeTodayRowState } from './today/homeTodayRowState';

export interface HomeTodayRowProps {
  /** The booking Home's upcoming card already shows, so one booking is never announced twice. */
  readonly upcomingBookingId: string | null;
  readonly onOpenPlan: () => void;
  /** Start today's session (its id). */
  readonly onStart: (sessionId: string) => void;
}

/**
 * iOS draws the row 68 pt tall (here its minimum, so large text grows it
 * rather than clipping), and the one-line title shrinks to 0.82 before it
 * would ellipsize: "Full body strength, 40 min" beside Start is exactly the
 * width of a small phone. Android honours the shrink; the floor is iOS-only
 * in React Native, so it is passed for parity and ignored there.
 */
const ROW_HEIGHT = 68;
const TITLE_MIN_SCALE = 0.82;

export default function HomeTodayRow({ upcomingBookingId, onOpenPlan, onStart }: HomeTodayRowProps) {
  const { t, language } = useT();
  const access = useAppStore((s) => s.healthAccess);
  const hasConsent = useAppStore(selectHasHealthConsent);
  const program = useAppStore((s) => s.profile?.health?.program ?? null);
  const localTodaySession = useHealthStore((s) => s.today?.day?.session ?? null);
  const sessionId = program?.today?.sessionId ?? null;
  const pending = useWorkoutOutbox(selectHasPendingWorkout(sessionId));

  const state = homeTodayRowState({
    access,
    hasConsent,
    program,
    outboxPending: (id) => pending && id === sessionId,
    localTodaySession,
    upcomingBookingId,
    t,
    language,
  });
  if (state.kind === 'hidden') return null;

  const kicker = homeTodayKicker(program, t);
  const { title, glyph, isDone, analyticsKind, startSessionId } = state;

  return (
    <Pressable
      onPress={() => {
        track('home_today_tapped', { kind: analyticsKind, action: 'open' });
        onOpenPlan();
      }}
      accessibilityRole="button"
      accessibilityLabel={`${kicker}. ${title}`}
      accessibilityHint={t('a11y.opens_plan')}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
      testID="home.todayRow"
    >
      <View style={[styles.tile, isDone && styles.tileDone]} {...hiddenFromAccessibility} testID="home.todayRow.tile">
        {isDone ? (
          <Ionicons name="checkmark" size={17} color={colors.rust} />
        ) : (
          <MaterialCommunityIcons name={sessionKindIcon(glyph)} size={17} color={colors.paper2} />
        )}
      </View>

      <View style={styles.texts} {...hiddenFromAccessibility}>
        <Kicker text={kicker} color={colors.paper3} numberOfLines={1} />
        <LPText
          size={15}
          weight="semibold"
          color={colors.paper}
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={TITLE_MIN_SCALE}
          testID="home.todayRow.title"
        >
          {title}
        </LPText>
      </View>

      {startSessionId ? (
        <Pressable
          onPress={() => {
            track('home_today_tapped', { kind: analyticsKind, action: 'start' });
            onStart(startSessionId);
          }}
          accessibilityRole="button"
          accessibilityLabel={t('a11y.start_session', { title })}
          hitSlop={4}
          style={({ pressed }) => [styles.start, pressed && styles.pressed]}
          testID="home.todayRow.start"
        >
          <LPText size={13} weight="semibold" color={colors.onAccent} numberOfLines={1}>
            {t('home.today.start')}
          </LPText>
        </Pressable>
      ) : (
        <View {...hiddenFromAccessibility}>
          <Ionicons name="chevron-forward" size={13} color={colors.paper3} />
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    minHeight: ROW_HEIGHT,
    backgroundColor: colors.ink2,
    borderWidth: hairline,
    borderColor: colors.line,
    borderRadius: radius.card,
  },
  tile: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: colors.ink3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tileDone: { backgroundColor: colors.rust3 },
  texts: { flex: 1, gap: 3, marginRight: 8 },
  start: {
    height: 40,
    paddingHorizontal: 16,
    borderRadius: 999,
    backgroundColor: colors.rust,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: { opacity: 0.75 },
});
