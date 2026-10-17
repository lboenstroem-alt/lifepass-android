// Step 2: confirm (iOS BookingFlowView.confirmStep). The card (Activity,
// Venue, then Class and When for a class, or Date and Time for a slot, all
// on the venue's clock), the charge section, and Back plus Confirm. A gate
// refusal hides Confirm entirely: the launcher blocks at disclosure time
// rather than letting the tap fail again.
import { ScrollView, StyleSheet, View } from 'react-native';

import type { RefusalCta } from '../../../api/refusals';
import { LPText, PrimaryButton } from '../../../components/ui';
import { useT, VenueTimeFormat } from '../../../i18n';
import { colors, radius } from '../../../theme';
import { bookingInProgress, usesClasses as sessionUsesClasses, type BookingSessionStore } from '../bookingSession';
import { useBooking } from '../useBookingSession';
import BookingChargeSection from './BookingChargeSection';
import SecondaryButton from './SecondaryButton';

export interface ConfirmStepProps {
  readonly store: BookingSessionStore;
  readonly activityName: string;
  readonly venueName: string | null;
  readonly offers: (cta: RefusalCta) => boolean;
  readonly onStep: (cta: RefusalCta) => void;
  readonly bottomInset?: number;
}

export default function ConfirmStep({ store, activityName, venueName, offers, onStep, bottomInset = 0 }: ConfirmStepProps) {
  const { t, language } = useT();
  const classes = useBooking(store, sessionUsesClasses);
  const selectedClass = useBooking(store, (s) => s.selectedClass);
  const selectedSlot = useBooking(store, (s) => s.selectedSlot);
  const gateRefusal = useBooking(store, (s) => s.gateRefusal);
  const isBooking = useBooking(store, (s) => s.isBooking);
  // Stepping back would let the selection (and its key) go under an attempt
  // still in flight; it waits, as the system back does (useBusyGuard).
  const busy = useBooking(store, bookingInProgress);

  const rows: { label: string; value: string }[] = [{ label: t('booking.activity'), value: activityName }];
  if (venueName) rows.push({ label: t('booking.venue'), value: venueName });
  if (classes && selectedClass) {
    if (selectedClass.name) rows.push({ label: t('booking.class'), value: selectedClass.name });
    rows.push({ label: t('booking.when'), value: VenueTimeFormat.dayTime(selectedClass.start, language) });
  } else if (!classes && selectedSlot) {
    rows.push({ label: t('booking.date'), value: VenueTimeFormat.date(selectedSlot.startTime, language) });
    rows.push({ label: t('booking.time'), value: VenueTimeFormat.time(selectedSlot.startTime) });
  }

  return (
    <View style={[styles.container, { paddingBottom: 16 + bottomInset }]}>
      <ScrollView contentContainerStyle={styles.content}>
        <LPText size={18} weight="bold" align="center" accessibilityRole="header">
          {t('booking.confirm_title')}
        </LPText>
        <View style={styles.card} testID="booking.confirm.card">
          {rows.map((row) => (
            <View key={row.label} style={styles.row} accessible accessibilityLabel={`${row.label}, ${row.value}`}>
              <LPText size={13} color={colors.mutedTextStrong}>
                {row.label}
              </LPText>
              <LPText size={13} weight="medium" align="right" style={styles.value}>
                {row.value}
              </LPText>
            </View>
          ))}
        </View>
        <BookingChargeSection store={store} offers={offers} onStep={onStep} />
      </ScrollView>
      <View style={styles.buttons}>
        <SecondaryButton
          title={t('common.back')}
          onPress={() => store.getState().previousStep()}
          disabled={busy}
          testID="booking.confirm.back"
        />
        {gateRefusal ? null : (
          <View style={styles.flex}>
            <PrimaryButton
              title={t('booking.confirm_cta')}
              onPress={() => void store.getState().confirmBooking()}
              loading={isBooking}
              tone="action"
              shape="booking"
              testID="booking.confirm"
            />
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 16,
    gap: 16,
  },
  content: {
    gap: 20,
  },
  card: {
    gap: 14,
    padding: 16,
    borderRadius: radius.field,
    backgroundColor: colors.ink2,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  value: {
    flexShrink: 1,
  },
  buttons: {
    flexDirection: 'row',
    gap: 12,
  },
  flex: {
    flex: 1,
  },
});
