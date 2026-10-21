// Where Home mounts the "You're checked in" staff-proof banner (CHECKIN-1's
// `CheckInProofBanner`), above the hero: a member who just checked in may be
// standing at a front desk, so the proof outranks everything (iOS draws it
// above the full-bleed hero, with its own top padding).
//
// The proof rides `GET /profile`, which Home already re-reads at every visit
// and pull to refresh (iOS `.task { await appState.loadProfile() }`). The
// banner reads that same profile from the app store itself, so it is not
// read a second time. The server stops sending `recentCheckIn` once its
// window lapses, so the bar goes at the next read; there is no timer here.
//
// THE PROOF MUST OUTLIVE THE BAR. iOS draws the full-screen proof from a
// snapshot taken when the member tapped "Show to staff" (`shownCheckInProof`),
// so a profile read that drops the check-in while the proof is up (the
// window lapsing, a focus refresh) never takes it from a member at the desk.
// On Android the proof lives inside the banner component, so the banner is
// mounted ALWAYS, with no props and no condition: it draws no bar while there
// is no recent check-in, and a proof that is up stays up when the bar goes.
//
// The banner's own props belong to CHECKIN-1; this file is the one place on
// Home that knows them.
import CheckInProofBanner from '../../components/CheckInProofBanner';

export default function HomeProofBanner() {
  return <CheckInProofBanner />;
}
