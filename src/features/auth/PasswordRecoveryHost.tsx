/**
 * Set a new password after a reset link (iOS `SetNewPasswordView`, which
 * ContentView presents over WHATEVER is showing while
 * `pendingPasswordRecovery` is set). The reset link has signed the member
 * in; without this screen the link would leave them on the OLD password.
 *
 * F4 mounts this host once at the root (src/navigation/RootNavigator.tsx),
 * above both the sign-in screens and the tabs. It is a full-screen modal
 * window of its own, so nothing the app opens underneath (a sheet, the Kenni
 * nudge, Explore's filters) can cover it, and TalkBack stays inside it.
 *
 * It closes only through its own "Later" (no swipe, no back: iOS
 * `interactiveDismissDisabled(true)`), or once the password is changed and
 * the "Password updated" alert is acknowledged. New password and Confirm,
 * at least 12 characters and the same (./validation.ts), then Supabase's
 * `updateUser`. Each opening starts with empty fields.
 */
import { useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { errorMessage } from '../../api/errorFormatter';
import AuthField from '../../components/AuthField';
import { Dialog, LPText, PrimaryButton } from '../../components/ui';
import { useT } from '../../i18n';
import { modalRequestClose } from '../../navigation/guards';
import { useAppStore } from '../../stores/appStore';
import { updatePassword } from '../../supabase/services/auth';
import { colors } from '../../theme';
import { endPasswordRecovery } from './recovery';
import { newPasswordProblem } from './validation';

export default function PasswordRecoveryHost() {
  const pending = useAppStore((s) => s.pendingPasswordRecovery);
  if (!pending) return null;
  return <SetNewPassword />;
}

function SetNewPassword() {
  const { t } = useT();
  const insets = useSafeAreaInsets();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  async function submit() {
    if (saving) return;
    const problem = newPasswordProblem(password, confirm);
    if (problem) {
      setError(t(problem));
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await updatePassword(password);
      if (mounted.current) setDone(true);
    } catch (failure) {
      if (mounted.current) setError(errorMessage(failure));
    } finally {
      if (mounted.current) setSaving(false);
    }
  }

  return (
    <Modal
      visible
      animationType="slide"
      statusBarTranslucent
      navigationBarTranslucent
      // Back does nothing: only "Later" closes it (iOS `interactiveDismissDisabled(true)`).
      onRequestClose={modalRequestClose({ busy: saving, dismissible: false }, endPasswordRecovery)}
      testID="auth.setNewPassword"
    >
      <View style={[styles.page, { paddingTop: insets.top }]}>
        <View style={styles.toolbar}>
          <Pressable
            onPress={endPasswordRecovery}
            hitSlop={10}
            accessibilityRole="button"
            testID="auth.setNewPassword.later"
          >
            <LPText size={17} color={colors.paper}>
              {t('auth.later')}
            </LPText>
          </Pressable>
        </View>
        <KeyboardAvoidingView style={styles.flex} behavior="padding">
          <ScrollView
            contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 24 }]}
            keyboardShouldPersistTaps="handled"
          >
            <LPText size={22} weight="bold" color={colors.paper} align="center" accessibilityRole="header">
              {t('auth.set_new_title')}
            </LPText>
            <LPText size={14} color={colors.paper3} align="center">
              {t('auth.set_new_body')}
            </LPText>
            <AuthField
              placeholder={t('auth.password_new')}
              value={password}
              onChangeText={setPassword}
              secure
              autoComplete="new-password"
              textContentType="newPassword"
              testID="auth.setNewPassword.password"
            />
            <AuthField
              placeholder={t('auth.password_confirm')}
              value={confirm}
              onChangeText={setConfirm}
              secure
              autoComplete="new-password"
              textContentType="newPassword"
              returnKeyType="done"
              onSubmitEditing={() => void submit()}
              testID="auth.setNewPassword.confirm"
            />
            {error ? (
              <LPText
                size={13}
                color={colors.destructive}
                align="center"
                accessibilityLiveRegion="polite"
                testID="auth.setNewPassword.error"
              >
                {error}
              </LPText>
            ) : null}
            <PrimaryButton
              title={t('auth.update_password')}
              onPress={() => void submit()}
              loading={saving}
              testID="auth.setNewPassword.submit"
            />
          </ScrollView>
        </KeyboardAvoidingView>
      </View>
      <Dialog
        visible={done}
        onClose={() => setDone(false)}
        title={t('auth.password_updated_title')}
        message={t('auth.password_updated_body')}
        buttons={[{ label: t('common.ok'), onPress: endPasswordRecovery, testID: 'auth.setNewPassword.doneOk' }]}
        testID="auth.setNewPassword.done"
      />
    </Modal>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.ink },
  flex: { flex: 1 },
  toolbar: { flexDirection: 'row', alignItems: 'center', minHeight: 44, paddingHorizontal: 20 },
  content: { paddingHorizontal: 24, paddingTop: 24, gap: 20 },
});
