import { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Crypto from 'expo-crypto';
import * as WebBrowser from 'expo-web-browser';
import { colors, fonts } from '../../theme';
import { useVenueById, useActivities } from '../../supabase/hooks/useVenues';
import {
  fetchAvailableSlots,
  fetchClasses,
  fetchBookableActivities,
  fetchBookingPreview,
  createBooking,
  createBookingPaymentSession,
  confirmBookingPaymentSession,
  type BookingSlot,
  type ActivityClass,
  type BookingPreview,
  type CreateBookingInput,
} from '../../supabase/services/bookings';
import { PAYMENT_SUCCESS_URL } from '../../supabase/services/payments';
import { ApiError, type ChargeOffer } from '../../api/client';
import { gateRefusalFor } from '../../api/gateRefusal';
import PrimaryButton from '../../components/PrimaryButton';
import Kicker from '../../components/Kicker';
import { scheduleBookingReminders } from '../../services/notifications';
import type { LegacyActivity as Activity, LegacyVenue as Venue } from '../../types/venue';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { HomeStackParamList } from '../../navigation/types';

type Props = NativeStackScreenProps<HomeStackParamList, 'BookingFlow'>;

const STEPS = ['Date', 'Time', 'Confirm'] as const;

// Icelandic króna, e.g. "2.500 kr".
function formatIsk(amount: number): string {
  return `${amount.toLocaleString('is-IS')} kr`;
}

// Charge-disclosure line for the Confirm step, from the booking preview.
function disclosureText(p: BookingPreview): string {
  switch (p.kind) {
    case 'free': {
      let s = 'Included in your plan.';
      if (p.remainingMonthly != null) {
        s += ` ${p.remainingMonthly} visit${p.remainingMonthly === 1 ? '' : 's'} left this month.`;
      }
      if (p.isLastBeforeTopUp) s += ' Last one before top-ups apply.';
      return s;
    }
    case 'pass':
      return 'Covered by your pass.';
    case 'topup':
      return p.priceIsk != null
        ? `Top-up: ${formatIsk(p.priceIsk)}, charged when you confirm.`
        : 'A top-up charge applies.';
    default: // surcharge
      return p.priceIsk != null
        ? `Extra charge: ${formatIsk(p.priceIsk)}, charged when you confirm.`
        : 'An extra charge applies.';
  }
}

// Maps a refunded pay-and-save-card reason to friendly copy (mirrors iOS
// BookingPaymentService.refundBodyKey). card_* → the card couldn't be saved
// (nothing charged); slot-loss → the time went away mid-payment (refunded).
function refundMessage(reason?: string): string {
  switch (reason) {
    case 'card_not_saved':
    case 'card_ref_unresolvable':
      return 'Your card could not be saved, so nothing was charged. Please try again.';
    case 'provider_booking_failed':
    case 'slot_already_booked':
    case 'slot_unavailable':
    case 'booking_payment_slot_lost_refunded':
      return 'That time was taken while paying, so you were refunded in full. Please pick another time.';
    default:
      return 'You were refunded in full.';
  }
}

export default function BookingFlowScreen({ route, navigation }: Props) {
  const insets = useSafeAreaInsets();
  const { venueId, activityId } = route.params;

  const { venue, loading: venueLoading } = useVenueById(venueId);
  const { activities, loading: activitiesLoading } = useActivities(venueId);
  const activity = activities.find((a) => a.id === activityId);

  const [step, setStep] = useState<0 | 1 | 2>(0);
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [selectedSlot, setSelectedSlot] = useState<BookingSlot | null>(null);
  const [slots, setSlots] = useState<BookingSlot[]>([]);
  const [selectedClass, setSelectedClass] = useState<ActivityClass | null>(null);
  const [classes, setClasses] = useState<ActivityClass[]>([]);
  // Abler activities book by class eventId; everyone else by slot window.
  const [usesClasses, setUsesClasses] = useState(false);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [slotsError, setSlotsError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [preview, setPreview] = useState<BookingPreview | null>(null);

  // One idempotency key per booking attempt — reused across the 402
  // charge-consent re-POST so consenting never double-books. Cleared on
  // success and whenever the chosen slot/class changes (a new booking target).
  const idempotencyKey = useRef<string | null>(null);
  useEffect(() => {
    idempotencyKey.current = null;
  }, [selectedSlot?.id, selectedClass?.eventId]);

  // Resolve whether this activity is class-based (Abler) from the walk-in
  // preview's slotActivities — the v1 discovery source for provider. Defaults
  // to slot mode (existing behaviour) when unknown.
  useEffect(() => {
    if (!activityId) return;
    fetchBookableActivities(venueId)
      .then((list) => setUsesClasses(list.find((a) => a.id === activityId)?.usesClasses ?? false))
      .catch(() => setUsesClasses(false));
  }, [venueId, activityId]);

  // Load the Time step on arrival / date change: classes for Abler, slots
  // otherwise. Surfacing the error avoids a silent "nothing available".
  useEffect(() => {
    if (step !== 1 || !activity) return;
    setSlotsLoading(true);
    setSlotsError(null);
    setSelectedSlot(null);
    setSelectedClass(null);
    const onError = (e: unknown, fallback: string) => {
      setSlotsError(e instanceof Error ? e.message : fallback);
      console.warn('[Booking] timetable failed:', e);
    };
    if (usesClasses) {
      // Abler caps the range at 31 days; show the next 14 from the chosen date.
      const end = new Date(selectedDate);
      end.setDate(end.getDate() + 14);
      fetchClasses(activity.id, selectedDate, end)
        .then(setClasses)
        .catch((e) => {
          setClasses([]);
          onError(e, 'Could not load classes.');
        })
        .finally(() => setSlotsLoading(false));
    } else {
      fetchAvailableSlots(activity.id, selectedDate)
        .then(setSlots)
        .catch((e) => {
          setSlots([]);
          onError(e, 'Could not load times.');
        })
        .finally(() => setSlotsLoading(false));
    }
  }, [step, activity, selectedDate, usesClasses]);

  // Disclose the charge on the Confirm step for a chosen slot (best-effort —
  // the 402 gate is still authoritative). Classes book by eventId, no preview.
  useEffect(() => {
    if (step !== 2 || usesClasses || !activity || !selectedSlot) {
      setPreview(null);
      return;
    }
    let cancelled = false;
    fetchBookingPreview(activity.id, selectedSlot.startsAt)
      .then((p) => !cancelled && setPreview(p))
      .catch(() => !cancelled && setPreview(null));
    return () => {
      cancelled = true;
    };
  }, [step, usesClasses, activity, selectedSlot]);

  if (venueLoading || activitiesLoading) {
    return (
      <View style={[styles.container, styles.center]}>
        <ActivityIndicator color={colors.blue} />
      </View>
    );
  }

  if (!venue || !activity) {
    return (
      <View style={styles.container}>
        <Text style={styles.errorText}>Activity not found</Text>
      </View>
    );
  }

  // Terminal success side-effects: clear the idempotency key, schedule
  // reminders, show the success screen. Used by the direct create AND the
  // pay-and-save-card rail.
  function onBookingCreated(bookingId: string) {
    if (!activity || !venue) return;
    idempotencyKey.current = null;
    scheduleBookingReminders({
      bookingId,
      venueName: venue.name,
      activityName: activity.name,
      bookingTime: selectedSlot?.startTime ?? selectedClass?.start ?? new Date(),
    }).catch(() => {}); // non-critical — don't block the success screen
    setConfirmed(true);
  }

  // Create the booking. On a 402 charge_consent_required, disclose the charge
  // and re-POST with consent (same idempotency key) via the `offer` argument.
  // On 402 no_payment_method_on_file (after consent), enter the pay-and-save-
  // card rail instead of dead-ending (slot bookings only).
  async function handleConfirm(offer?: ChargeOffer) {
    if (!activity || !venue) return;
    const consent = offer ? { acceptCharge: true as const, acceptedChargeAmountIsk: offer.amountIsk } : {};
    let input: CreateBookingInput;
    if (usesClasses) {
      if (!selectedClass) return;
      input = { activityId: activity.id, eventId: selectedClass.eventId, ...consent };
    } else {
      if (!selectedSlot) return;
      input = {
        activityId: activity.id,
        startsAt: selectedSlot.startsAt,
        endsAt: selectedSlot.endsAt,
        ...consent,
      };
    }
    setConfirming(true);
    try {
      if (!idempotencyKey.current) idempotencyKey.current = Crypto.randomUUID();
      const result = await createBooking(input, idempotencyKey.current);
      onBookingCreated(result.bookingId);
    } catch (e) {
      if (e instanceof ApiError && e.status === 402 && e.offer) {
        // Premium / à-la-carte venue — disclose the price and re-POST on
        // consent, reusing the same idempotency key.
        const off = e.offer;
        Alert.alert(
          'Payment required',
          `${venue.name} isn't included in your plan. Pay ${formatIsk(off.amountIsk)} to book this time?`,
          [
            { text: 'Cancel', style: 'cancel' },
            { text: `Pay ${formatIsk(off.amountIsk)}`, onPress: () => void handleConfirm(off) },
          ],
        );
      } else if (
        e instanceof ApiError &&
        e.code === 'no_payment_method_on_file' &&
        offer &&
        !usesClasses
      ) {
        // No vaulted card — pay the surcharge on Kling's hosted page (which
        // also saves the card), then the booking completes with those funds.
        // The rail is slot-only; a class keeps the web-profile fallback below.
        await startPayAndSaveCard(offer);
      } else if (e instanceof ApiError && e.code === 'no_payment_method_on_file') {
        Alert.alert(
          'Add a payment method',
          'This class needs a saved card. Add one at lifepass.is/profile, then try again.',
        );
      } else {
        // Booking-gate refusals (no plan, boutique membership, caps, dup slot)
        // get friendly copy + a "View plans" CTA instead of the raw code.
        const refusal = e instanceof ApiError ? gateRefusalFor(e.code) : null;
        if (refusal) {
          Alert.alert(
            refusal.title,
            refusal.message,
            refusal.needsMembership
              ? [
                  { text: 'Not now', style: 'cancel' },
                  { text: 'View plans', onPress: () => navigation.navigate('TopUp') },
                ]
              : [{ text: 'OK' }],
          );
        } else {
          const message = e instanceof Error ? e.message : 'Could not create booking. Try again.';
          Alert.alert('Booking failed', message);
        }
      }
    } finally {
      setConfirming(false);
    }
  }

  // Pay-and-save-card rail (no saved card). Creates the amount-only Kling
  // session with the SAME idempotency key as the booking, opens the hosted
  // page, then confirms on return.
  async function startPayAndSaveCard(offer: ChargeOffer) {
    if (!selectedSlot || !activity || !idempotencyKey.current) return;
    const key = idempotencyKey.current;
    try {
      const session = await createBookingPaymentSession(
        {
          activityId: activity.id,
          startsAt: selectedSlot.startsAt,
          endsAt: selectedSlot.endsAt,
          acceptedChargeAmountIsk: offer.amountIsk,
        },
        key,
      );

      if (session.hasCard) {
        // A card exists now (a concurrent purchase vaulted one) — book directly.
        const result = await createBooking(
          {
            activityId: activity.id,
            startsAt: selectedSlot.startsAt,
            endsAt: selectedSlot.endsAt,
            acceptCharge: true,
            acceptedChargeAmountIsk: offer.amountIsk,
          },
          key,
        );
        onBookingCreated(result.bookingId);
        return;
      }

      // openAuthSessionAsync captures the lifepass://payment-* return inline
      // (works on Android, unlike email links which hit about:blank).
      const web = await WebBrowser.openAuthSessionAsync(session.url, PAYMENT_SUCCESS_URL);
      const cancelLeg =
        web.type !== 'success' || !web.url || web.url.includes('payment-canceled');
      // ALWAYS confirm — the return URL carries no status, so a "canceled" leg
      // is only a hint. Confirm is idempotent and authoritative.
      await settlePayAndSaveCard(key, cancelLeg);
    } catch (e) {
      if (e instanceof ApiError && e.status === 402 && e.offer) {
        // Price drifted on session create — re-disclose and re-consent.
        const off = e.offer;
        Alert.alert('Price updated', `The price is now ${formatIsk(off.amountIsk)}. Continue?`, [
          { text: 'Cancel', style: 'cancel' },
          { text: `Pay ${formatIsk(off.amountIsk)}`, onPress: () => void handleConfirm(off) },
        ]);
      } else {
        const message = e instanceof Error ? e.message : 'Payment could not be started.';
        Alert.alert('Payment failed', message);
      }
    }
  }

  // Verify the payment: the confirm vaults the card and completes the booking.
  // Capture can lag the redirect, so the success leg polls; the cancel leg
  // checks once. Idempotent, so "Check again" is safe.
  async function settlePayAndSaveCard(key: string, cancelLeg: boolean) {
    const maxAttempts = cancelLeg ? 1 : 5;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      if (attempt > 0) await new Promise((r) => setTimeout(r, 2500));
      let conf;
      try {
        conf = await confirmBookingPaymentSession(key);
      } catch {
        continue; // transient — keep trying within the attempt budget
      }
      if (conf.status === 'fulfilled') {
        onBookingCreated(conf.bookingId ?? key);
        return;
      }
      if (conf.status === 'processing') {
        if (attempt < maxAttempts - 1) continue;
        Alert.alert('Still processing', 'Your payment is still processing.', [
          { text: 'Later', style: 'cancel' },
          { text: 'Check again', onPress: () => void settlePayAndSaveCard(key, false) },
        ]);
        return;
      }
      if (conf.status === 'refunded') {
        Alert.alert('Payment refunded', refundMessage(conf.reason));
        return;
      }
      if (conf.status === 'expired') {
        Alert.alert('Payment expired', 'The payment window expired and you were not charged. Please try again.');
        return;
      }
      // needs_attention: money captured, booking uncertain — parked for ops.
      Alert.alert(
        'Payment received',
        "We're finalizing your booking. If it doesn't appear shortly, contact support@lifepass.is.",
      );
      return;
    }
    // Every attempt failed transiently — let the user re-check.
    Alert.alert("Couldn't confirm payment", 'Please check your connection and try again.', [
      { text: 'Later', style: 'cancel' },
      { text: 'Check again', onPress: () => void settlePayAndSaveCard(key, false) },
    ]);
  }

  if (confirmed) {
    return <SuccessScreen onDone={() => navigation.popToTop()} venue={venue} activity={activity} />;
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <Header
        title={step === 1 && usesClasses ? 'Class' : STEPS[step]}
        onBack={() => (step === 0 ? navigation.goBack() : setStep((step - 1) as 0 | 1 | 2))}
      />

      <StepIndicator step={step} usesClasses={usesClasses} />

      {step === 0 && (
        <DateStep selected={selectedDate} onSelect={setSelectedDate} onNext={() => setStep(1)} />
      )}

      {step === 1 && (
        <TimeStep
          usesClasses={usesClasses}
          slots={slots}
          classes={classes}
          loading={slotsLoading}
          error={slotsError}
          selectedSlot={selectedSlot}
          selectedClass={selectedClass}
          onSelectSlot={setSelectedSlot}
          onSelectClass={setSelectedClass}
          onNext={() => setStep(2)}
        />
      )}

      {step === 2 && (
        <ConfirmStep
          venue={venue}
          activity={activity}
          date={selectedDate}
          usesClasses={usesClasses}
          slot={selectedSlot}
          klass={selectedClass}
          preview={preview}
          confirming={confirming}
          onConfirm={() => handleConfirm()}
        />
      )}
    </View>
  );
}

function Header({ title, onBack }: { title: string; onBack: () => void }) {
  return (
    <View style={styles.header}>
      <TouchableOpacity style={styles.backButton} onPress={onBack}>
        <Ionicons name="chevron-back" size={20} color={colors.paper} />
      </TouchableOpacity>
      <Text style={styles.headerTitle}>{title}</Text>
      <View style={styles.backButton} />
    </View>
  );
}

function StepIndicator({ step, usesClasses }: { step: 0 | 1 | 2; usesClasses: boolean }) {
  const labels = usesClasses ? (['Date', 'Class', 'Confirm'] as const) : STEPS;
  return (
    <View style={styles.steps}>
      {labels.map((label, i) => (
        <View key={label} style={styles.stepWrap}>
          <View style={styles.stepCol}>
            <View style={[styles.stepDot, i <= step && styles.stepDotActive]} />
            <Text style={[styles.stepLabel, i <= step && styles.stepLabelActive]}>{label}</Text>
          </View>
          {i < 2 && <View style={[styles.stepLine, i < step && styles.stepLineActive]} />}
        </View>
      ))}
    </View>
  );
}

// ─── Step 0 · date (graphical calendar, mirrors iOS DatePicker(.graphical)) ──

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
function isSameDay(a: Date, b: Date): boolean {
  return a.toDateString() === b.toDateString();
}

function DateStep({
  selected,
  onSelect,
  onNext,
}: {
  selected: Date;
  onSelect: (d: Date) => void;
  onNext: () => void;
}) {
  // Tapping a day picks it AND advances to the Time step — the Next button
  // alone was easy to miss (and can sit under the system nav bar edge-to-edge).
  const pick = (d: Date) => {
    onSelect(d);
    onNext();
  };
  return (
    <View style={stepStyles.container}>
      <Text style={stepStyles.heading}>Select a date</Text>
      <Calendar selected={selected} onSelect={pick} />
      <View style={{ flex: 1 }} />
      <View style={stepStyles.footer}>
        <PrimaryButton title="Next" onPress={onNext} />
      </View>
    </View>
  );
}

function Calendar({ selected, onSelect }: { selected: Date; onSelect: (d: Date) => void }) {
  const today = startOfDay(new Date());
  const [viewMonth, setViewMonth] = useState<Date>(
    () => new Date(selected.getFullYear(), selected.getMonth(), 1),
  );

  const year = viewMonth.getFullYear();
  const month = viewMonth.getMonth();

  // Monday-first grid: JS getDay() is 0=Sun..6=Sat → shift to 0=Mon..6=Sun.
  const leading = (new Date(year, month, 1).getDay() + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const cells: (Date | null)[] = [];
  for (let i = 0; i < leading; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(year, month, d));
  while (cells.length % 7 !== 0) cells.push(null);

  // Never page earlier than the current month (bookings can't be in the past).
  const canGoPrev = new Date(year, month, 1) > new Date(today.getFullYear(), today.getMonth(), 1);

  return (
    <View style={calStyles.container}>
      <View style={calStyles.header}>
        <TouchableOpacity
          disabled={!canGoPrev}
          onPress={() => setViewMonth(new Date(year, month - 1, 1))}
          style={calStyles.navBtn}
          hitSlop={8}
        >
          <Ionicons name="chevron-back" size={18} color={canGoPrev ? colors.paper : colors.line2} />
        </TouchableOpacity>
        <Text style={calStyles.monthLabel}>
          {viewMonth.toLocaleDateString([], { month: 'long', year: 'numeric' })}
        </Text>
        <TouchableOpacity
          onPress={() => setViewMonth(new Date(year, month + 1, 1))}
          style={calStyles.navBtn}
          hitSlop={8}
        >
          <Ionicons name="chevron-forward" size={18} color={colors.paper} />
        </TouchableOpacity>
      </View>

      <View style={calStyles.weekRow}>
        {WEEKDAYS.map((w) => (
          <Text key={w} style={calStyles.weekday}>
            {w}
          </Text>
        ))}
      </View>

      <View style={calStyles.grid}>
        {cells.map((cell, i) => {
          if (!cell) return <View key={`blank-${i}`} style={calStyles.cell} />;
          const past = cell < today;
          const sel = isSameDay(cell, selected);
          const today_ = isSameDay(cell, today);
          return (
            <TouchableOpacity
              key={cell.toISOString()}
              style={calStyles.cell}
              disabled={past}
              activeOpacity={0.7}
              onPress={() => onSelect(cell)}
            >
              <View style={[calStyles.day, sel && calStyles.daySelected, today_ && !sel && calStyles.dayToday]}>
                <Text
                  style={[
                    calStyles.dayText,
                    past && calStyles.dayTextPast,
                    sel && calStyles.dayTextSelected,
                  ]}
                >
                  {cell.getDate()}
                </Text>
              </View>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

// ─── Step 1 · time ───────────────────────────────────────────────────────────

function TimeStep({
  usesClasses,
  slots,
  classes,
  loading,
  error,
  selectedSlot,
  selectedClass,
  onSelectSlot,
  onSelectClass,
  onNext,
}: {
  usesClasses: boolean;
  slots: BookingSlot[];
  classes: ActivityClass[];
  loading: boolean;
  error: string | null;
  selectedSlot: BookingSlot | null;
  selectedClass: ActivityClass | null;
  onSelectSlot: (s: BookingSlot) => void;
  onSelectClass: (c: ActivityClass) => void;
  onNext: () => void;
}) {
  const hasSelection = usesClasses ? selectedClass != null : selectedSlot != null;
  const empty = usesClasses ? classes.length === 0 : slots.length === 0;
  return (
    <View style={stepStyles.container}>
      <Text style={stepStyles.heading}>{usesClasses ? 'Select a class' : 'Select a time'}</Text>
      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.blue} />
        </View>
      ) : error ? (
        <View style={styles.center}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : empty ? (
        <View style={styles.center}>
          <Text style={styles.errorText}>
            {usesClasses ? 'No classes in the next two weeks.' : 'No times available for this date.'}
          </Text>
        </View>
      ) : usesClasses ? (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={classStyles.list}>
          {classes.map((klass) => {
            const active = selectedClass?.eventId === klass.eventId;
            return (
              <TouchableOpacity
                key={klass.eventId}
                style={[classStyles.row, active && classStyles.rowActive]}
                onPress={() => onSelectClass(klass)}
                activeOpacity={0.85}
                disabled={!klass.bookable}
              >
                <View style={{ flex: 1 }}>
                  <Text style={[classStyles.name, !klass.bookable && timeStyles.timeTextDim]}>
                    {klass.name ?? 'Class'}
                  </Text>
                  <Text style={classStyles.when}>
                    {klass.start.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })}
                    {' · '}
                    {klass.start.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })}
                  </Text>
                  {klass.coachNames.length > 0 && (
                    <Text style={classStyles.coach}>{klass.coachNames}</Text>
                  )}
                </View>
                {!klass.bookable ? (
                  <Text style={classStyles.full}>{klass.reason ?? 'Full'}</Text>
                ) : klass.spotsLeft !== undefined ? (
                  <Text style={classStyles.spots}>{klass.spotsLeft} left</Text>
                ) : null}
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={timeStyles.grid}>
          {slots.map((slot) => {
            const active = selectedSlot?.id === slot.id;
            return (
              <TouchableOpacity
                key={slot.id}
                style={[timeStyles.tile, active && timeStyles.tileActive]}
                onPress={() => onSelectSlot(slot)}
                activeOpacity={0.85}
                disabled={!slot.available}
              >
                <Text
                  style={[
                    timeStyles.timeText,
                    active && timeStyles.timeTextActive,
                    !slot.available && timeStyles.timeTextDim,
                  ]}
                >
                  {slot.startTime.toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                    hour12: false,
                  })}
                </Text>
                {slot.spotsRemaining !== undefined && (
                  <Text style={[timeStyles.spots, active && timeStyles.spotsActive]}>
                    {slot.spotsRemaining} left
                  </Text>
                )}
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      )}
      <View style={stepStyles.footer}>
        <PrimaryButton title="Next" onPress={onNext} disabled={!hasSelection} />
      </View>
    </View>
  );
}

// ─── Step 2 · confirm ────────────────────────────────────────────────────────

function ConfirmStep({
  venue,
  activity,
  date,
  usesClasses,
  slot,
  klass,
  preview,
  confirming,
  onConfirm,
}: {
  venue: Venue;
  activity: Activity;
  date: Date;
  usesClasses: boolean;
  slot: BookingSlot | null;
  klass: ActivityClass | null;
  preview: BookingPreview | null;
  confirming: boolean;
  onConfirm: () => void;
}) {
  const charges = preview != null && (preview.kind === 'surcharge' || preview.kind === 'topup');
  return (
    <View style={stepStyles.container}>
      <Text style={stepStyles.heading}>Confirm booking</Text>

      <View style={confirmStyles.card}>
        <ConfirmRow label="Venue" value={venue.name} />
        <ConfirmRow label="Activity" value={activity.name} />
        {usesClasses && klass ? (
          <>
            {klass.name && <ConfirmRow label="Class" value={klass.name} />}
            <ConfirmRow
              label="When"
              value={klass.start.toLocaleString([], {
                weekday: 'short',
                day: 'numeric',
                month: 'short',
                hour: '2-digit',
                minute: '2-digit',
                hour12: false,
              })}
            />
          </>
        ) : (
          <>
            <ConfirmRow
              label="Date"
              value={date.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' })}
            />
            {slot && (
              <ConfirmRow
                label="Time"
                value={slot.startTime.toLocaleTimeString([], {
                  hour: '2-digit',
                  minute: '2-digit',
                  hour12: false,
                })}
              />
            )}
            <ConfirmRow label="Duration" value={`${activity.durationMinutes} min`} />
          </>
        )}
      </View>

      {preview && (
        <View style={[disclosureStyles.note, charges && disclosureStyles.noteCharge]}>
          <Ionicons
            name={charges ? 'card-outline' : 'checkmark-circle-outline'}
            size={14}
            color={charges ? colors.skyBlue : colors.moss}
          />
          <Text style={disclosureStyles.noteText}>{disclosureText(preview)}</Text>
        </View>
      )}

      <View style={stepStyles.footer}>
        <PrimaryButton
          title={
            confirming
              ? 'Confirming…'
              : charges && preview?.priceIsk != null
                ? `Confirm & pay ${formatIsk(preview.priceIsk)}`
                : 'Confirm booking'
          }
          onPress={onConfirm}
          loading={confirming}
        />
      </View>
    </View>
  );
}

function ConfirmRow({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <View style={confirmStyles.row}>
      <Text style={confirmStyles.label}>{label.toUpperCase()}</Text>
      <Text style={[confirmStyles.value, highlight && confirmStyles.valueHighlight]}>{value}</Text>
    </View>
  );
}

function SuccessScreen({
  venue,
  activity,
  onDone,
}: {
  venue: Venue;
  activity: Activity;
  onDone: () => void;
}) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.container, { paddingTop: insets.top, justifyContent: 'center' }]}>
      <View style={successStyles.container}>
        <View style={successStyles.checkCircle}>
          <Ionicons name="checkmark" size={48} color={colors.ink} />
        </View>
        <Text style={successStyles.title}>You're booked</Text>
        <Text style={successStyles.subtitle}>
          {activity.name} at {venue.name}
        </Text>
        <Kicker text="See it in your bookings" color={colors.skyBlue} />
        <View style={successStyles.button}>
          <PrimaryButton title="Done" onPress={onDone} />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.ink },
  center: { alignItems: 'center', justifyContent: 'center', flex: 1 },
  errorText: { color: colors.paper3, textAlign: 'center', marginTop: 80 },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  backButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: { fontSize: 16, fontWeight: '600', color: colors.paper },

  steps: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 0.5,
    borderBottomColor: colors.line,
  },
  stepWrap: { flexDirection: 'row', alignItems: 'center', flex: 1 },
  stepCol: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  stepDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.line2 },
  stepDotActive: { backgroundColor: colors.blue },
  stepLabel: { fontSize: 11, fontWeight: '500', color: colors.paper3 },
  stepLabelActive: { color: colors.paper },
  stepLine: { flex: 1, height: 2, backgroundColor: colors.line2, marginHorizontal: 8 },
  stepLineActive: { backgroundColor: colors.blue },
});

const stepStyles = StyleSheet.create({
  container: { flex: 1, padding: 20, gap: 16 },
  heading: { fontFamily: fonts.serif, fontSize: 22, fontWeight: '400', color: colors.paper, letterSpacing: -0.4 },
  footer: { paddingVertical: 8 },
});

const calStyles = StyleSheet.create({
  container: {
    backgroundColor: colors.ink2,
    borderRadius: 16,
    borderWidth: 0.5,
    borderColor: colors.line,
    padding: 12,
    gap: 8,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 4,
    paddingVertical: 4,
  },
  navBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  monthLabel: { fontSize: 15, fontWeight: '600', color: colors.paper },
  weekRow: { flexDirection: 'row' },
  weekday: {
    width: `${100 / 7}%`,
    textAlign: 'center',
    fontSize: 11,
    fontWeight: '600',
    color: colors.paper3,
  },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: {
    width: `${100 / 7}%`,
    height: 42,
    alignItems: 'center',
    justifyContent: 'center',
  },
  day: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  daySelected: { backgroundColor: colors.paper },
  dayToday: { borderWidth: 1, borderColor: colors.blue },
  dayText: { fontSize: 14, color: colors.paper },
  dayTextPast: { color: colors.line2 },
  dayTextSelected: { color: colors.ink, fontWeight: '700' },
});

const timeStyles = StyleSheet.create({
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    paddingBottom: 20,
  },
  tile: {
    width: '31%',
    paddingVertical: 14,
    backgroundColor: colors.ink2,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: 'transparent',
    alignItems: 'center',
    gap: 3,
  },
  tileActive: {
    backgroundColor: colors.blueWash,
    borderColor: colors.blue,
  },
  timeText: { fontSize: 14, fontWeight: '600', color: colors.paper },
  timeTextActive: { color: colors.paper },
  timeTextDim: { color: colors.line2 },
  spots: { fontSize: 10, color: colors.paper3 },
  spotsActive: { color: colors.paper2 },
});

const classStyles = StyleSheet.create({
  list: { gap: 10, paddingBottom: 20 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: colors.ink2,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  rowActive: { backgroundColor: colors.blueWash, borderColor: colors.blue },
  name: { fontSize: 14, fontWeight: '600', color: colors.paper, letterSpacing: -0.2 },
  when: { fontSize: 12, color: colors.paper3, marginTop: 2 },
  coach: { fontSize: 11, color: colors.paper3, marginTop: 2 },
  spots: { fontSize: 11, color: colors.paper3 },
  full: { fontSize: 10, fontWeight: '700', color: colors.paper3 },
});

const disclosureStyles = StyleSheet.create({
  note: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: colors.ink2,
    borderWidth: 0.5,
    borderColor: colors.line,
  },
  noteCharge: { borderColor: colors.blue },
  noteText: { flex: 1, fontSize: 12, color: colors.paper2, lineHeight: 17 },
});

const confirmStyles = StyleSheet.create({
  card: {
    backgroundColor: colors.ink2,
    borderRadius: 14,
    borderWidth: 0.5,
    borderColor: colors.line,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 0.5,
    borderBottomColor: colors.line,
    gap: 12,
  },
  label: {
    width: 80,
    fontSize: 11,
    fontWeight: '600',
    color: colors.paper3,
    letterSpacing: 0.4,
  },
  value: { flex: 1, fontSize: 14, color: colors.paper, fontWeight: '500' },
  valueHighlight: { color: colors.skyBlue },
});

const successStyles = StyleSheet.create({
  container: { padding: 40, alignItems: 'center', gap: 16 },
  checkCircle: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: colors.skyBlue,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  title: { fontFamily: fonts.serif, fontSize: 28, fontWeight: '400', color: colors.paper, letterSpacing: -0.6 },
  subtitle: { fontSize: 15, color: colors.paper2, textAlign: 'center' },
  button: { alignSelf: 'stretch', marginTop: 24 },
});
