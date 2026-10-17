/**
 * The first Android build's plan hook, kept for the screens that still call
 * it (Account, Check-in, ProfileCreditCard) until their owners move to the
 * app store. The plan now lives once in the app store: a mount re-reads it
 * there, as the old hook did, but every screen sees the same value, and a
 * failed read KEEPS the plan the member has instead of showing "No active
 * plan" to someone who pays (iOS `AppState.loadSubscription`).
 *
 * New code reads `useAppStore((s) => s.subscription)` and calls
 * `refreshCredits()` after a money event.
 */
import { useCallback, useEffect, useState } from 'react';

import type { Subscription } from '../../api/subscriptions';
import { useAppStore } from '../../stores/appStore';

type SubscriptionState = {
  subscription: Subscription | null;
  /** True while a read this hook started is running and no answer has arrived yet this session. */
  loading: boolean;
  /** Always null: a failed read keeps the plan and says nothing (iOS). */
  error: string | null;
  refetch: () => void;
};

export function useSubscription(): SubscriptionState {
  const subscription = useAppStore((s) => s.subscription);
  const loaded = useAppStore((s) => s.subscriptionLoaded);
  const [reading, setReading] = useState(false);

  const refetch = useCallback(() => {
    if (!useAppStore.getState().isAuthenticated) return;
    setReading(true);
    void useAppStore
      .getState()
      .loadSubscription()
      .finally(() => setReading(false));
  }, []);

  useEffect(() => {
    refetch();
  }, [refetch]);

  return { subscription, loading: reading && !loaded, error: null, refetch };
}
