/**
 * "Change date" for the diary: iOS `MealDatePickerSheet` with
 * `allowsOlderThan30Days: true` (Views/Meals/MealCaptureView.swift): a month
 * calendar from a year ago to today, Cancel, and Done, which opens the day.
 * Closing it any other way (pan down, the backdrop, back) changes nothing.
 *
 * The calendar is the classes feed's month grid (its public `DayCalendar`),
 * on server calendar days, so the phone's own zone never moves a day. Done is
 * pinned in the footer so it never scrolls out of reach at large text.
 */
import { useRef, useState } from 'react';
import { Pressable, StyleSheet, View, type Text } from 'react-native';

import { LPText, PrimaryButton, Sheet } from '../../../components/ui';
import { useT } from '../../../i18n';
import { colors } from '../../../theme';
import { DayCalendar } from '../../classes';

import { clampToToday, pickerRange } from './diaryModel';

export interface DiaryDateSheetProps {
  readonly visible: boolean;
  /** The day on screen. */
  readonly date: string;
  readonly today: string;
  readonly onPick: (date: string) => void;
  readonly onClose: () => void;
}

export default function DiaryDateSheet({ visible, date, today, onPick, onClose }: DiaryDateSheetProps) {
  const { t } = useT();
  // Each opening starts from the day on screen.
  const [picked, setPicked] = useState<string | null>(null);
  const value = picked ?? clampToToday(date, today);
  const titleRef = useRef<Text>(null);

  const close = () => {
    setPicked(null);
    onClose();
  };

  return (
    <Sheet
      visible={visible}
      onClose={close}
      initialFocusRef={titleRef}
      testID="diary.dateSheet"
      footer={
        <View style={styles.footer}>
          <PrimaryButton
            title={t('common.done')}
            onPress={() => {
              setPicked(null);
              onPick(value);
            }}
            testID="diary.dateSheet.done"
          />
        </View>
      }
    >
      <View style={styles.content}>
        <View style={styles.toolbar}>
          <Pressable onPress={close} accessibilityRole="button" hitSlop={8} style={styles.cancel} testID="diary.dateSheet.cancel">
            <LPText size={16} color={colors.accentText}>
              {t('common.cancel')}
            </LPText>
          </Pressable>
          <LPText ref={titleRef} size={16} weight="semibold" accessibilityRole="header" style={styles.title}>
            {t('meal.header.change_date')}
          </LPText>
          <View style={styles.cancel} />
        </View>
        {visible ? <DayCalendar key={date} value={value} range={pickerRange(today)} today={today} onChange={setPicked} /> : null}
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  content: { paddingBottom: 16, gap: 12 },
  toolbar: { flexDirection: 'row', alignItems: 'center', minHeight: 44 },
  cancel: { minWidth: 72, minHeight: 44, justifyContent: 'center' },
  title: { flex: 1, textAlign: 'center' },
  footer: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 12, backgroundColor: colors.ink },
});
