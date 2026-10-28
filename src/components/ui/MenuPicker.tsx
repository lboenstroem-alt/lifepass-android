// A pop-up menu that picks one value (iOS `Menu { Picker }`: the meal
// capture page's slot and date menus). The trigger shows the current choice
// with a chevron; the menu opens under it (or above, when there is no room)
// and marks the current choice with a check.
//
// TalkBack: the trigger is a button that says its value and whether the menu
// is open; each option is a menu item that says whether it is the current
// one. Back or a tap outside closes the menu without a change.
import { Ionicons } from '@expo/vector-icons';
import { useRef, useState, type ReactNode } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View, useWindowDimensions, type StyleProp, type ViewStyle } from 'react-native';

import { useReduceMotion } from '../../hooks/useReduceMotion';
import { colors, hairline, radius } from '../../theme';
import LPText from './LPText';

export type MenuOption<T extends string> = { value: T; label: string; testID?: string };

export type MenuPickerProps<T extends string> = {
  options: MenuOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /** What the menu chooses, for TalkBack ("Meal", "Day"). */
  label: string;
  /** Replaces the default trigger look; still pressed to open. */
  renderTrigger?: (selected: MenuOption<T> | undefined, open: boolean) => ReactNode;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

type Anchor = { x: number; y: number; width: number; height: number };

const MENU_MIN_WIDTH = 200;
const EDGE = 16;
const ROW_HEIGHT = 48;

export default function MenuPicker<T extends string>({
  options,
  value,
  onChange,
  label,
  renderTrigger,
  disabled = false,
  style,
  testID,
}: MenuPickerProps<T>) {
  const trigger = useRef<View>(null);
  const [open, setOpen] = useState(false);
  // Where the trigger sits on screen; the menu stays invisible until it is
  // known (one frame), so it never flashes in the wrong place.
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const window = useWindowDimensions();
  const reduceMotion = useReduceMotion();
  const selected = options.find((option) => option.value === value);

  const show = () => {
    setOpen(true);
    trigger.current?.measureInWindow((x, y, width, height) => setAnchor({ x, y, width, height }));
  };
  const close = () => {
    setOpen(false);
    setAnchor(null);
  };

  const menuHeight = Math.min(options.length * ROW_HEIGHT + 12, window.height * 0.6);
  const menuWidth = Math.max(MENU_MIN_WIDTH, anchor?.width ?? 0);
  const below = anchor ? anchor.y + anchor.height + 4 : 0;
  const fitsBelow = below + menuHeight <= window.height - EDGE;
  const top = anchor ? (fitsBelow ? below : Math.max(EDGE, anchor.y - 4 - menuHeight)) : 0;
  const left = anchor ? Math.min(Math.max(EDGE, anchor.x), window.width - EDGE - menuWidth) : 0;

  return (
    <>
      <Pressable
        ref={trigger}
        testID={testID}
        onPress={show}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityValue={selected ? { text: selected.label } : undefined}
        accessibilityState={{ expanded: open, disabled }}
        style={({ pressed }) => [renderTrigger ? null : styles.trigger, disabled && styles.disabled, pressed && styles.pressed, style]}
      >
        {renderTrigger ? (
          renderTrigger(selected, open)
        ) : (
          <>
            <LPText size={14} weight="semibold" color={colors.paper} numberOfLines={1}>
              {selected?.label ?? ''}
            </LPText>
            <Ionicons name="chevron-down" size={14} color={colors.paper2} />
          </>
        )}
      </Pressable>
      <Modal
        visible={open}
        transparent
        animationType={reduceMotion ? 'none' : 'fade'}
        statusBarTranslucent
        navigationBarTranslucent
        onRequestClose={close}
      >
        <Pressable style={StyleSheet.absoluteFill} onPress={close} accessible={false} importantForAccessibility="no" />
        <View
          accessibilityRole="menu"
          accessibilityLabel={label}
          style={[styles.menu, { top, left, width: menuWidth, maxHeight: menuHeight, opacity: anchor ? 1 : 0 }]}
        >
          <ScrollView bounces={false}>
            {options.map((option, index) => {
              const isCurrent = option.value === value;
              return (
                <Pressable
                  key={option.value}
                  testID={option.testID}
                  onPress={() => {
                    close();
                    if (!isCurrent) onChange(option.value);
                  }}
                  accessibilityRole="menuitem"
                  accessibilityLabel={option.label}
                  accessibilityState={{ selected: isCurrent }}
                  style={({ pressed }) => [styles.option, index > 0 && styles.divider, pressed && styles.optionPressed]}
                >
                  <View style={styles.check}>
                    {isCurrent ? <Ionicons name="checkmark" size={16} color={colors.accentText} /> : null}
                  </View>
                  <LPText size={15} weight={isCurrent ? 'semibold' : 'regular'} color={colors.paper} style={styles.optionText}>
                    {option.label}
                  </LPText>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  trigger: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 44,
    paddingHorizontal: 14,
    backgroundColor: colors.ink2,
    borderRadius: radius.pill,
    borderWidth: hairline,
    borderColor: colors.line,
    alignSelf: 'flex-start',
  },
  disabled: { opacity: 0.4 },
  pressed: { opacity: 0.8 },
  menu: {
    position: 'absolute',
    backgroundColor: colors.ink,
    borderRadius: radius.field,
    paddingVertical: 6,
    elevation: 10,
    shadowColor: '#000000',
    shadowOpacity: 0.18,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
  },
  option: { flexDirection: 'row', alignItems: 'center', minHeight: ROW_HEIGHT, paddingHorizontal: 12, gap: 8 },
  divider: { borderTopWidth: hairline, borderTopColor: colors.line },
  optionPressed: { backgroundColor: colors.ink3 },
  check: { width: 18, alignItems: 'center' },
  optionText: { flex: 1 },
});
