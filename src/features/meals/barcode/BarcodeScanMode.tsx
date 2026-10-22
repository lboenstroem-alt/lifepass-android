/**
 * Barcode mode (ios-ux.md 12.5): the Android port of iOS `BarcodeScanMode`
 * (Views/Meals/BarcodeScanMode.swift), drawn by the meal page in its
 * `BarcodeMode` slot (../capture/slots.ts), full bleed under the page header.
 *
 *   camera allowed  the camera, a 280 x 150 reticle and the pill "Line up
 *                   the barcode inside the frame"; "Type the number"
 *   no camera       only the typed panel: "Barcode number" and Type the
 *                   number
 *   first use       the privacy card: what Open Food Facts receives [OK]
 *   looking         "Looking up the product" until the result sheet opens
 *
 * ML Kit reads EAN-13, EAN-8, UPC-E and UPC-A; UPC-A becomes the 13 digits
 * iOS saves (./normaliser.ts). The same value in two frames within a second
 * is a read; it buzzes once, and reading holds until the result sheet has
 * gone, then resumes a second later so the same packet is not read again
 * at once. The tray bar is the page's own (MEAL-2 draws it in this mode).
 */
import { Ionicons } from '@expo/vector-icons';
import { CameraView, type BarcodeScanningResult } from 'expo-camera';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';
import { useStore } from 'zustand';

import { LPText } from '../../../components/ui';
import { useT } from '../../../i18n';
import { haptics } from '../../../lib/haptics';
import { colors } from '../../../theme';
import { useCapture } from '../capture/capturePages';
import { rememberMode } from '../capture/lastMode';
import type { CameraModeProps } from '../capture/slots';
import { TipCard } from '../photo/PhotoCaptureMode';
import { BARCODE_TIP_KEY, useTipSeen } from '../photo/tipSeen';
import { useMealCamera } from '../photo/useMealCamera';

import BarcodeResultSheet from './BarcodeResultSheet';
import { BarcodeLookupModel, type BarcodeSource } from './lookupModel';
import { MEAL_BARCODE_TYPES, normaliseBarcode, type BarcodeSymbology } from './normaliser';
import { BarcodeReadLock, BARCODE_RESUME_DELAY_MS } from './readLock';
import TypedBarcodeSheet from './TypedBarcodeSheet';

/** The reticle (iOS `ReticleShape(arm: 26, radius: 12)` in a 280 x 150 frame). */
export const RETICLE_WIDTH = 280;
export const RETICLE_HEIGHT = 150;
const ARM = 26;
const RADIUS = 12;
const STROKE = 4;

/** The four corner brackets of a `width` x `height` frame whose top left is at `inset`. */
export function bracketPath(width: number, height: number, inset: number = STROKE, arm: number = ARM, radius: number = RADIUS): string {
  const r = Math.min(radius, arm);
  const minX = inset;
  const minY = inset;
  const maxX = inset + width;
  const maxY = inset + height;
  return [
    `M ${minX} ${minY + arm} L ${minX} ${minY + r} Q ${minX} ${minY} ${minX + r} ${minY} L ${minX + arm} ${minY}`,
    `M ${maxX - arm} ${minY} L ${maxX - r} ${minY} Q ${maxX} ${minY} ${maxX} ${minY + r} L ${maxX} ${minY + arm}`,
    `M ${maxX} ${maxY - arm} L ${maxX} ${maxY - r} Q ${maxX} ${maxY} ${maxX - r} ${maxY} L ${maxX - arm} ${maxY}`,
    `M ${minX + arm} ${maxY} L ${minX + r} ${maxY} Q ${minX} ${maxY} ${minX} ${maxY - r} L ${minX} ${maxY - arm}`,
  ].join(' ');
}

/**
 * Where the reticle's centre sits (iOS geometry): under the page header,
 * halfway down the room above the bottom controls, never closer than 20 to
 * the header.
 */
export function barcodeCentreY(height: number, headerHeight: number, bottomInset: number): number {
  const regionTop = headerHeight;
  const regionBottom = height - bottomInset - 140;
  return Math.max(regionTop + RETICLE_HEIGHT / 2 + 20, (regionTop + regionBottom) / 2);
}

export default function BarcodeScanMode({ model, headerHeight }: CameraModeProps) {
  const { t, language } = useT();
  const insets = useSafeAreaInsets();
  const camera = useMealCamera(model);
  const trayEmpty = useCapture(model, (s) => s.tray.length === 0);
  const [tipSeen, markTipSeen] = useTipSeen(BARCODE_TIP_KEY);
  const [lookup] = useState(() => new BarcodeLookupModel());
  const isLooking = useStore(lookup.store, (s) => s.isLooking);
  const sheetShown = useStore(lookup.store, (s) => s.sheetShown);
  const [lock] = useState(() => new BarcodeReadLock());
  const [showTyped, setShowTyped] = useState(false);
  const showTypedRef = useRef(showTyped);
  showTypedRef.current = showTyped;
  const [size, setSize] = useState({ width: 0, height: 0 });
  const resumeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cameraAllowed = camera.allowed === true;

  useEffect(
    () => () => {
      lookup.dispose();
      if (resumeTimer.current) clearTimeout(resumeTimer.current);
    },
    [lookup],
  );

  const resume = useCallback(() => lock.resume(), [lock]);

  const read = useCallback(
    (raw: string, symbology: BarcodeSymbology, source: BarcodeSource) => {
      const code = normaliseBarcode(raw, symbology);
      if (code === null) {
        resume();
        return;
      }
      lock.lock();
      haptics.impact('medium');
      lookup.start(code, source, language);
    },
    [language, lock, lookup, resume],
  );

  const onBarcodeScanned = useCallback(
    (scan: BarcodeScanningResult) => {
      // Nothing is read under the typed sheet or the result sheet.
      if (showTypedRef.current || lookup.state.sheetShown) return;
      const confirmed = lock.frame(scan.type, scan.data);
      if (confirmed) read(confirmed.value, confirmed.symbology, 'camera');
    },
    [lock, lookup, read],
  );

  /** The result sheet has gone: forget the lookup and read again a second later. */
  const dismissResult = useCallback(() => {
    lookup.reset();
    if (resumeTimer.current) clearTimeout(resumeTimer.current);
    resumeTimer.current = setTimeout(() => {
      resumeTimer.current = null;
      resume();
    }, BARCODE_RESUME_DELAY_MS);
  }, [lookup, resume]);

  const searchInstead = useCallback(() => {
    lookup.reset();
    model.setMode('search');
    rememberMode('search');
  }, [lookup, model]);

  const onLayout = useCallback((event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setSize((current) => (current.width === width && current.height === height ? current : { width, height }));
  }, []);

  const laidOut = size.width > 0 && size.height > 0;
  const reticleWidth = Math.min(RETICLE_WIDTH, size.width - 64);
  const centreY = barcodeCentreY(size.height, headerHeight, insets.bottom);

  return (
    <View style={StyleSheet.absoluteFill} onLayout={onLayout} testID="meal.barcode">
      {camera.wants ? (
        <CameraView
          style={StyleSheet.absoluteFill}
          facing="back"
          enableTorch={camera.torchOn}
          barcodeScannerSettings={{ barcodeTypes: [...MEAL_BARCODE_TYPES] }}
          // Always set: toggling it makes expo-camera rebuild the camera (a
          // black frame each time). The read lock ignores frames instead.
          onBarcodeScanned={onBarcodeScanned}
          onCameraReady={camera.onCameraReady}
          onMountError={camera.onMountError}
          accessible={false}
          importantForAccessibility="no-hide-descendants"
          testID="meal.barcode.camera"
        />
      ) : (
        <View style={[StyleSheet.absoluteFill, styles.black]} />
      )}

      {laidOut && cameraAllowed ? (
        <>
          <View
            style={[styles.reticle, { left: (size.width - reticleWidth) / 2 - STROKE, top: centreY - RETICLE_HEIGHT / 2 - STROKE }]}
            accessible={false}
            importantForAccessibility="no-hide-descendants"
            pointerEvents="none"
            testID="meal.barcode.reticle"
          >
            <Svg width={reticleWidth + STROKE * 2} height={RETICLE_HEIGHT + STROKE * 2}>
              <Path d={bracketPath(reticleWidth, RETICLE_HEIGHT)} stroke="rgba(0,0,0,0.25)" strokeWidth={STROKE + 3} strokeLinecap="round" strokeLinejoin="round" fill="none" />
              <Path d={bracketPath(reticleWidth, RETICLE_HEIGHT)} stroke="#FFFFFF" strokeWidth={STROKE} strokeLinecap="round" strokeLinejoin="round" fill="none" />
            </Svg>
          </View>
          <View style={[styles.hintBand, { top: centreY + RETICLE_HEIGHT / 2 + 34 - 40, width: size.width }]} pointerEvents="none">
            <View style={styles.hintPill}>
              <LPText size={14} weight="semibold" color="#FFFFFF" align="center">
                {t('meal.barcode.hint')}
              </LPText>
            </View>
          </View>
        </>
      ) : null}

      {laidOut && camera.allowed === false ? (
        <View style={[styles.typedPanel, { top: centreY - 80, width: size.width }]} testID="meal.barcode.typedPanel">
          <Ionicons name="barcode-outline" size={36} color="rgba(255,255,255,0.85)" accessible={false} />
          <LPText size={16} weight="semibold" color="#FFFFFF">
            {t('meal.barcode.type_title')}
          </LPText>
          <Pressable
            onPress={() => setShowTyped(true)}
            accessibilityRole="button"
            style={({ pressed }) => [styles.whiteCapsule, pressed && styles.pressed]}
            testID="meal.barcode.typePanelButton"
          >
            <LPText size={15} weight="semibold" color="#000000">
              {t('meal.barcode.type')}
            </LPText>
          </Pressable>
        </View>
      ) : null}

      <View style={[styles.bottom, { paddingBottom: insets.bottom + (trayEmpty ? 24 : 96) }]} pointerEvents="box-none">
        {tipSeen === false ? (
          <View style={styles.cardRow}>
            <TipCard
              text={t('meal.barcode.privacy')}
              okLabel={t('common.ok')}
              onOk={markTipSeen}
              icon="shield-checkmark-outline"
              testID="meal.barcode.privacy"
            />
          </View>
        ) : null}
        {isLooking && !sheetShown ? (
          <View style={styles.cardRow}>
            <View style={styles.lookingCard} accessible accessibilityLiveRegion="polite" testID="meal.barcode.looking">
              <ActivityIndicator color={colors.paper} />
              <LPText size={14} weight="semibold" color={colors.paper}>
                {t('meal.barcode.looking')}
              </LPText>
            </View>
          </View>
        ) : null}
        {cameraAllowed ? (
          <Pressable
            onPress={() => setShowTyped(true)}
            accessibilityRole="button"
            style={({ pressed }) => [styles.typeButton, pressed && styles.pressed]}
            testID="meal.barcode.type"
          >
            <LPText size={15} weight="semibold" color="#FFFFFF">
              {t('meal.barcode.type')}
            </LPText>
          </Pressable>
        ) : null}
      </View>

      <TypedBarcodeSheet
        visible={showTyped}
        onClose={() => setShowTyped(false)}
        onLookup={(digits) => {
          setShowTyped(false);
          read(digits, 'typed', 'typed');
        }}
      />
      <BarcodeResultSheet lookup={lookup} model={model} onSearchInstead={searchInstead} onDismiss={dismissResult} />
    </View>
  );
}

const styles = StyleSheet.create({
  black: { backgroundColor: '#000000' },
  reticle: { position: 'absolute' },
  hintBand: { position: 'absolute', left: 0, height: 80, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 20 },
  hintPill: { maxWidth: 300, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, backgroundColor: 'rgba(0,0,0,0.55)' },
  typedPanel: { position: 'absolute', left: 0, alignItems: 'center', gap: 16 },
  whiteCapsule: { height: 52, paddingHorizontal: 28, borderRadius: 26, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' },
  pressed: { opacity: 0.85 },
  bottom: { ...StyleSheet.absoluteFillObject, justifyContent: 'flex-end', alignItems: 'stretch', gap: 12 },
  cardRow: { paddingHorizontal: 20 },
  lookingCard: {
    height: 56,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    borderRadius: 14,
    backgroundColor: 'rgba(248,246,241,0.96)',
  },
  typeButton: {
    alignSelf: 'center',
    height: 44,
    paddingHorizontal: 20,
    borderRadius: 22,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center',
  },
});
