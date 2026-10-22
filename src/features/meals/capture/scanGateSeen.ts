/**
 * Whether this member has seen the Scan tab's meal gate on this phone (iOS
 * UserDefaults `scan.meal.gateSeen.<id>`): the Scan tab's "Scan your meal"
 * is then a compact pill for someone without a membership.
 *
 * iOS reads UserDefaults synchronously, so a member who has seen the gate
 * never sees the full card first. AsyncStorage answers later, so the answer
 * is kept here, in memory, per member, once read: the first visit to the
 * Scan tab reads it (and draws no button for a non-member until it knows),
 * every later visit knows it at once, and the reticle's room under the
 * button does not move.
 *
 * The flag is health state (src/health/localKeys.ts): the health wipe
 * removes the key, and the hook below forgets the copy here with it. A read
 * still in flight when the wipe ran is dropped.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect } from 'react';
import { create } from 'zustand';

import { scanMealGateSeenKey } from '../../../health/localKeys';
import { registerHealthWipeHook } from '../../../health/wipe';

interface GateSeenState {
  /** Per member: read (or marked) answers only. */
  readonly seen: Readonly<Record<string, boolean>>;
}

const useGateSeenStore = create<GateSeenState>()(() => ({ seen: {} }));

/** Bumped by every forget: an answer read before it is out of date. */
let generation = 0;
const reading = new Map<string, Promise<void>>();

function store(profileId: string, value: boolean): void {
  useGateSeenStore.setState((state) => ({ seen: { ...state.seen, [profileId]: value } }));
}

/** Reads the flag once per member (again only after a forget). */
export function loadScanGateSeen(profileId: string): Promise<void> {
  if (profileId in useGateSeenStore.getState().seen) return Promise.resolve();
  const pending = reading.get(profileId);
  if (pending) return pending;
  const started = generation;
  const read = AsyncStorage.getItem(scanMealGateSeenKey(profileId))
    .then(
      (stored) => stored === 'true',
      // Unreadable: as on a phone that never saw it (the full card).
      () => false,
    )
    .then((value) => {
      if (started !== generation || profileId in useGateSeenStore.getState().seen) return;
      store(profileId, value);
    })
    .finally(() => {
      if (reading.get(profileId) === read) reading.delete(profileId);
    });
  reading.set(profileId, read);
  return read;
}

/** The gate has been seen (its sheet has gone). */
export function markScanGateSeen(profileId: string): void {
  store(profileId, true);
  AsyncStorage.setItem(scanMealGateSeenKey(profileId), 'true').catch(() => undefined);
}

/** The health wipe removed the key: forget the member's answer here too (everyone's when nobody is named). */
export function forgetScanGateSeen(profileId: string | null): void {
  generation += 1;
  reading.clear();
  useGateSeenStore.setState((state) => {
    if (profileId === null) return { seen: {} };
    const seen = { ...state.seen };
    delete seen[profileId];
    return { seen };
  });
}

/**
 * The flag for `profileId`: true or false once known, null while the first
 * read is under way. Nobody signed in has not seen it.
 */
export function useScanGateSeen(profileId: string | null): boolean | null {
  const value = useGateSeenStore((state) => (profileId ? state.seen[profileId] : false));
  const known = value !== undefined;
  useEffect(() => {
    if (profileId && !known) void loadScanGateSeen(profileId);
  }, [profileId, known]);
  return value ?? null;
}

/** Tests: nothing known, nothing being read. */
export function resetScanGateSeenForTests(): void {
  forgetScanGateSeen(null);
}

registerHealthWipeHook('meals.scanGateSeen', ({ profileId }) => forgetScanGateSeen(profileId));
