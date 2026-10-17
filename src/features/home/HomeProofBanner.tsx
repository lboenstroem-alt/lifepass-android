// Where Home mounts the "You're checked in" staff-proof banner (CHECKIN-1's
// `CheckInProofBanner`), above the hero: a member who just checked in may be
// standing at a front desk, so the proof outranks everything (iOS draws it
// above the full-bleed hero, with its own top padding).
//
// The proof rides `GET /profile`, which Home already re-reads at every visit
// and pull to refresh (iOS `.task { await appState.loadProfile() }`), so the
// banner reads the profile Home loaded rather than reading it a second time.
// The server stops sending `recentCheckIn` once its window lapses, so the
// banner goes at the next read; there is no timer here.
//
// The banner's own props belong to CHECKIN-1; this file is the one place on
// Home that knows them.
import { useMemo } from 'react';

import CheckInProofBanner from '../../components/CheckInProofBanner';
import { useAppStore } from '../../stores/appStore';
import { toLegacyRecentCheckIn } from '../../supabase/types/profile';

export default function HomeProofBanner() {
  const recent = useAppStore((state) => state.profile?.recentCheckIn ?? null);
  // The banner's shape; it carries the server's SHORT name only.
  const checkIn = useMemo(() => toLegacyRecentCheckIn(recent), [recent]);
  return checkIn ? <CheckInProofBanner checkIn={checkIn} /> : null;
}
