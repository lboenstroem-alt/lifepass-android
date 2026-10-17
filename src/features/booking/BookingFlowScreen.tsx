/* eslint lifepass/no-literal-copy: "error" */
/**
 * The booking flow (route `BookingFlow`, plan 3.0.2): the Android port of iOS
 * `BookingFlowView` (Views/Booking/BookingFlowView.swift).
 *
 * Date, then the timetable (slots, or Abler classes), then Confirm, moving
 * only with Next and Back: the steps are not swipeable, so selection and
 * consent gating cannot be skipped. The title is "Book {name}". The provider
 * decides the path: `abler` books classes by event from /classes, everyone
 * else slots by time from /availability.
 *
 * Opened with a day (`initialDate`, the class sheet's "See other times"), it
 * starts on that day's timetable, spinner first, and loads it once; Back
 * reaches the date picker. Every other entry point opens on the date picker.
 * A fresh flow always starts solo.
 *
 * The timetable loads on ARRIVAL at step 1 and the disclosure on arrival at
 * step 2 (not on the Next tap), so both are always fresh however the step
 * is reached.
 *
 * Hardware back, the back gesture and the header's back do nothing while a
 * booking or a payment is in flight (`useBusyGuard`): the booking would
 * still land, but with no alert, no reminder and no refresh.
 *
 * LEGACY CALLERS. The first build's venue screen still passes
 * `{ venueId, activityId }`; the activity (with its provider) is then read
 * from the walk-in preview's `slotActivities`, the only list of bookable
 * activities there is.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { bookingProvider, fetchWalkInPreview, isSlotBookable, type BookableActivity } from '../../api/walkInPreview';
import { ErrorState } from '../../components/ui';
import { useT } from '../../i18n';
import { useBusyGuard } from '../../navigation/guards';
import { isLegacyBookingFlowParams, type SharedRouteProps } from '../../navigation/types';
import { venuesStore } from '../../stores/venuesStore';
import { colors } from '../../theme';
import {
  bookingInProgress,
  groupBookable,
  hasSelection,
  loadsInitialDayOnAppear,
  usesClasses as sessionUsesClasses,
  type BookingSessionStore,
  type BookingVenue,
} from './bookingSession';
import BookingHeader from './components/BookingHeader';
import BookingOutcomeHost from './components/BookingOutcomeHost';
import ConfirmStep from './components/ConfirmStep';
import DateStep from './components/DateStep';
import StepsIndicator from './components/StepsIndicator';
import TimetableStep from './components/TimetableStep';
import type { GuestCounts } from './party/GroupPartySection';
import { useBooking, useBookingRefusalSteps, useNewBookingSession } from './useBookingSession';

/** The venue as far as the phone already knows it (the catalogue Home and Explore loaded). */
function knownVenue(venueId: string): BookingVenue | null {
  const { catalog, fetched } = venuesStore.getState();
  const id = venueId.toLowerCase();
  const venue = [...fetched, ...catalog].find((candidate) => candidate.id.toLowerCase() === id);
  return venue ? { id: venue.id, name: venue.name, slug: venue.slug } : null;
}

export default function BookingFlowScreen({ navigation, route }: SharedRouteProps<'BookingFlow'>) {
  const params = route.params;
  const legacyActivityId = isLegacyBookingFlowParams(params) ? params.activityId : null;
  const venueId = params.venueId;
  const routeActivity: BookableActivity | null = isLegacyBookingFlowParams(params)
    ? null
    : {
        id: params.activity.id,
        name: params.activity.name,
        // The walk-in preview's provider string; null (the venue books it
        // itself) is the first-party provider.
        provider: bookingProvider(params.activity.provider ?? 'internal'),
      };
  const initialDate = isLegacyBookingFlowParams(params) ? null : (params.initialDate ?? null);

  const [activity, setActivity] = useState<BookableActivity | null>(routeActivity);
  const [venue, setVenue] = useState<BookingVenue | null>(() => knownVenue(venueId));
  const [resolveFailed, setResolveFailed] = useState(false);

  // A legacy caller's activity, and the venue's name when the catalogue does
  // not have it: one read of the walk-in preview, best effort for the name.
  const resolve = useCallback(() => {
    let live = true;
    if (activity && venue) return () => undefined;
    setResolveFailed(false);
    fetchWalkInPreview(venueId).then(
      (preview) => {
        if (!live) return;
        if (!venue) setVenue({ id: preview.venue.id, name: preview.venue.name, slug: preview.venue.slug });
        if (!activity && legacyActivityId) {
          const found = preview.slotActivities.find(
            (candidate) => candidate.id.toLowerCase() === legacyActivityId.toLowerCase(),
          );
          if (found && isSlotBookable(found.provider)) setActivity(found);
          else setResolveFailed(true);
        }
      },
      () => {
        if (live && !activity) setResolveFailed(true);
      },
    );
    return () => {
      live = false;
    };
    // Resolved once per screen; a retry calls it again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [venueId]);

  useEffect(() => resolve(), [resolve]);

  if (!activity) {
    return (
      <View style={styles.page}>
        <BookingHeader title="" onBack={() => navigation.goBack()} />
        <View style={styles.center}>
          {resolveFailed ? <ErrorState onRetry={resolve} /> : <ActivityIndicator color={colors.actionFill} />}
        </View>
      </View>
    );
  }

  return (
    <BookingFlow
      activity={activity}
      venue={venue}
      venueId={venueId}
      initialDate={initialDate}
      onClose={() => navigation.goBack()}
    />
  );
}

interface BookingFlowProps {
  readonly activity: BookableActivity;
  readonly venue: BookingVenue | null;
  readonly venueId: string;
  readonly initialDate: string | null;
  readonly onClose: () => void;
}

function BookingFlow({ activity, venue, venueId, initialDate, onClose }: BookingFlowProps) {
  const { t } = useT();
  const insets = useSafeAreaInsets();
  const store = useNewBookingSession({ activity, venue, initialDay: initialDate });

  useEffect(() => {
    store.getState().setVenue(venue);
  }, [store, venue]);

  // A fresh flow starts solo: a stale group size (or guest ages) must not
  // silently price this booking for N. Opened on a day: load it, once.
  const loadedInitialDay = useRef(false);
  useEffect(() => {
    const session = store.getState();
    session.setActivity(activity);
    session.resetParty();
    if (loadsInitialDayOnAppear(initialDate, session.currentStep, loadedInitialDay.current)) {
      loadedInitialDay.current = true;
      void session.loadTimetable();
    }
  }, [store, activity, initialDate]);

  // Loading on ARRIVAL at a step keeps it fresh however it is reached.
  const step = useBooking(store, (s) => s.currentStep);
  const previousStep = useRef(step);
  useEffect(() => {
    if (previousStep.current === step) return;
    previousStep.current = step;
    if (step === 1) void store.getState().loadTimetable();
    if (step === 2) void store.getState().loadPreview();
  }, [store, step]);

  const busy = useBooking(store, bookingInProgress);
  useBusyGuard(busy);

  const steps = useBookingRefusalSteps(store);

  return (
    <View style={styles.page} testID="booking.flow">
      <BookingHeader title={t('booking.book_name', { name: activity.name })} onBack={onClose} />
      <StepsIndicator step={step} usesClasses={sessionUsesClasses({ activity })} />
      <View style={styles.flex}>
        {step === 0 ? (
          <DateStepHost store={store} bottomInset={insets.bottom} />
        ) : step === 1 ? (
          <TimetableHost store={store} venueId={venueId} bottomInset={insets.bottom} />
        ) : (
          <ConfirmStep
            store={store}
            activityName={activity.name}
            venueName={venue?.name ?? null}
            offers={steps.offers}
            onStep={steps.take}
            bottomInset={insets.bottom}
          />
        )}
      </View>
      <BookingOutcomeHost store={store} onClose={onClose} offers={steps.offers} onStep={steps.take} />
    </View>
  );
}

function DateStepHost({ store, bottomInset }: { readonly store: BookingSessionStore; readonly bottomInset: number }) {
  const selectedDay = useBooking(store, (s) => s.selectedDay);
  const classes = useBooking(store, sessionUsesClasses);
  return (
    <DateStep
      selectedDay={selectedDay}
      usesClasses={classes}
      onSelect={(day) => store.getState().selectDay(day)}
      onNext={() => store.getState().nextStep()}
      bottomInset={bottomInset}
    />
  );
}

/** Guests by band, from the per-seat list. */
function guestCounts(bands: readonly string[]): GuestCounts {
  const counts: Record<string, number> = {};
  for (const band of bands) counts[band] = (counts[band] ?? 0) + 1;
  return counts;
}

function TimetableHost({
  store,
  venueId,
  bottomInset,
}: {
  readonly store: BookingSessionStore;
  readonly venueId: string;
  readonly bottomInset: number;
}) {
  const activity = useBooking(store, (s) => s.activity);
  const classes = useBooking(store, sessionUsesClasses);
  const isLoading = useBooking(store, (s) => s.isLoading);
  const slots = useBooking(store, (s) => s.availableSlots);
  const classList = useBooking(store, (s) => s.classes);
  const selectedSlotId = useBooking(store, (s) => s.selectedSlot?.id ?? null);
  const selectedEventId = useBooking(store, (s) => s.selectedClass?.eventId ?? null);
  const selection = useBooking(store, hasSelection);
  const group = useBooking(store, groupBookable);
  const guestBands = useBooking(store, (s) => s.guestAgeBands);
  const isBooking = useBooking(store, (s) => s.isBooking);

  return (
    <TimetableStep
      usesClasses={classes}
      activityName={activity?.name ?? ''}
      isLoading={isLoading}
      slots={slots}
      classes={classList}
      selectedSlotId={selectedSlotId}
      selectedEventId={selectedEventId}
      hasSelection={selection}
      onSelectSlot={(slot) => store.getState().selectSlot(slot)}
      onSelectClass={(klass) => store.getState().selectClass(klass)}
      onBack={() => store.getState().previousStep()}
      onNext={() => store.getState().nextStep()}
      party={
        group && activity
          ? {
              venueId,
              activityId: activity.id,
              guests: guestCounts(guestBands),
              // BOOK-2 fills the section; the party size is the member plus
              // every guest it reports.
              onChangeGuests: (guests) => {
                const total = Object.values(guests).reduce((sum, count) => sum + count, 0);
                void store.getState().changeParticipants(1 + total);
              },
              disabled: isBooking,
            }
          : null
      }
      bottomInset={bottomInset}
    />
  );
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
    backgroundColor: colors.ink,
  },
  flex: {
    flex: 1,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
