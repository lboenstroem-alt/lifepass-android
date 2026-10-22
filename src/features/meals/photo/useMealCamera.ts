/**
 * The meal page's camera, for Photo and Barcode: the meal half of iOS
 * `ScanCameraController` (`acquire(.mealCapture)`, `release`, the torch).
 *
 * HELD EXACTLY WHILE IT IS WANTED: the mode is on screen, the page's Capture
 * screen is focused (not under a pushed Review or draft editor), the app is
 * in front, and the camera is allowed. expo-camera's `active` prop is iOS
 * only, so the CameraView is MOUNTED only while wanted; unmounting it is what
 * lets CameraX go (as the Scan tab does, CHECKIN-1's useScanCamera). While
 * this page is up the Scan tab is not focused, so its viewfinder is down and
 * no QR code in view can check anyone in.
 *
 * THE PAGE NEVER ASKS FOR THE CAMERA. As on iOS, permission is the Scan tab's
 * question ("Open Scanner"); here a camera that is not allowed (or not
 * there) is Photo's "Camera access is off. You can still choose a photo."
 * and Barcode's typed panel. The permission is read again whenever the page
 * comes back, since Settings may have changed it.
 *
 * THE LIGHT. The header draws the torch while the camera is open
 * (`model.setTorchAvailable`); expo-camera has no "has a flash" query on
 * Android, so the button shows once the camera has opened, and CameraX
 * ignores the request on a phone without a flash unit.
 */
import { useIsFocused } from '@react-navigation/native';
import { useCameraPermissions } from 'expo-camera';
import { useCallback, useEffect, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

import type { MealCaptureModel } from '../capture/captureModel';
import { useCapture } from '../capture/capturePages';

/**
 * Whether an AppState reading means the foreground. Android reports `active`
 * and `background`, and `unknown` before its first reading at launch, when
 * the app is in fact starting in front (as the Scan tab reads it).
 */
export function isForeground(state: AppStateStatus | null | undefined): boolean {
  return state !== 'background' && state !== 'inactive';
}

/** True while the app is in the foreground (iOS `scenePhase == .active`). */
export function useAppActive(): boolean {
  const [active, setActive] = useState(() => isForeground(AppState.currentState));
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next: AppStateStatus) => setActive(isForeground(next)));
    return () => subscription.remove();
  }, []);
  return active;
}

export interface MealCamera {
  /** The camera may be used: true, false, or null while the permission is being read. */
  readonly allowed: boolean | null;
  /** Mount the CameraView now. */
  readonly wants: boolean;
  /** CameraX has opened the camera (the shutter waits for it). */
  readonly ready: boolean;
  /** The light, as the header's button set it. */
  readonly torchOn: boolean;
  readonly onCameraReady: () => void;
  readonly onMountError: () => void;
}

export function useMealCamera(model: MealCaptureModel): MealCamera {
  const isFocused = useIsFocused();
  const appActive = useAppActive();
  const [permission, , getPermission] = useCameraPermissions({ get: true, request: false });
  const [mountFailed, setMountFailed] = useState(false);
  const [ready, setReady] = useState(false);
  const torchOn = useCapture(model, (s) => s.torchOn);

  const allowed = permission === null ? null : permission.granted && !mountFailed;
  const wants = allowed === true && isFocused && appActive;

  // Read the permission again whenever the page comes back (Settings may have changed it).
  useEffect(() => {
    if (isFocused && appActive) getPermission().catch(() => undefined);
  }, [isFocused, appActive, getPermission]);

  // The camera opens again each time it is mounted; the light goes with it.
  useEffect(() => {
    if (!wants) setReady(false);
  }, [wants]);

  useEffect(() => {
    model.setTorchAvailable(wants && ready);
  }, [model, wants, ready]);

  // Leaving the mode (a switch to Search, the page closing) turns the light off.
  useEffect(() => () => model.setTorchAvailable(false), [model]);

  const onCameraReady = useCallback(() => setReady(true), []);
  const onMountError = useCallback(() => setMountFailed(true), []);

  return { allowed, wants, ready, torchOn: torchOn && wants && ready, onCameraReady, onMountError };
}
