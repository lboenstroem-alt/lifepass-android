/**
 * "Type the number" (iOS `TypedBarcodeSheet`, ios-ux.md 12.5): "Barcode
 * number", a number pad with the placeholder 5690000000000, Look up, and
 * "Barcodes have 8, 12, 13 or 14 digits." when the count is wrong. Spaces
 * are fine while typing; only the digits are looked up.
 */
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, View, type Text, type TextInput } from 'react-native';

import { LPText, PrimaryButton, Sheet, SheetTextInput } from '../../../components/ui';
import { usePresentationKey } from '../capture/usePresentationKey';
import { useT } from '../../../i18n';
import { colors, hairline } from '../../../theme';

import { barcodeDigits, isValidTypedBarcode } from './normaliser';

/** The example in the field (an Icelandic EAN-13 prefix), as iOS shows it. */
export const TYPED_BARCODE_PLACEHOLDER = '5690000000000';

export interface TypedBarcodeSheetProps {
  readonly visible: boolean;
  /** The digits, once they make a barcode. The sheet is closed by the caller. */
  readonly onLookup: (digits: string) => void;
  readonly onClose: () => void;
}

export default function TypedBarcodeSheet(props: TypedBarcodeSheetProps) {
  // Each opening is a fresh field (iOS makes new @State per sheet).
  const presentation = usePresentationKey(props.visible);
  return <TypedBarcodeForm key={presentation} {...props} />;
}

function TypedBarcodeForm({ visible, onLookup, onClose }: TypedBarcodeSheetProps) {
  const { t } = useT();
  const [text, setText] = useState('');
  const [showLengthError, setShowLengthError] = useState(false);
  const titleRef = useRef<Text>(null);
  const field = useRef<TextInput>(null);
  const digits = barcodeDigits(text);

  // The number pad is up when the sheet opens (iOS `focused = true`).
  useEffect(() => {
    if (!visible) return undefined;
    const timer = setTimeout(() => field.current?.focus(), 350);
    return () => clearTimeout(timer);
  }, [visible]);

  const lookUp = () => {
    if (!isValidTypedBarcode(text)) {
      setShowLengthError(true);
      return;
    }
    onLookup(digits);
  };

  return (
    <Sheet visible={visible} onClose={onClose} initialFocusRef={titleRef} testID="meal.barcode.typedSheet">
      <View style={styles.page}>
        <Pressable onPress={onClose} accessibilityRole="button" style={styles.cancel} hitSlop={6} testID="meal.barcode.typedCancel">
          <LPText size={15} color={colors.accentText}>
            {t('common.cancel')}
          </LPText>
        </Pressable>
        <LPText ref={titleRef} serif size={22} color={colors.paper} accessibilityRole="header">
          {t('meal.barcode.type_title')}
        </LPText>
        <SheetTextInput
          ref={field}
          value={text}
          onChangeText={(value) => {
            setText(value);
            setShowLengthError(false);
          }}
          keyboardType="number-pad"
          inputMode="numeric"
          placeholder={TYPED_BARCODE_PLACEHOLDER}
          placeholderTextColor={colors.paper3}
          accessibilityLabel={t('meal.barcode.type_title')}
          returnKeyType="search"
          onSubmitEditing={lookUp}
          style={[styles.field, showLengthError && styles.fieldError]}
          testID="meal.barcode.typedField"
        />
        {showLengthError ? (
          <LPText size={13} color={colors.destructive} accessibilityLiveRegion="polite" testID="meal.barcode.typedError">
            {t('food.barcode.err.length')}
          </LPText>
        ) : null}
        <PrimaryButton title={t('meal.barcode.lookup')} onPress={lookUp} disabled={digits.length === 0} testID="meal.barcode.lookup" />
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  page: { padding: 20, gap: 14 },
  cancel: { alignSelf: 'flex-start', minHeight: 44, justifyContent: 'center' },
  field: {
    height: 52,
    paddingHorizontal: 14,
    borderRadius: 12,
    backgroundColor: colors.ink2,
    borderWidth: hairline,
    borderColor: colors.line,
    color: colors.paper,
    fontSize: 20,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  fieldError: { borderWidth: 1, borderColor: colors.destructive },
});
