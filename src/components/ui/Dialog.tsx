// A dialog with any number of buttons: the Android stand-in for SwiftUI's
// `.alert` and `.confirmationDialog` (plan 5.6). Android's own `Alert` caps
// at three buttons, and iOS asks some questions with five (the runner's Leave
// dialog), so LifePass draws its own.
//
// WHICH PRESENTATION. Port the iOS modifier, not the look you want:
//   .alert(...)                        presentation 'alert' (the default): a
//                                      card in the middle of the screen
//   .confirmationDialog(...)           presentation 'actionSheet': a card at
//                                      the BOTTOM, the title (small) and the
//                                      message on top, the answers stacked
//                                      in iOS's order, and the cancel button
//                                      as a separate block below
//     titleVisibility: .visible        titleVisibility 'visible'
//     (no titleVisibility)             'hidden' (the default), as iOS's
//                                      `.automatic` hides it on a phone
// e.g. the Account language picker, meal delete and discard, Plan's outbox
// discard, the venue's directions, the programme proposal's replace and
// discard. An action sheet also closes on a tap outside or on back, with or
// without a cancel button, as an iOS confirmation dialog does.
//
// Two ways to use it:
//   showDialog({ title, message, buttons })      anywhere, like Alert.alert;
//                                                the app shell's DialogHost draws it
//   <Dialog visible ... onClose={...} />         controlled, inside a screen
//
// Buttons follow iOS: up to two side by side (the cancel one first, as iOS
// and Material both put it on the left), three or more stacked with the
// cancel one last. A destructive button is red. Every press closes the
// dialog and then runs the button's action, as Alert does.
//
// Hardware back presses the cancel button when there is one. A notice with
// a single button and no cancel ("Email sent", OK) is acknowledged by back,
// which presses that button, as an Android alert with one button is. A
// question with two or more answers and no cancel must be answered: back
// does nothing unless `cancelable`, which closes it with no button.
// The dialog is its own window, so TalkBack stays inside it.
//
// LARGE TEXT. The card never grows past the window (less the system bars and
// a margin); its title, message and buttons scroll inside it, so at a font
// scale of 2 every button of the runner's five-button Leave dialog can still
// be reached, as iOS alerts scroll at the accessibility sizes.
import { useCallback } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useReduceMotion } from '../../hooks/useReduceMotion';
import { colors, hairline } from '../../theme';
import { createHostStore } from './hostStore';
import LPText from './LPText';

export type DialogButtonRole = 'default' | 'cancel' | 'destructive';

/** 'alert': iOS `.alert`, centred. 'actionSheet': iOS `.confirmationDialog`, at the bottom. */
export type DialogPresentation = 'alert' | 'actionSheet';

export type DialogButton = {
  label: string;
  role?: DialogButtonRole;
  onPress?: () => void;
  testID?: string;
};

export type DialogOptions = {
  title: string;
  message?: string;
  buttons: DialogButton[];
  /**
   * Back (or a tap outside) closes it with no button. Default: back presses
   * the cancel button, or the only button of a one-button notice; a tap
   * outside works only when there is a cancel button.
   */
  cancelable?: boolean;
  /** Called when the dialog closes without a button (back or outside). */
  onDismiss?: () => void;
  /** Which iOS modifier this ports (see the top of this file). Default 'alert'. */
  presentation?: DialogPresentation;
  /**
   * An action sheet's title: 'visible' where iOS passes
   * `titleVisibility: .visible`, else 'hidden' (the default, as iOS's
   * `.automatic` on a phone). An alert always shows its title.
   */
  titleVisibility?: 'visible' | 'hidden';
  testID?: string;
};

export type DialogProps = DialogOptions & {
  visible: boolean;
  /** Any close: a button, back, or outside. Set `visible` to false. */
  onClose: () => void;
};

/**
 * Labels longer than this do not fit two abreast on a phone; iOS then stacks
 * a two-button alert too.
 */
const SIDE_BY_SIDE_MAX_LABEL = 16;

/** Room kept clear above and below the card, inside the system bars. */
const CARD_MARGIN = 48;

/** iOS orders an alert's buttons: side by side, cancel first; stacked, cancel last. */
export function orderButtons(buttons: DialogButton[]): { stacked: boolean; ordered: DialogButton[] } {
  const stacked = buttons.length > 2 || buttons.some((b) => b.label.length > SIDE_BY_SIDE_MAX_LABEL);
  const cancel = buttons.filter((b) => b.role === 'cancel');
  const others = buttons.filter((b) => b.role !== 'cancel');
  return { stacked, ordered: stacked ? [...others, ...cancel] : [...cancel, ...others] };
}

export function Dialog({
  visible,
  onClose,
  title,
  message,
  buttons,
  cancelable,
  onDismiss,
  presentation = 'alert',
  titleVisibility = 'hidden',
  testID,
}: DialogProps) {
  const reduceMotion = useReduceMotion();
  const window = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const sheet = presentation === 'actionSheet';
  const { stacked, ordered } = orderButtons(buttons);
  const cancelButton = buttons.find((b) => b.role === 'cancel');
  // An iOS confirmation dialog always closes on a tap outside; an alert only with a cancel.
  const mayDismiss = cancelable ?? (sheet || cancelButton !== undefined);
  // A one-button notice ("Email sent", OK): back acknowledges it.
  const acknowledgement =
    !sheet && cancelable === undefined && !cancelButton && buttons.length === 1 ? buttons[0] : undefined;
  // The scrim is padded clear of the system bars; the card keeps a margin inside that.
  const maxHeight = Math.max(window.height - insets.top - insets.bottom - CARD_MARGIN, 160);

  const press = useCallback(
    (button: DialogButton) => {
      onClose();
      button.onPress?.();
    },
    [onClose],
  );

  /** A tap outside the card (and back, where no button answers it). */
  const dismissWithoutButton = useCallback(() => {
    if (cancelButton) {
      press(cancelButton);
      return;
    }
    if (!mayDismiss) return;
    onClose();
    onDismiss?.();
  }, [cancelButton, mayDismiss, onClose, onDismiss, press]);

  const onBack = useCallback(() => {
    if (acknowledgement) {
      press(acknowledgement);
      return;
    }
    dismissWithoutButton();
  }, [acknowledgement, dismissWithoutButton, press]);

  if (sheet) {
    return (
      <Modal
        visible={visible}
        transparent
        animationType={reduceMotion ? 'none' : 'fade'}
        statusBarTranslucent
        navigationBarTranslucent
        onRequestClose={onBack}
        testID={testID}
      >
        <View style={[styles.scrim, styles.sheetScrim, { paddingTop: insets.top, paddingBottom: insets.bottom + 8 }]}>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={mayDismiss ? dismissWithoutButton : undefined}
            accessible={false}
            importantForAccessibility="no"
          />
          <ActionSheetCard
            title={title}
            showTitle={titleVisibility === 'visible'}
            message={message}
            buttons={buttons}
            onPress={press}
            maxHeight={maxHeight}
            testID={testID}
          />
        </View>
      </Modal>
    );
  }

  return (
    <Modal
      visible={visible}
      transparent
      animationType={reduceMotion ? 'none' : 'fade'}
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={onBack}
      testID={testID}
    >
      <View style={[styles.scrim, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
        {/* A tap outside the card: like back, but only when the dialog may be dismissed. */}
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={mayDismiss ? dismissWithoutButton : undefined}
          accessible={false}
          importantForAccessibility="no"
        />
        <View style={[styles.card, { maxHeight }]} accessibilityViewIsModal>
          <ScrollView
            testID={testID ? `${testID}.scroll` : 'dialog.scroll'}
            bounces={false}
            overScrollMode="never"
            showsVerticalScrollIndicator
          >
            <View style={styles.texts}>
              <LPText size={17} weight="semibold" color={colors.paper} align="center" accessibilityRole="header">
                {title}
              </LPText>
              {message ? (
                <LPText size={14} color={colors.paper2} align="center">
                  {message}
                </LPText>
              ) : null}
            </View>
            <View style={stacked ? styles.stack : styles.row}>
              {ordered.map((button, index) => (
                <Pressable
                  key={`${index}-${button.label}`}
                  testID={button.testID}
                  onPress={() => press(button)}
                  accessibilityRole="button"
                  accessibilityLabel={button.label}
                  style={({ pressed }) => [
                    styles.button,
                    !stacked && styles.rowButton,
                    index > 0 && (stacked ? styles.stackDivider : styles.rowDivider),
                    pressed && styles.pressed,
                  ]}
                >
                  <LPText
                    size={16}
                    weight={button.role === 'cancel' ? 'semibold' : 'medium'}
                    color={button.role === 'destructive' ? colors.destructive : colors.accentText}
                    align="center"
                  >
                    {button.label}
                  </LPText>
                </Pressable>
              ))}
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

/**
 * iOS `.confirmationDialog` on a phone: the answers in one rounded group at
 * the bottom (title and message on top, in the declared order), and the
 * cancel button in its own block below. The group scrolls at large text; the
 * cancel block never scrolls away.
 */
function ActionSheetCard({
  title,
  showTitle,
  message,
  buttons,
  onPress,
  maxHeight,
  testID,
}: {
  title: string;
  showTitle: boolean;
  message?: string;
  buttons: DialogButton[];
  onPress: (button: DialogButton) => void;
  maxHeight: number;
  testID?: string;
}) {
  const answers = buttons.filter((b) => b.role !== 'cancel');
  const cancel = buttons.find((b) => b.role === 'cancel');
  const hasHeader = showTitle || !!message;
  return (
    <View style={[styles.sheetColumn, { maxHeight }]} accessibilityViewIsModal testID={testID ? `${testID}.sheet` : undefined}>
      <View style={[styles.sheetGroup, styles.sheetShrink]}>
        <ScrollView
          testID={testID ? `${testID}.scroll` : 'dialog.scroll'}
          bounces={false}
          overScrollMode="never"
          showsVerticalScrollIndicator
        >
          {hasHeader ? (
            <View style={styles.sheetHeader}>
              {showTitle ? (
                <LPText size={13} weight="semibold" color={colors.paper2} align="center" accessibilityRole="header">
                  {title}
                </LPText>
              ) : null}
              {message ? (
                <LPText size={13} color={colors.paper2} align="center">
                  {message}
                </LPText>
              ) : null}
            </View>
          ) : null}
          {answers.map((button, index) => (
            <SheetButton
              key={`${index}-${button.label}`}
              button={button}
              divider={hasHeader || index > 0}
              onPress={onPress}
            />
          ))}
        </ScrollView>
      </View>
      {cancel ? (
        <View style={styles.sheetGroup} testID={testID ? `${testID}.cancel` : undefined}>
          <SheetButton button={cancel} divider={false} onPress={onPress} />
        </View>
      ) : null}
    </View>
  );
}

function SheetButton({
  button,
  divider,
  onPress,
}: {
  button: DialogButton;
  divider: boolean;
  onPress: (button: DialogButton) => void;
}) {
  return (
    <Pressable
      testID={button.testID}
      onPress={() => onPress(button)}
      accessibilityRole="button"
      accessibilityLabel={button.label}
      style={({ pressed }) => [styles.sheetButton, divider && styles.stackDivider, pressed && styles.pressed]}
    >
      <LPText
        size={17}
        weight={button.role === 'cancel' ? 'semibold' : 'regular'}
        color={button.role === 'destructive' ? colors.destructive : colors.accentText}
        align="center"
      >
        {button.label}
      </LPText>
    </Pressable>
  );
}

// ─── App-wide host ──────────────────────────────────────────────────

type QueuedDialog = DialogOptions & { id: number };

const queue = createHostStore<QueuedDialog[]>([]);
let nextId = 1;

/**
 * Show a dialog from anywhere (the `Alert.alert` of the UI kit). Dialogs
 * queue: a second one waits until the first is answered.
 */
export function showDialog(options: DialogOptions): void {
  if (__DEV__ && queue.listenerCount() === 0) {
    console.warn('[ui] showDialog() with no DialogHost mounted; mount UiKitProvider in the app shell.');
  }
  const id = nextId++;
  queue.set((items) => [...items, { ...options, id }]);
}

/**
 * Closes every dialog shown with showDialog, without running any button.
 * Sign-out calls it (through resetUiKit), so a queued confirm whose actions
 * are bound to the previous member's data can never fire after they left.
 */
export function dismissAllDialogs(): void {
  queue.set([]);
}

/** Draws the dialogs shown with showDialog, one at a time. Mounted once by UiKitProvider. */
export function DialogHost() {
  const items = queue.use();
  const current = items[0];
  const close = useCallback(() => {
    if (!current) return;
    queue.set((list) => list.filter((item) => item.id !== current.id));
  }, [current]);
  if (!current) return null;
  return <Dialog key={current.id} {...current} visible onClose={close} />;
}

const styles = StyleSheet.create({
  scrim: {
    flex: 1,
    backgroundColor: 'rgba(25,28,36,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  card: {
    width: '100%',
    maxWidth: 340,
    backgroundColor: colors.ink,
    borderRadius: 18,
    overflow: 'hidden',
    elevation: 12,
  },
  texts: { paddingHorizontal: 20, paddingTop: 22, paddingBottom: 18, gap: 6 },
  row: { flexDirection: 'row', borderTopWidth: hairline, borderTopColor: colors.line },
  stack: { borderTopWidth: hairline, borderTopColor: colors.line },
  button: { minHeight: 48, justifyContent: 'center', paddingHorizontal: 12, paddingVertical: 10 },
  rowButton: { flex: 1 },
  rowDivider: { borderLeftWidth: hairline, borderLeftColor: colors.line },
  stackDivider: { borderTopWidth: hairline, borderTopColor: colors.line },
  pressed: { backgroundColor: colors.ink3 },
  // The action sheet: at the bottom, 8 from the edges, the cancel block 8 below the group.
  sheetScrim: { justifyContent: 'flex-end', paddingHorizontal: 8 },
  sheetColumn: { width: '100%', maxWidth: 480, gap: 8 },
  sheetGroup: { backgroundColor: colors.ink, borderRadius: 14, overflow: 'hidden', elevation: 12 },
  sheetShrink: { flexShrink: 1 },
  sheetHeader: { paddingHorizontal: 16, paddingVertical: 14, gap: 4 },
  sheetButton: { minHeight: 56, justifyContent: 'center', paddingHorizontal: 16, paddingVertical: 10 },
});
