/**
 * The rest's ring (iOS `restCountdown`'s two circles): what is left of the
 * rest, drawn from the top clockwise, 52 dp with a 4 dp stroke. Under
 * Remove animations (iOS Reduce Motion) it is a still, full ring: the
 * countdown beside it says the time.
 */
import Svg, { Circle } from 'react-native-svg';

import { useReduceMotion } from '../../../hooks/useReduceMotion';
import { colors } from '../../../theme';

export const REST_RING_SIZE = 52;
const STROKE = 4;

export interface RestRingProps {
  /** What is left, 0 to 1. */
  readonly fraction: number;
}

export default function RestRing({ fraction }: RestRingProps) {
  const reduceMotion = useReduceMotion();
  const radius = (REST_RING_SIZE - STROKE) / 2;
  const circumference = 2 * Math.PI * radius;
  const shown = reduceMotion ? 1 : Math.min(1, Math.max(0, fraction));
  const centre = REST_RING_SIZE / 2;
  return (
    <Svg
      width={REST_RING_SIZE}
      height={REST_RING_SIZE}
      testID="runner.restRing"
      accessible={false}
      importantForAccessibility="no-hide-descendants"
    >
      <Circle cx={centre} cy={centre} r={radius} stroke={colors.ink3} strokeWidth={STROKE} fill="none" />
      <Circle
        cx={centre}
        cy={centre}
        r={radius}
        stroke={colors.rust}
        strokeWidth={STROKE}
        strokeLinecap="round"
        fill="none"
        strokeDasharray={`${circumference} ${circumference}`}
        strokeDashoffset={circumference * (1 - shown)}
        // From twelve o'clock, as iOS rotates its trimmed circle by -90°.
        transform={`rotate(-90 ${centre} ${centre})`}
      />
    </Svg>
  );
}
