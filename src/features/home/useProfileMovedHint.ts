// The one-time "your bookings are here now" pointer's state on Home (iOS
// `showProfileMovedHint`, `evaluateProfileMovedHint`, `markProfileOpened`).
//
// Evaluated after each profile read: shown only on an install that knew
// Profile as a tab and only until THIS member has opened Profile (the key is
// per profile, so two accounts on one phone do not share it). A tap on the
// bubble, or opening Profile from anywhere on Home, retires it for good.
import { useCallback, useEffect, useRef, useState } from 'react';

import { track } from '../../lib/analytics';
import { markProfileOpened, shouldShowProfileMovedHint } from '../../navigation/profile';

export interface ProfileMovedHint {
  readonly visible: boolean;
  /** Re-reads whether the pointer is due for this member (after a profile read). */
  evaluate(profileId: string | null | undefined): Promise<void>;
  /** The bubble was tapped. */
  dismiss(profileId: string | null | undefined): void;
  /** Profile was opened from Home (avatar, person button or the upcoming card). */
  profileOpened(profileId: string | null | undefined): void;
}

export function useProfileMovedHint(): ProfileMovedHint {
  const [visible, setVisible] = useState(false);
  const visibleRef = useRef(false);
  const latest = useRef(0);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const show = useCallback((next: boolean) => {
    visibleRef.current = next;
    if (mounted.current) setVisible(next);
  }, []);

  const evaluate = useCallback(
    async (profileId: string | null | undefined) => {
      const mine = ++latest.current;
      const due = await shouldShowProfileMovedHint(profileId);
      if (mine === latest.current) show(due);
    },
    [show],
  );

  const retire = useCallback(
    (profileId: string | null | undefined) => {
      // An evaluation still on the way must not bring it back.
      latest.current += 1;
      if (visibleRef.current) {
        show(false);
        track('profile_hint_dismissed', { entry: 'home_callout' });
      }
      if (profileId) void markProfileOpened(profileId);
    },
    [show],
  );

  return { visible, evaluate, dismiss: retire, profileOpened: retire };
}
