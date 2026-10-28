// The one-time "Your bookings and saved places are here now." pointer under
// Home's avatar (iOS `HomeView.profileMovedCallout`): only for an install
// that knew Profile as a tab (src/app/launchTab.ts sets the flag), only
// until this member has opened Profile once (src/navigation/profile.ts).
//
// The bubble is the UI kit's Callout (one closed path, the pointer 22 dp in
// from its trailing edge, so it lands on the centre of the 44 dp button it is
// aligned to). It fades and scales in from its top trailing corner, unless
// the member has animations off.
//
// WHERE IT SITS. iOS overlays it on the avatar button and offsets it 42 pt
// down. Android only delivers a touch to a view inside its parent's bounds,
// so a bubble hanging below a 44 dp button could never be tapped away. Home
// places it in the header instead (`top`, `right`), at the same spot.
import { useEffect, useRef } from 'react';
import { Animated, StyleSheet } from 'react-native';

import { Callout } from '../../components/ui';
import { useReduceMotion } from '../../hooks/useReduceMotion';
import { useT } from '../../i18n';

/** iOS `.offset(y: 42)` below the top of the 44 pt avatar button. */
export const CALLOUT_OFFSET_Y = 42;
/** iOS `.frame(width: 260)`. */
export const CALLOUT_WIDTH = 260;

type Props = {
  /** Distance from the header's top to the top of the avatar button. */
  buttonTop: number;
  /** Distance from the header's trailing edge to the button's trailing edge. */
  right: number;
  onDismiss: () => void;
};

export default function ProfileMovedCallout({ buttonTop, right, onDismiss }: Props) {
  const { t } = useT();
  const reduceMotion = useReduceMotion();
  const progress = useRef(new Animated.Value(reduceMotion ? 1 : 0)).current;

  useEffect(() => {
    if (reduceMotion) {
      progress.setValue(1);
      return;
    }
    // iOS `withAnimation(.easeOut(duration: 0.25))`.
    Animated.timing(progress, { toValue: 1, duration: 250, useNativeDriver: true }).start();
  }, [progress, reduceMotion]);

  const scale = progress.interpolate({ inputRange: [0, 1], outputRange: [0.96, 1] });

  return (
    <Animated.View
      style={[
        styles.anchor,
        {
          top: buttonTop + CALLOUT_OFFSET_Y,
          right,
          opacity: progress,
          // Grows from the top trailing corner, where the pointer is.
          transformOrigin: 'top right',
          transform: [{ scale }],
        },
      ]}
    >
      <Callout text={t('home.profile_moved')} width={CALLOUT_WIDTH} onDismiss={onDismiss} testID="home.profileMovedHint" />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  anchor: { position: 'absolute', width: CALLOUT_WIDTH, zIndex: 10, elevation: 10 },
});
