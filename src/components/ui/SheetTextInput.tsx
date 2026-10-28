// A text field that works inside a bottom sheet and anywhere else.
//
// Inside a <Sheet>, a field must be the sheet library's own TextInput: that
// is how the sheet learns a field has focus, rises above the keyboard, and
// settles back when the keyboard goes ("keyboardBlurBehavior: restore").
// A plain TextInput in a sheet can end up under the keyboard. Outside a
// sheet the library's input cannot be used at all, so this picks the right
// one from where it is rendered.
//
// CARET AND SELECTION in the accent colour by default: iOS tints every caret
// and selection lpRust through the app-wide `.tint(Color.lpRust)`
// (LifePassApp.swift), and app.json sets no Android accent, so a plain field
// would show the default theme's colour. A caller's own props win.
import { BottomSheetTextInput } from '@gorhom/bottom-sheet';
import { createContext, forwardRef, useContext } from 'react';
import { TextInput, type TextInputProps } from 'react-native';

import { colors } from '../../theme';

/** True inside a <Sheet>'s content (set by Sheet itself). */
export const InSheetContext = createContext(false);

/** Whether the calling component is rendered inside a <Sheet>. */
export function useInSheet(): boolean {
  return useContext(InSheetContext);
}

const SheetTextInput = forwardRef<TextInput, TextInputProps>(function SheetTextInput(props, ref) {
  const inSheet = useInSheet();
  // The library's input forwards every TextInput prop and the ref.
  const Input = (inSheet ? BottomSheetTextInput : TextInput) as typeof TextInput;
  return (
    <Input
      ref={ref}
      cursorColor={colors.rust}
      selectionColor={colors.rust3}
      selectionHandleColor={colors.rust}
      {...props}
    />
  );
});

export default SheetTextInput;
