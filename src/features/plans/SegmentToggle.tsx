/**
 * Memberships or visitor passes: iOS `PlansView.segmentToggle`, a recessed
 * track with the chosen half drawn solid (ink on paper reversed). TalkBack
 * hears a tab list, each half a tab with its selected state.
 */
import { Pressable, StyleSheet, View } from 'react-native';

import { LPText } from '../../components/ui';
import { useT } from '../../i18n';
import { colors, hairline } from '../../theme';

import type { PlansSegmentValue } from './selection';

export interface SegmentToggleProps {
  readonly value: PlansSegmentValue;
  readonly onChange: (value: PlansSegmentValue) => void;
}

const SEGMENTS: readonly { readonly value: PlansSegmentValue; readonly key: string }[] = [
  { value: 'monthly', key: 'plans.segment.monthly' },
  { value: 'passes', key: 'plans.segment.passes' },
];

export default function SegmentToggle({ value, onChange }: SegmentToggleProps) {
  const { t } = useT();
  return (
    <View accessibilityRole="tablist" style={styles.track}>
      {SEGMENTS.map((segment) => {
        const active = segment.value === value;
        return (
          <Pressable
            key={segment.value}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            testID={`plans.segment.${segment.value}`}
            onPress={() => {
              if (!active) onChange(segment.value);
            }}
            style={[styles.segment, active && styles.active]}
          >
            <LPText size={13} weight="semibold" color={active ? colors.ink : colors.paper2} align="center" numberOfLines={2}>
              {t(segment.key)}
            </LPText>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    flexDirection: 'row',
    gap: 4,
    padding: 4,
    borderRadius: 12,
    borderWidth: hairline,
    borderColor: colors.line,
    backgroundColor: colors.ink3,
  },
  segment: {
    flex: 1,
    minHeight: 36,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  active: { backgroundColor: colors.paper },
});
