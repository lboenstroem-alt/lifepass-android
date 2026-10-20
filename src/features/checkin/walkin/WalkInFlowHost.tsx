/* eslint lifepass/no-literal-copy: "error" */
/**
 * Draws the walk-in flow (./store) on the Scan screen: the "Processing…"
 * overlay, the activity picker, the attendance choice, the own-visit step,
 * the guest sheet, the alerts (consent, link, pay outcome, refusals) and the
 * proof cover. The Android form of what iOS `CheckInView` presents from its
 * view model.
 *
 * WHERE TO MOUNT IT (CHECKIN-1): as the LAST child of the area under the top
 * bar (the camera region). The overlay fills its parent, as iOS's covers the
 * camera and not the bar; the sheets, the alerts and the proof draw over
 * the whole app wherever it sits.
 *
 * ONE FLOW, ONE HOST ON SCREEN. The flow is one per app: the Scan tab and a
 * scanner pushed from a venue page share it, and tab stacks stay mounted, so
 * several hosts can be mounted at once. Only one draws: the one whose screen
 * was focused last (a host mounted on a screen in focus counts as focused
 * then). So the "Processing…" veil and a refusal's step (My bookings, Book a
 * time) land on the scanner the member is looking at, never on a hidden tab,
 * as each iOS `CheckInView` draws its own flow. When that host goes, the one
 * focused before it takes over whatever is still in hand (a proof that
 * arrived after back, say). Outside a navigator a host counts as focused.
 */
import { NavigationContext } from '@react-navigation/native';
import { useContext, useEffect, useState } from 'react';
import { create } from 'zustand';

import { registerWalkInHooks } from './register';
import { noteHostMounted } from './store';
import ActivityPickerSheet from './ui/ActivityPickerSheet';
import AttendChoiceSheet from './ui/AttendChoiceSheet';
import GuestSheet from './ui/GuestSheet';
import OwnVisitSheet from './ui/OwnVisitSheet';
import ProcessingOverlay from './ui/ProcessingOverlay';
import SuccessCover from './ui/SuccessCover';
import WalkInDialogs from './ui/WalkInDialogs';

/** The mounted hosts, the one focused longest ago first: the last one draws. */
const useHosts = create<{ stack: readonly number[] }>(() => ({ stack: [] }));
let nextHostId = 1;

function without(stack: readonly number[], id: number): number[] {
  return stack.filter((host) => host !== id);
}

/** True for the host whose screen was focused last (see the file comment). */
function useIsDrawingHost(): boolean {
  const [id] = useState(() => nextHostId++);
  // The screen's own navigation: a hook that throws outside a navigator
  // (useIsFocused) would take the host down with it.
  const navigation = useContext(NavigationContext);
  useEffect(() => {
    registerWalkInHooks();
    const focused = navigation ? navigation.isFocused() : true;
    // A screen mounted out of sight (a preloaded tab) waits at the bottom.
    useHosts.setState((state) => ({ stack: focused ? [...without(state.stack, id), id] : [id, ...without(state.stack, id)] }));
    const unmount = noteHostMounted();
    const unsubscribe = navigation?.addListener('focus', () => {
      useHosts.setState((state) => ({ stack: [...without(state.stack, id), id] }));
    });
    return () => {
      unsubscribe?.();
      useHosts.setState((state) => ({ stack: without(state.stack, id) }));
      unmount();
    };
  }, [id, navigation]);
  return useHosts((state) => state.stack[state.stack.length - 1] === id);
}

export default function WalkInFlowHost() {
  const drawing = useIsDrawingHost();
  if (!drawing) return null;
  return (
    <>
      <ProcessingOverlay />
      <ActivityPickerSheet />
      <AttendChoiceSheet />
      <OwnVisitSheet />
      <GuestSheet />
      <WalkInDialogs />
      <SuccessCover />
    </>
  );
}
