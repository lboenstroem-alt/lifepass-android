// A month calendar on the venue's calendar (Reykjavík = UTC), for the full
// schedule sheet: the Android stand-in for iOS's graphical `DatePicker` with
// `.environment(\.timeZone, venueTimeZone)` and an `in:` range.
//
// Days are `YYYY-MM-DD` strings, so the phone's own zone never moves one.
// Weeks start on Monday (Iceland and the UK). Days outside the range are
// drawn faint and cannot be chosen; the month arrows stop at the range's
// months. TalkBack reads each day spelled out, with its selected state.
import { Ionicons } from '@expo/vector-icons';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { LPText } from '../../../components/ui';
import { useT } from '../../../i18n';
import { calendarWords, formatDatePattern } from '../../../i18n/format';
import { colors, radius } from '../../../theme';
import type { DayRange } from '../feed/days';
import { monthGrid, monthIndex, monthOf, shiftMonth, type Month } from './calendarMonth';
import { dayHeader } from './labels';

export interface DayCalendarProps {
  /** The chosen day. */
  readonly value: string;
  readonly range: DayRange;
  /** Today, marked in the accent colour. */
  readonly today: string;
  readonly onChange: (dayIso: string) => void;
}

export default function DayCalendar({ value, range, today, onChange }: DayCalendarProps) {
  const { t, language } = useT();
  const [visible, setVisible] = useState<Month>(() => monthOf(value));
  const cells = useMemo(() => monthGrid(visible), [visible]);
  const canGoBack = monthIndex(visible) > monthIndex(monthOf(range.first));
  const canGoForward = monthIndex(visible) < monthIndex(monthOf(range.last));
  const title = formatDatePattern(new Date(Date.UTC(visible.year, visible.month, 1)), 'MMMM y', language);
  // Monday first: the symbols start on Sunday.
  const shortDays = calendarWords(language).weekdaysShort;
  const weekdays = [...shortDays.slice(1), shortDays[0]!].map((word) => word.replace('.', '').toUpperCase());

  const rows: (string | null)[][] = [];
  for (let index = 0; index < cells.length; index += 7) rows.push(cells.slice(index, index + 7));

  return (
    <View testID="classes.calendar.grid">
      <View style={styles.header}>
        <LPText size={17} weight="semibold" accessibilityRole="header" style={styles.month}>
          {title.charAt(0).toUpperCase() + title.slice(1)}
        </LPText>
        <Pressable
          testID="classes.calendar.prev"
          onPress={() => setVisible((month) => shiftMonth(month, -1))}
          disabled={!canGoBack}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={t('classes.android.prev_month')}
          accessibilityState={{ disabled: !canGoBack }}
          style={styles.arrow}
        >
          <Ionicons name="chevron-back" size={20} color={canGoBack ? colors.accentText : colors.line2} />
        </Pressable>
        <Pressable
          testID="classes.calendar.next"
          onPress={() => setVisible((month) => shiftMonth(month, 1))}
          disabled={!canGoForward}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={t('classes.android.next_month')}
          accessibilityState={{ disabled: !canGoForward }}
          style={styles.arrow}
        >
          <Ionicons name="chevron-forward" size={20} color={canGoForward ? colors.accentText : colors.line2} />
        </Pressable>
      </View>

      <View style={styles.week} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        {weekdays.map((word) => (
          <View key={word} style={styles.cell}>
            <LPText size={11} weight="semibold" color={colors.paper3} maxScale={1.3}>
              {word}
            </LPText>
          </View>
        ))}
      </View>

      {rows.map((row, rowIndex) => (
        <View key={rowIndex} style={styles.week}>
          {row.map((dayIso, column) => {
            if (!dayIso) return <View key={`blank-${rowIndex}-${column}`} style={styles.cell} />;
            const enabled = dayIso >= range.first && dayIso <= range.last;
            const selected = dayIso === value;
            const isToday = dayIso === today;
            const textColor = selected ? colors.onAccent : !enabled ? colors.paper4 : isToday ? colors.accentText : colors.paper;
            return (
              <Pressable
                key={dayIso}
                testID={`classes.calendar.day.${dayIso}`}
                onPress={() => onChange(dayIso)}
                disabled={!enabled}
                accessibilityRole="button"
                accessibilityLabel={dayHeader(dayIso, language)}
                accessibilityState={{ selected, disabled: !enabled }}
                style={styles.cell}
              >
                <View style={[styles.day, selected && styles.daySelected]}>
                  <LPText size={16} weight={selected || isToday ? 'semibold' : 'regular'} color={textColor} maxScale={1.4}>
                    {String(Number(dayIso.slice(8)))}
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
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingBottom: 8, gap: 4 },
  month: { flex: 1 },
  arrow: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  week: { flexDirection: 'row' },
  cell: { flex: 1, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  day: { minWidth: 38, minHeight: 38, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  daySelected: { backgroundColor: colors.rust },
});
