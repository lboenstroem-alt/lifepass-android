/**
 * The 12-week weight chart on Body and goals (iOS `BodyAndGoalsView.weightChart`):
 * one smoothed line through the weekly averages, the target as a dashed rule
 * labelled "Target", no axes, and the first and last dates as plain labels
 * under it (an axis label at the very edge is cut to "Wed 1..." at this
 * width, and a date that stops mid-number is worse than none).
 *
 * ONE ELEMENT, ONE SENTENCE. TalkBack reads "Weekly average weight, from 74,8
 * kg to 72,5 kg, down." and, with a target, "Target 68 kilograms.", never the
 * points one by one.
 */
import { useState } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import Svg, { Line, Path } from 'react-native-svg';

import { LPText } from '../../../components/ui';
import { HealthFormat, useT } from '../../../i18n';
import { colors } from '../../../theme';

import type { WeightTrendWeek } from '../api';
import { chartAccessibilityValue } from '../model';
import { chartDomain, chartPoints, smoothPath, yFor } from './geometry';

/** iOS `.frame(height: 120)`. */
export const CHART_HEIGHT = 120;
/** Swift Charts' default line width. */
const LINE_WIDTH = 2;
/** Room for the stroke at the top and bottom of the range. */
const INSET = LINE_WIDTH;

export type WeightTrendChartProps = {
  /** The weeks with an average, oldest first (at least two). */
  readonly weeks: readonly WeightTrendWeek[];
  /** The server's direction (`down`, `up`, `same`). */
  readonly direction: string | null;
  /** The target to draw, or null (none, or one outside a healthy weight). */
  readonly targetKg: number | null;
};

export default function WeightTrendChart({ weeks, direction, targetKg }: WeightTrendChartProps) {
  const { t, language } = useT();
  const [width, setWidth] = useState(0);

  const values = weeks.flatMap((week) => (week.avgKg === null ? [] : [week.avgKg]));
  const first = values[0] ?? 0;
  const last = values[values.length - 1] ?? 0;
  const domain = chartDomain(values, targetKg);
  const plotHeight = CHART_HEIGHT - INSET * 2;
  const points = width > 0 ? chartPoints(weeks, { width, height: CHART_HEIGHT, inset: INSET }, domain) : [];
  const targetY = targetKg === null ? null : yFor(targetKg, domain, plotHeight) + INSET;

  const onLayout = (event: LayoutChangeEvent) => {
    const next = Math.round(event.nativeEvent.layout.width);
    if (next !== width) setWidth(next);
  };

  return (
    <View
      style={styles.wrap}
      accessible
      accessibilityRole="image"
      accessibilityLabel={t('bodygoals.chart.a11y_label')}
      accessibilityValue={{ text: chartAccessibilityValue(t, language, { first, last, direction, targetKg }) }}
      testID={targetKg === null ? 'bodygoals.chart' : 'bodygoals.chart.target'}
    >
      <View style={styles.plot} onLayout={onLayout} importantForAccessibility="no-hide-descendants">
        {width > 0 ? (
          <Svg width={width} height={CHART_HEIGHT}>
            {targetY !== null ? (
              <Line
                x1={0}
                x2={width}
                y1={targetY}
                y2={targetY}
                stroke={colors.paper3}
                strokeWidth={1}
                strokeDasharray="4 3"
              />
            ) : null}
            <Path
              d={smoothPath(points)}
              stroke={colors.rust}
              strokeWidth={LINE_WIDTH}
              strokeLinecap="round"
              strokeLinejoin="round"
              fill="none"
            />
          </Svg>
        ) : null}
        {targetY !== null ? (
          // Swift Charts' `.annotation(position: .top, alignment: .trailing)`.
          <LPText size={10} color={colors.paper3} style={[styles.targetLabel, { top: Math.max(0, targetY - 15) }]}>
            {t('bodygoals.chart.target')}
          </LPText>
        ) : null}
      </View>
      <View style={styles.dates} importantForAccessibility="no-hide-descendants">
        <LPText size={10} color={colors.paper3}>
          {HealthFormat.shortDay(weeks[0]?.weekStartsOn ?? '', language)}
        </LPText>
        <View style={styles.spacer} />
        <LPText size={10} color={colors.paper3}>
          {HealthFormat.shortDay(weeks[weeks.length - 1]?.weekStartsOn ?? '', language)}
        </LPText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: 16, paddingTop: 14, paddingBottom: 12 },
  plot: { height: CHART_HEIGHT },
  targetLabel: { position: 'absolute', right: 0 },
  dates: { flexDirection: 'row', alignItems: 'center', marginTop: 2 },
  spacer: { flex: 1, minWidth: 8 },
});
