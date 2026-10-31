/* eslint lifepass/no-literal-copy: "error" */
/**
 * "Select Activity": the venue's instant walk-in activities, one row each
 * (iOS `CheckInView.activityPickerSheet`). A pick re-previews with that
 * activity, so the charge disclosed is the activity's own. Cancel, back, a
 * pan down or the backdrop close it with nothing sent.
 */
import { Ionicons } from '@expo/vector-icons';
import { useRef } from 'react';
import { Pressable, StyleSheet, View, type Text } from 'react-native';

import { hiddenFromAccessibility, LPText, Sheet } from '../../../../components/ui';
import { useT } from '../../../../i18n';
import { colors, hairline, minTouch, radius } from '../../../../theme';
import { useWalkIn, walkInActions } from '../useWalkIn';

export default function ActivityPickerSheet() {
  const { t } = useT();
  const visible = useWalkIn((s) => s.showActivityPicker);
  const activities = useWalkIn((s) => s.pickerActivities);
  const venueName = useWalkIn((s) => s.preview?.venue.name ?? null);
  const titleRef = useRef<Text>(null);
  const close = () => walkInActions().cancelActivityPicker();

  return (
    <Sheet visible={visible} onClose={close} initialFocusRef={titleRef} testID="walkin.activityPicker">
      <View style={styles.header}>
        <LPText ref={titleRef} size={17} weight="semibold" color={colors.paper} accessibilityRole="header" style={styles.title}>
          {t('checkin.select_activity_title')}
        </LPText>
        <Pressable
          onPress={close}
          accessibilityRole="button"
          accessibilityLabel={t('common.cancel')}
          hitSlop={8}
          style={styles.cancel}
          testID="walkin.activityPicker.cancel"
        >
          <LPText size={16} weight="medium" color={colors.accentText}>
            {t('common.cancel')}
          </LPText>
        </Pressable>
      </View>
      {venueName ? (
        <LPText size={14} color={colors.mutedTextStrong} style={styles.line}>
          {t('checkin.select_activity', { name: venueName })}
        </LPText>
      ) : null}
      <View style={styles.rows}>
        {activities.map((activity) => (
          <Pressable
            key={activity.id}
            onPress={() => void walkInActions().selectActivity(activity)}
            accessibilityRole="button"
            accessibilityLabel={activity.name}
            style={({ pressed }) => [styles.row, pressed && styles.pressed]}
            testID={`walkin.activity.${activity.id}`}
          >
            <LPText size={15} weight="semibold" color={colors.paper} style={styles.name}>
              {activity.name}
            </LPText>
            <View style={styles.arrow} {...hiddenFromAccessibility}>
              <Ionicons name="arrow-forward" size={12} color={colors.mutedTextStrong} />
            </View>
          </Pressable>
        ))}
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 12 },
  title: { flex: 1 },
  cancel: { minHeight: minTouch, justifyContent: 'center' },
  line: { marginBottom: 12 },
  rows: { gap: 12 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    minHeight: minTouch,
    borderRadius: radius.card,
    backgroundColor: colors.ink2,
    borderWidth: hairline,
    borderColor: colors.line,
  },
  name: { flex: 1 },
  arrow: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.ink3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: { opacity: 0.85 },
});
