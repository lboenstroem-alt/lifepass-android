/* eslint lifepass/no-literal-copy: "error" */
/**
 * "You're booked in": a same-day booked class at this venue (iOS
 * `CheckInView.attendChoiceSheet`). Marking it present is FREE, never the
 * walk-in fee; the regular visit runs the normal (perhaps charged) walk-in
 * and leaves the booking for a later scan.
 *
 * THE PROMINENCE FOLLOWS THE CLASS'S WINDOW (web parity): within 30 minutes
 * either side, "Mark me as present" leads, with the regular visit as a small
 * link shown only when a walk-in is possible at all; a class LATER today
 * keeps the regular visit first, so a morning open-gym scan is not steered
 * into using tonight's class booking. At a venue where walk-ins are blocked,
 * attendance is the only action.
 */
import { useRef } from 'react';
import { StyleSheet, View, type Text } from 'react-native';

import { LPText, Sheet } from '../../../../components/ui';
import { useT, VenueTimeFormat } from '../../../../i18n';
import { colors } from '../../../../theme';
import type { AttendableBooking } from '../../../../api/walkInPreview';
import { useWalkIn, walkInActions } from '../useWalkIn';

import { LinkButton, SolidButton } from './buttons';

/** "Spinning · 18:00" on the venue's clock, or "Your class · 18:00" when unnamed. */
export function attendClassLine(booking: AttendableBooking, t: (key: string, params?: Record<string, string>) => string): string {
  const time = VenueTimeFormat.time(booking.startsAt);
  const name = booking.activityName;
  return name ? `${name} · ${time}` : t('checkin.attend.unnamed_class', { time });
}

export default function AttendChoiceSheet() {
  const { t } = useT();
  const visible = useWalkIn((s) => s.showAttendChoice);
  const booking = useWalkIn((s) => s.attendableBooking);
  const walkInAvailable = useWalkIn((s) => s.preview?.allowed === true);
  const titleRef = useRef<Text>(null);
  const withinWindow = booking?.withinWindow ?? true;
  const attend = () => void walkInActions().attendBookedClass();
  const walkIn = () => void walkInActions().walkInInsteadOfClass();

  return (
    <Sheet
      visible={visible}
      onClose={() => walkInActions().dismissAttendChoice()}
      initialFocusRef={titleRef}
      testID="walkin.attend"
    >
      <View style={styles.body}>
        <LPText size={12} weight="semibold" tracking={0.6} color={colors.mutedTextStrong}>
          {t('checkin.attend.eyebrow').toUpperCase()}
        </LPText>
        <LPText ref={titleRef} serif size={24} color={colors.paper} accessibilityRole="header">
          {booking ? attendClassLine(booking, t) : ''}
        </LPText>
        <LPText size={14} color={colors.mutedTextStrong}>
          {t(withinWindow ? 'checkin.attend.free_note' : 'checkin.attend.later_note')}
        </LPText>
        <View style={styles.actions}>
          {withinWindow || !walkInAvailable ? (
            <>
              <SolidButton title={t('checkin.attend.cta')} onPress={attend} testID="walkin.attend.present" />
              {walkInAvailable ? (
                <LinkButton title={t('checkin.attend.walk_in_instead')} onPress={walkIn} testID="walkin.attend.walkIn" />
              ) : null}
            </>
          ) : (
            <>
              <SolidButton title={t('checkin.attend.walk_in_primary')} onPress={walkIn} testID="walkin.attend.walkIn" />
              <LinkButton title={t('checkin.attend.attend_secondary')} onPress={attend} testID="walkin.attend.present" />
            </>
          )}
        </View>
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  body: { gap: 14, paddingTop: 10 },
  actions: { gap: 4, paddingTop: 6 },
});
