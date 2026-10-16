// A confirmation with a body (iOS Plan's ConfirmSheet). A dialog cannot
// always carry a message, and decisions like pause, end or discard need one:
// "End plan" alone does not say that the history stays.
//
// Serif title, body, a full-width confirm (red when destructive) and a quiet
// Cancel. Confirm closes the sheet and then runs the action, as on iOS.
import { Pressable, StyleSheet, View } from 'react-native';

import { useT } from '../../i18n';
import { colors } from '../../theme';
import LPText from './LPText';
import PrimaryButton from './PrimaryButton';
import Sheet from './Sheet';

export type ConfirmSheetProps = {
  visible: boolean;
  title: string;
  body: string;
  confirmLabel: string;
  destructive?: boolean;
  onConfirm: () => void;
  /** Cancel, back, pan down or the backdrop. Set `visible` to false. */
  onClose: () => void;
  testID?: string;
};

export default function ConfirmSheet({
  visible,
  title,
  body,
  confirmLabel,
  destructive = false,
  onConfirm,
  onClose,
  testID,
}: ConfirmSheetProps) {
  const { t } = useT();
  const cancel = t('common.cancel');
  return (
    <Sheet visible={visible} onClose={onClose} scrollable={false} testID={testID}>
      <View style={styles.texts}>
        <LPText serif size={24} color={colors.paper} accessibilityRole="header">
          {title}
        </LPText>
        <LPText size={14} color={colors.paper2}>
          {body}
        </LPText>
      </View>
      <PrimaryButton
        title={confirmLabel}
        tone={destructive ? 'destructive' : 'accent'}
        onPress={() => {
          onClose();
          onConfirm();
        }}
      />
      <Pressable
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel={cancel}
        style={({ pressed }) => [styles.cancel, pressed && styles.pressed]}
      >
        <LPText size={13} weight="semibold" color={colors.paper2} align="center">
          {cancel}
        </LPText>
      </Pressable>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  texts: { gap: 18, marginBottom: 18 },
  cancel: { minHeight: 44, justifyContent: 'center', marginTop: 8 },
  pressed: { opacity: 0.7 },
});
