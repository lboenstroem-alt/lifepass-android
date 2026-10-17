// Step 1: the timetable (iOS BookingFlowView.timetableStep). Slots in a
// three-column grid, or Abler classes in a list, read on the venue's clock.
// Not-bookable rows say why honestly ("Registration opens Thu 25 Sep,
// 14:00" in grey, "Full" in red) and can't be picked. Back and Next; Next is
// the readable grey until something is chosen. A Bókun activity shows the
// group party section above (BOOK-2).
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import {
  coachNames,
  isClassBookable,
  type ActivityClass,
  type AvailabilitySlot,
} from '../../../api/bookings';
import { EmptyState, LPText, PrimaryButton } from '../../../components/ui';
import { useT, VenueTimeFormat } from '../../../i18n';
import { colors, radius } from '../../../theme';
import { bookingCopy, isNotOpenReason } from '../bookingCopy';
import GroupPartySection, { type GuestCounts } from '../party/GroupPartySection';
import SecondaryButton from './SecondaryButton';

export interface TimetableStepProps {
  readonly usesClasses: boolean;
  readonly activityName: string;
  readonly isLoading: boolean;
  readonly slots: readonly AvailabilitySlot[];
  readonly classes: readonly ActivityClass[];
  readonly selectedSlotId: string | null;
  readonly selectedEventId: number | null;
  readonly hasSelection: boolean;
  readonly onSelectSlot: (slot: AvailabilitySlot) => void;
  readonly onSelectClass: (klass: ActivityClass) => void;
  readonly onBack: () => void;
  readonly onNext: () => void;
  /** The group party (Bókun slot activities only), drawn by BOOK-2's section. */
  readonly party: {
    readonly venueId: string;
    readonly activityId: string;
    readonly guests: GuestCounts;
    readonly onChangeGuests: (guests: GuestCounts) => void;
    readonly disabled: boolean;
  } | null;
  readonly bottomInset?: number;
}

export default function TimetableStep(props: TimetableStepProps) {
  const { t } = useT();
  const { usesClasses, isLoading, party, bottomInset = 0 } = props;
  return (
    <View style={[styles.container, { paddingBottom: 16 + bottomInset }]}>
      <LPText size={18} weight="bold" align="center" accessibilityRole="header">
        {usesClasses ? t('booking.select_class') : t('booking.select_time')}
      </LPText>
      {party ? (
        <GroupPartySection
          venueId={party.venueId}
          activityId={party.activityId}
          guests={party.guests}
          onChangeGuests={party.onChangeGuests}
          disabled={party.disabled}
        />
      ) : null}
      <View style={styles.body}>
        {isLoading ? (
          <View style={styles.center}>
            <ActivityIndicator color={colors.actionFill} accessibilityLabel={t('a11y.loading')} testID="booking.timetable.loading" />
          </View>
        ) : usesClasses ? (
          <ClassList {...props} />
        ) : (
          <SlotGrid {...props} />
        )}
      </View>
      <View style={styles.buttons}>
        <SecondaryButton title={t('common.back')} onPress={props.onBack} testID="booking.timetable.back" />
        <View style={styles.flex}>
          <PrimaryButton
            title={t('common.next')}
            onPress={props.onNext}
            disabled={!props.hasSelection}
            tone="action"
            shape="booking"
            testID="booking.timetable.next"
          />
        </View>
      </View>
    </View>
  );
}

function SlotGrid({ slots, selectedSlotId, onSelectSlot }: TimetableStepProps) {
  const { t } = useT();
  if (slots.length === 0) {
    return (
      <View style={styles.center}>
        <EmptyState icon="time-outline" message={t('booking.no_slots')} testID="booking.slots.empty" />
      </View>
    );
  }
  return (
    <ScrollView contentContainerStyle={styles.grid}>
      {slots.map((slot) => {
        const selected = slot.id === selectedSlotId;
        const time = VenueTimeFormat.time(slot.startTime);
        // Provider extras (class title, instructor), when present.
        const extras = [slot.title, slot.instructor].filter((part): part is string => !!part).join(' · ');
        const spots = slot.remainingCapacity != null ? t('usage.x_left', { count: `${slot.remainingCapacity}` }) : null;
        return (
          <Pressable
            key={slot.id}
            onPress={() => onSelectSlot(slot)}
            disabled={!slot.isAvailable}
            accessibilityRole="button"
            accessibilityLabel={[time, extras, spots].filter(Boolean).join(', ')}
            accessibilityState={{ selected, disabled: !slot.isAvailable }}
            style={[styles.tile, selected && styles.tileSelected, !slot.isAvailable && styles.dimmed]}
            testID={`booking.slot.${time}`}
          >
            <LPText size={14} weight="semibold" color={colors.paper}>
              {time}
            </LPText>
            {extras ? (
              <LPText size={10} weight="medium" color={colors.mutedTextStrong} numberOfLines={1}>
                {extras}
              </LPText>
            ) : null}
            {spots ? (
              <LPText size={10} color={colors.mutedTextStrong}>
                {spots}
              </LPText>
            ) : null}
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

function ClassList({ classes, selectedEventId, onSelectClass, activityName }: TimetableStepProps) {
  const { t, language } = useT();
  if (classes.length === 0) {
    return (
      <View style={styles.center}>
        <EmptyState icon="calendar-outline" message={t('booking.no_classes')} testID="booking.classes.empty" />
      </View>
    );
  }
  const copy = bookingCopy(language);
  return (
    <ScrollView contentContainerStyle={styles.list}>
      {classes.map((klass) => {
        const selected = klass.eventId === selectedEventId;
        const bookable = isClassBookable(klass);
        const name = klass.name ?? activityName;
        const when = VenueTimeFormat.weekdayTime(klass.start, language);
        const coaches = coachNames(klass);
        const spots =
          klass.attendance.limit > 0
            ? t('booking.spots_left', { count: `${Math.max(klass.attendance.limit - klass.attendance.current, 0)}` })
            : null;
        const notBookable = bookable ? null : copy.notBookableLabel(klass);
        // "Registration hasn't opened" is a neutral state, not an error:
        // muted, while full or unavailable stay red.
        const notOpen = isNotOpenReason(klass.canBookReason);
        return (
          <Pressable
            key={klass.eventId}
            onPress={() => onSelectClass(klass)}
            disabled={!bookable}
            accessibilityRole="button"
            accessibilityLabel={[name, when, coaches, spots, notBookable].filter(Boolean).join(', ')}
            accessibilityState={{ selected, disabled: !bookable }}
            style={[styles.row, selected && styles.tileSelected, !bookable && styles.half]}
            testID={`booking.class.${klass.eventId}`}
          >
            <View style={styles.rowTop}>
              <LPText size={14} weight="semibold" style={styles.flex}>
                {name}
              </LPText>
              <LPText size={12} weight="medium" color={colors.mutedTextStrong}>
                {when}
              </LPText>
            </View>
            {coaches ? (
              <LPText size={11} color={colors.mutedTextStrong}>
                {coaches}
              </LPText>
            ) : null}
            {spots || notBookable ? (
              <View style={styles.rowMeta}>
                {spots ? (
                  <LPText size={11} color={colors.mutedTextStrong}>
                    {spots}
                  </LPText>
                ) : null}
                {notBookable ? (
                  <LPText size={10} weight="semibold" color={notOpen ? colors.mutedTextStrong : colors.destructive}>
                    {notBookable}
                  </LPText>
                ) : null}
              </View>
            ) : null}
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 16,
    gap: 16,
  },
  body: {
    flex: 1,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttons: {
    flexDirection: 'row',
    gap: 12,
  },
  flex: {
    flex: 1,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  tile: {
    // Three columns, two 10 dp gaps.
    width: '31%',
    flexGrow: 1,
    maxWidth: '33%',
    alignItems: 'center',
    gap: 3,
    paddingVertical: 12,
    paddingHorizontal: 4,
    borderRadius: 10,
    backgroundColor: colors.ink2,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  tileSelected: {
    backgroundColor: colors.rust3,
    borderColor: colors.actionFill,
  },
  dimmed: {
    opacity: 0.4,
  },
  half: {
    opacity: 0.5,
  },
  list: {
    gap: 10,
  },
  row: {
    gap: 4,
    padding: 14,
    borderRadius: radius.field,
    backgroundColor: colors.ink2,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  rowTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  rowMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
});
