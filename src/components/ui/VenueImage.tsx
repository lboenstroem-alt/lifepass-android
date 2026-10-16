// A venue photo (iOS VenueImageView + CachedImage).
//
// - Cached in memory and on disk (expo-image `memory-disk`), so a hero image
//   survives scrolling and tab switches instead of downloading again.
// - Up to three attempts with a short back-off (0.6 s, then 1.2 s): venue
//   images occasionally 502 from Supabase storage under load.
// - While loading, and after three failures or with no usable URL, an ink3
//   panel with a photo glyph. NEVER another picture: a stock photo shown as a
//   venue misrepresents it (the old Android build did exactly that).
//
// Decorative unless given an `accessibilityLabel` (a venue card already
// names the venue in text).
import { Ionicons } from '@expo/vector-icons';
import { Image, type ImageContentFit } from 'expo-image';
import { useEffect, useState } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { useReduceMotion } from '../../hooks/useReduceMotion';
import { colors } from '../../theme';
import { hiddenFromAccessibility } from './a11y';
import { normaliseImageUrl } from './imageUrl';

/** iOS CachedImage tries three times. */
export const IMAGE_ATTEMPTS = 3;
/** Wait before attempt n+1: (n + 1) × 0.6 s, as iOS. */
export const imageRetryDelayMs = (failedAttempt: number) => (failedAttempt + 1) * 600;

export type VenueImageProps = {
  uri: string | null | undefined;
  /** Fixed height (iOS passes one); omit to size by `style`. */
  height?: number;
  style?: StyleProp<ViewStyle>;
  contentFit?: ImageContentFit;
  /** Reused list rows: pass the venue id so a recycled view never flashes the old photo. */
  recyclingKey?: string;
  accessibilityLabel?: string;
  testID?: string;
};

type Phase = 'loading' | 'loaded' | 'failed';

export default function VenueImage({
  uri,
  height,
  style,
  contentFit = 'cover',
  recyclingKey,
  accessibilityLabel,
  testID,
}: VenueImageProps) {
  const source = normaliseImageUrl(uri);
  const reduceMotion = useReduceMotion();
  const [attempt, setAttempt] = useState(0);
  const [phase, setPhase] = useState<Phase>(source ? 'loading' : 'failed');

  // A new URL starts again from the first attempt.
  const [retryDue, setRetryDue] = useState<number | null>(null);
  useEffect(() => {
    setAttempt(0);
    setRetryDue(null);
    setPhase(source ? 'loading' : 'failed');
  }, [source]);

  // After a failure, wait and try again (a new key remounts the image).
  useEffect(() => {
    if (retryDue === null) return;
    const timer = setTimeout(() => {
      setRetryDue(null);
      setAttempt(retryDue);
    }, imageRetryDelayMs(retryDue - 1));
    return () => clearTimeout(timer);
  }, [retryDue]);

  const onError = () => {
    if (attempt + 1 < IMAGE_ATTEMPTS) setRetryDue(attempt + 1);
    else setPhase('failed');
  };

  const showImage = source !== null && phase !== 'failed' && retryDue === null;
  const decorative = !accessibilityLabel;

  return (
    <View
      testID={testID}
      style={[styles.frame, height !== undefined && { height }, style]}
      {...(decorative ? hiddenFromAccessibility : { accessible: true, accessibilityRole: 'image' as const, accessibilityLabel })}
    >
      {phase !== 'loaded' ? (
        <View style={[StyleSheet.absoluteFill, styles.placeholder]} testID={testID ? `${testID}.placeholder` : 'venueImage.placeholder'}>
          <Ionicons name="image-outline" size={20} color={colors.paper4} />
        </View>
      ) : null}
      {showImage ? (
        <Image
          key={`${source}#${attempt}`}
          source={{ uri: source }}
          cachePolicy="memory-disk"
          recyclingKey={recyclingKey}
          contentFit={contentFit}
          transition={reduceMotion ? 0 : 150}
          onLoad={() => setPhase('loaded')}
          onError={onError}
          style={StyleSheet.absoluteFill}
          accessible={false}
          testID={testID ? `${testID}.image` : 'venueImage.image'}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { overflow: 'hidden', backgroundColor: colors.ink3 },
  placeholder: { backgroundColor: colors.ink3, alignItems: 'center', justifyContent: 'center' },
});
