/**
 * "Exercise skipped" (or "Remaining sets skipped") with Undo, for four
 * seconds after a skip (iOS `undoToast`, 7.6). Announced to TalkBack as it
 * appears; it sits over the content, clear of the bottom bar.
 */
import { useEffect } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { LPText } from '../../../components/ui';
import { announce } from '../../../components/ui/a11y';
import { useT } from '../../../i18n';
import { colors } from '../../../theme';

export interface RunnerUndoToastProps {
  readonly messageKey: string;
  /** A new id for every skip, so each one is announced. */
  readonly id: number;
  readonly onUndo: () => void;
}

export default function RunnerUndoToast({ messageKey, id, onUndo }: RunnerUndoToastProps) {
  const { t } = useT();
  const message = t(messageKey);

  useEffect(() => {
    announce(message);
    // Once per skip, not on every redraw of the page under it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  return (
    <View style={styles.wrap} pointerEvents="box-none">
      <View style={styles.toast} testID="runner.undoToast" accessibilityLiveRegion="polite">
        <LPText size={14} weight="medium" color={colors.ink} style={styles.message}>
          {message}
        </LPText>
        <Pressable
          testID="runner.undoSkip"
          onPress={onUndo}
          accessibilityRole="button"
          accessibilityLabel={t('plan.undo')}
          style={styles.undo}
        >
          <LPText size={14} weight="semibold" color={colors.rust2}>
            {t('plan.undo')}
          </LPText>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 150,
    paddingHorizontal: 20,
  },
  toast: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 16,
    borderRadius: 12,
    backgroundColor: colors.paper,
    elevation: 8,
    shadowColor: '#000000',
    shadowOpacity: 0.18,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
  },
  message: {
    flex: 1,
  },
  undo: {
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
