// Where Home mounts the "You're checked in" staff-proof banner (CHECKIN-1's
// `CheckInProofBanner`), above the hero: a member who just checked in may be
// standing at a front desk, so the proof outranks everything (iOS draws it
// above the full-bleed hero, with its own top padding).
//
// The proof rides `GET /profile`, which Home already re-reads at every visit
// and pull to refresh (iOS `.task { await appState.loadProfile() }`), so the
// banner reads the profile Home loaded rather than reading it a second time.
// The server stops sending `recentCheckIn` once its window lapses, so the
// bar goes at the next read; there is no timer here.
//
// THE PROOF MUST OUTLIVE THE BAR. iOS draws the full-screen proof from a
// snapshot taken when the member tapped "Show to staff" (`shownCheckInProof`),
// so a profile read that drops the check-in while the proof is up (the
// window lapsing, a focus refresh) never takes it from a member at the desk.
// On Android the proof lives inside the banner component, so the banner has
// to stay MOUNTED for that to hold:
//   - CHECKIN-1's rewrite (branch parity/checkin-1) keeps the snapshot and
//     takes an optional `checkIn`; it is to be mounted always, with no props.
//   - The first build's banner, still on this branch's base, needs a check-in
//     to draw at all, so until CHECKIN-1 lands Home can only mount it while
//     there is one (the first build's behaviour, unchanged).
// The tripwire below turns that hand-over into a compile error, so the merge
// that brings both together cannot miss it.
//
// The banner's own props belong to CHECKIN-1; this file is the one place on
// Home that knows them.
import { useMemo, type ComponentProps } from 'react';

import CheckInProofBanner from '../../components/CheckInProofBanner';
import { useAppStore } from '../../stores/appStore';
import { toLegacyRecentCheckIn } from '../../supabase/types/profile';

/**
 * MERGE TRIPWIRE (HOME-1 x CHECKIN-1). This stops compiling once the banner's
 * `checkIn` prop is optional, which is CHECKIN-1's rewrite landing. When it
 * does, replace the whole body of `HomeProofBanner` below with
 *
 *   return <CheckInProofBanner />;
 *
 * (always mounted, no props, no condition), drop the now unused imports, and
 * delete this type. In HomeSlots.test.tsx, let the banner stand-in read
 * `useAppStore`'s `profile.recentCheckIn` itself when it gets no `checkIn`.
 */
export type HomeProofBannerTripwire = RequireCheckIn<undefined extends ComponentProps<typeof CheckInProofBanner>['checkIn'] ? false : true>;
type RequireCheckIn<Holds extends true> = Holds;

export default function HomeProofBanner() {
  const recent = useAppStore((state) => state.profile?.recentCheckIn ?? null);
  // The banner's shape; it carries the server's SHORT name only.
  const checkIn = useMemo(() => toLegacyRecentCheckIn(recent), [recent]);
  return checkIn ? <CheckInProofBanner checkIn={checkIn} /> : null;
}
