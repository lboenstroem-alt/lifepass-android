/* eslint lifepass/no-literal-copy: "error" */
/**
 * A saved hike or sight on Favourites' "Hikes & sights" (API 0.45.0, a
 * `FavouriteAttraction`): its picture, its name, "Waterfall · South Iceland"
 * (the server's words), a walk's length and time as the sight card writes
 * them, and the button that takes it off the list. The row opens the place's
 * card. Published as a slot (eslint/lifepass-plugin.js) for the Saved lists
 * (src/features/library/saved), because the picture rules are the sights':
 *
 *   - the location plate (`imageIsMapPlate`) is a map: shown whole on its
 *     paper, and never credited as a photo;
 *   - a photograph shows only with its author AND licence, and then both
 *     print under it in full ("Photo: Jane Doe · CC BY-SA 4.0", never cut by
 *     a line limit: CC BY-SA wants the credit wherever the picture appears);
 *   - anything else (a photo without its credit, no picture, one that will not
 *     load) draws the place's ring, so a row never shows an uncredited photo
 *     and never passes for a venue.
 *
 * TalkBack reads the row as one button (name, kind and region, the walk's
 * figures, the credit) and the remove button on its own: "Remove Skógafoss
 * from favourites" / "Fjarlægja úr uppáhalds: Skógafoss".
 */
import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { resolveAttractionAsset } from '../../api/attractions';
import { hiddenFromAccessibility, LPText } from '../../components/ui';
import { useT, type Params } from '../../i18n';
import { colors, hairline } from '../../theme';
import type { FavouriteAttraction } from '../favourites';
import AttractionRing from './AttractionRing';
import SightImage from './detail/SightImage';
import { creditLine, trailFacts } from './format';
import { isHike, PLATE_PAPER } from './model';
import { kindLabel, regionLabel } from './rules';
import { SIGHT_HEART_SIZE } from './SightHeart';

/** What a saved place's tile shows (see the file comment). */
export type SavedSightPicture =
  | { readonly kind: 'plate'; readonly uri: string }
  | { readonly kind: 'photo'; readonly uri: string; readonly credit: string; readonly license: string }
  | { readonly kind: 'ring' };

/** The plate rule and the photo-with-credit rule, as one decision. */
export function savedSightPicture(
  place: Pick<FavouriteAttraction, 'imageUrl' | 'imageIsMapPlate' | 'imageCredit' | 'imageLicense'>,
): SavedSightPicture {
  const uri = resolveAttractionAsset(place.imageUrl);
  if (uri === null) return { kind: 'ring' };
  if (place.imageIsMapPlate) return { kind: 'plate', uri };
  if (place.imageCredit !== null && place.imageLicense !== null) {
    return { kind: 'photo', uri, credit: place.imageCredit, license: place.imageLicense };
  }
  return { kind: 'ring' };
}

/**
 * "Waterfall · South Iceland": the server's own words in the list's language,
 * else the app's labels for the kind and region (an unknown region is left
 * out), as iOS words a saved place.
 */
export function savedSightKindRegion(
  place: Pick<FavouriteAttraction, 'kind' | 'kindLabel' | 'region' | 'regionLabel'>,
  lookup: (key: string) => string,
): string {
  const kind = place.kindLabel ?? kindLabel(place.kind, lookup);
  const region = place.regionLabel ?? regionLabel(place.region, lookup);
  return region ? `${kind} · ${region}` : kind;
}

/** A walk's "7.1 km one way · 3 h there and back", as the sight card writes it; null without figures. */
export function savedSightFacts(
  place: Pick<FavouriteAttraction, 'lengthM' | 'durationMinutes' | 'outAndBack'>,
  t: (key: string, params?: Params) => string,
): string | null {
  return trailFacts(place, t);
}

export interface SavedSightRowProps {
  readonly place: FavouriteAttraction;
  /** Opens the place's card (`AttractionDetail { slug }`). */
  readonly onOpen: () => void;
  /** Takes it off the list (the favourites store's `removeAttraction`). */
  readonly onRemove: () => void;
  readonly testID?: string;
}

export default function SavedSightRow({ place, onOpen, onRemove, testID }: SavedSightRowProps) {
  const { t } = useT();
  const [photoFailed, setPhotoFailed] = useState(false);
  const id = testID ?? `saved.sight.${place.slug}`;
  const picture = savedSightPicture(place);
  const showsPhoto = picture.kind === 'photo' && !photoFailed;
  const credit = showsPhoto && picture.kind === 'photo' ? creditLine(t('attraction.photo'), picture.credit, picture.license) : null;
  const kindRegion = savedSightKindRegion(place, (key) => t(key));
  const facts = savedSightFacts(place, t);
  const ring = <AttractionRing isTrailhead={isHike(place)} frame={34} testID={`${id}.ring`} />;

  return (
    <View style={styles.row} testID={id}>
      <Pressable
        onPress={onOpen}
        accessibilityRole="button"
        accessibilityLabel={[place.name, kindRegion, facts, credit].filter(Boolean).join(', ')}
        style={({ pressed }) => [styles.open, pressed && styles.pressed]}
        testID={`${id}.open`}
      >
        <View style={[styles.tile, picture.kind === 'plate' && styles.plateTile]} {...hiddenFromAccessibility}>
          {picture.kind === 'plate' ? (
            <SightImage
              uri={picture.uri}
              contentFit="contain"
              style={StyleSheet.absoluteFill}
              placeholder={(phase) => (phase === 'failed' ? ring : null)}
              testID={`${id}.plate`}
            />
          ) : showsPhoto ? (
            <SightImage
              uri={picture.uri}
              contentFit="cover"
              style={StyleSheet.absoluteFill}
              placeholder={(phase) => (phase === 'failed' ? ring : null)}
              onFailed={() => setPhotoFailed(true)}
              testID={`${id}.photo`}
            />
          ) : (
            ring
          )}
        </View>
        <View style={styles.texts}>
          <LPText size={15} weight="semibold" color={colors.paper} numberOfLines={2}>
            {place.name}
          </LPText>
          <LPText size={12} color={colors.paper3} testID={`${id}.kind`}>
            {kindRegion}
          </LPText>
          {facts ? (
            <LPText size={10} color={colors.paper3} tracking={1.1} style={MONO} testID={`${id}.facts`}>
              {facts}
            </LPText>
          ) : null}
          {credit ? (
            <LPText size={11} color={colors.paper3} testID={`${id}.credit`}>
              {credit}
            </LPText>
          ) : null}
        </View>
      </Pressable>
      <Pressable
        onPress={onRemove}
        accessibilityRole="button"
        accessibilityLabel={t('favourites.card.removeNamed', { name: place.name })}
        hitSlop={7}
        style={({ pressed }) => [styles.remove, pressed && styles.pressed]}
        testID={`${id}.remove`}
      >
        <Ionicons name="heart" size={15} color={colors.rust2} />
      </Pressable>
    </View>
  );
}

/** The sights' monospaced figures (iOS `LPFont.mono`), as the card's walk rows. */
const MONO = { fontFamily: 'monospace' } as const;

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 10,
    borderRadius: 14,
    borderWidth: hairline,
    borderColor: colors.line,
    backgroundColor: colors.ink2,
  },
  open: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12 },
  tile: {
    width: 64,
    height: 64,
    borderRadius: 10,
    overflow: 'hidden',
    backgroundColor: colors.ink3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  plateTile: { backgroundColor: PLATE_PAPER },
  texts: { flex: 1, gap: 3 },
  // The place's heart, filled (./SightHeart.tsx): the same glyph takes it off.
  remove: {
    width: SIGHT_HEART_SIZE,
    height: SIGHT_HEART_SIZE,
    marginLeft: 8,
    borderRadius: SIGHT_HEART_SIZE / 2,
    borderWidth: 1,
    borderColor: colors.line2,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.ink3,
  },
  pressed: { opacity: 0.7 },
});
