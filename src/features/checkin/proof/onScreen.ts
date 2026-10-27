/**
 * Whether a check-in proof is on screen: the live success screen after a
 * walk-in, or the proof Home re-offers (both draw `CheckInProofDisplay`,
 * which counts itself in while it is mounted; an Android Modal mounts its
 * content only while it shows).
 *
 * The screen reception reads is never covered: the visit rating's card and
 * sheet and the Google Play rating ask wait while this says true
 * (docs/05: "NEVER on the proof screen").
 */
import { useEffect } from 'react';

import { createHostStore } from '../../../components/ui/hostStore';

const shown = createHostStore<number>(0);

/** Counts the calling proof in while it is mounted. */
export function useProofOnScreen(): void {
  useEffect(() => {
    shown.set((count) => count + 1);
    return () => shown.set((count) => Math.max(0, count - 1));
  }, []);
}

/** True while a proof is on screen. */
export function proofOnScreen(): boolean {
  return shown.get() > 0;
}

/** Hears a proof come or go. */
export function subscribeProofOnScreen(listener: () => void): () => void {
  return shown.subscribe(listener);
}
