/**
 * The camera-first Scan tab: the Android port of iOS `CheckInView`
 * (Views/CheckIn/CheckInView.swift, `ios-ux.md` 11), in its two modes:
 *
 *   tab     the Scan tab's first screen (`ScanMain`): the person button, the
 *           "Scan your meal" entry above the reticle, check-in links
 *   pushed  the scanner a venue's "Scan QR" pushes on its own stack
 *           (`ScanPushed`): a back arrow in the bar, no meal entry, and every
 *           refusal explained, because the member aimed at that venue's code
 *           on purpose
 *
 * What it owns: the camera (./useScanCamera.ts), what each read means and the
 * QR lock (./qrRead.ts), the chip, the refusal alert, "Scan another code",
 * and the parked link (../link). What it hands on: a venue to the walk-in
 * flow (`useWalkInFlow`, CHECKIN-2), whose "Processing…" veil, sheets,
 * alerts and success cover (the proof, ../proof) `WalkInFlowHost` draws.
 *
 * THE HOST is the last child of the camera region, as CHECKIN-2 asks: its
 * veil covers the camera and not the bar, as iOS's does, and its sheets and
 * covers draw over the whole app wherever it sits. Two scanners can be
 * mounted (the Scan tab and one pushed on a venue's stack); the flow is one
 * store and only the newest mounted host draws. Newest by MOUNT is not the
 * one on screen: a scanner pushed from a venue stays mounted on its tab when
 * the member taps over to the Scan tab, and its veil would then fall on the
 * hidden tab while the visible camera sat locked with nothing explaining why.
 * iOS gives every scanner its own overlay, so the one in front always shows
 * its walk-in. Here each scanner mounts its host afresh whenever it comes
 * back on screen (`useFocusGeneration`), which makes the scanner in front
 * the newest host, and so the one that draws.
 */
import { BottomTabBarHeightContext } from '@react-navigation/bottom-tabs';
import type { BarcodeScanningResult } from 'expo-camera';
import { useCallback, useContext, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';

import { announce, Dialog, TopBar } from '../../../components/ui';
import { useT } from '../../../i18n';
import { haptics } from '../../../lib/haptics';
import { track } from '../../../lib/analytics';
import { useAppNavigation } from '../../../navigation/hooks';
import { openProfile } from '../../../navigation/profile';
import { colors } from '../../../theme';
import ScanMealEntry from '../../meals/ScanMealEntry';
import { useParkedScanLink, type ScanLinkNavigation } from '../link/useParkedScanLink';
import { useWalkInFlow, WalkInFlowHost } from '../walkin';
import { dispositionOf, QrGate, QrReadClassifier, type QrDisposition } from './qrRead';
import ScanPrompt from './ScanPrompt';
import ScanViewfinder from './ScanViewfinder';
import { useScanCamera } from './useScanCamera';

/** "Not a LifePass code" stays this long (iOS 2 s). */
export const FOREIGN_CHIP_MS = 2_000;

/** The 24 dp gap under the meal entry, or under the bar when there is none (iOS `reticleReserveTop`). */
const RESERVE_GAP = 24;
const MEAL_ENTRY_TOP = 16;

/** iOS `reticleReserveTop`: under the meal entry with the 24 dp gap, or 24 dp when there is none. */
export function reserveTopFor(mealEntryHeight: number): number {
  return mealEntryHeight > 0 ? MEAL_ENTRY_TOP + mealEntryHeight + RESERVE_GAP : RESERVE_GAP;
}

/**
 * Counts the times this screen has come back into focus. Used as the walk-in
 * host's key, so the host mounts again (and becomes the newest) each time the
 * scanner returns to the front; the first appearance is the first mount and
 * needs no second one.
 */
export function useFocusGeneration(isFocused: boolean): number {
  const [seen, setSeen] = useState({ isFocused, generation: 0 });
  if (seen.isFocused === isFocused) return seen.generation;
  // React's "adjust state while rendering" form: no effect, no extra frame
  // with the old host still drawing.
  const next = { isFocused, generation: isFocused ? seen.generation + 1 : seen.generation };
  setSeen(next);
  return next.generation;
}

export interface CheckInScanViewProps {
  /** Pushed from a venue's page (iOS `showsBackButton`). */
  readonly pushed: boolean;
}

export default function CheckInScanView({ pushed }: CheckInScanViewProps) {
  const { t } = useT();
  const navigation = useAppNavigation();
  const flow = useWalkInFlow();
  const camera = useScanCamera({ pushed });
  const hostGeneration = useFocusGeneration(camera.isFocused);
  const tabBarHeight = useContext(BottomTabBarHeightContext) ?? 0;

  const gate = useRef(new QrGate()).current;
  const classifier = useRef(new QrReadClassifier()).current;
  const qrLocked = useSyncExternalStore(gate.subscribe, gate.getSnapshot, gate.getSnapshot);

  /** A refused code's alert (iOS `viewModel.error` from `handleScannedCode`). */
  const [refusalKey, setRefusalKey] = useState<string | null>(null);
  const [chipVisible, setChipVisible] = useState(false);
  const chipTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [mealEntryHeight, setMealEntryHeight] = useState(0);

  const isIdle = flow.isIdle;
  const showsMealEntry = !pushed;
  const reserveTop = reserveTopFor(showsMealEntry ? mealEntryHeight : 0);

  useEffect(
    () => () => {
      if (chipTimer.current) clearTimeout(chipTimer.current);
    },
    [],
  );

  // Whatever started the walk-in (a read, a link, or the other scanner: the
  // flow is one store), the same rule after it: no second walk-in until the
  // member asks for one. iOS locks when its view model starts processing;
  // here the flow's `isIdle` is the published signal, and it turns false no
  // later than that.
  useEffect(() => {
    if (!isIdle) gate.lock();
  }, [isIdle, gate]);

  const showForeignChip = useCallback(() => {
    if (chipTimer.current) return;
    setChipVisible(true);
    announce(t('scan.qr.not_lifepass'));
    chipTimer.current = setTimeout(() => {
      chipTimer.current = null;
      setChipVisible(false);
    }, FOREIGN_CHIP_MS);
  }, [t]);

  // A QR code in view (iOS `handleQR`, 11.4.4 and 11.6).
  const latest = useRef({ pushed, flow, isFocused: camera.isFocused, t, showForeignChip });
  latest.current = { pushed, flow, isFocused: camera.isFocused, t, showForeignChip };
  const handleQr = useCallback(
    (payload: string): QrDisposition => {
      const now = latest.current;
      // Not on screen (the meal page or another tab over it): a code in view
      // must not check the member in under it. Ignored without a lock, so it
      // reads again once the scanner is back.
      if (!now.isFocused) return 'foreign';
      const read = classifier.read(payload, now.pushed);
      switch (read.kind) {
        case 'venue':
          haptics.impact('medium');
          announce(now.t('common.processing'));
          void now.flow.startWalkIn(read.venueId, { fromLink: false }).catch(() => undefined);
          break;
        case 'rejected':
          // Today's alert; the code stays locked until "Scan another code".
          setRefusalKey(read.messageKey);
          break;
        case 'foreignChip':
          now.showForeignChip();
          break;
        case 'foreignIgnored':
          break;
      }
      return dispositionOf(read);
    },
    [classifier],
  );

  const onBarcodeScanned = useCallback(
    (result: BarcodeScanningResult) => {
      gate.didRead(result.data, handleQr);
    },
    [gate, handleQr],
  );

  // A check-in link parked for the Scan tab: lock, then the flow asks first.
  useParkedScanLink({
    enabled: !pushed,
    isFocused: camera.isFocused,
    navigation: navigation as unknown as ScanLinkNavigation,
    onLink: (venueId) => {
      gate.lock();
      setRefusalKey(null);
      void flow.startWalkIn(venueId, { fromLink: true }).catch(() => undefined);
    },
  });

  // The QR is locked and nothing of the walk-in is on screen: offer the
  // capsule rather than scanning again by itself.
  const showsRescan = qrLocked && isIdle && refusalKey === null;

  const rescan = useCallback(() => {
    track('qr_rescan_tapped');
    setRefusalKey(null);
    gate.resume();
  }, [gate]);

  const onLayout = useCallback((event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setSize((current) => (current.width === width && current.height === height ? current : { width, height }));
  }, []);

  const onMealEntryLayout = useCallback((event: LayoutChangeEvent) => {
    setMealEntryHeight(event.nativeEvent.layout.height);
  }, []);

  const chip = camera.isPaused ? t('scan.camera_paused') : chipVisible ? t('scan.qr.not_lifepass') : null;

  return (
    <View style={styles.screen} testID={pushed ? 'scan.pushed' : 'scan.tab'}>
      <TopBar
        title={t('checkin.walkin_title')}
        subtitle={t('checkin.walkin_subtitle')}
        onBack={pushed ? () => navigation.goBack() : undefined}
        trailing={{
          kind: 'person',
          onPress: () => openProfile(navigation, 'scan'),
          labelKey: 'a11y.open_profile',
          // Disabled, not hidden, while a walk-in is mid-flight (`ios-ux.md`
          // 11.4.4): a button that vanishes under a finger is worse than one
          // that will not answer.
          disabled: !isIdle,
        }}
      />

      <View style={styles.region} onLayout={onLayout} testID="scan.region">
        {camera.authorization === 'authorized' ? (
          camera.wantsCamera && size.height > 0 ? (
            <ScanViewfinder
              width={size.width}
              height={size.height}
              reserveTop={reserveTop}
              reserveBottom={tabBarHeight}
              isDimmed={showsRescan}
              chip={chip}
              rescanTitle={showsRescan ? t('scan.qr.again') : null}
              onRescan={rescan}
              hint={t('scan.qr.hint')}
              onBarcodeScanned={qrLocked ? undefined : onBarcodeScanned}
              onCameraReady={camera.onCameraReady}
              onMountError={camera.onMountError}
            />
          ) : (
            <View style={styles.cameraOff} />
          )
        ) : camera.authorization === 'checking' ? (
          <View style={styles.checking} />
        ) : (
          <ScanPrompt
            kind={camera.authorization}
            reserveTop={reserveTop}
            reserveBottom={tabBarHeight}
            onOpenScanner={() => void camera.requestAccess()}
            onOpenSettings={camera.openSettings}
          />
        )}

        {showsMealEntry ? (
          <View style={styles.mealEntry} pointerEvents="box-none" onLayout={onMealEntryLayout} testID="scan.mealEntry">
            <ScanMealEntry disabled={!isIdle} />
          </View>
        ) : null}

        <WalkInFlowHost key={hostGeneration} />
      </View>

      <Dialog
        visible={refusalKey !== null}
        onClose={() => setRefusalKey(null)}
        title={t('common.error_title')}
        message={refusalKey ? t(refusalKey) : undefined}
        buttons={[{ label: t('common.ok'), role: 'cancel' }]}
      />

    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.ink },
  region: { flex: 1, overflow: 'hidden' },
  cameraOff: { ...StyleSheet.absoluteFillObject, backgroundColor: '#000000' },
  checking: { ...StyleSheet.absoluteFillObject, backgroundColor: colors.ink2 },
  mealEntry: { position: 'absolute', top: MEAL_ENTRY_TOP, left: 20, right: 20 },
});
