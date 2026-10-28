/**
 * Publishes a walk-in on its way (intent store `walkInActive`, iOS
 * `AppState.walkInActive`): the Android port of what iOS `CheckInView` sets
 * in `onAppear`, `.onChange(of: viewModel.isIdle)` and `onDisappear`.
 *
 * WHY. "A new version is available" waits while a check-in is underway
 * (src/features/appUpdate/AppUpdateHost.tsx). A walk-in's sheet ("Check in at
 * <venue>?", the own-visit or guest sheet, the charge consent) comes only
 * after its preview request returns, so without this the dialog could take
 * the screen in between and cover the member at the door.
 *
 * WHILE FOCUSED ONLY. The scanner on screen publishes `!isIdle`; a scanner
 * that loses focus or unmounts withdraws it. The walk-in store is NOT read
 * globally: a flow state left behind a scanner the member has walked away
 * from would hold the dialog for good, as iOS's `onDisappear` clears it.
 *
 * TWO SCANNERS can be mounted (the Scan tab and one pushed on a venue's
 * stack), and the one losing focus may run its effect after the one gaining
 * it. So the flag remembers which scanner turned it on, and only that one
 * turns it off (the same rule as the dark tab bar in ./useScanCamera.ts).
 */
import { useEffect, useRef } from 'react';

import { useIntentStore } from '../../../stores/intentStore';

// The scanner that turned `walkInActive` on.
let activeOwner: object | null = null;

function publish(owner: object, active: boolean): void {
  if (active) {
    activeOwner = owner;
    useIntentStore.getState().setWalkInActive(true);
  } else if (activeOwner === owner) {
    activeOwner = null;
    useIntentStore.getState().setWalkInActive(false);
  }
}

/** `walkInActive` is `!isIdle` while this scanner is focused, and withdrawn on blur and unmount. */
export function usePublishWalkInActive(isFocused: boolean, isIdle: boolean): void {
  const owner = useRef({}).current;
  useEffect(() => {
    publish(owner, isFocused && !isIdle);
  }, [owner, isFocused, isIdle]);
  useEffect(() => () => publish(owner, false), [owner]);
}
