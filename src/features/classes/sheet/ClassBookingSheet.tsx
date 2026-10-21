/**
 * The sheet a dated class opens: THAT session (its name, venue, day and
 * time) with the charge disclosure and Confirm, and no date step or
 * timetable to find the class in again. The Android port of iOS
 * `ClassBookingSheet` (Views/Booking/ClassBookingSheet.swift).
 *
 * It books through the same booking session as the full flow (BOOK-1,
 * src/features/booking) and draws the same confirm-step pieces
 * (`BookingChargeSection`, `BookingOutcomeHost`), so the charge consent, the
 * pay-and-save-card rail (a card-less member's class goes through the
 * payment page with its `eventId`), the plan, cap and duplicate refusals and
 * every result dialog behave exactly as they do there. What it adds is the
 * session's own state: a class that has started, left the schedule or can't
 * be booked right now says so, hides Confirm, and offers the full flow
 * ("See other times") instead.
 *
 * HEIGHT. Half height, with full height only at the accessibility text sizes
 * (the only height there) and for the premium rung picker (a slot's: a class
 * never shows one). The amount Confirm charges sits in the pinned footer with
 * Confirm, so no height hides it. Once opened out for the picker it stays
 * full height (iOS keeps the large detent, still draggable; this sheet can't
 * be dragged back to half then).
 *
 * BUSY. While a booking is in flight (the create, the consent up, the
 * payment page open or settling, a timed-out create waiting) the close
 * button is disabled and swipe, the backdrop and hardware back do nothing:
 * leaving would still book, with no alert, no reminder and no refresh.
 *
 * PAGES. iOS presents everything the sheet opens over it (Plans, Account, My
 * bookings) or pushes it inside it (the full flow). A UI-kit sheet is drawn
 * over every page, so here it steps aside: it hides, the page opens in the
 * app's navigator, and when the member is back where the sheet was it comes
 * back and checks the same class again (iOS "closing Plans re-checks the
 * same class"). The full flow ("See other times", and the "Choose another
 * time" and "Change guests" steps) instead ends the sheet: the member is
 * back on the list it was opened from, which re-reads (iOS closes the sheet
 * when the pushed flow booked). The Kenni and deletion sheets open over it
 * and re-check when they close.
 */
import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, ActivityIndicator, AppState, Pressable, StyleSheet, View, type Text } from 'react-native';

import type { RefusalCta } from '../../../api/refusals';
import { announce, LPText, PrimaryButton, Sheet } from '../../../components/ui';
import { hiddenFromAccessibility } from '../../../components/ui/a11y';
import { useA11ySize } from '../../../hooks/useA11ySize';
import { useT, type Lang } from '../../../i18n';
import { presentsRefusalStep, takeRefusalStep } from '../../../navigation/refusalSteps';
import type { SharedRouteNavigation } from '../../../navigation/sharedSheet';
import type { SharedRouteName } from '../../../navigation/types';
import { colors, parseColor, radius } from '../../../theme';
import {
  BookingChargeSection,
  BookingOutcomeHost,
  bookingInProgress,
  bookingScreenTakes,
  canConfirmOccurrence,
  occurrenceEnd,
  occurrenceStart,
  useBooking,
  useNewBookingSession,
  visitChoiceOptions,
  type BookingSessionStore,
  type BookingVenue,
  type CreateBookingSessionOptions,
} from '../../booking';
import type { ClassOccurrence } from '../model/occurrence';
import {
  announcesStatus,
  ClassSheetHeight,
  confirmAccessibilityLabel,
  headerAccessibilityLabel,
  instructorLine,
  isNotOpenYet,
  otherTimesTarget,
  sheetClassName,
  sheetPriceLine,
  showsConfirm,
  showsOtherTimes,
  spotsLine,
  statusText,
  toBookingOccurrence,
  whenLine,
} from './model';
import { appPages, type ClassSheetPages } from './pages';
import type { ClassSheetEnding } from './requests';

/** A session that starts while the sheet is open stops being bookable: checked this often. */
export const CLASS_SHEET_TICK_MS = 30_000;

export interface ClassBookingSheetProps {
  readonly occurrence: ClassOccurrence;
  /** A booking landed (confirmed, or accepted and pending). */
  readonly onBooked?: () => void;
  /** The sheet has ended: closed, or left for the full schedule and the member is back. */
  readonly onFinished: (ending: ClassSheetEnding) => void;
  /** A booking started or ended (the host holds the sheet while one is in flight). */
  readonly onBusyChange?: (busy: boolean) => void;
  /** Where its pages open (the app's navigator by default). */
  readonly pages?: ClassSheetPages;
  /** The booking session's dependencies (tests). */
  readonly sessionOptions?: CreateBookingSessionOptions;
}

/**
 * Where the sheet is: on screen, stepped aside for a page it opened, gone to
 * the full schedule, or closing for good.
 */
type Phase = 'shown' | 'away' | 'otherTimes' | 'closing';

/** The venue, for the payment record a card-less class leaves (null when a Coach plan did not say). */
function venueOf(occurrence: ClassOccurrence): BookingVenue | null {
  return occurrence.venueId ? { id: occurrence.venueId, name: occurrence.venueName, slug: occurrence.venueSlug } : null;
}

/** Says `text` when TalkBack is on (iOS posts an announcement only with VoiceOver running). */
function speak(text: string): void {
  if (!text) return;
  AccessibilityInfo.isScreenReaderEnabled()
    .then((on) => {
      if (on) announce(text);
    })
    .catch(() => undefined);
}

export default function ClassBookingSheet({
  occurrence,
  onBooked,
  onFinished,
  onBusyChange,
  pages = appPages,
  sessionOptions,
}: ClassBookingSheetProps) {
  const { t, language } = useT();
  const store = useNewBookingSession(sessionOptions);
  const { isAccessibilitySize } = useA11ySize();
  const titleRef = useRef<Text>(null);

  const [phase, setPhase] = useState<Phase>('shown');
  const phaseRef = useRef<Phase>(phase);
  const goTo = useCallback((next: Phase) => {
    phaseRef.current = next;
    setPhase(next);
  }, []);

  // The latest callbacks, so a parent's new arrow never restarts anything.
  const finishedRef = useRef(onFinished);
  const busyChangeRef = useRef(onBusyChange);
  useEffect(() => {
    finishedRef.current = onFinished;
    busyChangeRef.current = onBusyChange;
  });

  /** The return watch for a page the sheet stepped aside for. */
  const stopWatch = useRef<(() => void) | null>(null);
  useEffect(() => () => stopWatch.current?.(), []);

  const finish = useCallback((ending: ClassSheetEnding) => {
    stopWatch.current?.();
    stopWatch.current = null;
    finishedRef.current(ending);
  }, []);

  // Prepared once: seed from the row, re-check its day, then the price.
  const prepared = useRef(false);
  useEffect(() => {
    if (prepared.current) return;
    prepared.current = true;
    const session = store.getState();
    session.setVenue(venueOf(occurrence));
    void session.prepare(toBookingOccurrence(occurrence));
  }, [store, occurrence]);

  // The 30 s tick while the sheet exists; a return to the app ticks at once.
  useEffect(() => {
    const timer = setInterval(() => store.getState().tickOccurrence(), CLASS_SHEET_TICK_MS);
    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'active') store.getState().tickOccurrence();
    });
    return () => {
      clearInterval(timer);
      subscription.remove();
    };
  }, [store]);

  const busy = useBooking(store, bookingInProgress);
  useEffect(() => {
    busyChangeRef.current?.(busy);
  }, [busy]);

  // --- Closing --------------------------------------------------------------

  /** The member closes it (X, back, a swipe, the backdrop, Done): never under a booking in flight. */
  const close = useCallback(() => {
    if (bookingInProgress(store.getState())) return;
    if (phaseRef.current === 'shown') {
      goTo('closing');
    } else if (phaseRef.current === 'away') {
      // Already off screen: nothing to slide away.
      goTo('closing');
      finish('closed');
    }
  }, [store, goTo, finish]);

  const handleClosed = useCallback(() => {
    if (phaseRef.current === 'closing') finish('closed');
  }, [finish]);

  // --- Pages ------------------------------------------------------------------

  /** Back where the sheet was: it comes back and checks the same class again. */
  const comeBack = useCallback(() => {
    stopWatch.current?.();
    stopWatch.current = null;
    if (phaseRef.current !== 'away') return;
    goTo('shown');
    void store.getState().recheckAfterPlans();
  }, [store, goTo]);

  /** Steps aside for a page, and watches for the member coming back. */
  const stepAside = useCallback(() => {
    goTo('away');
    stopWatch.current?.();
    stopWatch.current = pages.watchForReturn((how) => {
      stopWatch.current = null;
      if (how === 'back') comeBack();
      else finish('closed');
    });
  }, [pages, goTo, comeBack, finish]);

  /** "See other times": the full flow on the session's day; the sheet ends once the member is back. */
  const openOtherTimes = useCallback(() => {
    if (bookingInProgress(store.getState())) return;
    const target = otherTimesTarget(occurrence, new Date(), (slug) => pages.venueIdForSlug(slug));
    if (!target) return;
    goTo('otherTimes');
    stopWatch.current?.();
    stopWatch.current = pages.watchForReturn(() => {
      stopWatch.current = null;
      finish('otherTimes');
    });
    if (!pages.openSharedRoute(target.route, target.params)) {
      // Nothing opened (the app is not on screen): the sheet stays.
      stopWatch.current?.();
      stopWatch.current = null;
      goTo('shown');
      return;
    }
    // Opened, but nothing can tell when the member is back: end it now.
    if (!stopWatch.current) finish('otherTimes');
  }, [store, occurrence, pages, goTo, finish]);

  /** A refusal's step: the sheet's own (another time, change guests, try again), then the app's. */
  const takeStep = useCallback(
    (cta: RefusalCta) => {
      let opened = false;
      let steppedAside = false;
      const navigation = {
        navigate: (name: string, params?: object) => {
          opened = name === 'Plans' ? pages.openPlans() : pages.openSharedRoute(name as SharedRouteName, params);
        },
      } as unknown as SharedRouteNavigation;
      takeRefusalStep(
        cta,
        { navigation },
        {
          venueSlug: null,
          local: (step) => {
            switch (step) {
              case 'chooseAnotherTime':
              case 'editGuests':
                // The full flow's timetable (and its party stepper).
                openOtherTimes();
                return true;
              case 'tryAgain':
                void store.getState().retryAfterRefusal();
                return true;
              default:
                return false;
            }
          },
          beforeOpen: () => {
            steppedAside = true;
            stepAside();
          },
          // The Kenni or deletion sheet, opened over this one, has closed.
          onClosed: () => void store.getState().recheckAfterPlans(),
        },
      );
      if (steppedAside && !opened) comeBack();
    },
    [pages, store, openOtherTimes, stepAside, comeBack],
  );

  const offers = useCallback((cta: RefusalCta) => bookingScreenTakes(cta) || presentsRefusalStep(cta, null), []);

  // --- What the sheet shows ---------------------------------------------------

  const status = useBooking(store, (s) => s.occurrenceStatus);
  const selectedClass = useBooking(store, (s) => s.selectedClass);
  const selectedSlot = useBooking(store, (s) => s.selectedSlot);
  const gateRefusal = useBooking(store, (s) => s.gateRefusal);
  const isBooking = useBooking(store, (s) => s.isBooking);
  const canConfirm = useBooking(store, canConfirmOccurrence);
  const start = useBooking(store, occurrenceStart) ?? occurrence.startsAt;
  const end = useBooking(store, occurrenceEnd);
  const priceLine = useBooking(store, (s) => sheetPriceLine(s, occurrence.surchargeFromIsk, language));
  const offersRung = useBooking(store, (s) => visitChoiceOptions(s).length > 0);

  const selection = { selectedClass, selectedSlot };
  const name = sheetClassName(occurrence, selection, language);
  const when = whenLine(start, end, language);
  const instructor = instructorLine(occurrence, selection);
  const spots = spotsLine(status, selection, language);

  // Opened out for the rung picker, and kept there.
  const needsFullHeight = ClassSheetHeight.expands(status === 'ready', gateRefusal !== null, offersRung);
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    if (needsFullHeight) setExpanded(true);
  }, [needsFullHeight]);
  const snapPoints = useMemo(() => ClassSheetHeight.snapPoints(false), []);

  // TalkBack: the re-check answers after the sheet is on screen, so a
  // session that turned out not to be bookable is spoken; the amount, when
  // it appears or changes, likewise (iOS `.onChange`, never the first value).
  const lastStatus = useRef(status);
  useEffect(() => {
    if (lastStatus.current === status) return;
    lastStatus.current = status;
    if (!announcesStatus(status)) return;
    const s = store.getState();
    speak(statusText(status, s, language));
  }, [status, store, language]);
  const lastPriceLine = useRef(priceLine);
  useEffect(() => {
    if (lastPriceLine.current === priceLine) return;
    lastPriceLine.current = priceLine;
    if (priceLine) speak(priceLine);
  }, [priceLine]);

  const footer = showsConfirm(status, gateRefusal) ? (
    <ConfirmBar
      priceLine={priceLine}
      enabled={canConfirm}
      isBooking={isBooking}
      accessibilityLabel={confirmAccessibilityLabel(t('classsheet.confirm_a11y', { name, when }), priceLine)}
      title={t('booking.confirm_cta')}
      onConfirm={() => void store.getState().confirmBooking()}
    />
  ) : null;

  return (
    <>
      <Sheet
        visible={phase === 'shown'}
        onClose={close}
        onClosed={handleClosed}
        busy={busy}
        snapPoints={snapPoints}
        fullHeight={isAccessibilitySize || expanded}
        footer={footer}
        initialFocusRef={titleRef}
        contentStyle={styles.sheetContent}
        testID="classsheet"
      >
        <View style={styles.toolbar}>
          <Pressable
            onPress={close}
            disabled={busy}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel={t('common.close')}
            accessibilityState={{ disabled: busy }}
            style={({ pressed }) => [styles.close, pressed && styles.pressed, busy && styles.dimmed]}
            testID="classsheet.close"
          >
            <Ionicons name="close" size={20} color={colors.paper} />
          </Pressable>
          <LPText ref={titleRef} size={16} weight="semibold" align="center" style={styles.title} accessibilityRole="header">
            {t('classsheet.title')}
          </LPText>
          <View style={styles.close} {...hiddenFromAccessibility} />
        </View>

        <View style={styles.body}>
          <View
            style={styles.header}
            accessible
            accessibilityRole="header"
            accessibilityLabel={headerAccessibilityLabel(
              { name, venue: occurrence.venueName, when },
              [instructor, spots],
              language,
            )}
            testID="classsheet.header"
          >
            <LPText size={20} weight="bold">
              {name}
            </LPText>
            <MetaRow icon="location-outline" text={occurrence.venueName} />
            <MetaRow icon="calendar-outline" text={when} />
            {instructor ? <MetaRow icon="person-outline" text={instructor} /> : null}
            {spots ? <MetaRow icon="people-outline" text={spots} testID="classsheet.spots" /> : null}
          </View>

          <StatusBlock store={store} language={language} />

          {status === 'ready' ? <BookingChargeSection store={store} offers={offers} onStep={takeStep} /> : null}

          {showsOtherTimes(status, gateRefusal) ? (
            <Pressable
              onPress={openOtherTimes}
              accessibilityRole="button"
              style={({ pressed }) => [styles.otherTimes, pressed && styles.pressed]}
              testID="classsheet.other_times"
            >
              <LPText size={14} weight="semibold" color={colors.accentText}>
                {t('classsheet.other_times')}
              </LPText>
              <View {...hiddenFromAccessibility}>
                <Ionicons name="chevron-forward" size={14} color={colors.accentText} />
              </View>
            </Pressable>
          ) : null}
        </View>
      </Sheet>
      <BookingOutcomeHost store={store} onClose={close} offers={offers} onStep={takeStep} onBooked={onBooked} />
    </>
  );
}

function MetaRow({ icon, text, testID }: { readonly icon: keyof typeof Ionicons.glyphMap; readonly text: string; readonly testID?: string }) {
  return (
    <View style={styles.meta}>
      <View {...hiddenFromAccessibility} style={styles.metaIcon}>
        <Ionicons name={icon} size={13} color={colors.mutedTextStrong} />
      </View>
      <LPText size={14} style={styles.flex} testID={testID}>
        {text}
      </LPText>
    </View>
  );
}

/** Where the session stands: checking, can't be booked (and why), or couldn't be loaded. */
function StatusBlock({ store, language }: { readonly store: BookingSessionStore; readonly language: Lang }) {
  const { t } = useT();
  const status = useBooking(store, (s) => s.occurrenceStatus);
  const selectedClass = useBooking(store, (s) => s.selectedClass);
  const selectedSlot = useBooking(store, (s) => s.selectedSlot);
  switch (status) {
    case 'idle':
    case 'checking':
      return (
        <View style={styles.checking} accessible testID="classsheet.checking">
          <ActivityIndicator size="small" color={colors.actionFill} />
          <LPText size={12} color={colors.mutedTextStrong}>
            {t('classsheet.checking')}
          </LPText>
        </View>
      );
    case 'ready':
      return null;
    case 'started':
    case 'gone':
    case 'notBookable':
      return (
        <StatusNote
          text={statusText(status, { selectedClass, selectedSlot }, language)}
          neutral={isNotOpenYet(status, selectedClass)}
        />
      );
    case 'unresolved':
      return (
        <View style={styles.unresolved}>
          <StatusNote text={statusText(status, { selectedClass, selectedSlot }, language)} neutral={false} />
          <Pressable
            onPress={() => void store.getState().retryOccurrence()}
            accessibilityRole="button"
            style={({ pressed }) => [styles.retry, pressed && styles.pressed]}
            testID="classsheet.retry"
          >
            <LPText size={13} weight="semibold" color={colors.onAccent}>
              {t('venue.try_again')}
            </LPText>
          </Pressable>
        </View>
      );
  }
}

/** "Registration hasn't opened" is neutral (a clock on the muted wash); everything else a red note. */
function StatusNote({ text, neutral }: { readonly text: string; readonly neutral: boolean }) {
  return (
    <View
      style={[styles.note, neutral ? styles.noteNeutral : styles.noteError]}
      accessible
      accessibilityLabel={text}
      testID="classsheet.status"
    >
      <View {...hiddenFromAccessibility} style={styles.noteIcon}>
        <Ionicons
          name={neutral ? 'time-outline' : 'alert-circle-outline'}
          size={14}
          color={neutral ? colors.mutedTextStrong : colors.destructive}
        />
      </View>
      <LPText size={13} style={styles.flex}>
        {text}
      </LPText>
    </View>
  );
}

/** Confirm, with the amount it charges directly above it, pinned to the sheet's bottom edge. */
function ConfirmBar({
  priceLine,
  enabled,
  isBooking,
  accessibilityLabel,
  title,
  onConfirm,
}: {
  readonly priceLine: string | null;
  readonly enabled: boolean;
  readonly isBooking: boolean;
  readonly accessibilityLabel: string;
  readonly title: string;
  readonly onConfirm: () => void;
}) {
  return (
    <View style={styles.bar}>
      {priceLine ? (
        <View style={styles.price} accessible accessibilityLabel={priceLine} testID="classsheet.price">
          <View {...hiddenFromAccessibility}>
            <Ionicons name="card-outline" size={13} color={colors.accentText} />
          </View>
          <LPText size={13} weight="semibold" align="center" style={styles.priceText}>
            {priceLine}
          </LPText>
        </View>
      ) : null}
      <PrimaryButton
        title={title}
        onPress={onConfirm}
        // Disabled while the session is checked, drawn as the readable grey
        // button; while booking it stays blue with its spinner.
        disabled={!enabled}
        loading={isBooking}
        tone="action"
        shape="booking"
        accessibilityLabel={accessibilityLabel}
        testID="classsheet.confirm"
      />
    </View>
  );
}

/** A token at an opacity (iOS `Color.lpDestructive.opacity(0.08)`). */
function tint(token: string, opacity: number): string {
  const [r, g, b, a] = parseColor(token);
  const channel = (value: number) => Math.round(value * 255);
  return `rgba(${channel(r)},${channel(g)},${channel(b)},${+(a * opacity).toFixed(3)})`;
}

const styles = StyleSheet.create({
  sheetContent: {
    paddingHorizontal: 16,
    paddingTop: 0,
  },
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 44,
    marginBottom: 8,
  },
  close: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    flex: 1,
  },
  body: {
    gap: 16,
  },
  header: {
    gap: 8,
    padding: 16,
    borderRadius: radius.field,
    backgroundColor: colors.ink2,
  },
  meta: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  metaIcon: {
    width: 16,
    paddingTop: 3,
    alignItems: 'center',
  },
  flex: {
    flex: 1,
  },
  checking: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  unresolved: {
    gap: 10,
  },
  note: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    padding: 12,
    borderRadius: 10,
  },
  noteNeutral: {
    backgroundColor: colors.ink2,
  },
  noteError: {
    backgroundColor: tint(colors.destructive, 0.08),
  },
  noteIcon: {
    paddingTop: 2,
  },
  retry: {
    alignSelf: 'flex-start',
    minHeight: 36,
    justifyContent: 'center',
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderRadius: radius.pill,
    backgroundColor: colors.actionFill,
  },
  otherTimes: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    minHeight: 44,
    paddingVertical: 12,
    borderRadius: radius.field,
    backgroundColor: colors.ink2,
  },
  bar: {
    gap: 8,
  },
  price: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  priceText: {
    flexShrink: 1,
    fontVariant: ['tabular-nums'],
  },
  pressed: {
    opacity: 0.8,
  },
  dimmed: {
    opacity: 0.4,
  },
});
