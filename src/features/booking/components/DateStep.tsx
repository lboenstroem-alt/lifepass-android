// Step 0: the date (iOS BookingFlowView.dateStep). A month grid on the
// VENUE's calendar, in the account's language, from today on. Tapping a day
// only selects it; Next advances, and the timetable loads on arrival at the
// next step, so it is always fresh. Classes say they show the two weeks from
// the picked day.
import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { LPText, PrimaryButton } from '../../../components/ui';
import { useT } from '../../../i18n';
import { todayServerDay } from '../../../i18n/format';
import { colors, radius } from '../../../theme';
import {
  addMonths,
  dayLabel,
  dayNumber,
  monthBefore,
  monthGrid,
  monthOf,
  monthTitle,
  weekdayHeads,
  type CalendarMonth,
} from '../calendar';

export interface DateStepProps {
  readonly selectedDay: string;
  readonly usesClasses: boolean;
  readonly onSelect: (day: string) => void;
  readonly onNext: () => void;
  /** Today on the venue's calendar (tests pin it). */
  readonly today?: string;
  readonly bottomInset?: number;
}

export default function DateStep({ selectedDay, usesClasses, onSelect, onNext, today, bottomInset = 0 }: DateStepProps) {
  const { t } = useT();
  const floor = today ?? todayServerDay();
  return (
    <ScrollView contentContainerStyle={[styles.content, { paddingBottom: 24 + bottomInset }]}>
      <LPText size={18} weight="bold" align="center" accessibilityRole="header">
        {usesClasses ? t('booking.pick_start_date') : t('booking.select_date')}
      </LPText>
      <VenueCalendar selectedDay={selectedDay} today={floor} onSelect={onSelect} />
      {usesClasses ? (
        <LPText size={12} color={colors.mutedTextStrong} align="center">
          {t('booking.two_weeks_hint')}
        </LPText>
      ) : null}
      <View style={styles.spacer} />
      <PrimaryButton title={t('common.next')} onPress={onNext} tone="action" shape="booking" testID="booking.date.next" />
    </ScrollView>
  );
}

interface VenueCalendarProps {
  readonly selectedDay: string;
  readonly today: string;
  readonly onSelect: (day: string) => void;
}

function VenueCalendar({ selectedDay, today, onSelect }: VenueCalendarProps) {
  const { t, language } = useT();
  const [shown, setShown] = useState<CalendarMonth>(() => monthOf(selectedDay));
  const current = monthOf(today);
  // Never earlier than this month: a booking can't be in the past.
  const canGoBack = monthBefore(current, shown);
  const heads = weekdayHeads(language);

  return (
    <View style={styles.calendar}>
      <View style={styles.header}>
        <LPText size={17} weight="semibold" accessibilityRole="header" style={styles.monthTitle}>
          {monthTitle(shown, language)}
        </LPText>
        <Pressable
          onPress={() => setShown(addMonths(shown, -1))}
          disabled={!canGoBack}
          accessibilityRole="button"
          accessibilityLabel={t('book1.calendar.previous_month')}
          accessibilityState={{ disabled: !canGoBack }}
          hitSlop={8}
          style={styles.arrow}
          testID="booking.calendar.previous"
        >
          <Ionicons name="chevron-back" size={20} color={canGoBack ? colors.actionFill : colors.line2} />
        </Pressable>
        <Pressable
          onPress={() => setShown(addMonths(shown, 1))}
          accessibilityRole="button"
          accessibilityLabel={t('book1.calendar.next_month')}
          hitSlop={8}
          style={styles.arrow}
          testID="booking.calendar.next"
        >
          <Ionicons name="chevron-forward" size={20} color={colors.actionFill} />
        </Pressable>
      </View>
      <View style={styles.week} importantForAccessibility="no-hide-descendants">
        {heads.map((head) => (
          <LPText key={head} size={12} weight="semibold" color={colors.mutedTextStrong} align="center" style={styles.cell}>
            {head}
          </LPText>
        ))}
      </View>
      {monthGrid(shown).map((week, row) => (
        <View key={`${shown.year}-${shown.month}-${row}`} style={styles.week}>
          {week.map((day, column) => {
            if (!day) return <View key={`blank-${column}`} style={styles.cell} />;
            const past = day < today;
            const selected = day === selectedDay;
            const isToday = day === today;
            return (
              <Pressable
                key={day}
                onPress={() => onSelect(day)}
                disabled={past}
                accessibilityRole="button"
                accessibilityLabel={dayLabel(day, language)}
                accessibilityState={{ selected, disabled: past }}
                style={styles.cell}
                testID={`booking.day.${day}`}
              >
                <View style={[styles.day, selected && styles.daySelected]}>
                  <LPText
                    size={17}
                    weight={selected || isToday ? 'semibold' : 'regular'}
                    color={selected ? colors.onAccent : past ? colors.paper4 : isToday ? colors.actionFill : colors.paper}
                    maxScale={1.6}
                  >
                    {dayNumber(day)}
                  </LPText>
                </View>
              </Pressable>
            );
          })}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  content: {
    flexGrow: 1,
    padding: 16,
    gap: 24,
  },
  spacer: {
    flexGrow: 1,
  },
  calendar: {
    gap: 4,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 4,
    paddingBottom: 8,
  },
  monthTitle: {
    flex: 1,
  },
  arrow: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  week: {
    flexDirection: 'row',
  },
  cell: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
  },
  day: {
    minWidth: 40,
    minHeight: 40,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  daySelected: {
    backgroundColor: colors.actionFill,
  },
});
