// Account's "Delete account" row (plan 3.0.3 slot, filled by ACCT-4; mounted
// by ACCT-1 with no props, last in the account rows, after Sign out).
//
// IN-APP DELETION. The first Android build showed "To delete your account,
// log in on our website" and opened lifepass.is/auth, the flow iOS retired in
// 2.5.3: an account created in an app must be deletable in the app (Google
// Play's account-deletion policy, App Store 5.1.1(v)). The row now opens the
// deletion sheet here, which reads the account's state and can request the
// deletion, show a pending one, or cancel it.
//
// THE SUBTITLE CHANGED WITH IT. "Delete your account and everything we
// store" (`account.delete_sub`), never the old "Log in on our website to
// delete" (`account.delete_gdpr`): a reviewer checking the deletion policy
// reads this one line, and it must be true.
//
// The row hosts its own sheet, as iOS `AccountView` has its own `.sheet`;
// `openAccountDeletion` (../deletion) is for screens that have none.
import { Ionicons } from '@expo/vector-icons';
import { useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { hiddenFromAccessibility, LPText } from '../../../components/ui';
import { useT } from '../../../i18n';
import { colors } from '../../../theme';
import AccountDeletionSheet from '../deletion/AccountDeletionSheet';
import { opensDeletionFixture } from '../deletion/fixtures';

export default function DeletionRow() {
  const { t } = useT();
  // A development fixture (`health=deletion`) opens the sheet with Account,
  // as iOS's screenshot fixture does; always closed in a release build.
  const [open, setOpen] = useState(opensDeletionFixture);
  const rowRef = useRef<View>(null);
  const title = t('account.delete');
  const subtitle = t('account.delete_sub');

  return (
    <>
      <Pressable
        ref={rowRef}
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={`${title}, ${subtitle}`}
        style={({ pressed }) => [styles.row, pressed && styles.pressed]}
        testID="account.delete"
      >
        <View style={styles.text}>
          <LPText size={14} weight="medium" color={colors.destructive}>
            {title}
          </LPText>
          <LPText size={11} color={colors.paper3}>
            {subtitle}
          </LPText>
        </View>
        <View {...hiddenFromAccessibility}>
          <Ionicons name="chevron-forward" size={11} color={colors.paper3} />
        </View>
      </Pressable>
      <AccountDeletionSheet visible={open} onClose={() => setOpen(false)} returnFocusRef={rowRef} />
    </>
  );
}

const styles = StyleSheet.create({
  // iOS `AccountRowLabel`: 16 across, 14 down, the whole row the tap target.
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    minHeight: 44,
  },
  pressed: { opacity: 0.6 },
  text: { flex: 1, gap: 2 },
});
