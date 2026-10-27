// Step 1: the timetable (iOS BookingFlowView.timetableStep). Slots in a
// three-column grid, or Abler classes in a list, read on the venue's clock.
// A class shows its room ("Salur 4", API 0.44.0) on a line of its own, alone:
// this is the venue's own timetable, so the row carries no venue name to put
// it after (src/copy/classRoom.ts).
// Not-bookable rows say why honestly ("Registration opens Thu 25 Sep,
// 14:00" in grey, "Full" in red) and can't be picked. Back and Next; Next is
// the readable grey until something is chosen. A Bókun activity shows the
// group party section above (BOOK-2).
//
// ONE SCROLL. The title, the party section (its steppers and age pickers
// grow tall at large text) and the slots or classes scroll together, and
// Back and Next are pinned below them (./BookingStepFooter.tsx). Before,
// only the list scrolled: at the largest font size on a small phone the party
// section alone could fill the screen and push Back and Next off its bottom.
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
import GroupPartySection, { type GroupPartySectionProps } from '../party/GroupPartySection';
import BookingStepFooter from './BookingStepFooter';

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
  /** The group party (Bókun slot activities only), drawn by BOOK-2's section with every prop it takes. */
  readonly party: GroupPartySectionProps | null;
  readonly bottomInset?: number;
}

export default function TimetableStep(props: TimetableStepProps) {
  const { t } = useT();
  const { usesClasses, isLoading, party, bottomInset = 0 } = props;
  return (
    <View style={styles.container} testID="booking.timetable.step">
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content} testID="booking.timetable.scroll">
        <LPText size={18} weight="bold" align="center" accessibilityRole="header">
          {usesClasses ? t('booking.select_class') : t('booking.select_time')}
        </LPText>
        {party ? <GroupPartySection {...party} /> : null}
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
      </ScrollView>
      <BookingStepFooter
        back={{ title: t('common.back'), onPress: props.onBack, testID: 'booking.timetable.back' }}
        primary={
          <PrimaryButton
            title={t('common.next')}
            onPress={props.onNext}
            disabled={!props.hasSelection}
            tone="action"
            shape="booking"
            testID="booking.timetable.next"
          />
        }
        bottomInset={bottomInset}
        testID="booking.timetable.footer"
      />
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
    <View style={styles.grid}>
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
    </View>
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
    <View style={styles.list}>
      {classes.map((klass) => {
        const selected = klass.eventId === selectedEventId;
        const bookable = isClassBookable(klass);
        const name = klass.name ?? activityName;
        const when = VenueTimeFormat.weekdayTime(klass.start, language);
        const coaches = coachNames(klass);
        const room = klass.room;
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
            accessibilityLabel={[name, when, coaches, room, spots, notBookable].filter(Boolean).join(', ')}
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
            {room ? (
              <LPText size={11} color={colors.mutedTextStrong} testID={`booking.class.${klass.eventId}.room`}>
                {room}
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
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scroll: {
    flex: 1,
  },
  // Grows to the visible height, so the spinner and the empty state sit in
  // the middle of what is left under the title and the party section.
  content: {
    flexGrow: 1,
    padding: 16,
    gap: 16,
  },
  body: {
    flexGrow: 1,
  },
  center: {
    flexGrow: 1,
    minHeight: 160,
    alignItems: 'center',
    justifyContent: 'center',
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
