/* eslint lifepass/no-literal-copy: "error" */
/**
 * The one-tap consent block for a feature that sends the member's words to
 * the AI provider: the line that names it, the privacy policy link, one
 * button, and a sentence under it when the grant failed. "Describe what you
 * ate" shows it in its sheet (the line `healthconsent.ai.describe`); the
 * Coach shows it in the chat before a member's first plan change (the line
 * `healthconsent.ai.plan_edit`), on the Coach's dark glass (`palette`).
 *
 * Pure presentation: the caller grants (its model or flow) and passes
 * `granting` while the request is out.
 */
import { Ionicons } from '@expo/vector-icons';
import { ActivityIndicator, Linking, Pressable, StyleSheet, View } from 'react-native';

import { hiddenFromAccessibility, LPText } from '../../components/ui';
import { useT } from '../../i18n';
import { colors, hairline, radius } from '../../theme';

import { PRIVACY_POLICY_URL } from './consent';

export interface AiConsentPalette {
  readonly text: string;
  readonly link: string;
  readonly icon: string;
  readonly error: string;
  readonly background: string;
  readonly border: string;
  readonly button: string;
  readonly buttonText: string;
}

/** The light sheets' colours (the meal description sheet). */
export const SHEET_CONSENT_PALETTE: AiConsentPalette = {
  text: colors.paper,
  link: colors.accentText,
  icon: colors.signal,
  error: colors.destructive,
  background: colors.ink2,
  border: colors.line,
  button: colors.rust,
  buttonText: colors.onAccent,
};

export interface AiConsentBlockProps {
  /** The consent line, already the key of the version that will be granted. */
  readonly lineKey: string;
  /**
   * Lines of the same version the member has not been shown yet, above the
   * main one (the describe line for a plan-change grant over a consent older
   * than v3).
   */
  readonly extraLines?: readonly { readonly key: string; readonly icon: keyof typeof Ionicons.glyphMap }[];
  readonly ctaKey: string;
  readonly granting: boolean;
  /** A sentence under the button (a failed grant). */
  readonly errorKey: string | null;
  readonly onGrant: () => void;
  readonly palette?: AiConsentPalette;
  readonly icon?: keyof typeof Ionicons.glyphMap;
  /** The block, its button and its error line get `${testID}`, the button its own. */
  readonly testID: string;
  readonly buttonTestID: string;
  readonly errorTestID: string;
}

export default function AiConsentBlock({
  lineKey,
  extraLines = [],
  ctaKey,
  granting,
  errorKey,
  onGrant,
  palette = SHEET_CONSENT_PALETTE,
  icon = 'chatbubble-ellipses-outline',
  testID,
  buttonTestID,
  errorTestID,
}: AiConsentBlockProps) {
  const { t } = useT();
  return (
    <View style={[styles.consent, { backgroundColor: palette.background, borderColor: palette.border }]} testID={testID}>
      {extraLines.map((extra) => (
        <View key={extra.key} style={styles.line} testID={`${testID}.${extra.key}`}>
          <View {...hiddenFromAccessibility} style={styles.icon}>
            <Ionicons name={extra.icon} size={16} color={palette.icon} />
          </View>
          <LPText size={14} color={palette.text} style={styles.grow}>
            {t(extra.key)}
          </LPText>
        </View>
      ))}
      <View style={styles.line}>
        <View {...hiddenFromAccessibility} style={styles.icon}>
          <Ionicons name={icon} size={16} color={palette.icon} />
        </View>
        <LPText size={14} color={palette.text} style={styles.grow}>
          {t(lineKey)}
        </LPText>
      </View>
      <Pressable
        accessibilityRole="link"
        onPress={() => {
          void Linking.openURL(PRIVACY_POLICY_URL).catch(() => undefined);
        }}
        style={styles.link}
      >
        <LPText size={13} weight="semibold" color={palette.link}>
          {t('healthconsent.privacy_link')}
        </LPText>
      </Pressable>
      <Pressable
        onPress={onGrant}
        disabled={granting}
        accessibilityRole="button"
        accessibilityState={{ disabled: granting, busy: granting }}
        style={({ pressed }) => [styles.button, { backgroundColor: palette.button }, pressed && !granting && styles.pressed]}
        testID={buttonTestID}
      >
        {granting ? <ActivityIndicator size="small" color={palette.buttonText} /> : null}
        <LPText size={15} weight="semibold" color={palette.buttonText}>
          {t(ctaKey)}
        </LPText>
      </Pressable>
      {errorKey ? (
        <LPText size={13} color={palette.error} testID={errorTestID}>
          {t(errorKey)}
        </LPText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  consent: { gap: 12, padding: 14, borderRadius: radius.card, borderWidth: hairline },
  line: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  icon: { width: 18, alignItems: 'center', paddingTop: 1 },
  grow: { flex: 1 },
  link: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' },
  button: {
    minHeight: 52,
    borderRadius: radius.card,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 20,
  },
  pressed: { opacity: 0.85 },
});
