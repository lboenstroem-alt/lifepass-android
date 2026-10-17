/**
 * The sign-up form's three controls that are not text fields (iOS
 * SignUpView): the nationality menu, the marketing switch and the Terms
 * checkbox with its links.
 */
import { Ionicons } from '@expo/vector-icons';
import { useMemo } from 'react';
import { Pressable, StyleSheet, Switch, View } from 'react-native';

import { LPText, MenuPicker, type MenuOption } from '../../../components/ui';
import { markupPlain, MarkupText, useT } from '../../../i18n';
import { colors, hairline, radius, sans } from '../../../theme';
import { COUNTRY_OPTIONS, nationalityLabel } from '../../../utils/nationality';

/** Where the Terms and Privacy links go (iOS `MerchantInfo.termsURL` / `privacyURL`). */
export const TERMS_URL = 'https://lifepass.is/terms';
export const PRIVACY_URL = 'https://lifepass.is/privacy';

/**
 * The optional nationality (iOS `Menu`): "Prefer not to say" on top, then
 * Iceland and the rest alphabetically. The field reads "Nationality
 * (optional)" in the muted colour while unset, the country's name once set.
 * Country names are English in both languages, as on iOS and the website.
 */
export function NationalityPicker({
  value,
  onPick,
}: {
  /** ISO alpha-2, or '' when unset. */
  readonly value: string;
  readonly onPick: (code: string) => void;
}) {
  const { t } = useT();
  const options = useMemo<MenuOption<string>[]>(
    () => [
      { value: '', label: t('auth.prefer_not_say'), testID: 'auth.signup.nationality.none' },
      ...COUNTRY_OPTIONS.map((option) => ({
        value: option.code,
        label: option.label,
        testID: `auth.signup.nationality.${option.code}`,
      })),
    ],
    [t],
  );
  const shown = value ? (nationalityLabel(value) ?? t('auth.nationality')) : t('auth.nationality');
  return (
    <MenuPicker
      options={options}
      value={value}
      onChange={onPick}
      label={t('auth.nationality')}
      style={styles.pickerTrigger}
      testID="auth.signup.nationality"
      renderTrigger={() => (
        <View style={styles.pickerField}>
          <LPText size={15} color={value ? colors.paper : colors.paper3} style={styles.flex} numberOfLines={1}>
            {shown}
          </LPText>
          <Ionicons name="chevron-expand" size={14} color={colors.paper3} />
        </View>
      )}
    />
  );
}

/** "Send me occasional news and offers" (iOS `Toggle`), off by default. One switch to TalkBack. */
export function MarketingToggle({ value, onChange }: { readonly value: boolean; readonly onChange: (on: boolean) => void }) {
  const { t } = useT();
  const label = t('auth.marketing_optin');
  return (
    <Pressable
      onPress={() => onChange(!value)}
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityState={{ checked: value }}
      style={styles.toggleRow}
      testID="auth.signup.marketing"
    >
      <LPText size={13} color={colors.paper3} style={styles.flex}>
        {label}
      </LPText>
      <Switch
        value={value}
        onValueChange={onChange}
        trackColor={{ true: colors.rust, false: colors.line2 }}
        thumbColor={colors.onAccent}
        accessible={false}
        importantForAccessibility="no-hide-descendants"
      />
    </Pressable>
  );
}

/**
 * The required Terms checkbox (iOS `termsRow`): the box, then "I agree to
 * the Terms and Privacy Policy." with both as links that open in the
 * browser. The box and the links are separate controls, so TalkBack can
 * reach the links (one checkbox around them would swallow them).
 */
export function TermsRow({ checked, onChange }: { readonly checked: boolean; readonly onChange: (on: boolean) => void }) {
  const { t } = useT();
  const text = t('auth.terms_agree', { terms: TERMS_URL, privacy: PRIVACY_URL });
  return (
    <View style={styles.termsRow}>
      <Pressable
        onPress={() => onChange(!checked)}
        hitSlop={10}
        accessibilityRole="checkbox"
        accessibilityLabel={markupPlain(text)}
        accessibilityState={{ checked }}
        testID="auth.signup.terms"
      >
        <Ionicons name={checked ? 'checkbox' : 'square-outline'} size={22} color={checked ? colors.rust : colors.paper3} />
      </Pressable>
      <MarkupText style={styles.termsText} linkColor={colors.accentText} testID="auth.signup.termsText">
        {text}
      </MarkupText>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  pickerTrigger: { alignSelf: 'stretch' },
  pickerField: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 52,
    paddingHorizontal: 16,
    backgroundColor: colors.ink2,
    borderRadius: radius.field,
    borderWidth: hairline,
    borderColor: colors.line,
  },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 44 },
  termsRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  termsText: { ...sans(13), color: colors.paper3, flex: 1, lineHeight: 18 },
});
