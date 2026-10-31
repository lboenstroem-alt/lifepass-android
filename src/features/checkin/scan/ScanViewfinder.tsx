/**
 * The live viewfinder of the Scan tab and its check-in overlay: the Android
 * port of iOS `QRScannerView` (Views/CheckIn/QRScannerView.swift,
 * `ios-ux.md` 11.3 and 11.4).
 *
 * The reticle is centred in the space left between whatever sits above it
 * (the "Scan your meal" entry, `reserveTop`) and the tab bar
 * (`reserveBottom`), and never closer than `reserveTop` to the top: the 24 dp
 * gap under the meal entry is a hard rule, because a finger reaching for it
 * must never be over the code it is aiming at. The hint under the reticle has
 * its own room above the tab bar, so a two-line Icelandic hint never sits on
 * the centre scan button.
 *
 * Gradient scrims at the top (black 45 % to clear over 140 dp) and the foot
 * (clear to black 35 % over 160 dp) keep the meal card and the tab bar's
 * white labels readable over a bright frame.
 *
 * Every word is the caller's, already translated.
 */
import { Ionicons } from '@expo/vector-icons';
import { CameraView, type BarcodeScanningResult } from 'expo-camera';
import { LinearGradient } from 'expo-linear-gradient';
import { Pressable, StyleSheet, View } from 'react-native';

import { LPText } from '../../../components/ui';
import { colors } from '../../../theme';
import Reticle, { RETICLE_SIDE } from './Reticle';

/** Room the hint needs above the tab bar (iOS `QRScannerView.hintRoom`). */
export const HINT_ROOM = 56;

/**
 * The reticle's centre, from the top of the viewfinder (iOS QRScannerView's
 * `centreY`): halfway between `reserveTop` and the bottom of the region the
 * hint leaves, and never higher than half a reticle under `reserveTop`.
 */
export function reticleCentreY(height: number, reserveTop: number, reserveBottom: number, side: number = RETICLE_SIDE): number {
  const regionBottom = Math.max(reserveTop + side, height - reserveBottom - HINT_ROOM);
  return Math.max(reserveTop + side / 2, (reserveTop + regionBottom) / 2);
}

/**
 * Where the hint's centre sits under the reticle (iOS positions it at
 * `centreY + side / 2 + 24 + 20`): one line or two, the centre stays here, so
 * a longer Icelandic hint grows both ways rather than only down.
 */
export const HINT_CENTRE_BELOW_RETICLE = 24 + 20;

/** The hint's centre, from the top of the viewfinder. */
export function hintCentreY(centreY: number, side: number = RETICLE_SIDE): number {
  return centreY + side / 2 + HINT_CENTRE_BELOW_RETICLE;
}

/**
 * The band the hint is centred in: from the reticle's bottom edge to as far
 * again below the centre, so the text's middle lands on `hintCentreY` without
 * waiting for a measured height (a frame drawn in the wrong place first).
 */
const HINT_BAND = 2 * HINT_CENTRE_BELOW_RETICLE;
// A hint taller than the band (three lines at the largest text) overflows it
// evenly above and below, its centre still in place: the band never clips.

export interface ScanViewfinderProps {
  /** The viewfinder's own height (measured by the caller). */
  readonly height: number;
  readonly width: number;
  /** Space above the reticle's region. */
  readonly reserveTop: number;
  /** Space below it: the tab bar. */
  readonly reserveBottom: number;
  /** A walk-in just ran and the QR is locked: the reticle fades back and the hint goes. */
  readonly isDimmed: boolean;
  /** A transient line centred on the reticle ("Camera paused", "Not a LifePass code"). */
  readonly chip: string | null;
  /** "Scan another code", over the dimmed reticle. */
  readonly rescanTitle: string | null;
  readonly onRescan: () => void;
  /** "Point at the LifePass code at the venue". */
  readonly hint: string;
  /** Undefined while the QR is locked: CameraX then stops handing codes over. */
  readonly onBarcodeScanned: ((result: BarcodeScanningResult) => void) | undefined;
  readonly onCameraReady: () => void;
  readonly onMountError: () => void;
}

export default function ScanViewfinder({
  height,
  width,
  reserveTop,
  reserveBottom,
  isDimmed,
  chip,
  rescanTitle,
  onRescan,
  hint,
  onBarcodeScanned,
  onCameraReady,
  onMountError,
}: ScanViewfinderProps) {
  const centreY = reticleCentreY(height, reserveTop, reserveBottom);
  const canvas = RETICLE_SIDE + 8;

  return (
    <View style={StyleSheet.absoluteFill} testID="scan.viewfinder">
      <CameraView
        style={StyleSheet.absoluteFill}
        facing="back"
        barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
        onBarcodeScanned={onBarcodeScanned}
        onCameraReady={onCameraReady}
        onMountError={onMountError}
        testID="scan.camera"
      />

      <View pointerEvents="none" style={StyleSheet.absoluteFill}>
        <LinearGradient colors={['rgba(0,0,0,0.45)', 'rgba(0,0,0,0)']} style={styles.topScrim} />
        <LinearGradient colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.35)']} style={styles.bottomScrim} />
      </View>

      <View
        accessible
        accessibilityRole="image"
        accessibilityLabel={hint}
        style={[styles.reticle, { top: centreY - canvas / 2, left: (width - canvas) / 2 }]}
        testID="scan.reticle"
      >
        <Reticle dimmed={isDimmed} />
      </View>

      {!isDimmed ? (
        <View
          pointerEvents="none"
          importantForAccessibility="no-hide-descendants"
          accessibilityElementsHidden
          style={[styles.hint, { top: hintCentreY(centreY) - HINT_BAND / 2, left: (width - 280) / 2 }]}
          testID="scan.hint"
        >
          <LPText size={15} weight="semibold" color="#FFFFFF" align="center" style={styles.hintText}>
            {hint}
          </LPText>
        </View>
      ) : null}

      {rescanTitle ? (
        <View style={[styles.centre, { top: centreY - 24 }]} pointerEvents="box-none">
          <Pressable
            onPress={onRescan}
            accessibilityRole="button"
            accessibilityLabel={rescanTitle}
            style={({ pressed }) => [styles.rescan, pressed && styles.pressed]}
            testID="scan.rescan"
          >
            <Ionicons name="scan-outline" size={16} color={colors.paper} />
            <LPText size={15} weight="semibold" color={colors.paper}>
              {rescanTitle}
            </LPText>
          </Pressable>
        </View>
      ) : chip ? (
        <View style={[styles.centre, { top: centreY - 17 }]} pointerEvents="none">
          <View style={styles.chip} accessible accessibilityRole="text" testID="scan.chip">
            <LPText size={13} weight="semibold" color="#FFFFFF">
              {chip}
            </LPText>
          </View>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  topScrim: { position: 'absolute', top: 0, left: 0, right: 0, height: 140 },
  bottomScrim: { position: 'absolute', bottom: 0, left: 0, right: 0, height: 160 },
  reticle: { position: 'absolute' },
  hint: {
    position: 'absolute',
    width: 280,
    height: HINT_BAND,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'visible',
  },
  hintText: { textShadowColor: 'rgba(0,0,0,0.4)', textShadowRadius: 4, textShadowOffset: { width: 0, height: 1 } },
  centre: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
  rescan: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 48,
    paddingHorizontal: 18,
    borderRadius: 999,
    backgroundColor: 'rgba(248,246,241,0.96)',
    elevation: 6,
    shadowColor: '#000000',
    shadowOpacity: 0.25,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  pressed: { opacity: 0.8 },
});
