// Date / Time (or Class) / Confirm, a dot and a line filling as the steps
// pass (iOS BookingFlowView.stepsIndicator). Not buttons (the steps move
// only with Next and Back, so selection and consent can't be skipped);
// TalkBack reads each name, the current one marked selected.
//
// The labels stop growing at the first accessibility size: three Icelandic
// names in one row at a font scale of 2 would wrap and take height from the
// step below, where Back, Next and Confirm must stay on screen.
import { StyleSheet, View } from 'react-native';

import { LPText } from '../../../components/ui';
import { FONT_SCALE_CAP } from '../../../hooks/useA11ySize';
import { useT } from '../../../i18n';
import { colors } from '../../../theme';
import type { BookingStep } from '../bookingSession';

export interface StepsIndicatorProps {
  readonly step: BookingStep;
  readonly usesClasses: boolean;
}

export default function StepsIndicator({ step, usesClasses }: StepsIndicatorProps) {
  const { t } = useT();
  const labels = [t('booking.date'), usesClasses ? t('booking.class') : t('booking.time'), t('booking.step_confirm')];
  return (
    <View style={styles.row}>
      {labels.map((label, index) => (
        <View key={label + index} style={[styles.item, index < 2 && styles.grow]}>
          <View
            style={styles.step}
            accessible
            accessibilityLabel={label}
            accessibilityState={{ selected: step === index }}
          >
            <View style={[styles.dot, { backgroundColor: step >= index ? colors.actionFill : colors.line }]} />
            <LPText
              size={11}
              weight="medium"
              color={step >= index ? colors.paper : colors.mutedTextStrong}
              maxScale={FONT_SCALE_CAP.accessibility1}
            >
              {label}
            </LPText>
          </View>
          {index < 2 ? (
            <View style={[styles.line, { backgroundColor: step > index ? colors.actionFill : colors.line }]} />
          ) : null}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    backgroundColor: colors.ink,
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  grow: {
    flex: 1,
  },
  step: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  line: {
    flex: 1,
    height: 2,
    marginHorizontal: 4,
  },
});
