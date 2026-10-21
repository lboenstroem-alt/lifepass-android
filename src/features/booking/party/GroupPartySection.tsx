/**
 * The group party on the timetable step (plan 3.0.3 slot, filled by BOOK-2;
 * mounted by BOOK-1's TimetableStep for a Bókun slot activity only): the
 * Android port of iOS BookingFlowView's `groupStepper` and `guestAgePicker`.
 *
 * - "Number of people", minus and plus, from 1 to 10. Minus is off at 1 and
 *   plus at 10 (drawn faded there), both while a booking is in flight. A
 *   change re-reads the timetable for the whole party and re-prices a kept
 *   time (the session's `changeGuests`).
 * - "Guest ages" when the venue sells more than one band and someone else is
 *   coming: one row per GUEST, "Person 2" on (the member is person 1 and
 *   always an adult, so never in the list), each with a menu of the venue's
 *   bands with its own ranges ("Child (6-15)"), and the note "You are
 *   counted as an adult...". A guest starts as an adult.
 *
 * Controlled by the booking screen. `onChangeGuests` (guests by band) is the
 * contract; when the screen also passes `guestBands` and `onChangeGuestBand`
 * (BOOK-1's mount does), the rows are the session's own seats and a menu
 * changes exactly that seat, as iOS `changeGuestAgeBand(at:to:)` does.
 *
 * ANDROID LAYOUT. The section sits above the timetable, the step's flexible
 * part, so nine guest rows at a large font size would push the times (and
 * Back and Next) off the screen. The section takes at most half of the
 * step's own height (a percentage of the space the step really has, not of
 * the window) and gives way in the guest rows, which then scroll inside the
 * card; the stepper and the note stay in view.
 *
 * TOUCH. The minus and plus circles are 32 dp, as iOS draws them, inside
 * 48 dp touch targets (their real bounds, not a hit slop, so Play's
 * Accessibility Scanner measures 48); the age menus likewise wrap a 36 dp
 * pill in a 48 dp target.
 *
 * TALKBACK. The count is one adjustable element ("Number of people, 3"): a
 * swipe up or down is one step, the same as the buttons. The buttons carry
 * words of their own (iOS draws bare symbols). Each age menu says whose it
 * is ("Person 2") and its current band.
 */
import { Ionicons } from '@expo/vector-icons';
import { Pressable, ScrollView, StyleSheet, View, type AccessibilityActionEvent } from 'react-native';

import type { AgeBandOffer } from '../../../api/bookings';
import { LPText, MenuPicker } from '../../../components/ui';
import { hiddenFromAccessibility } from '../../../components/ui/a11y';
import { useT } from '../../../i18n';
import { colors, radius } from '../../../theme';
import {
  bandOptionLabel,
  bandsFromCounts,
  countsFromBands,
  MAX_PARTY,
  MIN_PARTY,
  partySize,
  selectedBandLabel,
  showsGuestAges,
  steppedBands,
  type GuestCounts,
} from './partyModel';

export type { GuestCounts } from './partyModel';

export interface GroupPartySectionProps {
  readonly venueId: string;
  readonly activityId: string;
  readonly guests: GuestCounts;
  readonly onChangeGuests: (guests: GuestCounts) => void;
  /** A booking is in flight: nothing changes. */
  readonly disabled?: boolean;
  /**
   * The bands this venue sells, in its order, from the availability answer
   * (empty: adults only, no picker; iOS `offeredAgeBands`).
   */
  readonly ageBands?: readonly AgeBandOffer[];
  /** One band per GUEST seat, in order; index 0 is the second person (iOS `guestAgeBands`). */
  readonly guestBands?: readonly string[];
  /** One seat's band changed (iOS `changeGuestAgeBand(at:to:)`). */
  readonly onChangeGuestBand?: (index: number, band: string) => void;
}

/** One empty list, so a caller with no bands gets the same value every render. */
const NO_BANDS: readonly AgeBandOffer[] = Object.freeze([]);

export default function GroupPartySection({
  guests,
  onChangeGuests,
  disabled = false,
  ageBands = NO_BANDS,
  guestBands,
  onChangeGuestBand,
}: GroupPartySectionProps) {
  const { t, language } = useT();

  // The session's own seats when the screen passes them; else the counts,
  // in the venue's band order.
  const seats = guestBands ?? bandsFromCounts(guests, ageBands.map((offer) => offer.band));
  const participants = partySize(seats);
  const canFewer = !disabled && participants > MIN_PARTY;
  const canMore = !disabled && participants < MAX_PARTY;

  const step = (direction: 1 | -1) => {
    if (disabled) return;
    const next = steppedBands(seats, direction);
    if (next) onChangeGuests(countsFromBands(next));
  };

  const changeBand = (index: number, band: string) => {
    if (disabled || seats[index] === band) return;
    if (onChangeGuestBand) {
      onChangeGuestBand(index, band);
      return;
    }
    const next = [...seats];
    next[index] = band;
    onChangeGuests(countsFromBands(next));
  };

  const onAdjust = (event: AccessibilityActionEvent) => {
    if (event.nativeEvent.actionName === 'increment') step(1);
    if (event.nativeEvent.actionName === 'decrement') step(-1);
  };

  // Only the bands the venue sells, as iOS lists them. A seat whose band is
  // not among them (a guest who starts as an adult where only child and
  // infant tickets are sold) shows its band on the trigger alone.
  const options = ageBands.map((offer) => ({
    value: offer.band,
    label: bandOptionLabel(offer.band, offer.rangeLabel, language),
    testID: `booking.party.band.${offer.band}`,
  }));
  const offered = new Set(ageBands.map((offer) => offer.band));

  return (
    <View style={styles.section} testID="booking.party">
      <View style={styles.card}>
        <View
          accessible
          accessibilityRole="adjustable"
          accessibilityLabel={t('booking.group_label')}
          accessibilityValue={{ min: MIN_PARTY, max: MAX_PARTY, now: participants, text: `${participants}` }}
          accessibilityState={{ disabled }}
          accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
          onAccessibilityAction={onAdjust}
          style={styles.stepperLabel}
          testID="booking.party.size"
        >
          <LPText size={14} weight="medium" style={styles.flex}>
            {t('booking.group_label')}
          </LPText>
        </View>
        <View style={styles.stepper}>
          <RoundButton
            icon="remove"
            label={t('book2.party.fewer')}
            enabled={canFewer}
            atBound={participants <= MIN_PARTY}
            onPress={() => step(-1)}
            testID="booking.party.fewer"
          />
          <LPText
            size={16}
            weight="semibold"
            align="center"
            style={styles.count}
            {...hiddenFromAccessibility}
            testID="booking.party.count"
          >
            {`${participants}`}
          </LPText>
          <RoundButton
            icon="add"
            label={t('book2.party.more')}
            enabled={canMore}
            atBound={participants >= MAX_PARTY}
            onPress={() => step(1)}
            testID="booking.party.more"
          />
        </View>
      </View>

      {showsGuestAges(ageBands, seats) ? (
        <View style={[styles.card, styles.ages]} testID="booking.party.ages">
          <LPText size={14} weight="medium">
            {t('booking.guest_ages_label')}
          </LPText>
          <ScrollView
            style={styles.rowsScroll}
            nestedScrollEnabled
            bounces={false}
          >
            {seats.map((band, index) => {
              // +2: index 0 is the SECOND person in the party.
              const person = t('booking.guest_ordinal', { n: `${index + 2}` });
              const bandLabel = selectedBandLabel(band, ageBands, language);
              return (
                <View key={index} style={styles.row} testID={`booking.party.guest.${index + 2}`}>
                  <LPText size={14} color={colors.mutedTextStrong} style={styles.flex} {...hiddenFromAccessibility}>
                    {person}
                  </LPText>
                  <MenuPicker
                    // MenuPicker says the current option as the trigger's
                    // value; a band the venue does not list is no option, so
                    // the label names it instead (contract request to F5: an
                    // optional value label for a value outside the options).
                    label={offered.has(band) ? person : `${person}, ${bandLabel}`}
                    value={band}
                    options={options}
                    onChange={(next) => changeBand(index, next)}
                    disabled={disabled}
                    style={styles.menuTarget}
                    renderTrigger={() => (
                      <View style={styles.menu}>
                        <LPText size={14} weight="medium" numberOfLines={1} style={styles.menuText}>
                          {bandLabel}
                        </LPText>
                        <Ionicons name="chevron-expand" size={10} color={colors.paper} />
                      </View>
                    )}
                    testID={`booking.party.guest.${index + 2}.band`}
                  />
                </View>
              );
            })}
          </ScrollView>
          <LPText size={12} color={colors.mutedTextStrong}>
            {t('booking.guest_ages_note')}
          </LPText>
        </View>
      ) : null}
    </View>
  );
}

function RoundButton({
  icon,
  label,
  enabled,
  atBound,
  onPress,
  testID,
}: {
  readonly icon: 'add' | 'remove';
  readonly label: string;
  readonly enabled: boolean;
  /** Faded only at the bound (as iOS); a booking in flight just refuses the tap. */
  readonly atBound: boolean;
  readonly onPress: () => void;
  readonly testID: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={!enabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !enabled }}
      // A 32 dp circle, as iOS draws it, in Android's 48 dp to touch.
      style={({ pressed }) => [styles.roundTarget, atBound && styles.faded, pressed && styles.pressed]}
      testID={testID}
    >
      <View style={styles.round} testID={`${testID}.circle`}>
        <Ionicons name={icon} size={13} color={colors.paper} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  section: {
    gap: 16,
    // Half of the step at most, giving way before the times and the buttons
    // do (see ANDROID LAYOUT above).
    maxHeight: '50%',
    flexShrink: 1,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderRadius: radius.field,
    backgroundColor: colors.ink2,
  },
  stepperLabel: {
    flex: 1,
    flexDirection: 'row',
  },
  flex: {
    flex: 1,
  },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    // iOS spaces the circles 14 apart and 14 from the card's edge; the 8 dp
    // of touch target around each circle is taken out of both, so the card
    // keeps the iOS height and the circles their places.
    gap: 6,
    marginVertical: -8,
    marginRight: -8,
  },
  count: {
    minWidth: 22,
  },
  roundTarget: {
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  round: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    // iOS lpMuted, the card's own colour: only the glyph shows.
    backgroundColor: colors.ink2,
  },
  faded: {
    opacity: 0.35,
  },
  pressed: {
    opacity: 0.7,
  },
  ages: {
    flexDirection: 'column',
    alignItems: 'stretch',
    gap: 10,
    flexShrink: 1,
  },
  rowsScroll: {
    flexGrow: 0,
    flexShrink: 1,
    // One row always shows, so the ages can still be scrolled to.
    minHeight: 48,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  menuTarget: {
    // Rows touch: the 48 dp targets leave 12 dp between the pills (iOS
    // spaces its rows 10 apart).
    flexShrink: 1,
    minHeight: 48,
    justifyContent: 'center',
  },
  menu: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 36,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: radius.small,
    backgroundColor: colors.ink,
  },
  menuText: {
    flexShrink: 1,
  },
});
