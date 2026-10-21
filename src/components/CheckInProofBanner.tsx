/* eslint lifepass/no-literal-copy: "error" */
/**
 * Home's "You're checked in" bar and the staff proof it re-offers: the
 * Android port of iOS `HomeView.checkInProofBanner` and
 * `checkInProofScreen` (Views/Home/HomeView.swift).
 *
 * A member checks in on the app, walks to reception, and holds this up. The
 * SERVER decides how long the proof lives (it sends `recentCheckIn` on
 * `GET /profile` for 15 minutes after the newest check-in, else null), so
 * there is no countdown here: the bar disappears on the next profile read. A
 * timer in the app would be a second clock to drift out of step with the
 * web's.
 *
 * THE COVER DRAWS A SNAPSHOT taken when the member tapped "Show to staff",
 * not the live profile. A profile read while it is up (the window lapsing, a
 * focus refresh) would otherwise take the proof away from a member standing
 * at the desk. That is also why the cover lives here, beside the bar rather
 * than inside it: mount this component unconditionally (it draws no bar
 * while there is no recent check-in), and the cover outlives the bar.
 *
 * The proof is the SAME view the scanner shows the moment a member checks in
 * (`CheckInProofDisplay`): the time, the day, the venue and the server's
 * short name ("Lucas B."; the full `memberName` is never shown), the class or
 * "Walk-in", the confirmation code (the last six of the check-in id, as the
 * web shows it), and the reception hint. The party is not drawn here, as on
 * iOS (owner decision D6).
 *
 * The bar sits ABOVE Home's hero, which flows under the status bar, so it
 * clears the status bar itself.
 *
 * HOW TO MOUNT IT: `<CheckInProofBanner />`, always, with no props. It reads
 * the app store's profile and draws no bar while there is no recent
 * check-in; a cover that is up stays up when the bar goes. A parent that
 * mounts it only while a check-in is recent takes the cover down with the
 * bar the moment a profile read drops the check-in, which is the blank
 * screen at the desk the snapshot exists to prevent. A `checkIn` prop is
 * still taken (null for none), in the app's shape or the first build's.
 */
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { checkInConfirmationCode, type RecentCheckIn } from '../api/profile';
import type { RecentCheckIn as LegacyRecentCheckIn } from '../supabase/types/profile';
import { CheckInProofCover, SealMark, sealMarkSize, type CheckInProofDisplayProps } from '../features/checkin/proof';
import { useA11ySize } from '../hooks/useA11ySize';
import { useT, type Params } from '../i18n';
import { useAppStore } from '../stores/appStore';
import { colors } from '../theme';
import { hiddenFromAccessibility, LPText } from './ui';

/** What the re-offered proof shows for a recent check-in (iOS `checkInProofScreen`), without its mark. */
export function recentCheckInProof(
  checkIn: RecentCheckIn,
  t: (key: string, params?: Params) => string,
): Omit<CheckInProofDisplayProps, 'mark'> {
  return {
    checkedInAt: checkIn.checkedInAt,
    venueName: checkIn.venue.name,
    // The server's own shortening. `memberName` is still on the wire for
    // shipped clients and is deliberately not read: the surname in full is
    // not what staff are to be handed.
    memberShortName: checkIn.memberShortName,
    activityName: checkIn.activity?.name ?? t('checkin.proof.walkin'),
    confirmationCode: checkInConfirmationCode(checkIn),
    // Not drawn on the re-offered proof (D6: decoded, not shown).
    party: null,
    hint: t('checkin.proof.hint'),
  };
}

/**
 * The app's shape for a check-in handed in the first build's
 * (src/supabase/types/profile.ts). There, `memberName` already carries the
 * SERVER's short name (`toLegacyRecentCheckIn` copies `memberShortName` into
 * it), never the full one, and there is no party, which this proof does not
 * draw anyway.
 */
export function asRecentCheckIn(checkIn: RecentCheckIn | LegacyRecentCheckIn): RecentCheckIn {
  if ('memberShortName' in checkIn) return checkIn;
  return {
    checkInId: checkIn.checkInId,
    checkedInAt: checkIn.checkedInAt,
    memberShortName: checkIn.memberName,
    venue: checkIn.venue,
    activity: checkIn.activity,
    party: null,
  };
}

export interface CheckInProofBannerProps {
  /**
   * The recent check-in to offer. Omitted, the bar reads the app store's
   * profile itself (the way to mount it: see HOW TO MOUNT IT); null shows no
   * bar.
   */
  readonly checkIn?: RecentCheckIn | LegacyRecentCheckIn | null;
}

export default function CheckInProofBanner({ checkIn: given }: CheckInProofBannerProps) {
  const { t } = useT();
  const insets = useSafeAreaInsets();
  const compact = useA11ySize().isAccessibilitySize;
  const fromStore = useAppStore((s) => s.profile?.recentCheckIn ?? null);
  const handed = given === undefined ? fromStore : given;
  const checkIn = handed ? asRecentCheckIn(handed) : null;
  /** The proof as it was when the member opened it. */
  const [shown, setShown] = useState<RecentCheckIn | null>(null);

  return (
    <>
      {checkIn ? (
        <View style={[styles.banner, { paddingTop: insets.top + 12 }]} testID="checkin.proofBanner">
          <View {...hiddenFromAccessibility}>
            <MaterialCommunityIcons name="check-decagram" size={20} color={colors.rust} allowFontScaling={false} />
          </View>
          <View style={styles.bannerText}>
            <LPText size={15} weight="semibold" color={colors.paper} numberOfLines={1}>
              {t('checkin.proof.banner_title')}
            </LPText>
            <LPText size={12} color={colors.paper2} numberOfLines={1}>
              {checkIn.venue.name}
            </LPText>
          </View>
          <Pressable
            onPress={() => setShown(checkIn)}
            accessibilityRole="button"
            accessibilityLabel={t('checkin.proof.show_staff')}
            // iOS's capsule is drawn 36 dp tall; the target reaches Android's 48.
            hitSlop={SHOW_HIT_SLOP}
            style={({ pressed }) => [styles.showButton, pressed && styles.pressed]}
            testID="checkin.proofBanner.show"
          >
            <LPText size={13} weight="semibold" color={colors.ink}>
              {t('checkin.proof.show_staff')}
            </LPText>
          </Pressable>
        </View>
      ) : null}

      <CheckInProofCover
        visible={shown !== null}
        proof={shown ? { ...recentCheckInProof(shown, t), mark: <SealMark size={sealMarkSize(compact)} /> } : null}
        onDone={() => setShown(null)}
        testID="checkin.reoffer"
      />
    </>
  );
}

/** The capsule's 36 dp plus 6 above and below: the 48 dp touch target. */
const SHOW_HIT_SLOP = { top: 6, bottom: 6, left: 4, right: 4 } as const;

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingBottom: 12,
    backgroundColor: colors.ink2,
  },
  bannerText: { flex: 1, gap: 2 },
  showButton: {
    minHeight: 36,
    justifyContent: 'center',
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 999,
    backgroundColor: colors.paper,
  },
  pressed: { opacity: 0.85 },
});
