/**
 * A picture on a sight's card (iOS `CachedImage` as AttractionDetailView uses
 * it): cached in memory and on disk, three attempts with the same short
 * back-off as every image in the app (`IMAGE_ATTEMPTS`,
 * `imageRetryDelayMs`), and the caller's own stand-in while it loads and
 * after it has failed. The hero shows a map or photo glyph on failure; a
 * nearby row swaps to the sight's ring and drops its credit line
 * (`onFailed`), since a "Photo:" line beside a ring would credit a picture
 * nobody can see.
 *
 * Decorative: the caller labels the picture (the hero) or hides it (a row).
 */
import { Image, type ImageContentFit } from 'expo-image';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { hiddenFromAccessibility, IMAGE_ATTEMPTS, imageRetryDelayMs } from '../../../components/ui';
import { useReduceMotion } from '../../../hooks/useReduceMotion';

export type SightImagePhase = 'loading' | 'loaded' | 'failed';

export interface SightImageProps {
  /** Already resolved (`resolveAttractionAsset`); null draws the failed stand-in. */
  readonly uri: string | null;
  readonly contentFit: ImageContentFit;
  /** What shows under the picture while it loads, and instead of it once it failed. */
  readonly placeholder: (phase: Exclude<SightImagePhase, 'loaded'>) => ReactNode;
  readonly onFailed?: () => void;
  readonly style?: StyleProp<ViewStyle>;
  readonly testID?: string;
}

interface LoadState {
  readonly uri: string | null;
  readonly attempt: number;
  readonly phase: SightImagePhase;
  /** The attempt waiting out its back-off, if any. */
  readonly retryDue: number | null;
}

const freshState = (uri: string | null): LoadState => ({ uri, attempt: 0, phase: uri ? 'loading' : 'failed', retryDue: null });

export default function SightImage({ uri, contentFit, placeholder, onFailed, style, testID }: SightImageProps) {
  const reduceMotion = useReduceMotion();
  const [state, setState] = useState(() => freshState(uri));
  if (state.uri !== uri) setState(freshState(uri));
  const { attempt, phase, retryDue } = state.uri === uri ? state : freshState(uri);

  const failedReported = useRef<string | null>(null);
  useEffect(() => {
    if (phase !== 'failed' || failedReported.current === uri) return;
    failedReported.current = uri;
    onFailed?.();
  }, [phase, uri, onFailed]);

  useEffect(() => {
    if (retryDue === null) return undefined;
    const timer = setTimeout(() => {
      setState((s) => (s.retryDue === retryDue ? { ...s, retryDue: null, attempt: retryDue } : s));
    }, imageRetryDelayMs(retryDue - 1));
    return () => clearTimeout(timer);
  }, [retryDue]);

  const onError = () =>
    setState((s) => (s.attempt + 1 < IMAGE_ATTEMPTS ? { ...s, retryDue: s.attempt + 1 } : { ...s, phase: 'failed' }));
  const onLoad = () => setState((s) => ({ ...s, phase: 'loaded' }));

  const showImage = uri !== null && phase !== 'failed' && retryDue === null;
  return (
    <View {...hiddenFromAccessibility} style={[styles.frame, style]} testID={testID}>
      {phase !== 'loaded' ? (
        <View style={styles.fill} testID={testID ? `${testID}.${phase}` : undefined}>
          {placeholder(phase === 'failed' ? 'failed' : 'loading')}
        </View>
      ) : null}
      {showImage ? (
        <Image
          key={`${uri}#${attempt}`}
          source={{ uri }}
          cachePolicy="memory-disk"
          contentFit={contentFit}
          transition={reduceMotion ? 0 : 150}
          onLoad={onLoad}
          onError={onError}
          style={StyleSheet.absoluteFill}
          accessible={false}
          testID={testID ? `${testID}.image` : undefined}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { overflow: 'hidden' },
  fill: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
});
