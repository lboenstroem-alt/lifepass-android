// The full-schedule sheet behind the calendar circle (iOS ClassesDiscoveryView
// `datePickerSheet`): "Pick a date, full schedule", a month calendar from today
// to the feed's horizon (reaching further when the next-match jump landed
// past it), and Done, which selects the day. Closing it any other way (pan
// down, the backdrop, back) leaves the day as it was.
//
// Done is pinned in the sheet's footer so it never scrolls out of reach at
// large text (iOS sizes the sheet to keep it on screen).
import { useRef, useState } from 'react';
import { StyleSheet, View, type Text } from 'react-native';

import { LPText, PrimaryButton, Sheet } from '../../../components/ui';
import { useT } from '../../../i18n';
import { colors } from '../../../theme';
import type { DayRange } from '../feed/days';
import DayCalendar from './DayCalendar';

export interface DatePickerSheetProps {
  readonly visible: boolean;
  /** The day the calendar opens on: the active selection, else today. */
  readonly initialDay: string;
  readonly range: DayRange;
  readonly today: string;
  readonly onDone: (dayIso: string) => void;
  readonly onClose: () => void;
}

export default function DatePickerSheet({ visible, initialDay, range, today, onDone, onClose }: DatePickerSheetProps) {
  const { t } = useT();
  // Each opening starts from the active selection (iOS sets `pickerDate`
  // before presenting): a pick is forgotten when the sheet closes.
  const [picked, setPicked] = useState<string | null>(null);
  const value = picked ?? initialDay;
  const titleRef = useRef<Text>(null);

  return (
    <Sheet
      visible={visible}
      onClose={() => {
        setPicked(null);
        onClose();
      }}
      initialFocusRef={titleRef}
      testID="classes.date_sheet"
      footer={
        <View style={styles.footer}>
          <PrimaryButton
            testID="classes.date_sheet.done"
            title={t('common.done')}
            shape="booking"
            onPress={() => {
              setPicked(null);
              onDone(value);
            }}
          />
        </View>
      }
    >
      <View style={styles.content}>
        <LPText ref={titleRef} serif size={20} align="center" accessibilityRole="header" style={styles.title}>
          {t('classes.date_pick')}
        </LPText>
        {visible ? <DayCalendar key={initialDay} value={value} range={range} today={today} onChange={setPicked} /> : null}
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 12, paddingBottom: 16, backgroundColor: colors.ink },
  title: { paddingTop: 22, paddingBottom: 16, paddingHorizontal: 8 },
  footer: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 12, backgroundColor: colors.ink },
});
