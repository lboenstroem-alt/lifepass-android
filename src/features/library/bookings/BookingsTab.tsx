/* eslint lifepass/no-literal-copy: "error" */
/**
 * Profile's Bookings half: the port of iOS `MyBookingsContentView`
 * (Views/Profile/LibraryView.swift). The state is ./myBookings.ts.
 *
 * Top to bottom: the Upcoming / Past chips with their counts, the "Book Now"
 * card (leaves Profile, then switches to Explore), and the list: Upcoming as
 * cards with their status and, when the booking can still be cancelled, an X;
 * Past as compact rows with hairlines. Empty, each half says so.
 *
 * While a load runs the half is a spinner, as on iOS; a pull to refresh keeps
 * the list on screen under the pull's own spinner instead (Android's
 * SwipeRefreshLayout convention), so the list never jumps out from under the
 * member's finger.
 *
 * Two dialogs, both drawn only while the list is (iOS hangs both alerts on
 * the list, so neither shows over the spinner):
 *   - the cancel question, "Keep booking" or "Cancel booking" (destructive);
 *   - "Error", for a load that failed or a cancel that was refused, with the
 *     refusal's next step as its second button where there is one. Refresh
 *     and Try again are this screen's own (a reload; the same cancel again);
 *     "My bookings" is this screen, so it is never offered here; any other
 *     step (Contact support) goes through F4's refusal steps.
 */
import { Ionicons } from '@expo/vector-icons';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useStore } from 'zustand';

import { Dialog, EmptyState, LPText, type DialogButton } from '../../../components/ui';
import { useT } from '../../../i18n';
import { ctaLabelKey, type RefusalCta } from '../../../api';
import { isCancellable, type MemberBooking } from '../../../api/bookingsList';
import { presentsRefusalStep, useRefusalStep } from '../../../navigation/refusalSteps';
import { colors, hairline } from '../../../theme';

import { PastBookingRow, PastRowDivider, UpcomingBookingCard } from './BookingRows';
import type { MyBookingsStore } from './myBookings';

export type BookingSegment = 'upcoming' | 'past';

/**
 * Whether the error dialog offers `cta` (iOS `offersRefusalStep`): Refresh
 * and Try again are this screen's; My bookings is this screen; anything else
 * only when the app can take it.
 */
export function offersCancelStep(cta: RefusalCta): boolean {
  switch (cta) {
    case 'refreshBookings':
    case 'tryAgain':
      return true;
    case 'myBookings':
      return false;
    default:
      return presentsRefusalStep(cta, null);
  }
}

export interface BookingsTabProps {
  readonly store: MyBookingsStore;
  /** Leave Profile, then switch to Explore (the "Book Now" card). */
  readonly onBrowse: () => void;
  /** Room under the list for the floating tab bar. */
  readonly bottomSpace: number;
}

export default function BookingsTab({ store, onBrowse, bottomSpace }: BookingsTabProps) {
  const { t } = useT();
  const upcoming = useStore(store, (s) => s.upcoming);
  const past = useStore(store, (s) => s.past);
  const isLoading = useStore(store, (s) => s.isLoading);
  const error = useStore(store, (s) => s.error);
  const errorCta = useStore(store, (s) => s.errorCta);
  const cancelInFlight = useStore(store, (s) => s.cancellingBookingId !== null);

  const [segment, setSegment] = useState<BookingSegment>('upcoming');
  const [toCancel, setToCancel] = useState<MemberBooking | null>(null);
  const [pulling, setPulling] = useState(false);

  const step = useRefusalStep({
    local: (cta) => {
      if (cta === 'refreshBookings') {
        void store.getState().load();
        return true;
      }
      if (cta === 'tryAgain') {
        void store.getState().retryCancel();
        return true;
      }
      return false;
    },
  });

  const onRefresh = useCallback(async () => {
    setPulling(true);
    try {
      await store.getState().load();
    } finally {
      setPulling(false);
    }
  }, [store]);

  if (isLoading && !pulling) {
    return (
      <View style={styles.loading} testID="library.bookings.loading">
        <LoadingSpinner />
      </View>
    );
  }

  const list = segment === 'upcoming' ? upcoming : past;
  const now = new Date();

  const pendingCancel = toCancel;
  const cancelButtons: DialogButton[] = [
    { label: t('bookings.cancel_keep'), role: 'cancel', testID: 'library.cancel.keep' },
    {
      label: t('bookings.cancel_confirm'),
      role: 'destructive',
      testID: 'library.cancel.confirm',
      onPress: () => {
        if (pendingCancel) void store.getState().cancelBooking(pendingCancel);
      },
    },
  ];

  const errorButtons: DialogButton[] = [];
  if (errorCta && offersCancelStep(errorCta)) {
    const cta = errorCta;
    errorButtons.push({ label: t(ctaLabelKey(cta)), testID: 'library.error.cta', onPress: () => step.take(cta) });
  }
  errorButtons.push({ label: t('common.ok'), role: 'cancel', testID: 'library.error.ok' });

  return (
    <View style={styles.root}>
      <ScrollView
        style={styles.root}
        contentContainerStyle={{ paddingBottom: bottomSpace }}
        refreshControl={<RefreshControl refreshing={pulling} onRefresh={onRefresh} colors={[colors.rust]} tintColor={colors.rust} />}
        testID="library.bookings.scroll"
      >
        <View style={styles.chips} accessibilityRole="tablist">
          <SegmentChip
            title={t('library.upcoming')}
            count={upcoming.length}
            active={segment === 'upcoming'}
            onPress={() => setSegment('upcoming')}
            testID="library.segment.upcoming"
          />
          <SegmentChip
            title={t('library.past')}
            count={past.length}
            active={segment === 'past'}
            onPress={() => setSegment('past')}
            testID="library.segment.past"
          />
        </View>

        <Pressable
          onPress={onBrowse}
          accessibilityRole="button"
          accessibilityLabel={`${t('library.book_now')}, ${t('library.browse')}`}
          style={({ pressed }) => [styles.browse, pressed && styles.pressed]}
          testID="library.bookNow"
        >
          <View style={styles.browseIcon}>
            <Ionicons name="compass-outline" size={15} color={colors.rust} />
          </View>
          <View style={styles.browseText}>
            <LPText size={14} weight="semibold" color={colors.paper}>
              {t('library.book_now')}
            </LPText>
            <LPText size={11} color={colors.paper3}>
              {t('library.browse')}
            </LPText>
          </View>
          <Ionicons name="chevron-forward" size={12} color={colors.paper3} />
        </Pressable>

        {list.length === 0 ? (
          <EmptyState
            icon={segment === 'upcoming' ? 'calendar-outline' : 'time-outline'}
            message={t(segment === 'upcoming' ? 'library.empty_upcoming' : 'library.empty_past')}
            testID={`library.empty.${segment}`}
          />
        ) : segment === 'upcoming' ? (
          <View style={styles.upcomingList}>
            {upcoming.map((booking) => (
              <UpcomingBookingCard
                key={booking.id}
                booking={booking}
                now={now}
                onCancel={isCancellable(booking, now) ? () => setToCancel(booking) : undefined}
                cancelInFlight={cancelInFlight}
              />
            ))}
          </View>
        ) : (
          <View style={styles.pastList}>
            {past.map((booking, index) => (
              <View key={booking.id}>
                <View style={styles.pastRowPad}>
                  <PastBookingRow booking={booking} now={now} />
                </View>
                {index < past.length - 1 ? <PastRowDivider /> : null}
              </View>
            ))}
          </View>
        )}
      </ScrollView>

      <Dialog
        visible={toCancel !== null}
        onClose={() => setToCancel(null)}
        title={t('bookings.cancel_title')}
        message={t('bookings.cancel_msg')}
        buttons={cancelButtons}
        testID="library.cancel.dialog"
      />
      <Dialog
        visible={error !== null}
        onClose={() => store.getState().dismissError()}
        title={t('common.error_title')}
        message={error ?? t('common.error_body')}
        buttons={errorButtons}
        testID="library.error.dialog"
      />
    </View>
  );
}

function SegmentChip({
  title,
  count,
  active,
  onPress,
  testID,
}: {
  readonly title: string;
  readonly count: number;
  readonly active: boolean;
  readonly onPress: () => void;
  readonly testID: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="tab"
      accessibilityLabel={`${title}, ${count}`}
      accessibilityState={{ selected: active }}
      style={({ pressed }) => [styles.chip, active ? styles.chipActive : styles.chipIdle, pressed && styles.pressed]}
      testID={testID}
    >
      <LPText size={12.5} weight="semibold" color={active ? colors.ink : colors.paper2}>
        {title}
      </LPText>
      <LPText size={11} color={active ? colors.ink : colors.paper2} style={styles.chipCount}>
        {String(count)}
      </LPText>
    </Pressable>
  );
}

/** iOS `ProgressView().tint(Color.lpRust)`, which VoiceOver reads as loading. */
export function LoadingSpinner() {
  const { t } = useT();
  return <ActivityIndicator color={colors.rust} accessibilityLabel={t('a11y.loading')} />;
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  chips: { flexDirection: 'row', gap: 8, paddingHorizontal: 20, paddingTop: 14 },
  chip: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 4,
    paddingHorizontal: 14,
    paddingVertical: 8,
    minHeight: 36,
    borderRadius: 999,
    borderWidth: 1,
  },
  chipActive: { backgroundColor: colors.paper, borderColor: colors.paper },
  chipIdle: { backgroundColor: colors.ink2, borderColor: colors.line },
  chipCount: { opacity: 0.8 },
  browse: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    marginHorizontal: 20,
    marginTop: 14,
    borderRadius: 14,
    borderWidth: hairline,
    borderColor: colors.line,
    backgroundColor: colors.ink2,
  },
  browseIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(71,133,194,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  browseText: { flex: 1, gap: 2 },
  upcomingList: { gap: 10, paddingHorizontal: 20, paddingTop: 16 },
  pastList: { paddingTop: 16 },
  pastRowPad: { paddingHorizontal: 20 },
  pressed: { opacity: 0.7 },
});
