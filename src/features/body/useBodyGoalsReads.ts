/**
 * The two reads Body and goals makes of its own (iOS `BodyAndGoalsView.load`);
 * everything else on the page comes off the profile and the Today read,
 * which are already loaded.
 *
 * - SERIAL, NOT TOGETHER: two reads on a cold serverless function are two
 *   connections, and the pooler has been the cause of a timeout before. The
 *   trend first, then the calorie goal.
 * - THE GOAL READ CARRIES MORE THAN THE GOAL: the standing target weight and
 *   the server's feature list ride on it, and the features are passed on to
 *   the app store as the latest word on what the server supports.
 * - Without consent, or for a minor, nothing is read and nothing is shown.
 * - A refusal goes through the health store's table (a 409 that says consent
 *   is gone is answered there, by a reconcile); the page just shows its
 *   error row. A cancelled read says nothing.
 * - A read that is overtaken (a newer load, or `clear` after a withdrawal)
 *   lands nowhere, so deleted numbers never come back on screen.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import { ApiError, isCancellation } from '../../api';
import type { HealthAccess } from '../../api/profile';
import { fetchNutritionGoalEnvelope, useHealthStore, type NutritionGoalView, type TargetWeightView } from '../../health';
import type { Lang } from '../../i18n';
import { useAppStore } from '../../stores/appStore';

import { fetchWeightTrendWeeks, TREND_WEEKS, type WeightTrendWeeks } from './api';

export interface BodyGoalsReadState {
  readonly trend: WeightTrendWeeks | null;
  readonly goal: NutritionGoalView | null;
  readonly targetWeight: TargetWeightView | null;
  readonly loadFailed: boolean;
}

const EMPTY: BodyGoalsReadState = { trend: null, goal: null, targetWeight: null, loadFailed: false };

/** What a load needs to know at the moment it runs. */
export interface BodyGoalsReadFacts {
  readonly hasConsent: boolean;
  readonly access: HealthAccess;
  readonly language: Lang;
}

export function useBodyGoalsReads(facts: () => BodyGoalsReadFacts): BodyGoalsReadState & {
  load(): Promise<void>;
  /** Forget what was read (a withdrawal: the numbers are deleted). */
  clear(): void;
} {
  const [state, setState] = useState<BodyGoalsReadState>(EMPTY);
  const generation = useRef(0);
  const factsRef = useRef(facts);
  factsRef.current = facts;
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      generation.current += 1;
    };
  }, []);

  const load = useCallback(async () => {
    generation.current += 1;
    const mine = generation.current;
    const { hasConsent, access, language } = factsRef.current();
    if (!hasConsent || access === 'minor') {
      setState(EMPTY);
      return;
    }
    const current = () => mounted.current && generation.current === mine;
    setState((s) => ({ ...s, loadFailed: false }));
    try {
      const trend = await fetchWeightTrendWeeks(TREND_WEEKS);
      if (!current()) return;
      setState((s) => ({ ...s, trend }));
      const envelope = await fetchNutritionGoalEnvelope(language);
      if (!current()) return;
      setState((s) => ({ ...s, goal: envelope.goal, targetWeight: envelope.targetWeight }));
      useAppStore.getState().noteServerFeatures(envelope.features);
    } catch (error) {
      if (!current() || isCancellation(error)) return;
      if (error instanceof ApiError) useHealthStore.getState().handle(error, { foreground: true });
      setState((s) => ({ ...s, loadFailed: true }));
    }
  }, []);

  // Everything goes, the target weight and the error row included: a
  // re-consent on this page starts its reads from nothing, so a deleted
  // target never shows while (or because) the reads that follow run or fail.
  // iOS's withdraw() leaves `targetWeight` set; this does not.
  const clear = useCallback(() => {
    generation.current += 1;
    setState(EMPTY);
  }, []);

  return { ...state, load, clear };
}
