// A confirmation with a body (iOS Plan's ConfirmSheet). A dialog cannot
// always carry a message, and decisions like pause, end or discard need one:
// "End plan" alone does not say that the history stays.
//
// Serif title, body, a full-width confirm (red when destructive) and a quiet
// Cancel. Confirm closes the sheet and then runs the action, as on iOS. The
// confirm is a FLAT fill, 52 tall with radius 14 and no shadow: iOS draws its
// own RoundedRectangle here, not LPPrimaryButton (which has one).
//
// ONE ANSWER. The first Confirm or Cancel answers the sheet; any further
// press before it is shown again does nothing, so a double tap can never end
// a plan or delete twice (UIKit disables a sheet while it is dismissed; the
// Sheet also stops taking touches as it slides away). The answer resets each
// time `visible` turns true.
//
// The buttons sit in the Sheet's pinned footer and the title and body
// scroll above them, so at the largest font scale on a small phone (a serif
// 24 title over a long Icelandic body) Confirm and Cancel are never pushed
// off the bottom of the sheet. iOS gives it `[.height(280), .medium]`.
import { useEffect, useRef } from 'react';
import { Pressable, StyleSheet, View, type Text } from 'react-native';

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
  // TalkBack starts at the title, as VoiceOver starts a sheet at its top.
  const titleRef = useRef<Text>(null);

  const answered = useRef(false);
  useEffect(() => {
    if (visible) answered.current = false;
  }, [visible]);
  const answer = (confirmed: boolean) => {
    if (answered.current) return;
    answered.current = true;
    onClose();
    if (confirmed) onConfirm();
  };

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      initialFocusRef={titleRef}
      testID={testID}
      footer={
        <>
          <PrimaryButton
            title={confirmLabel}
            tone={destructive ? 'destructive' : 'accent'}
            shape="flat"
            onPress={() => answer(true)}
          />
          <Pressable
            onPress={() => answer(false)}
            accessibilityRole="button"
            accessibilityLabel={cancel}
            style={({ pressed }) => [styles.cancel, pressed && styles.pressed]}
          >
            <LPText size={13} weight="semibold" color={colors.paper2} align="center">
              {cancel}
            </LPText>
          </Pressable>
        </>
      }
    >
      <View style={styles.texts}>
        <LPText ref={titleRef} serif size={24} color={colors.paper} accessibilityRole="header">
          {title}
        </LPText>
        <LPText size={14} color={colors.paper2}>
          {body}
        </LPText>
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  texts: { gap: 18 },
  // The footer's 10 between its rows plus 8: iOS's 18 between Confirm and Cancel.
  cancel: { minHeight: 44, justifyContent: 'center', marginTop: 8 },
  pressed: { opacity: 0.7 },
});
