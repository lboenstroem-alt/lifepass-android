/* eslint lifepass/no-literal-copy: "error" */
// The floating bar above the tab bar (iOS VenueDetailView `floatingAction`),
// one of the shapes of `venueBar` (../model.ts):
//
//   scan            walk-ins only: one full-width "Scan the QR code" pill with
//                   the price and an arrow. No "Book" words: there is nothing
//                   to book, the member shows up and scans at the door.
//   scanAndClasses  walk-ins AND bookable classes (2.5.4): "Book a class",
//                   which scrolls to the class list rather than guessing the
//                   class, beside "Scan QR" with its price line. Equal widths,
//                   sized to fit a narrow phone in Icelandic.
//   book            classes only: "Bookable", the first class's name, and a
//                   "Book" pill that opens the booking flow for it.
//   none            awaiting connection, or nothing to do: no bar.
//
// Every filled pill is the action blue (#2F6699): its white label is 6.0:1
// and the 85 % white price line 4.9:1, where white on the brand blue was
// 3.9:1, below AA for text that size (iOS 2.5.4). Scan pushes the scanner
// with a back button to this venue.
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { Pressable, StyleSheet, View } from 'react-native';

import { Kicker, LPText } from '../../../components/ui';
import type { BookableActivity } from '../../../api/walkInPreview';
import { useT } from '../../../i18n';
import { colors } from '../../../theme';
import type { Venue } from '../../../types/venue';
import { venueBar, walkInBarPrice } from '../model';
import { BAR_MATERIAL } from './shared';

/** The bar's pills (iOS `.frame(height: 56)`). */
export const BAR_HEIGHT = 56;

/** 85 % white: the Scan pill's price, 4.9:1 on the action blue. */
const PRICE_ON_ACTION = 'rgba(255,255,255,0.85)';

export interface FloatingBarProps {
  readonly venue: Venue;
  readonly slotActivities: readonly BookableActivity[];
  readonly onScan: () => void;
  readonly onBookAClass: () => void;
  readonly onBook: (activity: BookableActivity) => void;
}

export default function FloatingBar({ venue, slotActivities, onScan, onBookAClass, onBook }: FloatingBarProps) {
  const { t } = useT();
  const bar = venueBar(venue, slotActivities);
  switch (bar.kind) {
    case 'none':
      return null;

    case 'scan': {
      const label = t('venue.scan_qr');
      const price = walkInBarPrice(venue, t);
      return (
        <Pressable
          onPress={onScan}
          accessibilityRole="button"
          accessibilityLabel={`${label}, ${price}`}
          style={({ pressed }) => [styles.scanPill, styles.actionShadow, pressed && styles.pressed]}
          testID="venue.bar.scan"
        >
          <MaterialCommunityIcons name="qrcode-scan" size={19} color={colors.onAccent} />
          <LPText size={15} weight="semibold" tracking={-0.1} color={colors.onAccent} numberOfLines={1} style={styles.grow}>
            {label}
          </LPText>
          <LPText size={13} weight="semibold" color={PRICE_ON_ACTION} numberOfLines={1}>
            {price}
          </LPText>
          <Ionicons name="arrow-forward" size={14} color={colors.onAccent} />
        </Pressable>
      );
    }

    case 'scanAndClasses': {
      const classes = t('venue.book_a_class');
      const scan = t('venue.scan_short');
      const price = walkInBarPrice(venue, t);
      return (
        <View style={styles.split}>
          <Pressable
            onPress={onBookAClass}
            accessibilityRole="button"
            accessibilityLabel={classes}
            style={({ pressed }) => [styles.half, styles.classesPill, pressed && styles.pressed]}
            testID="venue.bar.classes"
          >
            <Ionicons name="calendar-outline" size={17} color={colors.paper} />
            <LPText
              size={15}
              weight="semibold"
              tracking={-0.1}
              color={colors.paper}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.75}
              style={styles.shrink}
            >
              {classes}
            </LPText>
          </Pressable>
          <Pressable
            onPress={onScan}
            accessibilityRole="button"
            accessibilityLabel={`${scan}, ${price}`}
            style={({ pressed }) => [styles.half, styles.scanHalf, styles.actionShadow, pressed && styles.pressed]}
            testID="venue.bar.scan"
          >
            <MaterialCommunityIcons name="qrcode-scan" size={19} color={colors.onAccent} />
            <View style={styles.shrink}>
              <LPText
                size={15}
                weight="semibold"
                tracking={-0.1}
                color={colors.onAccent}
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.75}
              >
                {scan}
              </LPText>
              <LPText
                size={12}
                weight="semibold"
                color={colors.onAccent}
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.75}
              >
                {price}
              </LPText>
            </View>
          </Pressable>
        </View>
      );
    }

    case 'book': {
      const book = t('home.book');
      return (
        <View style={styles.bookBar} testID="venue.bar.bookable">
          <View style={styles.grow}>
            <Kicker text={t('venue.bookable')} color={colors.paper3} />
            <LPText size={14} weight="semibold" color={colors.paper} numberOfLines={1}>
              {bar.activity.name}
            </LPText>
          </View>
          <Pressable
            onPress={() => onBook(bar.activity)}
            accessibilityRole="button"
            accessibilityLabel={`${book}, ${bar.activity.name}`}
            style={({ pressed }) => [styles.bookPill, styles.actionShadow, pressed && styles.pressed]}
            testID="venue.bar.book"
          >
            <LPText size={13} weight="bold" color={colors.onAccent}>
              {book}
            </LPText>
          </Pressable>
        </View>
      );
    }
  }
}

const styles = StyleSheet.create({
  grow: { flex: 1 },
  shrink: { flexShrink: 1 },
  scanPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: BAR_HEIGHT,
    paddingHorizontal: 18,
    borderRadius: 16,
    backgroundColor: colors.actionFill,
  },
  actionShadow: {
    shadowColor: colors.actionFill,
    shadowOpacity: 0.35,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
  },
  split: { flexDirection: 'row', gap: 10 },
  half: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    minHeight: BAR_HEIGHT,
    paddingHorizontal: 12,
    borderRadius: 16,
  },
  classesPill: {
    backgroundColor: colors.ink,
    borderWidth: 1,
    borderColor: colors.line2,
    shadowColor: '#000000',
    shadowOpacity: 0.12,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 4,
  },
  scanHalf: { backgroundColor: colors.actionFill },
  bookBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 10,
    paddingLeft: 14,
    borderRadius: 16,
    backgroundColor: BAR_MATERIAL,
    borderWidth: 0.5,
    borderColor: colors.line2,
    shadowColor: '#000000',
    shadowOpacity: 0.45,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 12 },
    elevation: 10,
  },
  bookPill: {
    minHeight: 44,
    paddingHorizontal: 18,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 999,
    backgroundColor: colors.actionFill,
  },
  pressed: { opacity: 0.85 },
});
