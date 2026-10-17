/* eslint lifepass/no-literal-copy: "error" */
/**
 * A text field on the sign-in screens (iOS LoginView `authField` and
 * SignUpView `inputField` / `secureField`): 52 tall, the raised paper
 * surface, a hairline rule, radius 12, Inter Tight 15 in ink with a muted
 * placeholder.
 *
 * - `icon` puts a 14 pt glyph in an 18 wide column on the left (Log in's
 *   envelope and lock).
 * - `secure` hides the text; `revealable` adds the eye button that shows
 *   it (Sign up's password). The field itself stays the same field, so the
 *   typed password and the keyboard survive the toggle, as iOS keeps both
 *   twins in the hierarchy for that reason.
 *
 * TalkBack hears the placeholder as the field's name even once it is
 * filled, and the eye button says what a tap does.
 */
import { Ionicons } from '@expo/vector-icons';
import { forwardRef, useState } from 'react';
import { Pressable, StyleSheet, View, type TextInput, type TextInputProps } from 'react-native';

import { useT } from '../i18n';
import { colors, hairline, radius, sans } from '../theme';
import SheetTextInput from './ui/SheetTextInput';

export type AuthFieldProps = Omit<TextInputProps, 'placeholder' | 'value' | 'onChangeText' | 'secureTextEntry'> & {
  /** The field's name, already translated. */
  placeholder: string;
  value: string;
  onChangeText: (value: string) => void;
  icon?: keyof typeof Ionicons.glyphMap;
  secure?: boolean;
  /** With `secure`: the eye button that shows and hides the text. */
  revealable?: boolean;
};

const AuthField = forwardRef<TextInput, AuthFieldProps>(function AuthField(
  { icon, placeholder, value, onChangeText, secure = false, revealable = false, testID, style, ...rest },
  ref,
) {
  const { t } = useT();
  const [visible, setVisible] = useState(false);
  const hidden = secure && !visible;

  return (
    <View style={[styles.field, icon ? styles.withIcon : null]}>
      {icon ? (
        <View style={styles.iconColumn} accessible={false} importantForAccessibility="no-hide-descendants">
          <Ionicons name={icon} size={14} color={colors.paper3} />
        </View>
      ) : null}
      <SheetTextInput
        ref={ref}
        testID={testID}
        style={[styles.input, style]}
        placeholder={placeholder}
        placeholderTextColor={colors.paper3}
        accessibilityLabel={placeholder}
        value={value}
        onChangeText={onChangeText}
        secureTextEntry={hidden}
        autoCapitalize="none"
        autoCorrect={false}
        {...rest}
      />
      {secure && revealable ? (
        <Pressable
          onPress={() => setVisible((shown) => !shown)}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel={t(visible ? 'auth.android.hide_password' : 'auth.android.show_password')}
          testID={testID ? `${testID}.reveal` : undefined}
          style={styles.reveal}
        >
          <Ionicons name={visible ? 'eye-off-outline' : 'eye-outline'} size={17} color={colors.paper3} />
        </Pressable>
      ) : null}
    </View>
  );
});

export default AuthField;

const styles = StyleSheet.create({
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 52,
    paddingHorizontal: 16,
    backgroundColor: colors.ink2,
    borderRadius: radius.field,
    borderWidth: hairline,
    borderColor: colors.line,
    gap: 8,
  },
  withIcon: { gap: 12 },
  iconColumn: { width: 18, alignItems: 'center' },
  input: {
    flex: 1,
    ...sans(15),
    color: colors.paper,
    paddingVertical: 14,
  },
  reveal: { minHeight: 32, justifyContent: 'center' },
});
