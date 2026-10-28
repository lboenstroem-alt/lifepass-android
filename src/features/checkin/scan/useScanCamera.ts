/**
 * Who holds the Scan tab's camera, and when: the Android port of the camera
 * ownership in iOS `CheckInView` (`wantsCamera`, `syncCamera`) and the
 * authorization half of `ScanCameraController`.
 *
 * THE CAMERA IS HELD EXACTLY WHILE IT IS WANTED: the screen is focused (the
 * Scan tab is selected, or the pushed scanner is on top), the app is active,
 * and the camera is allowed. Anything else releases it, so the camera is never
 * on behind another tab, a root modal (the meal page) or a backgrounded app.
 * expo-camera's `active` prop is iOS only, so on Android the viewfinder is
 * MOUNTED only while wanted; unmounting the CameraView is what lets CameraX go.
 *
 * AUTHORIZATION, as iOS reads it:
 *   authorized      a live viewfinder
 *   notDetermined   "Ready to scan" with an Open Scanner capsule that asks.
 *                   Android also lands here after a first "Don't allow" while
 *                   the system will still ask again (`canAskAgain`), since the
 *                   capsule then still opens the system dialog; iOS can only
 *                   ask once.
 *   denied          the system will not ask again: Open Settings
 *   unavailable     no usable back camera: CameraX could not bind one
 *                   (`onMountError`). Tried again the next time the camera is
 *                   wanted, as iOS re-checks the device on every acquire.
 *   checking        the first permission read has not answered yet (Android
 *                   only; iOS reads it synchronously): nothing is drawn.
 *
 * "CAMERA PAUSED". iOS shows the chip while the capture session is
 * interrupted (a call, another app holding the camera). expo-camera reports
 * only "ready" (CameraX opened the camera) and a bind failure, and CameraX
 * keeps waiting while another app holds the camera. So a viewfinder that is
 * mounted but has not opened its camera within `PAUSED_AFTER_MS` says it is
 * paused, and the chip goes the moment the camera opens.
 *
 * THE DARK TAB BAR. The bar turns dark over a live viewfinder (intent store
 * `scanCameraLive`). Two scanners can be mounted at once (the Scan tab and a
 * scanner pushed on a venue's stack), so the flag remembers which one turned
 * it on, and only that one turns it off: the scanner losing focus must not
 * switch the bar back to paper under the scanner that just gained it.
 */
import { useIsFocused } from '@react-navigation/native';
import { useCameraPermissions, type PermissionResponse } from 'expo-camera';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Linking, type AppStateStatus } from 'react-native';

import { track } from '../../../lib/analytics';
import { useIntentStore } from '../../../stores/intentStore';

export type CameraAuthorization = 'checking' | 'authorized' | 'notDetermined' | 'denied' | 'unavailable';

/** A mounted viewfinder whose camera has not opened by then shows "Camera paused". */
export const PAUSED_AFTER_MS = 2_500;

/** The state the Scan screen draws, from the permission and whether CameraX could bind a camera. */
export function cameraAuthorization(permission: PermissionResponse | null, mountFailed: boolean): CameraAuthorization {
  if (!permission) return 'checking';
  if (permission.granted) return mountFailed ? 'unavailable' : 'authorized';
  if (permission.status === 'undetermined' || permission.canAskAgain) return 'notDetermined';
  return 'denied';
}

/** `scan_tab_viewed.camera` (iOS `cameraAnalyticsValue`). */
export function cameraAnalyticsValue(authorization: Exclude<CameraAuthorization, 'checking'>): string {
  switch (authorization) {
    case 'authorized':
      return 'authorized';
    case 'notDetermined':
      return 'not_determined';
    case 'denied':
      return 'denied';
    case 'unavailable':
      return 'unavailable';
  }
}

/** iOS `wantsCamera`. */
export function wantsCamera(focused: boolean, appActive: boolean, authorization: CameraAuthorization): boolean {
  return focused && appActive && authorization === 'authorized';
}

/**
 * Whether an AppState reading means the foreground. Android reports `active`
 * and `background` only, and `unknown` before its first reading at launch,
 * when the app is in fact starting in front.
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

// The scanner that turned the dark tab bar on (see THE DARK TAB BAR).
let liveOwner: object | null = null;

function setCameraLive(owner: object, live: boolean): void {
  if (live) {
    liveOwner = owner;
    useIntentStore.getState().setScanCameraLive(true);
  } else if (liveOwner === owner) {
    liveOwner = null;
    useIntentStore.getState().setScanCameraLive(false);
  }
}

export interface ScanCamera {
  readonly authorization: CameraAuthorization;
  /** Mount the viewfinder now. */
  readonly wantsCamera: boolean;
  /** The viewfinder is up but its camera has not opened (another app holds it). */
  readonly isPaused: boolean;
  /** The screen is focused (the walk-in, the link and the analytics all wait for it). */
  readonly isFocused: boolean;
  /** "Open Scanner": the system dialog; a yes turns the card into the live viewfinder. */
  requestAccess(): Promise<void>;
  /** "Open Settings" (denied). */
  openSettings(): void;
  /** CameraView `onCameraReady`. */
  onCameraReady(): void;
  /** CameraView `onMountError`. */
  onMountError(): void;
}

export function useScanCamera({ pushed }: { readonly pushed: boolean }): ScanCamera {
  const isFocused = useIsFocused();
  const appActive = useAppActive();
  const [permission, requestPermission, getPermission] = useCameraPermissions();
  const [mountFailed, setMountFailed] = useState(false);
  const [ready, setReady] = useState(false);
  const [isPaused, setPaused] = useState(false);
  const owner = useRef({}).current;

  const authorization = cameraAuthorization(permission, mountFailed);
  const wants = wantsCamera(isFocused, appActive, authorization);

  // The member may have changed the permission in Settings while away: read it
  // again whenever the screen comes back. Leaving forgets a bind failure, so
  // the camera is tried again next time (iOS re-checks on every acquire).
  useEffect(() => {
    if (isFocused && appActive) {
      getPermission().catch(() => undefined);
    } else {
      setMountFailed(false);
    }
  }, [isFocused, appActive, getPermission]);

  // The viewfinder comes and goes with `wants`; its camera has to open again each time.
  useEffect(() => {
    if (!wants) {
      setReady(false);
      setPaused(false);
      return undefined;
    }
    if (ready) {
      setPaused(false);
      return undefined;
    }
    const timer = setTimeout(() => setPaused(true), PAUSED_AFTER_MS);
    return () => clearTimeout(timer);
  }, [wants, ready]);

  // The tab bar's dark treatment, cleared on the way out so it never stays dark over a light page.
  useEffect(() => {
    setCameraLive(owner, wants);
  }, [owner, wants]);
  useEffect(() => () => setCameraLive(owner, false), [owner]);

  // scan_tab_viewed, once per appearance, as soon as the camera's state is known.
  const viewed = useRef(false);
  useEffect(() => {
    if (!isFocused) {
      viewed.current = false;
      return;
    }
    if (viewed.current || authorization === 'checking') return;
    viewed.current = true;
    track('scan_tab_viewed', { camera: cameraAnalyticsValue(authorization), mode: pushed ? 'pushed' : 'tab' });
  }, [isFocused, authorization, pushed]);

  const requestAccess = useCallback(async () => {
    try {
      await requestPermission();
    } catch {
      // No answer: the card stays as it was.
    }
  }, [requestPermission]);

  const openSettings = useCallback(() => {
    Linking.openSettings().catch(() => undefined);
  }, []);

  const onCameraReady = useCallback(() => setReady(true), []);
  const onMountError = useCallback(() => setMountFailed(true), []);

  return { authorization, wantsCamera: wants, isPaused, isFocused, requestAccess, openSettings, onCameraReady, onMountError };
}
