/**
 * "Forgot password?" (iOS `PasswordResetView`, presented as a sheet from Log
 * in): a title, a line saying what happens, the email (seeded with what the
 * member already typed on Log in), Send Reset Link with a spinner while it
 * sends, and Cancel at the top. An empty email is refused here; once the
 * email is sent an "Email Sent" alert says so over the sheet, and OK closes
 * both.
 *
 * Each opening starts fresh, as an iOS sheet builds a new view each time:
 * the email from Log in, no error, no spinner.
 *
 * The request (src/supabase/services/auth.ts `resetPassword`) marks the
 * phone and asks Supabase to keep `type=recovery` on the link, so the link
 * opens the set-new-password screen rather than simply signing in.
 */
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, View, type Text } from 'react-native';

import { errorMessage } from '../../../api/errorFormatter';
import AuthField from '../../../components/AuthField';
import { Dialog, LPText, PrimaryButton, Sheet } from '../../../components/ui';
import { useT } from '../../../i18n';
import { resetPassword } from '../../../supabase/services/auth';
import { colors } from '../../../theme';
import { resetProblem } from '../validation';

export interface PasswordResetSheetProps {
  readonly visible: boolean;
  /** The email typed on Log in, if any. */
  readonly initialEmail: string;
  readonly onClose: () => void;
}

export default function PasswordResetSheet({ visible, initialEmail, onClose }: PasswordResetSheetProps) {
  const { t } = useT();
  const title = useRef<Text>(null);
  const [email, setEmail] = useState(initialEmail);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // A fresh form at each opening (iOS builds the sheet's view anew).
  useEffect(() => {
    if (!visible) return;
    setEmail(initialEmail);
    setError(null);
    setSending(false);
    setSent(false);
    // Only on opening: the seed is what Log in held at that moment.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  async function send() {
    if (sending) return;
    const problem = resetProblem(email);
    if (problem) {
      setError(t(problem));
      return;
    }
    setSending(true);
    setError(null);
    try {
      await resetPassword(email.trim());
      if (mounted.current) setSent(true);
    } catch (failure) {
      if (mounted.current) setError(errorMessage(failure));
    } finally {
      if (mounted.current) setSending(false);
    }
  }

  return (
    <Sheet visible={visible} onClose={onClose} initialFocusRef={title} testID="auth.resetSheet">
      <View style={styles.toolbar}>
        <Pressable
          onPress={onClose}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel={t('common.cancel')}
          testID="auth.resetSheet.cancel"
        >
          <LPText size={17} color={colors.paper}>
            {t('common.cancel')}
          </LPText>
        </Pressable>
      </View>
      <View style={styles.content}>
        <LPText ref={title} size={22} weight="bold" color={colors.paper} align="center" accessibilityRole="header">
          {t('auth.reset_title')}
        </LPText>
        <LPText size={14} color={colors.paper3} align="center">
          {t('auth.reset_body')}
        </LPText>
        <AuthField
          placeholder={t('auth.email')}
          value={email}
          onChangeText={setEmail}
          keyboardType="email-address"
          autoComplete="email"
          textContentType="emailAddress"
          returnKeyType="send"
          onSubmitEditing={() => void send()}
          testID="auth.resetSheet.email"
        />
        {error ? (
          <LPText size={13} color={colors.destructive} align="center" accessibilityLiveRegion="polite" testID="auth.resetSheet.error">
            {error}
          </LPText>
        ) : null}
        <PrimaryButton title={t('auth.send_reset')} onPress={() => void send()} loading={sending} testID="auth.resetSheet.send" />
      </View>
      {/* Over the sheet, as iOS's alert is; OK closes both. */}
      <Dialog
        visible={sent}
        onClose={() => setSent(false)}
        title={t('auth.email_sent_title')}
        message={t('auth.email_sent_body')}
        buttons={[{ label: t('common.ok'), onPress: onClose, testID: 'auth.resetSheet.sentOk' }]}
        testID="auth.resetSheet.sent"
      />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  toolbar: { flexDirection: 'row', paddingHorizontal: 20, paddingTop: 4, paddingBottom: 4, minHeight: 44, alignItems: 'center' },
  content: { paddingHorizontal: 24, paddingTop: 8, paddingBottom: 24, gap: 24 },
});
