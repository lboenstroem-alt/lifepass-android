/**
 * The Plan card's state for the member signed in now: the stores read into
 * `resolveFeedbackCardState` (iOS PlanView `feedbackCardState(profileId:)`),
 * once for code outside React (Plan's bridge: may the page scroll to the
 * card?) and once as a hook for the section that draws it, so the two can
 * never disagree.
 *
 * Until this member's local flags are read the card offers no intro and no
 * offer (rather than one that may vanish a moment later); the note and the
 * month's report do not depend on them.
 */
import { useEffect, useState } from 'react';

import type { Profile } from '../../api/profile';
import { isLiveStatus } from '../../health/models';
import { selectHasLiveProgram, useHealthStore } from '../../health/store';
import { useAppStore } from '../../stores/appStore';

import { resolveFeedbackCardState, type FeedbackCardState } from './cardState';
import { useFeedbackStore } from './feedbackStore';
import type { FeedbackLocalFlags, FeedbackStoreState } from './store';

type Inputs = {
  readonly profile: Profile | null;
  readonly hasLiveProgram: boolean;
  readonly summary: FeedbackStoreState['summary'];
  readonly flags: FeedbackLocalFlags | null;
  readonly now: Date;
};

function stateFrom({ profile, hasLiveProgram, summary, flags, now }: Inputs): FeedbackCardState {
  const own = profile && flags?.profileId === profile.id ? flags : null;
  return resolveFeedbackCardState({
    summary,
    introDismissed: own?.introDismissed ?? true,
    foodOfferDismissed: own?.foodOfferDismissed ?? true,
    foodOffPending: own?.foodOffPending ?? false,
    hasLivePlan: hasLiveProgram || isLiveStatus(profile?.health?.program?.status ?? null),
    now,
  });
}

/** The card's state as the stores hold it now. */
export function feedbackCardStateNow(now: Date = new Date()): FeedbackCardState {
  const store = useFeedbackStore.getState();
  return stateFrom({
    profile: useAppStore.getState().profile,
    hasLiveProgram: selectHasLiveProgram(useHealthStore.getState()),
    summary: store.summary,
    flags: store.flags,
    now,
  });
}

/** The card's state, re-rendering with the stores; reads the member's flags when they are not in memory. */
export function useFeedbackCardState(): FeedbackCardState {
  const profile = useAppStore((s) => s.profile);
  const hasLiveProgram = useHealthStore(selectHasLiveProgram);
  const summary = useFeedbackStore((s) => s.summary);
  const flags = useFeedbackStore((s) => s.flags);
  // "Under a week old" is measured when the summary changes, not every frame.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => setNow(new Date()), [summary]);
  const profileId = profile?.id ?? null;
  useEffect(() => {
    if (profileId) void useFeedbackStore.getState().loadFlags(profileId);
  }, [profileId]);
  return stateFrom({ profile, hasLiveProgram, summary, flags, now });
}
