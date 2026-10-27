/* eslint lifepass/no-literal-copy: "error" */
/**
 * The three kinds of card in a day plan (iOS CoachPlanView.swift
 * `PlanVenueCard`, `PlanClassCard`, `PlanSightCard`, `DistanceLine`), one
 * column width for every kind (250), in the Coach's dark glass over a little
 * of the photo's own ink: these cards carry text where the venue card
 * carries a photo, and white text straight on a bright sky does not read.
 *
 * Each kind keeps its own honesty rules:
 * - a venue is drawn from the plan's own fields until its full row loads,
 *   then as the same card the carousel shows (heart, price pill; drawn by
 *   PlanMessage with COACH-1's `VenueMiniCard`);
 * - a class books through the Classes tab's sheet on that exact session;
 * - a sight is a public place: a photo only with its photographer's credit,
 *   the plate shown whole on its paper, and a distance that says which kind
 *   of distance it is (a straight line is never a drive).
 */
import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { LPText, normaliseImageUrl } from '../../../components/ui';
import { hiddenFromAccessibility } from '../../../components/ui/a11y';
import { venueWithRoom } from '../../../copy/classRoom';
import { useT } from '../../../i18n';
import { colors } from '../../../theme';
import { AttractionRing, kindRegionLine, PLATE_PAPER } from '../../attractions';
import type { CoachPlanClass } from '../../classes/sheet';
import type { CoachPlanDistance, CoachPlanSight, CoachPlanVenue } from '../dayPlan/decode';
import { coachPalette } from '../theme/palette';
import PlanCardImage from './PlanCardImage';
import {
  classWhenLine,
  distanceIcon,
  isPlanSightPlate,
  planSightCreditLine,
  planSightImageUrl,
  planSightTravelLine,
  type TravelIcon,
} from './format';

/** One column width for every kind of card, so the sequence reads as one list (iOS `cardWidth`). */
export const PLAN_CARD_WIDTH = 250;

/** The steps and chips sit this far in, clear of the avatar (iOS `.padding(.leading, 34)`). */
export const PLAN_INDENT = 34;
/** A step's slot label, note and card sit this far right of the rail. */
export const PLAN_STEP_INSET = 24;
/** The chat's own padding on each side (CoachScreen's `chat` style). */
const CHAT_PADDING = 16;

/** What sits beside a card on each row of the chat. */
const PLAN_CARD_SURROUND = CHAT_PADDING * 2 + PLAN_INDENT + PLAN_STEP_INSET;

/**
 * The card width for a window `windowWidth` wide: iOS's 250 ("fits beside the
 * rail on a 375 pt phone"), narrowed on a smaller window so Book and See the
 * place stay on screen. Android phones go well under 340 dp once Display size
 * is raised, which iPhones never do.
 */
export function planCardWidth(windowWidth: number): number {
  return Math.max(0, Math.min(PLAN_CARD_WIDTH, Math.floor(windowWidth - PLAN_CARD_SURROUND)));
}

/**
 * The card's fill: the Coach's glass (rgb 10 20 46 at 0.72) laid over the
 * photo's ink (rgb 8 14 30 at 0.38), as iOS stacks the two backgrounds
 * (`coachPlanCard`), flattened into one colour: alpha 0.72 + 0.38 x 0.28.
 */
const CARD_FILL = 'rgba(10,19,44,0.83)';

/** iOS's SF Symbols, as Ionicons: `car.fill`, `location` (the arrow), `car`, `ferry`. */
const ICONS: Readonly<Record<TravelIcon, keyof typeof Ionicons.glyphMap>> = {
  drive: 'car',
  straight: 'navigate-outline',
  road: 'car-outline',
  ferry: 'boat-outline',
};

/** A travel line: the filled car only for a measured drive, an arrow for a straight line (./format.ts `TravelIcon`). */
export function TravelLineView({ text, icon, testID }: { text: string; icon: TravelIcon; testID?: string }) {
  return (
    <View style={styles.travel} testID={testID}>
      <Ionicons name={ICONS[icon]} size={11} color={coachPalette.textSecondary} {...hiddenFromAccessibility} testID={testID ? `${testID}.${icon}` : undefined} />
      <LPText size={12} weight="medium" color={coachPalette.textSecondary} numberOfLines={1} style={styles.flexShrink}>
        {text}
      </LPText>
    </View>
  );
}

/** A step's own distance (iOS `DistanceLine`). */
export function DistanceLine({ text, basis, testID }: { text: string; basis: CoachPlanDistance['basis'] | null; testID?: string }) {
  return <TravelLineView text={text} icon={distanceIcon(basis)} testID={testID} />;
}

// MARK: - Venue (before its full row arrives)

/**
 * Drawn from the plan's own fields until the venue's full row loads (or if
 * it never does), in the carousel card's shape. No heart: that needs the
 * venue's id, which only the full row carries.
 */
export function PlanVenueCard({
  venue,
  detailLine,
  onOpen,
  width = PLAN_CARD_WIDTH,
}: {
  venue: CoachPlanVenue;
  detailLine: string | null;
  onOpen: () => void;
  width?: number;
}) {
  const { t } = useT();
  const imageUrl = normaliseImageUrl(venue.imageUrl);
  return (
    <View style={[styles.card, { width }]} testID={`coach.plan.venue.${venue.slug}`}>
      {/* The Coach's tile, bare until a photo loads (or if none does): no placeholder glyph, as iOS. */}
      <View style={[styles.venueBand, { width }]} testID={`coach.plan.venue.${venue.slug}.band`}>
        {imageUrl !== null ? (
          <PlanCardImage uri={imageUrl} contentFit="cover" testID={`coach.plan.venue.${venue.slug}.image`} />
        ) : null}
      </View>
      <View style={styles.venueInfo}>
        <LPText size={14} weight="semibold" color="#FFFFFF" numberOfLines={1}>
          {venue.name}
        </LPText>
        {venue.city ? (
          <LPText size={12} color={coachPalette.textMeta} numberOfLines={1}>
            {venue.city}
          </LPText>
        ) : null}
        {detailLine ? (
          <LPText size={12} weight="medium" color={coachPalette.textSecondary} numberOfLines={1}>
            {detailLine}
          </LPText>
        ) : null}
        {venue.priceLabel ? (
          <View style={styles.pricePill}>
            <LPText size={11} weight="semibold" color={coachPalette.textPrimary}>
              {venue.priceLabel}
            </LPText>
          </View>
        ) : null}
      </View>
      <Pressable
        onPress={onOpen}
        style={({ pressed }) => [styles.button, styles.venueButton, pressed && styles.pressed]}
        accessibilityRole="button"
        accessibilityLabel={`${t('coach.venue.book_it')}, ${venue.name}`}
        testID={`coach.plan.venue.${venue.slug}.book`}
      >
        <LPText size={13} weight="semibold" color="#FFFFFF">
          {t('coach.venue.book_it')}
        </LPText>
      </Pressable>
    </View>
  );
}

// MARK: - Class

/**
 * A class step: when (Reykjavík time), what, where (the venue, with the
 * class's room after it when the plan names one: "Hress · Salur 3", API
 * 0.44.0), how far, and Book. The feed lookup can take a moment when the plan
 * carried no booking handle; the button shows a spinner and ignores a second
 * tap meanwhile.
 */
export function PlanClassCard({
  session,
  distance,
  basis,
  onBook,
  width = PLAN_CARD_WIDTH,
}: {
  session: CoachPlanClass;
  distance: string | null;
  basis: CoachPlanDistance['basis'] | null;
  onBook: (session: CoachPlanClass) => Promise<void>;
  width?: number;
}) {
  const { t, language } = useT();
  const [resolving, setResolving] = useState(false);
  const resolvingRef = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    // Armed in the body too: Fast Refresh (and StrictMode) run the cleanup
    // and then this again on a card that is still on screen.
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const title = session.title ?? t('classes.unnamed');
  const book = () => {
    if (resolvingRef.current) return;
    resolvingRef.current = true;
    setResolving(true);
    void onBook(session).finally(() => {
      resolvingRef.current = false;
      if (mounted.current) setResolving(false);
    });
  };

  return (
    <View style={[styles.card, styles.padded, { width }]} testID={`coach.plan.class.${session.id}`}>
      <View style={styles.iconRow}>
        <Ionicons name="calendar-outline" size={12} color={coachPalette.textPrimary} {...hiddenFromAccessibility} />
        <LPText size={12} weight="semibold" color={coachPalette.textPrimary} numberOfLines={1} style={styles.flexShrink}>
          {classWhenLine(session, language, t)}
        </LPText>
      </View>
      <LPText size={15} weight="semibold" color="#FFFFFF" numberOfLines={2}>
        {title}
      </LPText>
      <View style={styles.iconRow}>
        <Ionicons name="location-sharp" size={11} color={coachPalette.textMeta} {...hiddenFromAccessibility} />
        <LPText
          size={12}
          color={coachPalette.textMeta}
          // A second line for the room, so a long venue name never cuts it off.
          numberOfLines={session.room ? 2 : 1}
          style={styles.flexShrink}
          testID={`coach.plan.class.${session.id}.venue`}
        >
          {venueWithRoom(session.venueName, session.room)}
        </LPText>
      </View>
      {distance ? <DistanceLine text={distance} basis={basis} testID={`coach.plan.class.${session.id}.distance`} /> : null}
      <Pressable
        onPress={book}
        style={({ pressed }) => [styles.button, styles.classButton, pressed && styles.pressed]}
        accessibilityRole="button"
        accessibilityLabel={`${t('coach.plan.class.book')}, ${title}`}
        accessibilityState={{ busy: resolving }}
        testID={`coach.plan.class.${session.id}.book`}
      >
        <LPText size={13} weight="semibold" color="#FFFFFF" style={resolving ? styles.hidden : undefined}>
          {t('coach.plan.class.book')}
        </LPText>
        {resolving ? (
          <ActivityIndicator color="#FFFFFF" size="small" style={StyleSheet.absoluteFill} testID={`coach.plan.class.${session.id}.spinner`} />
        ) : null}
      </Pressable>
    </View>
  );
}

// MARK: - Sight

/**
 * A sight step: the photo (credited), the plate (a map, shown whole) or the
 * ring; the credit; the name; "Waterfall · South Iceland"; how to get there;
 * "See the place". The whole card opens the sight's card.
 */
export function PlanSightCard({
  sight,
  distance,
  basis,
  onOpen,
  width = PLAN_CARD_WIDTH,
}: {
  sight: CoachPlanSight;
  distance: string | null;
  basis: CoachPlanDistance['basis'] | null;
  onOpen: () => void;
  width?: number;
}) {
  const { t } = useT();
  const [photoFailed, setPhotoFailed] = useState(false);
  const onPhotoFailed = useCallback(() => setPhotoFailed(true), []);
  const plate = isPlanSightPlate(sight);
  const imageUrl = planSightImageUrl(sight);
  const credit = planSightCreditLine(sight, photoFailed, t);
  const travel = planSightTravelLine(sight, distance, basis, t);
  const ring = <AttractionRing tier="top" isTrailhead={sight.kind === 'hike'} frame={34} />;

  return (
    <Pressable
      onPress={onOpen}
      style={({ pressed }) => [styles.card, { width }, pressed && styles.pressed]}
      accessibilityRole="button"
      testID={`coach.plan.sight.${sight.slug}`}
    >
      <View style={[styles.sightBand, { width, backgroundColor: plate ? PLATE_PAPER : coachPalette.tile }]}>
        {imageUrl !== null && !photoFailed ? (
          <PlanCardImage
            uri={imageUrl}
            contentFit={plate ? 'contain' : 'cover'}
            fallback={ring}
            onFailed={onPhotoFailed}
            testID={`coach.plan.sight.${sight.slug}.image`}
          />
        ) : (
          <View style={styles.ringBox} testID={`coach.plan.sight.${sight.slug}.ring`}>
            {ring}
          </View>
        )}
      </View>
      <View style={styles.sightInfo}>
        {credit ? (
          <LPText size={10} color={coachPalette.textMeta} numberOfLines={1} testID={`coach.plan.sight.${sight.slug}.credit`}>
            {credit}
          </LPText>
        ) : null}
        <LPText size={14} weight="semibold" color="#FFFFFF" numberOfLines={2}>
          {sight.name}
        </LPText>
        <LPText size={12} color={coachPalette.textMeta} numberOfLines={1}>
          {kindRegionLine(sight, (key) => t(key))}
        </LPText>
        {travel ? <TravelLineView text={travel.text} icon={travel.icon} testID={`coach.plan.sight.${sight.slug}.travel`} /> : null}
        <View style={[styles.iconRow, styles.openRow]}>
          <LPText size={12} weight="semibold" color={colors.aurora}>
            {t('coach.plan.sight.open')}
          </LPText>
          <Ionicons name="chevron-forward" size={11} color={colors.aurora} {...hiddenFromAccessibility} />
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: CARD_FILL,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: coachPalette.glassStroke,
    overflow: 'hidden',
  },
  venueBand: { height: 110, overflow: 'hidden', backgroundColor: coachPalette.tile },
  padded: { padding: 12, gap: 6 },
  venueInfo: { paddingHorizontal: 10, paddingTop: 10, paddingBottom: 6, gap: 4, alignItems: 'flex-start' },
  pricePill: {
    marginTop: 2,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: coachPalette.tile,
    borderWidth: 1,
    borderColor: coachPalette.stroke,
  },
  button: {
    minHeight: 40,
    paddingVertical: 9,
    borderRadius: 10,
    backgroundColor: coachPalette.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  venueButton: { marginHorizontal: 10, marginBottom: 10 },
  classButton: { marginTop: 4 },
  pressed: { opacity: 0.85 },
  hidden: { opacity: 0 },
  iconRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  travel: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  flexShrink: { flexShrink: 1 },
  sightBand: { height: 120, overflow: 'hidden' },
  ringBox: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  sightInfo: { padding: 10, gap: 4, alignItems: 'flex-start' },
  openRow: { gap: 4, marginTop: 2 },
});
