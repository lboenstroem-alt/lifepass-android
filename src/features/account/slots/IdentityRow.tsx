// The Account identity row (iOS AccountView's kennitala row), filled by
// AUTH-3; mounted by ACCT-1 in the account card (plan 3.0.3).
//
// A permanent, visible home for verification, so it is discoverable before a
// monthly checkout or a co-pay claim demands it. Rendered only once the
// profile has loaded, so the wrong state never flashes. A verified member
// sees an informational row ("Identity (kennitala)", "Verified with
// Kenni.is", a green seal, no chevron); an unverified one gets a tappable row
// ("Not verified", "needed for monthly plans") that opens the Kenni sheet
// with the default body and no "See visitor passes".
//
// ON CLOSE, verified or not, the profile is re-read (iOS `onDismiss`), and
// the co-pay banner re-reads the company-plan context through
// `onKenniSheetClosed`: the Kenni completion is where invitations are
// claimed, so an invite may just have turned into a pending activation.
//
// THE DIVIDER. iOS draws the hairline under this row only when the row
// itself is drawn, so the slot draws it too. Pass `divider={false}` for a
// row placed last in its card.
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, View, Pressable } from 'react-native';

import { hiddenFromAccessibility, LPText } from '../../../components/ui';
import { useT } from '../../../i18n';
import { useAppStore } from '../../../stores/appStore';
import { colors, hairline } from '../../../theme';
import { isKenniSheetRequested, openKenniSheet } from '../../kenni';

/** iOS draws the verified seal in the system green; the same darker green as the sheet's "Identity verified!". */
const SEAL_GREEN = '#1E7B34';

export type IdentityRowProps = {
  /** The hairline below the row (default true; false when it is the card's last row). */
  divider?: boolean;
};

/** Opens the sheet from Account (exported for the tests). */
export function openIdentityVerification(): void {
  if (isKenniSheetRequested()) return;
  openKenniSheet({
    bodyKey: 'kenni.body',
    onClose: () => {
      void useAppStore.getState().loadProfile();
    },
  });
}

export default function IdentityRow({ divider = true }: IdentityRowProps) {
  const { t } = useT();
  const profileLoaded = useAppStore((state) => state.profile !== null);
  const verified = useAppStore((state) => state.profile?.kennitalaVerified ?? false);
  if (!profileLoaded) return null;

  const title = t('account.identity');
  const subtitle = t(verified ? 'account.identity_verified' : 'account.identity_needed');

  const labels = (
    <View style={styles.labels}>
      <LPText size={14} weight="medium" color={colors.paper}>
        {title}
      </LPText>
      <LPText size={11} color={colors.mutedTextStrong}>
        {subtitle}
      </LPText>
    </View>
  );

  return (
    <>
      {verified ? (
        <View
          accessible
          accessibilityLabel={`${title}, ${subtitle}`}
          style={styles.row}
          testID="account.identity.verified"
        >
          {labels}
          <View {...hiddenFromAccessibility}>
            <Ionicons name="shield-checkmark" size={16} color={SEAL_GREEN} />
          </View>
        </View>
      ) : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${title}, ${subtitle}`}
          onPress={openIdentityVerification}
          style={({ pressed }) => [styles.row, pressed && styles.pressed]}
          testID="account.identity"
        >
          {labels}
          <View {...hiddenFromAccessibility}>
            <Ionicons name="chevron-forward" size={13} color={colors.paper3} />
          </View>
        </Pressable>
      )}
      {divider ? <View {...hiddenFromAccessibility} style={styles.divider} testID="account.identity.divider" /> : null}
    </>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    minHeight: 48,
  },
  labels: { flex: 1, gap: 2 },
  pressed: { opacity: 0.6 },
  divider: { height: hairline, backgroundColor: colors.line, marginHorizontal: 16 },
});
