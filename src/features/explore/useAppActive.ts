// Whether the app is in the foreground (iOS `scenePhase == .active`).
import { useEffect, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

/** Unknown counts as active: only a definite background or inactive state holds things back. */
function isActive(state: AppStateStatus | null | undefined): boolean {
  return state !== 'background' && state !== 'inactive';
}

export function useAppActive(): boolean {
  const [active, setActive] = useState(() => isActive(AppState.currentState));
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next) => setActive(isActive(next)));
    return () => subscription.remove();
  }, []);
  return active;
}
