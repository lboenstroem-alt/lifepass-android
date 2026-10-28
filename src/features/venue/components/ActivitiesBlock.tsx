/* eslint lifepass/no-literal-copy: "error" */
// The middle of the page (iOS VenueDetailView `activitiesBlock`): one of the
// content states of `venueContent` (../model.ts).
//
//   comingSoon   "Coming soon": the partnership is not finished; the heart
//                is how to hear when it opens.
//   offers       the walk-in card ("No booking needed") and/or the "Book a
//                class" list. A venue can be both: both are shown.
//   unavailable  "Bookings not yet available", with "Call the venue" when it
//                has a phone.
//
// A class row opens the booking flow for that class; the flow discloses the
// exact price and asks for consent, so nothing is gated here.
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View, type LayoutChangeEvent } from 'react-native';

import { LPText } from '../../../components/ui';
import { usesClasses, type BookableActivity } from '../../../api/walkInPreview';
import { useT } from '../../../i18n';
import { colors, radius } from '../../../theme';
import type { Venue } from '../../../types/venue';
import { activityFromPrice, venueContent, venuePhoneUrl, walkInCardPrice } from '../model';
import { SectionTitle } from './shared';

/** lpAurora (#4785C2) and lpSignal (#2A4D6F) washes, as iOS draws them. */
const AURORA_WASH = 'rgba(71,133,194,0.18)';
const AURORA_EDGE = 'rgba(71,133,194,0.30)';
const SIGNAL_WASH = 'rgba(42,77,111,0.14)';
const RUST_EDGE = 'rgba(71,133,194,0.35)';

export interface ActivitiesBlockProps {
  readonly venue: Venue;
  readonly slotActivities: readonly BookableActivity[];
  readonly onBook: (activity: BookableActivity) => void;
  readonly onCall: (url: string) => void;
  /** Where the class list starts, in this block's own coordinates (the bar's "Book a class" scrolls there). */
  readonly onClassesLayout?: (y: number) => void;
}

export default function ActivitiesBlock({ venue, slotActivities, onBook, onCall, onClassesLayout }: ActivitiesBlockProps) {
  const content = venueContent(venue, slotActivities);
  switch (content.kind) {
    case 'comingSoon':
      return <ComingSoonCard venue={venue} />;
    case 'unavailable':
      return <BookingsUnavailableCard venue={venue} onCall={onCall} />;
    case 'offers':
      return (
        <View style={styles.offers} testID="venue.offers">
          {content.walkIn ? <WalkInCard venue={venue} /> : null}
          {content.classes ? (
            <View
              testID="venue.classes"
              onLayout={(event: LayoutChangeEvent) => onClassesLayout?.(event.nativeEvent.layout.y)}
              style={styles.classes}
            >
              <ClassList venue={venue} slotActivities={slotActivities} onBook={onBook} />
            </View>
          ) : null}
        </View>
      );
  }
}

function IconDisc({ wash, children }: { readonly wash: string; readonly children: ReactNode }) {
  return (
    <View style={[styles.disc, { backgroundColor: wash }]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {children}
    </View>
  );
}

function ComingSoonCard({ venue }: { readonly venue: Venue }) {
  const { t } = useT();
  return (
    <LinearGradient
      colors={[colors.ink2, colors.ink3]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={[styles.card, { borderColor: AURORA_EDGE, borderWidth: 1 }]}
      testID="venue.coming_soon"
    >
      <IconDisc wash={AURORA_WASH}>
        <Ionicons name="hourglass-outline" size={24} color={colors.aurora} />
      </IconDisc>
      <LPText serif size={22} tracking={-0.4} color={colors.paper} align="center" accessibilityRole="header">
        {t('venue.coming_soon')}
      </LPText>
      <LPText size={13} color={colors.paper3} align="center">
        {t('venue.coming_soon_body', { name: venue.name })}
      </LPText>
    </LinearGradient>
  );
}

function BookingsUnavailableCard({ venue, onCall }: { readonly venue: Venue; readonly onCall: (url: string) => void }) {
  const { t } = useT();
  const tel = venuePhoneUrl(venue.phone);
  const call = t('venue.call_venue');
  return (
    <View style={[styles.card, styles.plainCard]} testID="venue.no_bookings">
      <IconDisc wash={SIGNAL_WASH}>
        <MaterialCommunityIcons name="calendar-alert" size={22} color={colors.signal} />
      </IconDisc>
      <LPText serif size={20} tracking={-0.3} color={colors.paper} align="center" accessibilityRole="header">
        {t('venue.no_bookings')}
      </LPText>
      <LPText size={13} color={colors.paper3} align="center">
        {t('venue.no_bookings_body', { name: venue.name })}
      </LPText>
      {tel ? (
        <Pressable
          onPress={() => onCall(tel)}
          accessibilityRole="link"
          accessibilityLabel={call}
          style={({ pressed }) => [styles.callButton, pressed && styles.pressed]}
          testID="venue.call"
        >
          <Ionicons name="call-outline" size={15} color={colors.paper} />
          <LPText size={13} weight="semibold" color={colors.paper}>
            {call}
          </LPText>
        </Pressable>
      ) : null}
    </View>
  );
}

function WalkInCard({ venue }: { readonly venue: Venue }) {
  const { t } = useT();
  const price = walkInCardPrice(venue, t);
  return (
    <LinearGradient
      colors={[colors.ink2, colors.ink3]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={[styles.card, { borderColor: RUST_EDGE, borderWidth: 1 }]}
      testID="venue.walkin"
    >
      <IconDisc wash={colors.rust3}>
        <Ionicons name="qr-code-outline" size={26} color={colors.rust2} />
      </IconDisc>
      <LPText serif size={20} tracking={-0.3} color={colors.paper} align="center" accessibilityRole="header">
        {t('venue.walkin_heading')}
      </LPText>
      <LPText size={13} color={colors.paper3} align="center">
        {t('venue.walkin_body')}
      </LPText>
      <View style={styles.priceLines}>
        <View style={styles.priceRow}>
          <View style={styles.priceDot} />
          <LPText size={13} weight="semibold" color={colors.signal} testID="venue.walkin.price">
            {price.primary}
          </LPText>
        </View>
        {price.secondary ? (
          <LPText size={11} color={colors.paper3} align="center" testID="venue.walkin.secondary">
            {price.secondary}
          </LPText>
        ) : null}
      </View>
    </LinearGradient>
  );
}

function ClassList({
  venue,
  slotActivities,
  onBook,
}: {
  readonly venue: Venue;
  readonly slotActivities: readonly BookableActivity[];
  readonly onBook: (activity: BookableActivity) => void;
}) {
  const { t } = useT();
  const fromPrice = activityFromPrice(venue, t);
  return (
    <>
      <SectionTitle title={t('venue.book_a_class')} kicker={t('venue.classes_count', { count: slotActivities.length })} />
      <View style={styles.rows}>
        {slotActivities.map((activity) => {
          const hint = usesClasses(activity.provider) ? t('venue.view_schedule') : t('venue.choose_time');
          return (
            <Pressable
              key={activity.id}
              onPress={() => onBook(activity)}
              accessibilityRole="button"
              accessibilityLabel={[activity.name, hint, fromPrice].filter(Boolean).join(', ')}
              style={({ pressed }) => [styles.activityRow, pressed && styles.pressed]}
              testID={`venue.activity.${activity.id}`}
            >
              <View style={styles.activityDisc}>
                <MaterialCommunityIcons name="calendar-plus" size={20} color={colors.rust2} />
              </View>
              <View style={styles.activityText}>
                <LPText size={15} weight="semibold" color={colors.paper} numberOfLines={2}>
                  {activity.name}
                </LPText>
                <LPText size={12} color={colors.paper3}>
                  {hint}
                </LPText>
                {fromPrice ? (
                  <LPText size={11} weight="semibold" color={colors.signal}>
                    {fromPrice}
                  </LPText>
                ) : null}
              </View>
              <Ionicons name="chevron-forward" size={13} color={colors.paper3} />
            </Pressable>
          );
        })}
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  offers: { gap: 18 },
  classes: { gap: 14 },
  card: {
    padding: 24,
    gap: 14,
    alignItems: 'center',
    borderRadius: 16,
    overflow: 'hidden',
  },
  plainCard: { backgroundColor: colors.ink2, borderWidth: 0.5, borderColor: colors.line },
  disc: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center' },
  callButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 4,
    paddingHorizontal: 16,
    paddingVertical: 9,
    minHeight: 44,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.line2,
  },
  priceLines: { alignItems: 'center', gap: 3 },
  priceRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  priceDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.signal },
  rows: { gap: 10 },
  activityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    backgroundColor: colors.ink2,
    borderRadius: radius.card,
    borderWidth: 0.5,
    borderColor: colors.line,
  },
  activityDisc: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.rust3,
  },
  activityText: { flex: 1, gap: 3 },
  pressed: { opacity: 0.7 },
});
