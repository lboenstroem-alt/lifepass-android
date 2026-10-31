/**
 * The health sheets that can open over any screen: the consent sheet
 * (`openHealthConsent`) and the meal membership gate (`presentMealGate`).
 * iOS draws them over the tab view (`mealGlobalChrome`); the app shell mounts
 * this once, above the navigator and inside the UI kit's provider, and hands
 * it the two places they lead to. Until it is mounted, `openHealthConsent`
 * and `presentMealGate` answer false and show nothing (F4 contract request:
 * mount it in App.tsx).
 *
 *   <HealthHost
 *     onSeeMemberships={() => navigate('Plans')}
 *     onOpenAccount={() => navigate('Account')}
 *   />
 */
import { useEffect } from 'react';

import HealthConsentHost from './consent/HealthConsentHost';
import { attachMealGateHost, dismissMealGate, useMealGatePresenter } from './gate/mealGate';
import MealGateSheet from './gate/MealGateSheet';

export type HealthHostProps = {
  /** The membership catalogue (the Plans sheet). */
  onSeeMemberships: () => void;
  /** The Account screen. */
  onOpenAccount: () => void;
};

export default function HealthHost({ onSeeMemberships, onOpenAccount }: HealthHostProps) {
  return (
    <>
      <HealthConsentHost onOpenAccount={onOpenAccount} />
      <MealGateHost onSeeMemberships={onSeeMemberships} onOpenAccount={onOpenAccount} />
    </>
  );
}

function MealGateHost({ onSeeMemberships, onOpenAccount }: HealthHostProps) {
  // Until this runs, `presentMealGate` answers false: nothing would draw it.
  useEffect(() => attachMealGateHost(), []);
  const access = useMealGatePresenter((s) => s.access);
  const visible = useMealGatePresenter((s) => s.visible);
  if (access === null) return null;
  return (
    <MealGateSheet
      visible={visible}
      access={access}
      onClose={dismissMealGate}
      onSeeMemberships={onSeeMemberships}
      onOpenAccount={onOpenAccount}
    />
  );
}
