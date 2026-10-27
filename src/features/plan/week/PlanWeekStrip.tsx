/**
 * The seven days of the programme week holding the selected date (iOS
 * PlanWeekStrip.swift, `ios-ux.md` 3.8), and under it "{done} of {planned}
 * sessions done this week", or, with an extra workout logged that week,
 * "4 workouts this week: 3 of 3 planned + 1 extra" (./weekTotals.ts).
 *
 * It is the only way to look at another day, so it has to survive the
 * narrowest phone: seven columns plus two 36 dp chevrons inside 360 dp leave
 * about 40 dp a column, under the 44 minimum. The columns stay narrow and
 * the TAP TARGET is 64 dp tall, the dimension there is room in.
 *
 * The selected day has a filled background, today a ring. Chevrons and a
 * horizontal swipe move a week, each only where the week allows it; TalkBack
 * reaches the chevrons, since its own swipes move between elements. A paused
 * plan dims the strip. Every cell is one element whose name carries the
 * status as a WORD ("Wed 17 Sept, Full body, done"), never colour alone.
 */
import { Ionicons } from '@expo/vector-icons';
import { useEffect, useMemo, useRef } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';

import { LPText } from '../../../components/ui';
import type { WeekDayCell, WeekView } from '../../../health';
import { FONT_SCALE_CAP } from '../../../hooks/useA11ySize';
import { useT } from '../../../i18n';
import { colors, radius } from '../../../theme';

import StatusMark from './StatusMark';
import { cellAccessibilityLabel, cellStatus, cellWeekday, dayNumber, swipeWeekDelta } from './weekRules';
import { weekStripLine } from './weekTotals';

export type PlanWeekStripProps = {
  week: WeekView;
  selectedDate: string;
  todayDate: string;
  isPaused: boolean;
  onSelect: (date: string) => void;
  /** -1 the previous week, 1 the next. */
  onMoveWeek: (delta: -1 | 1) => void;
  testID?: string;
};

/** The strip's cells have a fixed height; their text stops growing at iOS xxLarge. */
const STRIP_TEXT_CAP = FONT_SCALE_CAP.xxLarge;

export default function PlanWeekStrip({
  week,
  selectedDate,
  todayDate,
  isPaused,
  onSelect,
  onMoveWeek,
  testID = 'plan.week',
}: PlanWeekStripProps) {
  const translator = useT();
  const { t } = translator;
  const days = week.days ?? [];
  const canGoBack = week.canGoBack ?? false;
  const canGoForward = week.canGoForward ?? false;

  // THE GESTURE IS BUILT ONCE. A new Pan on a re-render (the read landing,
  // a toast, the outbox) gets a new handler tag, and GestureDetector drops
  // the one the member is dragging: the swipe is lost and the week does not
  // move. So the swipe reads the week's limits and the handler of the moment.
  const latest = useRef({ canGoBack, canGoForward, onMoveWeek });
  useEffect(() => {
    latest.current = { canGoBack, canGoForward, onMoveWeek };
  }, [canGoBack, canGoForward, onMoveWeek]);
  const swipe = useMemo(
    () =>
      Gesture.Pan()
        .runOnJS(true)
        .activeOffsetX([-24, 24])
        .failOffsetY([-24, 24])
        .onEnd((event) => {
          const now = latest.current;
          const delta = swipeWeekDelta(event.translationX, event.translationY, now.canGoBack, now.canGoForward);
          if (delta !== 0) now.onMoveWeek(delta);
        })
        .withTestId(`${testID}.swipe`),
    [testID],
  );

  return (
    <View style={styles.wrap} testID={testID}>
      <GestureDetector gesture={swipe}>
        <View style={[styles.row, isPaused && styles.paused]} testID={`${testID}.row`}>
          <Chevron
            icon="chevron-back"
            label={t('a11y.prev_week')}
            enabled={canGoBack}
            onPress={() => onMoveWeek(-1)}
            testID={`${testID}.prev`}
          />
          <View style={styles.days}>
            {days.map((cell) => (
              <DayColumn
                key={cell.date}
                cell={cell}
                isSelected={cell.date === selectedDate}
                isToday={cell.date === todayDate}
                onSelect={onSelect}
                testID={`${testID}.day.${cell.date}`}
              />
            ))}
          </View>
          <Chevron
            icon="chevron-forward"
            label={t('a11y.next_week')}
            enabled={canGoForward}
            onPress={() => onMoveWeek(1)}
            testID={`${testID}.next`}
          />
        </View>
      </GestureDetector>
      <LPText size={12} color={colors.paper2} style={styles.progress} testID={`${testID}.progress`}>
        {weekStripLine(week, translator)}
      </LPText>
    </View>
  );
}

function Chevron({
  icon,
  label,
  enabled,
  onPress,
  testID,
}: {
  icon: 'chevron-back' | 'chevron-forward';
  label: string;
  enabled: boolean;
  onPress: () => void;
  testID: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={!enabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !enabled }}
      hitSlop={{ top: 10, bottom: 10 }}
      style={({ pressed }) => [styles.chevron, pressed && enabled && styles.pressed]}
      testID={testID}
    >
      <Ionicons name={icon} size={14} color={enabled ? colors.paper2 : colors.paper4} />
    </Pressable>
  );
}

function DayColumn({
  cell,
  isSelected,
  isToday,
  onSelect,
  testID,
}: {
  cell: WeekDayCell;
  isSelected: boolean;
  isToday: boolean;
  onSelect: (date: string) => void;
  testID: string;
}) {
  const { t, language } = useT();
  const status = cellStatus(cell);
  return (
    <Pressable
      onPress={() => onSelect(cell.date)}
      accessibilityRole="button"
      accessibilityLabel={cellAccessibilityLabel(cell, language, t)}
      accessibilityState={{ selected: isSelected }}
      style={({ pressed }) => [
        styles.column,
        isSelected && styles.selected,
        isToday && styles.today,
        pressed && styles.pressed,
      ]}
      testID={testID}
    >
      <LPText size={11} color={colors.paper2} maxScale={STRIP_TEXT_CAP} numberOfLines={1}>
        {cellWeekday(cell, language)}
      </LPText>
      <LPText size={15} weight="semibold" color={colors.paper} maxScale={STRIP_TEXT_CAP} numberOfLines={1}>
        {dayNumber(cell.date)}
      </LPText>
      <StatusMark status={status} testID={`${testID}.mark.${status}`} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: 20, paddingTop: 12, gap: 8 },
  row: { flexDirection: 'row', alignItems: 'center' },
  paused: { opacity: 0.5 },
  days: { flex: 1, flexDirection: 'row' },
  chevron: { width: 36, height: 44, alignItems: 'center', justifyContent: 'center' },
  column: {
    flex: 1,
    height: 64,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    borderRadius: radius.field,
    borderWidth: 1.5,
    borderColor: 'transparent',
  },
  selected: { backgroundColor: colors.rust3 },
  today: { borderColor: colors.rust },
  progress: { paddingHorizontal: 4 },
  pressed: { opacity: 0.7 },
});
