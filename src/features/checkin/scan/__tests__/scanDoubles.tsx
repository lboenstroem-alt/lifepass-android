/**
 * Test doubles for the Scan screen: the camera (expo-camera's view and its
 * permission hook) and the walk-in flow contract (CHECKIN-2), each driven
 * from a small store so a change re-renders the screen as the real ones do.
 * Required from `jest.mock` factories, so it loads nothing of the app.
 */
import type { PermissionResponse } from 'expo-camera';
import { View, type ViewProps } from 'react-native';
import { create } from 'zustand';

export const GRANTED: PermissionResponse = { status: 'granted' as never, granted: true, canAskAgain: true, expires: 'never' };
export const UNDETERMINED: PermissionResponse = { status: 'undetermined' as never, granted: false, canAskAgain: true, expires: 'never' };
export const DENIED_ASK_AGAIN: PermissionResponse = { status: 'denied' as never, granted: false, canAskAgain: true, expires: 'never' };
export const DENIED: PermissionResponse = { status: 'denied' as never, granted: false, canAskAgain: false, expires: 'never' };

interface CameraDouble {
  /** What the hook last read (null before its first read). */
  permission: PermissionResponse | null;
  /** What Android holds now (Settings can change it while the app is away). */
  system: PermissionResponse;
  /** What the system dialog answers. */
  answer: PermissionResponse;
  requests: number;
  reads: number;
}

export const cameraDouble = create<CameraDouble>(() => ({
  permission: GRANTED,
  system: GRANTED,
  answer: GRANTED,
  requests: 0,
  reads: 0,
}));

export function resetCameraDouble(permission: PermissionResponse | null = GRANTED): void {
  cameraDouble.setState(
    { permission, system: permission ?? UNDETERMINED, answer: GRANTED, requests: 0, reads: 0 },
    true,
  );
}

async function request(): Promise<PermissionResponse> {
  const { answer, requests } = cameraDouble.getState();
  cameraDouble.setState({ permission: answer, system: answer, requests: requests + 1 });
  return answer;
}

async function get(): Promise<PermissionResponse> {
  const { system, reads } = cameraDouble.getState();
  cameraDouble.setState({ permission: system, reads: reads + 1 });
  return system;
}

export const expoCameraModule = {
  CameraView: (props: ViewProps) => <View {...props} />,
  useCameraPermissions: () => [cameraDouble((s) => s.permission), request, get] as const,
};

interface FlowDouble {
  isIdle: boolean;
  isProcessing: boolean;
  starts: [string, { readonly fromLink: boolean }][];
}

export const flowDouble = create<FlowDouble>(() => ({ isIdle: true, isProcessing: false, starts: [] }));

export function resetFlowDouble(): void {
  flowDouble.setState({ isIdle: true, isProcessing: false, starts: [] }, true);
}

function useWalkInFlow() {
  const isIdle = flowDouble((s) => s.isIdle);
  const isProcessing = flowDouble((s) => s.isProcessing);
  return {
    isIdle,
    isProcessing,
    startWalkIn: async (venueId: string, options: { readonly fromLink: boolean }) => {
      flowDouble.setState((s) => ({ starts: [...s.starts, [venueId, options]] }));
    },
  };
}

export const walkInModule = {
  useWalkInFlow,
  WalkInFlowHost: () => <View testID="walkin.host" />,
};

export const mealEntryModule = {
  __esModule: true,
  default: ({ disabled }: { disabled?: boolean }) => (
    <View testID="meal.entry" accessibilityState={{ disabled: !!disabled }} style={{ height: 64 }} />
  ),
};
