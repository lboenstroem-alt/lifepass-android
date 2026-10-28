/**
 * The status mark of the week strip, the plan overview and the history (iOS
 * `PlanStatusMark`): shape AND colour, never colour alone (3.18).
 *
 *   done     a filled accent disc with a white tick
 *   skipped  a ring with a slash
 *   missed   a ring with a cross
 *   rest     a small dot
 *   planned  an empty ring
 *
 * DRAWN, NOT A GLYPH, and hidden from TalkBack: every row that draws a mark
 * says its status in words (`statusWord`). An icon font's glyph can carry a
 * name of its own into the row's label; a path carries none.
 */
import { View } from 'react-native';
import Svg, { Circle, Line, Path } from 'react-native-svg';

import { hiddenFromAccessibility } from '../../../components/ui';
import type { SessionStatusView } from '../../../health';
import { colors } from '../../../theme';

export type StatusMarkProps = {
  status: SessionStatusView;
  size?: number;
  testID?: string;
};

export default function StatusMark({ status, size = 12, testID }: StatusMarkProps) {
  return (
    <View {...hiddenFromAccessibility} style={{ width: size, height: size }} testID={testID ?? `status-mark.${status}`}>
      <Mark status={status} size={size} />
    </View>
  );
}

function Mark({ status, size }: { status: SessionStatusView; size: number }) {
  const centre = size / 2;
  switch (status) {
    case 'done': {
      // The tick sits in the middle half of the disc (iOS frame size * 0.5).
      const box = size * 0.5;
      const x0 = centre - box / 2;
      const y0 = centre - box / 2;
      const tick = `M ${x0} ${y0 + box * 0.55} L ${x0 + box * 0.38} ${y0 + box * 0.92} L ${x0 + box} ${y0 + box * 0.1}`;
      return (
        <Svg width={size} height={size}>
          <Circle cx={centre} cy={centre} r={centre} fill={colors.rust} />
          <Path
            d={tick}
            stroke={colors.onAccent}
            strokeWidth={Math.max(1.5, size * 0.13)}
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
          />
        </Svg>
      );
    }
    case 'skipped': {
      // A slash 90 % of the mark long, at 45 degrees.
      const half = (size * 0.9) / 2 / Math.SQRT2;
      return (
        <Svg width={size} height={size}>
          <Circle cx={centre} cy={centre} r={centre - 0.5} stroke={colors.paper3} strokeWidth={1} fill="none" />
          <Line x1={centre - half} y1={centre + half} x2={centre + half} y2={centre - half} stroke={colors.paper3} strokeWidth={1} />
        </Svg>
      );
    }
    case 'missed': {
      const half = (size * 0.4) / 2;
      const width = Math.max(1.2, size * 0.11);
      return (
        <Svg width={size} height={size}>
          <Circle cx={centre} cy={centre} r={centre - 0.5} stroke={colors.paper3} strokeWidth={1} fill="none" />
          <Path
            d={`M ${centre - half} ${centre - half} L ${centre + half} ${centre + half} M ${centre + half} ${centre - half} L ${centre - half} ${centre + half}`}
            stroke={colors.paper3}
            strokeWidth={width}
            strokeLinecap="round"
            fill="none"
          />
        </Svg>
      );
    }
    case 'rest':
      return (
        <Svg width={size} height={size}>
          <Circle cx={centre} cy={centre} r={2} fill={colors.paper4} />
        </Svg>
      );
    case 'planned':
      return (
        <Svg width={size} height={size}>
          <Circle cx={centre} cy={centre} r={centre - 0.5} stroke={colors.line2} strokeWidth={1} fill="none" />
        </Svg>
      );
    default:
      return null;
  }
}
