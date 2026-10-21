/* eslint lifepass/no-literal-copy: "error" */
/**
 * The blocks of a sight's card, top to bottom as iOS AttractionDetailView
 * draws them (./../AttractionDetailScreen.tsx puts them in order).
 *
 * Anything a visitor has to act on (the bathing verdict, the off-road rule,
 * whether a pass covers the pool) is the server's prose, never a string made
 * up here, so the phone and the website cannot say different things about
 * the same place. The rules for what may show live in ../model.ts; these
 * components only draw what it allows.
 */
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import type { ComponentProps } from 'react';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import type {
  AttractionDetail,
  AttractionImage,
  AttractionNearby,
  AttractionPairing,
  AttractionTrailLink,
} from '../../../api/attractions';
import { LPText } from '../../../components/ui';
import { useT } from '../../../i18n';
import { colors, hairline } from '../../../theme';
import AttractionRing from '../AttractionRing';
import {
  creditLine,
  driveLine,
  lengthText,
  pairingDriveText,
  pairingPriceText,
  parkingFeeLine,
  sightDistance,
  trailFacts,
  walkTimeText,
} from '../format';
import {
  accessSentenceKey,
  afterPairings,
  creditedThumbUrl,
  imageAlt,
  imageLicenseLink,
  imageUrl,
  isBathingWarning,
  isHike,
  isPlate,
  locationPreviewRegion,
  nearestRoadNoteMetres,
  PLATE_ASPECT_RATIO,
  PLATE_PAPER,
  returnPairings,
  roadDriveFromReykjavik,
  roadKilometres,
  routeBounds,
  routeRegion,
  sightDisplayName,
  soakPairings,
  sourceDisplayName,
  sourceLink,
  wholeDistanceM,
} from '../model';
import SightImage from './SightImage';
import SightMap from './SightMap';

/** iOS's monospaced figures and kickers (`LPFont.mono`). */
export const MONO = { fontFamily: 'monospace' } as const;

/** A photograph fills a band this tall and may lose its edges doing it. */
export const HERO_HEIGHT = 240;

type MCIName = ComponentProps<typeof MaterialCommunityIcons>['name'];

/** The card's links open through the screen (it owns `Linking`). */
export type OpenUrl = (url: string) => void;

// MARK: - Shared pieces

export function SectionTitle({ text }: { readonly text: string }) {
  return (
    <LPText serif size={22} weight="semibold" color={colors.paper} accessibilityRole="header" style={styles.sectionTitle}>
      {text}
    </LPText>
  );
}

/** A small mono kicker, upper-cased (iOS `Text(...uppercased()).font(LPFont.mono(10)).tracking(1.4)`). */
function MonoKicker({ text, testID }: { readonly text: string; readonly testID?: string }) {
  // TalkBack reads the words as written, not letter by letter in capitals.
  return (
    <LPText size={10} color={colors.paper3} tracking={1.4} style={MONO} accessibilityLabel={text} testID={testID}>
      {text.toUpperCase()}
    </LPText>
  );
}

function Chevron() {
  return <Ionicons name="chevron-forward" size={13} color={colors.paper3} />;
}

// MARK: - Hero

/**
 * Every sight gets a picture: a photograph where a licence-clean one exists,
 * otherwise the server's location plate. Both arrive in `images`, so the card
 * never decides which a place deserves, it only labels them honestly. A plate
 * is shown whole on its own paper (filling a band would cut into the name it
 * prints), a photograph fills a 240 dp band. A card with no image at all (a
 * server from before the plate) shows a still map of the spot instead: a true
 * picture of where the place is, and never a wrong photo.
 */
export function Hero({ detail, onOpenUrl }: { readonly detail: AttractionDetail; readonly onOpenUrl: OpenUrl }) {
  const { language } = useT();
  const image = detail.images[0];
  if (!image) {
    return (
      <SightMap
        region={locationPreviewRegion(detail)}
        marker={{
          coordinate: { latitude: detail.latitude, longitude: detail.longitude },
          tier: detail.tier,
          isSelected: true,
          isTrailhead: isHike(detail),
        }}
        label={detail.name}
        style={styles.heroBand}
        testID="attraction.hero.map"
      />
    );
  }
  const plate = isPlate(image);
  const url = imageUrl(image);
  return (
    <>
      <View
        accessible
        accessibilityRole="image"
        accessibilityLabel={imageAlt(image, language)}
        style={plate ? styles.plateBand : styles.heroBand}
        testID={plate ? 'attraction.hero.plate' : 'attraction.hero.photo'}
      >
        <SightImage
          uri={url}
          contentFit={plate ? 'contain' : 'cover'}
          style={StyleSheet.absoluteFill}
          // A URL that will not load shows the glyph; with no usable URL at
          // all iOS draws the bare band, and so does this.
          placeholder={(phase) =>
            phase === 'failed' && url !== null ? (
              <Ionicons name={plate ? 'map-outline' : 'image-outline'} size={20} color={colors.paper4} />
            ) : null
          }
          testID="attraction.hero.image"
        />
      </View>
      <CreditLine image={image} onOpenUrl={onOpenUrl} />
    </>
  );
}

/**
 * "Photo: {credit} · {license}", or "Map: …" for a plate, generated from the
 * row: Commons requires author and licence per file. Tappable only when the
 * licence has an https URL (CC BY-SA wants the licence one step away wherever
 * the image appears, and the link comes from metadata anyone can edit).
 */
function CreditLine({ image, onOpenUrl }: { readonly image: AttractionImage; readonly onOpenUrl: OpenUrl }) {
  const { t } = useT();
  const line = creditLine(t(isPlate(image) ? 'attraction.map_label' : 'attraction.photo'), image.credit, image.license);
  const link = imageLicenseLink(image);
  const text = (
    <LPText size={11} color={colors.paper3}>
      {line}
    </LPText>
  );
  if (!link) {
    return (
      <View style={styles.credit} testID="attraction.credit">
        {text}
      </View>
    );
  }
  return (
    <Pressable
      onPress={() => onOpenUrl(link)}
      accessibilityRole="link"
      accessibilityLabel={line}
      style={({ pressed }) => [styles.credit, pressed && styles.pressed]}
      testID="attraction.credit"
    >
      {text}
    </Pressable>
  );
}

// MARK: - Header

/**
 * The top-pick badge: light blue and hollow, the ring's own colours, so a
 * recommendation reads as a public place worth the detour and never as a
 * venue, a price or something the pass includes.
 */
export function TopPickBadge() {
  const { t } = useT();
  const label = t('attraction.top_pick');
  return (
    <View style={styles.badge} accessible accessibilityLabel={label} testID="attraction.top_pick">
      <View style={styles.badgeRing}>
        <View style={styles.badgeDot} />
      </View>
      <LPText size={10} color={colors.attraction2} tracking={1.4} style={MONO} accessibilityLabel={label}>
        {label.toUpperCase()}
      </LPText>
    </View>
  );
}

/** "WATERFALL · SOUTH ICELAND", the server's words. */
export function KindRegionKicker({ detail }: { readonly detail: AttractionDetail }) {
  return <MonoKicker text={`${detail.kindLabel} · ${detail.regionLabel}`} testID="attraction.kicker" />;
}

function TravelLabel({ icon, text, testID }: { readonly icon: MCIName; readonly text: string; readonly testID: string }) {
  return (
    <View style={styles.travel} accessible accessibilityLabel={text}>
      <MaterialCommunityIcons name={icon} size={14} color={colors.paper3} style={styles.travelIcon} />
      <LPText size={14} color={colors.paper2} style={styles.flex} testID={testID}>
        {text}
      </LPText>
    </View>
  );
}

/**
 * How the place is reached, in the only terms that hold: the ferry or
 * "offshore" for a place the road does not reach, and for one it does a
 * MEASURED road time from Reykjavík plus, beyond a kilometre from any road,
 * how far that road is. Nothing at all when none is known: a drive estimated
 * from a straight line is how somebody plans an hour for a fjord that takes
 * three.
 */
export function TravelLine({ detail }: { readonly detail: AttractionDetail }) {
  const { t, language } = useT();
  const key = accessSentenceKey(detail);
  if (key) {
    return (
      <TravelLabel icon={detail.roadAccess === 'offshore' ? 'waves' : 'ferry'} text={t(key)} testID="attraction.travel.access" />
    );
  }
  const drive = roadDriveFromReykjavik(detail);
  const roadMetres = nearestRoadNoteMetres(detail);
  if (!drive && roadMetres === null) return null;
  return (
    <View style={styles.travelStack}>
      {drive ? <TravelLabel icon="car" text={driveLine(drive, t)} testID="attraction.travel.drive" /> : null}
      {roadMetres !== null ? (
        <TravelLabel
          icon="road-variant"
          text={t('attraction.nearest_road', { km: roadKilometres(roadMetres, language) })}
          testID="attraction.travel.nearest_road"
        />
      ) : null}
    </View>
  );
}

// MARK: - Facts

/** The rows "The facts" shows: only those the sight has. */
export function factRows(detail: AttractionDetail, t: (key: string, params?: Record<string, string | number>) => string): [string, string][] {
  const rows: [string, string][] = [];
  if (detail.heightM !== null) rows.push([t('attraction.height'), `${detail.heightM} m`]);
  if (detail.lengthM !== null) rows.push([t('attraction.length'), lengthText(detail.lengthM, detail.outAndBack, t)]);
  if (detail.ascentM !== null) rows.push([t('attraction.ascent'), `${detail.ascentM} m`]);
  if (detail.durationMinutes !== null) rows.push([t('attraction.walk_time'), walkTimeText(detail.durationMinutes, detail.outAndBack, t)]);
  if (detail.difficultyLabel !== null) rows.push([t('attraction.difficulty'), detail.difficultyLabel]);
  if (detail.nearestTown !== null) rows.push([t('attraction.nearest_town'), detail.nearestTown]);
  return rows;
}

export function FactsSection({ detail }: { readonly detail: AttractionDetail }) {
  const { t } = useT();
  const rows = factRows(detail, t);
  if (rows.length === 0) return null;
  return (
    <View style={styles.section26} testID="attraction.facts">
      <SectionTitle text={t('attraction.facts')} />
      {rows.map(([label, value]) => (
        <View key={label} style={styles.factRow} accessible accessibilityLabel={`${label}, ${value}`}>
          <LPText size={10} color={colors.paper3} tracking={1.2} style={[MONO, styles.factLabel]} accessibilityLabel={label}>
            {label.toUpperCase()}
          </LPText>
          <LPText size={15} color={colors.paper} align="right" style={styles.flex}>
            {value}
          </LPText>
        </View>
      ))}
    </View>
  );
}

// MARK: - Route

/**
 * The walk, drawn (hikes only), with the ODbL credit directly under it
 * because the line IS OpenStreetMap geometry.
 */
export function RouteSection({ detail }: { readonly detail: AttractionDetail }) {
  const { t } = useT();
  const bounds = routeBounds(detail);
  if (!bounds) return null;
  return (
    <View style={[styles.section26, styles.gap8]} testID="attraction.route">
      <SectionTitle text={t('attraction.route')} />
      <SightMap
        region={routeRegion(bounds)}
        lines={detail.routeLines}
        marker={{ coordinate: { latitude: detail.latitude, longitude: detail.longitude }, isTrailhead: true }}
        label={detail.name}
        style={styles.routeMap}
        testID="attraction.route.map"
      />
      <LPText size={11} color={colors.paper3}>
        {t('attraction.route_credit')}
      </LPText>
    </View>
  );
}

// MARK: - Walk links

function TrailLinkRow({
  link,
  isTrailhead,
  onPress,
}: {
  readonly link: AttractionTrailLink;
  readonly isTrailhead: boolean;
  readonly onPress: () => void;
}) {
  const { t, language } = useT();
  const name = sightDisplayName(link, language);
  const facts = trailFacts(link, t);
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={facts ? `${name}, ${facts}` : name}
      style={({ pressed }) => [styles.linkRow, pressed && styles.pressed]}
      testID={`attraction.trail.${link.slug}`}
    >
      <AttractionRing isTrailhead={isTrailhead} frame={28} />
      <View style={[styles.flex, styles.gap3]}>
        <LPText size={15} weight="semibold" color={colors.paper} numberOfLines={2}>
          {name}
        </LPText>
        {facts ? (
          <LPText size={10} color={colors.paper3} tracking={1.1} style={MONO}>
            {facts}
          </LPText>
        ) : null}
      </View>
      <Chevron />
    </Pressable>
  );
}

/** For a walk: the sight it leads to, one tap away, on the same stack. */
export function WalkDestinationSection({
  detail,
  onOpenSight,
}: {
  readonly detail: AttractionDetail;
  readonly onOpenSight: (slug: string) => void;
}) {
  const { t } = useT();
  const sight = detail.forAttraction;
  if (!sight) return null;
  return (
    <View style={styles.section30} testID="attraction.walk_destination">
      <SectionTitle text={t('attraction.walk_destination')} />
      <TrailLinkRow link={sight} isTrailhead={false} onPress={() => onOpenSight(sight.slug)} />
    </View>
  );
}

/** For a sight: the walks that lead to it, each opening the walk's own card, route drawn. */
export function RelatedTrailsSection({
  detail,
  onOpenSight,
}: {
  readonly detail: AttractionDetail;
  readonly onOpenSight: (slug: string) => void;
}) {
  const { t } = useT();
  if (detail.relatedTrails.length === 0) return null;
  return (
    <View style={styles.section30} testID="attraction.related_trails">
      <SectionTitle text={t('attraction.trails_title')} />
      {detail.relatedTrails.map((link) => (
        <TrailLinkRow key={link.slug} link={link} isTrailhead onPress={() => onOpenSight(link.slug)} />
      ))}
    </View>
  );
}

// MARK: - Getting there

/**
 * Notes, the 4x4 sentence, the parking fee, seasonal access, bathing safety,
 * the public-access rule, then Directions.
 *
 * Bathing safety shows whenever the API sends it, including "we have not
 * verified this", which is a real answer: staying quiet about an unchecked
 * hot spring would read as permission, and some are near boiling. The access
 * rule is legally required (Náttúruverndarlög), so it ships with the data.
 */
export function GettingThereSection({
  detail,
  onDirections,
}: {
  readonly detail: AttractionDetail;
  readonly onDirections: () => void;
}) {
  const { t } = useT();
  const bathing = detail.bathing;
  const warning = bathing ? isBathingWarning(bathing) : false;
  return (
    <View style={[styles.section26, styles.gap12]} testID="attraction.getting_there">
      <SectionTitle text={t('attraction.getting_there')} />
      {detail.accessNotes ? (
        <LPText size={15} color={colors.paper2}>
          {detail.accessNotes}
        </LPText>
      ) : null}
      {detail.requiresFourWheelDrive ? (
        <LPText size={15} weight="semibold" color={colors.paper} testID="attraction.four_wheel_drive">
          {t('attraction.four_wheel_drive')}
        </LPText>
      ) : null}
      {detail.parkingFeeIsk !== null && detail.parkingFeeIsk > 0 ? (
        <LPText size={15} color={colors.paper2} testID="attraction.parking_fee">
          {parkingFeeLine(detail.parkingFeeIsk, t)}
        </LPText>
      ) : null}
      {detail.seasonalAccess ? (
        <LPText size={15} color={colors.paper2}>
          {detail.seasonalAccess}
        </LPText>
      ) : null}
      {bathing ? (
        <View style={[styles.bathing, warning ? styles.bathingWarning : styles.bathingCalm]} testID={warning ? 'attraction.bathing.warning' : 'attraction.bathing'}>
          <LPText size={14} weight={warning ? 'semibold' : 'regular'} color={warning ? colors.paper : colors.paper2}>
            {bathing.text}
          </LPText>
        </View>
      ) : null}
      {detail.accessRule ? (
        <LPText size={13} color={colors.paper3} testID="attraction.access_rule">
          {detail.accessRule}
        </LPText>
      ) : null}
      <Pressable
        onPress={onDirections}
        accessibilityRole="button"
        accessibilityLabel={t('attraction.directions')}
        style={({ pressed }) => [styles.directions, pressed && styles.pressed]}
        testID="attraction.directions"
      >
        <LPText size={15} weight="semibold" color={colors.ink} align="center">
          {t('attraction.directions')}
        </LPText>
      </Pressable>
    </View>
  );
}

// MARK: - Soak

function PairingRow({ pairing, onPress }: { readonly pairing: AttractionPairing; readonly onPress: () => void }) {
  const { t } = useT();
  const drive = pairingDriveText(pairing, t);
  const price = pairingPriceText(pairing, t);
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${pairing.venueName}, ${drive}, ${price}`}
      style={({ pressed }) => [styles.pairingRow, pressed && styles.pressed]}
      testID={`attraction.pairing.${pairing.venueSlug}`}
    >
      <View style={styles.pairingTop}>
        <LPText size={15} weight="semibold" color={colors.paper} style={styles.flex}>
          {pairing.venueName}
        </LPText>
        <LPText size={10} color={colors.paper3} tracking={1.1} style={MONO}>
          {drive}
        </LPText>
        <Chevron />
      </View>
      <LPText size={13} color={colors.paper2} testID={`attraction.pairing.${pairing.venueSlug}.price`}>
        {price}
      </LPText>
    </Pressable>
  );
}

/**
 * "Soak here afterwards": only what `soakPairings` allows, a short drive to a
 * pool on the sight's own island, never a crossing. A row opens the venue's
 * page on the same stack: the card has just named a real pool and a real
 * drive, and the next thing anyone wants is its hours and price.
 */
export function SoakSection({
  detail,
  onOpenVenue,
}: {
  readonly detail: AttractionDetail;
  readonly onOpenVenue: (slug: string) => void;
}) {
  const { t } = useT();
  if (soakPairings(detail).length === 0) return null;
  const after = afterPairings(detail);
  const back = returnPairings(detail);
  return (
    <View style={[styles.section30, styles.gap10]} testID="attraction.soak">
      <MonoKicker text={t('attraction.after_this')} />
      <LPText serif size={24} weight="semibold" color={colors.paper} accessibilityRole="header">
        {t('attraction.soak_title')}
      </LPText>
      {after.map((pairing) => (
        <PairingRow key={pairing.venueSlug} pairing={pairing} onPress={() => onOpenVenue(pairing.venueSlug)} />
      ))}
      {back.length > 0 ? (
        <>
          <View style={styles.returnKicker}>
            <MonoKicker text={t('attraction.on_the_way_back')} />
          </View>
          {back.map((pairing) => (
            <PairingRow key={pairing.venueSlug} pairing={pairing} onPress={() => onOpenVenue(pairing.venueSlug)} />
          ))}
        </>
      ) : null}
    </View>
  );
}

// MARK: - Nearby

/**
 * One row of "Nearby sights". A photograph only when it came with its
 * photographer and licence, and then both print under the name in full: CC
 * BY-SA wants the credit wherever the image appears, a 56 dp thumbnail
 * included, and a licence cut off by a line limit is not a licence. Anything
 * else (a plate, an older server, a photo that will not load) draws the
 * sight's ring, so the row still cannot pass for a venue.
 */
function NearbySightRow({ item, onPress }: { readonly item: AttractionNearby; readonly onPress: () => void }) {
  const { t, language } = useT();
  const [photoFailed, setPhotoFailed] = useState(false);
  const thumb = creditedThumbUrl(item);
  const showsPhoto = thumb !== null && !photoFailed;
  const name = sightDisplayName(item, language);
  const metres = wholeDistanceM(item);
  const distance = metres === null ? null : sightDistance(metres);
  const credit =
    showsPhoto && item.thumbCredit !== null && item.thumbLicense !== null
      ? creditLine(t('attraction.photo'), item.thumbCredit, item.thumbLicense)
      : null;
  const ring = <AttractionRing isTrailhead={isHike(item)} testID={`attraction.nearby.${item.slug}.ring`} />;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      // The whole row, as VoiceOver reads iOS's NavigationLink: the photo's
      // credit too while the photo shows (CC BY-SA wants it reachable).
      accessibilityLabel={[name, credit, distance].filter(Boolean).join(', ')}
      style={({ pressed }) => [styles.linkRow, pressed && styles.pressed]}
      testID={`attraction.nearby.${item.slug}`}
    >
      <View style={styles.thumb}>
        {showsPhoto ? (
          <SightImage
            uri={thumb}
            contentFit="cover"
            style={StyleSheet.absoluteFill}
            placeholder={(phase) => (phase === 'failed' ? ring : null)}
            onFailed={() => setPhotoFailed(true)}
            testID={`attraction.nearby.${item.slug}.photo`}
          />
        ) : (
          ring
        )}
      </View>
      <View style={[styles.flex, styles.gap3]}>
        <LPText size={15} weight="semibold" color={colors.paper} numberOfLines={2}>
          {name}
        </LPText>
        {credit ? (
          <LPText size={11} color={colors.paper3} testID={`attraction.nearby.${item.slug}.credit`}>
            {credit}
          </LPText>
        ) : null}
      </View>
      {distance ? (
        <LPText size={10} color={colors.paper3} tracking={1.1} style={MONO} testID={`attraction.nearby.${item.slug}.distance`}>
          {distance}
        </LPText>
      ) : null}
      <Chevron />
    </Pressable>
  );
}

/**
 * Other sights close by, closest first, each pushing its card on the same
 * stack so a member can walk a valley card by card. The distance is a
 * straight line and the caption says so: in Iceland the road between two
 * places 10 km apart can be 90 km round a fjord.
 */
export function NearbySection({
  detail,
  onOpenSight,
}: {
  readonly detail: AttractionDetail;
  readonly onOpenSight: (slug: string) => void;
}) {
  const { t } = useT();
  if (detail.nearby.length === 0) return null;
  return (
    <View style={styles.section30} testID="attraction.nearby">
      <SectionTitle text={t('attraction.nearby_title')} />
      <LPText size={12} color={colors.paper3} style={styles.nearbyCaption}>
        {t('attraction.nearby_straight_line')}
      </LPText>
      {detail.nearby.map((item) => (
        <NearbySightRow key={item.slug} item={item} onPress={() => onOpenSight(item.slug)} />
      ))}
    </View>
  );
}

// MARK: - Sources

/**
 * ODbL and CC BY-SA both want the credit reachable wherever the data
 * appears, an app included: the attribution, then each source with an https
 * link.
 */
export function SourcesSection({ detail, onOpenUrl }: { readonly detail: AttractionDetail; readonly onOpenUrl: OpenUrl }) {
  const { t } = useT();
  return (
    <View style={[styles.section30, styles.gap8]} testID="attraction.sources">
      <MonoKicker text={t('attraction.sources')} />
      {detail.attribution !== null ? (
        <LPText size={12} color={colors.paper3}>
          {detail.attribution}
        </LPText>
      ) : null}
      {detail.sources.map((source) => {
        const link = sourceLink(source);
        if (!link) return null;
        const label = `${sourceDisplayName(source)} (${source.license})`;
        return (
          <Pressable
            key={`${source.source}:${source.sourceId}`}
            onPress={() => onOpenUrl(link)}
            accessibilityRole="link"
            accessibilityLabel={label}
            style={({ pressed }) => pressed && styles.pressed}
            testID={`attraction.source.${source.source}`}
          >
            <LPText size={12} color={colors.paper2} style={styles.underline}>
              {label}
            </LPText>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  gap3: { gap: 3 },
  gap8: { gap: 8 },
  gap10: { gap: 10 },
  gap12: { gap: 12 },
  pressed: { opacity: 0.7 },
  sectionTitle: { paddingBottom: 6 },
  section26: { paddingHorizontal: 20, paddingTop: 26 },
  section30: { paddingHorizontal: 20, paddingTop: 30 },

  heroBand: { width: '100%', height: HERO_HEIGHT, backgroundColor: colors.ink3 },
  plateBand: { width: '100%', aspectRatio: PLATE_ASPECT_RATIO, backgroundColor: PLATE_PAPER },
  credit: { paddingHorizontal: 20, paddingTop: 6 },

  badge: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.attraction,
  },
  badgeRing: {
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: colors.attraction,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeDot: { width: 4, height: 4, borderRadius: 2, backgroundColor: colors.attraction },

  travelStack: { gap: 6 },
  travel: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  travelIcon: { marginTop: 2 },

  factRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    paddingVertical: 10,
    borderBottomWidth: hairline,
    borderBottomColor: colors.line,
  },
  factLabel: { marginRight: 16 },

  routeMap: { height: 220, borderRadius: 12 },

  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
    borderTopWidth: hairline,
    borderTopColor: colors.line,
  },
  thumb: {
    width: 56,
    height: 56,
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: colors.ink3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  nearbyCaption: { paddingBottom: 8 },

  bathing: { padding: 12, borderLeftWidth: 2 },
  bathingWarning: { backgroundColor: colors.ink2, borderLeftColor: colors.paper },
  bathingCalm: { borderLeftColor: colors.line },

  directions: {
    marginTop: 4,
    paddingVertical: 13,
    borderRadius: 999,
    backgroundColor: colors.paper,
    alignItems: 'center',
  },

  pairingRow: {
    gap: 3,
    paddingVertical: 10,
    borderTopWidth: hairline,
    borderTopColor: colors.line,
  },
  pairingTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  returnKicker: { paddingTop: 8 },

  underline: { textDecorationLine: 'underline' },
});
