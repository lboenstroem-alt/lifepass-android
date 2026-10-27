/* eslint lifepass/no-literal-copy: "error" */
/**
 * My bookings' rows: the ports of iOS `UnifiedBookingCard` (Upcoming) and
 * `UnifiedBookingRow` (Past) in Views/Profile/LibraryView.swift.
 *
 * THE ROOM. A class booking with a room shows it after the venue name, "World
 * Class Laugar & Pool · Salur 4" (API 0.44.0), on both rows. It is this read's
 * value (`GET /bookings` follows a class the club moves), never one kept from
 * the confirmation.
 *
 * NEVER A PHOTO. The bookings API carries no venue image, so a booking shows
 * a calendar tile (Upcoming) or a clock tile (Past), never a stock picture
 * standing in for the venue (the first Android build drew random photos).
 *
 * THE STATUS is the raw one: `pending` reads "Pending" in amber (the money
 * or the seat is not settled yet), `checked_in` reads "Checked in" in
 * aurora, anything else "Confirmed". The first build folded pending into
 * Confirmed, so a booking that might still fail read as booked.
 *
 * The cancel button (an X) is drawn only for a booking that can still be
 * cancelled (`isCancellable`), and disabled while any cancel is in flight.
 */
import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, View } from 'react-native';

import { LPText } from '../../../components/ui';
import { venueWithRoom } from '../../../copy/classRoom';
import { useT } from '../../../i18n';
import { bookingActivityName, type MemberBooking } from '../../../api/bookingsList';
import { colors, hairline } from '../../../theme';

import { pastRowDetail, relativeBookingTime } from './bookingTime';

/**
 * Amber for pending, a transient "not settled yet": the brand palette has no
 * amber, so it is defined here, as iOS defines it locally. Deep ochre (iOS
 * `Color(red: 0.70, green: 0.46, blue: 0.10)`) so it stays legible as text
 * on the paper card.
 */
export const PENDING_AMBER = '#B3751A';

/** The status's colour and copy key (iOS `statusColor`, `statusLabel`). */
export function bookingStatusStyle(status: string): { readonly color: string; readonly labelKey: string } {
  switch (status) {
    case 'pending':
      return { color: PENDING_AMBER, labelKey: 'library.pending' };
    case 'checked_in':
      return { color: colors.aurora, labelKey: 'library.checked_in' };
    default:
      return { color: colors.moss, labelKey: 'library.confirmed' };
  }
}

export interface UpcomingBookingCardProps {
  readonly booking: MemberBooking;
  /** Present when the booking can be cancelled: draws the X. */
  readonly onCancel?: () => void;
  /** A cancel is in flight: the X waits for its answer. */
  readonly cancelInFlight?: boolean;
  readonly now?: Date;
}

export function UpcomingBookingCard({ booking, onCancel, cancelInFlight = false, now }: UpcomingBookingCardProps) {
  const { t } = useT();
  const status = bookingStatusStyle(booking.status);
  const when = relativeBookingTime(booking.startsAt, t, now);

  return (
    <View style={styles.card} testID={`library.booking.${booking.id}`}>
      <View style={styles.tile} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <Ionicons name="calendar-outline" size={20} color={colors.paper3} />
      </View>

      <View style={styles.info} accessible>
        {/* A second line for the room, so a long venue name never cuts it off. */}
        <LPText
          size={14}
          weight="semibold"
          color={colors.paper}
          numberOfLines={booking.room ? 2 : 1}
          testID={`library.booking.${booking.id}.venue`}
        >
          {venueWithRoom(booking.venue.name, booking.room)}
        </LPText>
        <LPText size={12} color={colors.paper3} numberOfLines={1}>
          {bookingActivityName(booking) ?? t('library.booking')}
        </LPText>
        <View style={styles.metaRow}>
          <LPText size={12} weight="medium" color={colors.paper2}>
            {when}
          </LPText>
          <View style={styles.metaDot} />
          <View style={styles.statusRow}>
            <View style={[styles.statusDot, { backgroundColor: status.color }]} />
            <LPText size={11} weight="semibold" color={status.color} testID={`library.booking.${booking.id}.status`}>
              {t(status.labelKey)}
            </LPText>
          </View>
        </View>
      </View>

      {onCancel ? (
        <Pressable
          onPress={onCancel}
          disabled={cancelInFlight}
          accessibilityRole="button"
          accessibilityLabel={t('bookings.cancel_title')}
          accessibilityState={{ disabled: cancelInFlight }}
          // A 28 pt circle, as iOS draws it, with room around it to hit.
          hitSlop={10}
          style={({ pressed }) => [styles.cancel, cancelInFlight && styles.disabled, pressed && styles.pressed]}
          testID={`library.booking.${booking.id}.cancel`}
        >
          <Ionicons name="close" size={13} color={colors.paper3} />
        </Pressable>
      ) : null}
    </View>
  );
}

export interface PastBookingRowProps {
  readonly booking: MemberBooking;
  readonly now?: Date;
}

export function PastBookingRow({ booking, now }: PastBookingRowProps) {
  const { t } = useT();
  const detail = pastRowDetail(bookingActivityName(booking) ?? t('library.booking'), relativeBookingTime(booking.startsAt, t, now));
  return (
    <View style={styles.pastRow} testID={`library.past.${booking.id}`}>
      <View style={styles.pastTile} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <Ionicons name="time-outline" size={14} color={colors.paper3} />
      </View>
      <View style={styles.pastInfo} accessible>
        <LPText
          size={13.5}
          weight="medium"
          color={colors.paper2}
          numberOfLines={booking.room ? 2 : 1}
          testID={`library.past_venue.${booking.id}`}
        >
          {venueWithRoom(booking.venue.name, booking.room)}
        </LPText>
        <LPText size={11} color={colors.paper3} numberOfLines={1}>
          {detail}
        </LPText>
      </View>
    </View>
  );
}

/** The hairline between two Past rows. */
export function PastRowDivider() {
  return <View style={styles.divider} />;
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    borderRadius: 14,
    borderWidth: hairline,
    borderColor: colors.line,
    backgroundColor: colors.ink2,
  },
  tile: {
    width: 64,
    height: 64,
    borderRadius: 10,
    backgroundColor: colors.ink3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  info: { flex: 1, gap: 4 },
  metaRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8 },
  metaDot: { width: 3, height: 3, borderRadius: 1.5, backgroundColor: colors.paper4 },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  cancel: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.ink3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: { opacity: 0.7 },
  disabled: { opacity: 0.4 },
  pastRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 },
  pastTile: {
    width: 44,
    height: 44,
    borderRadius: 8,
    backgroundColor: colors.ink3,
    opacity: 0.7,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pastInfo: { flex: 1, gap: 2 },
  divider: { height: hairline, backgroundColor: colors.line, marginHorizontal: 20 },
});
