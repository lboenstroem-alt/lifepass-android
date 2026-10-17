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
 * scanner pushed from a venue page share it. Each mounted host counts itself
 * in, and only the newest draws, so a pushed scanner over the tab's never
 * shows a sheet twice; when it goes, the tab's host takes over whatever is
 * still in hand (a proof that arrived after back, say).
 */
import { useEffect, useState } from 'react';
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

/** The mounted hosts, oldest first. */
const useHosts = create<{ stack: readonly number[] }>(() => ({ stack: [] }));
let nextHostId = 1;

/** True for the newest mounted host. */
function useIsDrawingHost(): boolean {
  const [id] = useState(() => nextHostId++);
  useEffect(() => {
    registerWalkInHooks();
    useHosts.setState((state) => ({ stack: [...state.stack, id] }));
    const unmount = noteHostMounted();
    return () => {
      useHosts.setState((state) => ({ stack: state.stack.filter((host) => host !== id) }));
      unmount();
    };
  }, [id]);
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
