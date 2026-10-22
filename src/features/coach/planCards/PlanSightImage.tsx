/**
 * A plan sight's picture (iOS `CachedImage` as `PlanSightCard` uses it):
 * cached in memory and on disk, three attempts with the app's usual short
 * back-off (`IMAGE_ATTEMPTS`, `imageRetryDelayMs`), nothing while it loads,
 * and the sight's ring once it has failed. `onFailed` lets the card drop the
 * credit line too: "Photo: X" beside a ring would credit a picture nobody can
 * see.
 *
 * Decorative to TalkBack: the card around it names the sight.
 */
import { Image, type ImageContentFit } from 'expo-image';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { IMAGE_ATTEMPTS, imageRetryDelayMs } from '../../../components/ui/VenueImage';
import { hiddenFromAccessibility } from '../../../components/ui/a11y';
import { useReduceMotion } from '../../../hooks/useReduceMotion';

interface LoadState {
  readonly uri: string;
  readonly attempt: number;
  readonly failed: boolean;
  readonly loaded: boolean;
  /** The attempt waiting out its back-off, if any. */
  readonly retryDue: number | null;
}

const freshState = (uri: string): LoadState => ({ uri, attempt: 0, failed: false, loaded: false, retryDue: null });

export default function PlanSightImage({
  uri,
  contentFit,
  fallback,
  onFailed,
  testID,
}: {
  /** Already resolved. */
  uri: string;
  contentFit: ImageContentFit;
  /** Drawn once every attempt has failed (the ring). */
  fallback: ReactNode;
  onFailed: () => void;
  testID?: string;
}) {
  const reduceMotion = useReduceMotion();
  const [state, setState] = useState(() => freshState(uri));
  const current = state.uri === uri ? state : freshState(uri);
  if (state.uri !== uri) setState(current);

  const reported = useRef<string | null>(null);
  useEffect(() => {
    if (!current.failed || reported.current === uri) return;
    reported.current = uri;
    onFailed();
  }, [current.failed, uri, onFailed]);

  const { retryDue } = current;
  useEffect(() => {
    if (retryDue === null) return undefined;
    const timer = setTimeout(() => {
      setState((s) => (s.retryDue === retryDue ? { ...s, retryDue: null, attempt: retryDue } : s));
    }, imageRetryDelayMs(retryDue - 1));
    return () => clearTimeout(timer);
  }, [retryDue]);

  const onError = () =>
    setState((s) => (s.attempt + 1 < IMAGE_ATTEMPTS ? { ...s, retryDue: s.attempt + 1 } : { ...s, failed: true }));
  const onLoad = () => setState((s) => ({ ...s, loaded: true }));

  if (current.failed) {
    return (
      <View {...hiddenFromAccessibility} style={styles.fill} testID={testID ? `${testID}.failed` : undefined}>
        {fallback}
      </View>
    );
  }
  return (
    <View {...hiddenFromAccessibility} style={StyleSheet.absoluteFill} testID={testID}>
      {current.retryDue === null ? (
        <Image
          key={`${uri}#${current.attempt}`}
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
  fill: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
});
