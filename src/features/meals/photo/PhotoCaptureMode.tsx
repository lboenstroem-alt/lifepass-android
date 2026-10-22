/**
 * Photo mode (ios-ux.md 12.4): aim at the plate, take it or pick one, check
 * the frozen frame, send it. The Android port of iOS `PhotoCaptureMode`
 * (Views/Meals/PhotoCaptureMode.swift), drawn by the meal page in its
 * `PhotoMode` slot (../capture/slots.ts), full bleed under the page header.
 *
 *   live        the camera, a dashed guide square (160 to 320) and the pill
 *               "Fit the whole plate in the frame"; the first-use tip; the
 *               tray bar; [Choose a photo] (shutter); "N photo scans left
 *               today" when 3 or fewer remain
 *   frozen      the photo that will be sent, [Retake, Use photo]
 *   estimating  the photo dimmed, "Estimating what's on the plate",
 *               [Cancel, Keep going]
 *   failed      the error card (./photoErrors.ts)
 *
 * With the camera not allowed (or not there): "Camera access is off. You
 * can still choose a photo." and Choose a photo.
 *
 * THE PHOTO IS NEVER KEPT. A shot or a pick is encoded at once (cropped to
 * the guide for a shot, kept whole when picked, at most 1,024 px and 600 KB,
 * metadata stripped byte by byte) and the original is let go; the frozen
 * frame shown is the JPEG that will be sent, from memory. Use photo mints
 * the Idempotency-Key that Try again reuses for the same photo; the request
 * belongs to the scan coordinator, which outlives the page for Keep going.
 */
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, type NavigationProp } from '@react-navigation/native';
import { CameraView, type PictureRef } from 'expo-camera';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AccessibilityInfo, ActivityIndicator, Image, Pressable, StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { newIdempotencyKey } from '../../../api';
import { LPText, PrimaryButton } from '../../../components/ui';
import { openHealthConsent } from '../../../health/consent/presenter';
import { useHealthStore } from '../../../health/store';
import { HealthConsentSheet } from '../../../health/ui';
import { useT } from '../../../i18n';
import { track } from '../../../lib/analytics';
import type { MealCaptureRoutes } from '../../../navigation/types';
import { useAppStore } from '../../../stores/appStore';
import { colors, hairline, minTouch } from '../../../theme';
import { useCapture } from '../capture/capturePages';
import { rememberMode } from '../capture/lastMode';
import MealTrayBar from '../capture/MealTrayBar';
import type { CameraModeProps } from '../capture/slots';
import { jpegDataUri, MealImageEncoderError, type EncodedMealImage, type MealImageCrop, type MealImageSource } from '../imageEncoder';
import type { Rect, Size } from '../imageEncoder/cropMath';
import { encodeMealImage } from '../imageEncoder/encoder';
import { nativeMealImagePipeline, sweepMealPhotoFiles } from '../imageEncoder/pipeline';

import { photoGuideRect } from './guideLayout';
import { pickMealPhoto } from './pickPhoto';
import {
  photoErrorActionKey,
  photoErrorActions,
  photoErrorCopyKey,
  photoErrorOutcome,
  showsRetryCost,
  type MealPhotoError,
  type PhotoErrorAction,
} from './photoErrors';
import {
  cancelMealScan,
  keepGoingWithScan,
  noteScansLeft,
  scanMealPhoto,
  useScansLeftToday,
  type MealScanOutcome,
} from './scanCoordinator';
import { PHOTO_TIP_KEY, useTipSeen } from './tipSeen';
import { useMealCamera } from './useMealCamera';

export type PhotoPhase =
  | { readonly kind: 'live' }
  | { readonly kind: 'frozen' }
  | { readonly kind: 'estimating' }
  | { readonly kind: 'failed'; readonly failure: MealPhotoError };

const LIVE: PhotoPhase = { kind: 'live' };
const FROZEN: PhotoPhase = { kind: 'frozen' };

/** The line under the shutter shows from this many scans left down. */
export const SCANS_LEFT_SHOWN_AT = 3;

interface FrozenPhoto {
  readonly encoded: EncodedMealImage;
  readonly fromLibrary: boolean;
}

/** Shot or picked bytes to the JPEG that would be sent (the seam the tests replace). */
export type PhotoEncoder = (source: MealImageSource, crop: MealImageCrop) => Promise<EncodedMealImage>;

const nativeEncoder: PhotoEncoder = (source, crop) => encodeMealImage(source, { crop }, nativeMealImagePipeline);

let encoder: PhotoEncoder = nativeEncoder;

/** Tests: encode with a fake pipeline. */
export function setPhotoEncoderForTests(next: PhotoEncoder | null): void {
  encoder = next ?? nativeEncoder;
}

/** The encoder's failure as the card says it (iOS `accept`). */
export function photoErrorForEncoding(error: unknown): MealPhotoError {
  if (error instanceof MealImageEncoderError) {
    if (error.failure === 'tooLarge') return 'tooLarge';
    // A sticker or a picture saved out of a chat: the true thing, without spending a scan.
    if (error.failure === 'tooSmall') return 'tooSmall';
  }
  return 'unsupported';
}

export default function PhotoCaptureMode({ model, headerHeight }: CameraModeProps) {
  const { t, tp } = useT();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<NavigationProp<MealCaptureRoutes>>();
  const camera = useMealCamera(model);
  const cameraRef = useRef<CameraView>(null);
  const trayEmpty = useCapture(model, (s) => s.tray.length === 0);
  const scansLeft = useScansLeftToday();
  const [tipSeen, markTipSeen] = useTipSeen(PHOTO_TIP_KEY);

  const [size, setSize] = useState<Size>({ width: 0, height: 0 });
  const [phase, setPhase] = useState<PhotoPhase>(LIVE);
  const [photo, setPhoto] = useState<FrozenPhoto | null>(null);
  const [busy, setBusy] = useState(false);
  const [localConsent, setLocalConsent] = useState(false);
  const scanKey = useRef<string | null>(null);
  const mounted = useRef(true);
  const photoRef = useRef<FrozenPhoto | null>(null);
  photoRef.current = photo;
  const phaseRef = useRef<PhotoPhase>(phase);
  phaseRef.current = phase;

  const cameraAllowed = camera.allowed === true;
  const showsTip = phase.kind === 'live' && tipSeen === false && cameraAllowed;
  const guide = useMemo(
    () => photoGuideRect({ width: size.width, height: size.height, headerHeight, bottomInset: insets.bottom, trayEmpty, showsTip }),
    [size.width, size.height, headerHeight, insets.bottom, trayEmpty, showsTip],
  );
  // What the member aimed with, read when the shutter fires.
  const aim = useRef<{ readonly guide: Rect; readonly view: Size }>({ guide, view: size });
  aim.current = { guide, view: size };

  useEffect(() => {
    mounted.current = true;
    // The day's count from the Today read, until a scan answers with a newer one.
    noteScansLeft(useHealthStore.getState().today?.meals?.scansLeftToday);
    // Anything a crash left between a write and its delete goes now.
    sweepMealPhotoFiles();
    return () => {
      mounted.current = false;
    };
  }, []);

  // --------------------------------------------------------------------------
  // Actions

  const retake = useCallback(() => {
    const key = scanKey.current;
    if (key && phaseRef.current.kind === 'estimating') cancelMealScan(key);
    setPhase(LIVE);
    setPhoto(null);
    scanKey.current = null;
  }, []);

  /** Encode at once and let the original go: from here on only the small, stripped JPEG exists. */
  const accept = useCallback(async (source: MealImageSource, fromLibrary: boolean, release?: () => void) => {
    track('meal_photo_taken', { source: fromLibrary ? 'library' : 'camera' });
    const crop: MealImageCrop = fromLibrary ? { kind: 'none' } : { kind: 'guide', guide: aim.current.guide, view: aim.current.view };
    setBusy(true);
    try {
      const encoded = await encoder(source, crop);
      if (!mounted.current) return;
      setPhoto({ encoded, fromLibrary });
      scanKey.current = null;
      setPhase(FROZEN);
    } catch (error) {
      if (mounted.current) setPhase({ kind: 'failed', failure: photoErrorForEncoding(error) });
    } finally {
      release?.();
      if (mounted.current) setBusy(false);
    }
  }, []);

  const takePhoto = useCallback(async () => {
    const view = cameraRef.current;
    if (busy || !view || !camera.ready) return;
    setBusy(true);
    let ref: PictureRef;
    try {
      // A bitmap in memory: no file is written for it.
      ref = await view.takePictureAsync({ pictureRef: true, quality: 1, exif: false });
    } catch {
      if (mounted.current) setBusy(false);
      return;
    }
    await accept({ kind: 'ref', ref }, false, () => {
      try {
        ref.release();
      } catch {
        // Already gone.
      }
    });
  }, [accept, busy, camera.ready]);

  const choosePhoto = useCallback(async () => {
    if (busy) return;
    const picked = await pickMealPhoto();
    if (!mounted.current || picked.kind === 'cancelled') return;
    if (picked.kind === 'failed') {
      setPhase({ kind: 'failed', failure: 'unsupported' });
      return;
    }
    await accept({ kind: 'uri', uri: picked.uri, dropAfterLoad: true }, true);
  }, [accept, busy]);

  const handle = useCallback(
    (outcome: MealScanOutcome, retry: () => void) => {
      if (!mounted.current) {
        // The mode has gone (the member switched to Search) but the page may
        // still be there: a draft still opens in it, as iOS pushes it onto
        // the page's path.
        if (outcome.kind === 'draft') {
          track('meal_scan_result', { outcome: 'ok' });
          model.openDraft(outcome.meal.id, outcome.meal);
        }
        return;
      }
      switch (outcome.kind) {
        case 'draft':
          track('meal_scan_result', { outcome: 'ok' });
          // The photo is no longer needed: only the draft's thumbnail stays.
          setPhoto(null);
          setPhase(LIVE);
          scanKey.current = null;
          model.openDraft(outcome.meal.id, outcome.meal);
          return;
        case 'failed':
          track('meal_scan_result', { outcome: photoErrorOutcome(outcome.failure) });
          setPhase({ kind: 'failed', failure: outcome.failure });
          return;
        case 'refused':
          setPhase(FROZEN);
          switch (useHealthStore.getState().handle(outcome.error, { foreground: true })) {
            case 'presentConsent':
              if (!openHealthConsent({ entry: 'scan', onGranted: async () => retry() })) setLocalConsent(true);
              return;
            case 'gate':
              model.showGate(useAppStore.getState().healthAccess);
              return;
            case 'pendingDeletion':
              setPhase({ kind: 'failed', failure: 'other' });
              return;
            default:
              model.close();
          }
          return;
        case 'cancelled':
          return;
      }
    },
    [model],
  );

  const sendPhoto = useCallback(() => {
    const current = photoRef.current;
    if (!current) {
      retake();
      return;
    }
    const key = scanKey.current ?? newIdempotencyKey();
    scanKey.current = key;
    setPhase({ kind: 'estimating' });
    AccessibilityInfo.announceForAccessibility(t('meal.photo.estimating'));
    const { slot, date } = model.state;
    void scanMealPhoto(current.encoded, slot, date, key).then((outcome) => handle(outcome, () => sendPhotoRef.current()));
  }, [handle, model, retake, t]);
  const sendPhotoRef = useRef(sendPhoto);
  sendPhotoRef.current = sendPhoto;

  const cancelScan = useCallback(() => {
    const key = scanKey.current;
    if (!key) return;
    cancelMealScan(key);
    track('meal_scan_result', { outcome: 'cancelled' });
    setPhase(FROZEN);
    // The key stays with that request: its draft, if one still arrives, is
    // deleted; a new tap on Use photo mints a new one.
    scanKey.current = null;
  }, []);

  const keepGoing = useCallback(() => {
    const key = scanKey.current;
    if (!key) return;
    keepGoingWithScan(key);
    track('meal_scan_result', { outcome: 'kept_going' });
    model.close();
  }, [model]);

  const perform = useCallback(
    (action: PhotoErrorAction) => {
      switch (action) {
        case 'retake':
          retake();
          return;
        case 'search':
          retake();
          model.setMode('search');
          rememberMode('search');
          return;
        case 'barcode':
          retake();
          model.setMode('barcode');
          rememberMode('barcode');
          return;
        case 'tryAgain':
          sendPhoto();
          return;
        case 'chooseOther':
          retake();
          void choosePhoto();
          return;
      }
    },
    [choosePhoto, model, retake, sendPhoto],
  );

  const onLayout = useCallback((event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setSize((current) => (current.width === width && current.height === height ? current : { width, height }));
  }, []);

  // --------------------------------------------------------------------------
  // Drawing

  const laidOut = size.width > 0 && size.height > 0;
  const guideCentreY = guide.y + guide.height / 2;
  const showsPanel = camera.allowed === false && phase.kind === 'live';
  const scansLine =
    phase.kind === 'live' && scansLeft !== null && scansLeft <= SCANS_LEFT_SHOWN_AT ? tp('meal.photo.remaining', scansLeft, { count: String(scansLeft) }) : null;

  return (
    <View style={StyleSheet.absoluteFill} onLayout={onLayout} testID="meal.photo">
      {camera.wants ? (
        <CameraView
          ref={cameraRef}
          style={StyleSheet.absoluteFill}
          facing="back"
          mode="picture"
          animateShutter={false}
          enableTorch={camera.torchOn}
          onCameraReady={camera.onCameraReady}
          onMountError={camera.onMountError}
          accessible={false}
          importantForAccessibility="no-hide-descendants"
          testID="meal.photo.camera"
        />
      ) : (
        <View style={[StyleSheet.absoluteFill, styles.black]} />
      )}

      {laidOut && showsPanel ? (
        <View style={[styles.panel, { top: guideCentreY - 110, width: size.width }]} testID="meal.photo.noCamera">
          <Ionicons name="images-outline" size={34} color="rgba(255,255,255,0.8)" accessible={false} />
          <LPText size={15} color="#FFFFFF" align="center" style={styles.panelText}>
            {t('meal.photo.no_camera')}
          </LPText>
          <Pressable
            onPress={() => void choosePhoto()}
            accessibilityRole="button"
            style={({ pressed }) => [styles.whiteCapsule, pressed && styles.pressed]}
            testID="meal.photo.panelLibrary"
          >
            <LPText size={15} weight="semibold" color="#000000">
              {t('meal.photo.library')}
            </LPText>
          </Pressable>
        </View>
      ) : null}

      {laidOut && !showsPanel ? (
        <GuideLayer
          phase={phase}
          guide={guide}
          photo={photo}
          scansLeft={scansLeft}
          onCancel={cancelScan}
          onKeepGoing={keepGoing}
          onAction={perform}
        />
      ) : null}

      <View style={[styles.bottom, { paddingBottom: insets.bottom + 4 }]} pointerEvents="box-none">
        {showsTip ? (
          <View style={styles.tipRow}>
            <TipCard text={t('meal.photo.tip')} okLabel={t('common.ok')} onOk={markTipSeen} />
          </View>
        ) : null}
        {phase.kind === 'live' || phase.kind === 'frozen' ? (
          <MealTrayBar
            model={model}
            onReview={() => navigation.navigate('Review')}
            onSave={() => {
              void model.commitTray();
            }}
          />
        ) : null}
        <View style={styles.controls}>
          {phase.kind === 'live' ? (
            <View style={styles.liveRow}>
              <Pressable
                onPress={() => void choosePhoto()}
                disabled={!cameraAllowed || busy}
                accessibilityRole="button"
                accessibilityLabel={t('meal.photo.library')}
                accessibilityElementsHidden={!cameraAllowed}
                importantForAccessibility={cameraAllowed ? 'auto' : 'no-hide-descendants'}
                style={[styles.libraryButton, !cameraAllowed && styles.hidden]}
                testID="meal.photo.library"
              >
                <Ionicons name="images-outline" size={20} color="#FFFFFF" />
              </Pressable>
              <Pressable
                onPress={() => void takePhoto()}
                disabled={!cameraAllowed || busy || !camera.ready}
                accessibilityRole="button"
                accessibilityLabel={t('a11y.take_photo')}
                accessibilityState={{ disabled: !cameraAllowed || busy || !camera.ready, busy }}
                style={[styles.shutter, !cameraAllowed && styles.dimmed]}
                testID="meal.photo.shutter"
              >
                <View style={styles.shutterRing} />
                <View style={styles.shutterFill} />
              </Pressable>
              <View style={styles.spacer} />
            </View>
          ) : null}
          {phase.kind === 'frozen' ? (
            <View style={styles.frozenRow}>
              <Pressable
                onPress={retake}
                accessibilityRole="button"
                style={({ pressed }) => [styles.retake, pressed && styles.pressed]}
                testID="meal.photo.retake"
              >
                <LPText size={15} weight="semibold" color="#FFFFFF">
                  {t('meal.photo.retake')}
                </LPText>
              </Pressable>
              <View style={styles.grow}>
                <PrimaryButton title={t('meal.photo.use')} onPress={sendPhoto} testID="meal.photo.use" />
              </View>
            </View>
          ) : null}
        </View>
        {scansLine ? (
          <LPText size={12} weight="medium" color="rgba(255,255,255,0.85)" align="center" style={styles.scansLeft} testID="meal.photo.scansLeft">
            {scansLine}
          </LPText>
        ) : null}
      </View>

      <HealthConsentSheet
        visible={localConsent}
        entry="scan"
        onClose={() => setLocalConsent(false)}
        onGranted={async () => {
          sendPhotoRef.current();
        }}
      />
    </View>
  );
}

// ----------------------------------------------------------------------------
// The guide square, the frozen frame and the cards

interface GuideLayerProps {
  readonly phase: PhotoPhase;
  readonly guide: Rect;
  readonly photo: FrozenPhoto | null;
  readonly scansLeft: number | null;
  readonly onCancel: () => void;
  readonly onKeepGoing: () => void;
  readonly onAction: (action: PhotoErrorAction) => void;
}

function GuideLayer({ phase, guide, photo, scansLeft, onCancel, onKeepGoing, onAction }: GuideLayerProps) {
  const { t } = useT();
  const centreX = guide.x + guide.width / 2;
  const centreY = guide.y + guide.height / 2;
  if (phase.kind === 'live') {
    return (
      <>
        <View
          style={[styles.guide, { left: guide.x, top: guide.y, width: guide.width, height: guide.height }]}
          accessible={false}
          importantForAccessibility="no-hide-descendants"
          testID="meal.photo.guide"
        />
        <View style={[styles.hintBand, { top: guide.y + guide.height + 30 - 40, left: centreX - (guide.width + 40) / 2, width: guide.width + 40 }]}>
          <View style={styles.hintPill}>
            <LPText size={14} weight="semibold" color="#FFFFFF" align="center">
              {t('meal.photo.hint')}
            </LPText>
          </View>
        </View>
      </>
    );
  }
  const extra = photo?.fromLibrary ? 40 : 0;
  return (
    <>
      {photo ? (
        <>
          <View style={[StyleSheet.absoluteFill, styles.frozenScrim]} />
          <Image
            source={{ uri: jpegDataUri(photo.encoded.base64) }}
            resizeMode={photo.fromLibrary ? 'contain' : 'cover'}
            accessible
            accessibilityRole="image"
            accessibilityLabel={t('meal.photo.preview_label')}
            style={[
              styles.frozenImage,
              {
                left: guide.x - extra / 2,
                top: guide.y - extra / 2,
                width: guide.width + extra,
                height: guide.height + extra,
                opacity: phase.kind === 'frozen' ? 1 : 0.5,
              },
            ]}
            testID="meal.photo.frozen"
          />
        </>
      ) : null}
      {phase.kind === 'estimating' ? (
        <CenteredCard centreX={centreX} centreY={centreY} width={Math.min(guide.width + 24, 340)}>
          <EstimatingCard onCancel={onCancel} onKeepGoing={onKeepGoing} />
        </CenteredCard>
      ) : null}
      {phase.kind === 'failed' ? (
        <CenteredCard centreX={centreX} centreY={centreY} width={Math.min(guide.width + 40, 350)}>
          <ErrorCard failure={phase.failure} scansLeft={scansLeft} onAction={onAction} />
        </CenteredCard>
      ) : null}
    </>
  );
}

/** A card centred on a point, however tall its copy makes it. */
function CenteredCard({ centreX, centreY, width, children }: { readonly centreX: number; readonly centreY: number; readonly width: number; readonly children: ReactNode }) {
  const [height, setHeight] = useState(0);
  return (
    <View
      style={[styles.centered, { left: centreX - width / 2, top: centreY - height / 2, width, opacity: height > 0 ? 1 : 0 }]}
      onLayout={(event) => setHeight(event.nativeEvent.layout.height)}
    >
      {children}
    </View>
  );
}

function EstimatingCard({ onCancel, onKeepGoing }: { readonly onCancel: () => void; readonly onKeepGoing: () => void }) {
  const { t } = useT();
  return (
    <View style={styles.card} accessibilityViewIsModal testID="meal.photo.estimating">
      <ActivityIndicator size="large" color={colors.paper} />
      <LPText size={15} weight="semibold" color={colors.paper} align="center">
        {t('meal.photo.estimating')}
      </LPText>
      <View style={styles.estimatingButtons}>
        <Pressable onPress={onCancel} accessibilityRole="button" style={styles.textButton} testID="meal.photo.cancel">
          <LPText size={14} weight="semibold" color={colors.paper2}>
            {t('common.cancel')}
          </LPText>
        </Pressable>
        <Pressable onPress={onKeepGoing} accessibilityRole="button" style={styles.textButton} testID="meal.photo.keepGoing">
          <LPText size={14} weight="semibold" color={colors.accentText}>
            {t('meal.photo.keep_going')}
          </LPText>
        </Pressable>
      </View>
    </View>
  );
}

function ErrorCard({ failure, scansLeft, onAction }: { readonly failure: MealPhotoError; readonly scansLeft: number | null; readonly onAction: (action: PhotoErrorAction) => void }) {
  const { t, tp } = useT();
  const actions = photoErrorActions(failure);
  return (
    <View style={[styles.card, styles.errorCard]} testID="meal.photo.error">
      <LPText size={15} weight="semibold" color={colors.paper} accessibilityLiveRegion="polite" testID="meal.photo.errorText">
        {t(photoErrorCopyKey(failure))}
      </LPText>
      {showsRetryCost(failure) ? (
        <>
          {scansLeft !== null ? (
            <LPText size={12} color={colors.paper2}>
              {tp('meal.photo.remaining', scansLeft, { count: String(scansLeft) })}
            </LPText>
          ) : null}
          <LPText size={12} color={colors.paper2}>
            {t('meal.photo.retry_cost')}
          </LPText>
        </>
      ) : null}
      <View style={styles.errorButtons}>
        {actions.map((action, index) => {
          const primary = index === 0;
          return (
            <Pressable
              key={action}
              onPress={() => onAction(action)}
              accessibilityRole="button"
              style={({ pressed }) => [styles.errorButton, primary ? styles.errorPrimary : styles.errorSecondary, pressed && styles.pressed]}
              testID={`meal.photo.action.${action}`}
            >
              <LPText
                size={14}
                weight="semibold"
                color={primary ? colors.onAccent : colors.paper}
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.8}
              >
                {t(photoErrorActionKey(action))}
              </LPText>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

/** A first-use card above the shutter (Photo's tip, Barcode's privacy note). */
export function TipCard({
  text,
  okLabel,
  onOk,
  icon = 'bulb-outline',
  testID = 'meal.photo.tip',
}: {
  readonly text: string;
  readonly okLabel: string;
  readonly onOk: () => void;
  readonly icon?: keyof typeof Ionicons.glyphMap;
  readonly testID?: string;
}) {
  return (
    <View style={styles.tip} testID={testID}>
      <Ionicons name={icon} size={16} color={colors.rust} style={styles.tipIcon} accessible={false} />
      <LPText size={13} color={colors.paper} style={styles.tipText}>
        {text}
      </LPText>
      <Pressable onPress={onOk} accessibilityRole="button" style={styles.tipOk} testID={`${testID}.ok`}>
        <LPText size={13} weight="semibold" color={colors.accentText}>
          {okLabel}
        </LPText>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  black: { backgroundColor: '#000000' },
  panel: { position: 'absolute', left: 0, alignItems: 'center', gap: 16 },
  panelText: { paddingHorizontal: 32 },
  whiteCapsule: {
    height: 52,
    paddingHorizontal: 28,
    borderRadius: 26,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: { opacity: 0.85 },
  guide: {
    position: 'absolute',
    borderRadius: 20,
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: 'rgba(255,255,255,0.8)',
  },
  hintBand: { position: 'absolute', height: 80, alignItems: 'center', justifyContent: 'center' },
  hintPill: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, backgroundColor: 'rgba(0,0,0,0.55)' },
  frozenScrim: { backgroundColor: 'rgba(0,0,0,0.82)' },
  frozenImage: { position: 'absolute', borderRadius: 20, overflow: 'hidden' },
  centered: { position: 'absolute' },
  card: {
    backgroundColor: colors.ink,
    borderRadius: 18,
    padding: 20,
    gap: 14,
    alignItems: 'center',
    elevation: 12,
    shadowColor: '#000000',
    shadowOpacity: 0.3,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
  },
  errorCard: { alignItems: 'stretch', padding: 18, gap: 12 },
  estimatingButtons: { flexDirection: 'row', gap: 20 },
  textButton: { minHeight: minTouch, justifyContent: 'center', paddingHorizontal: 4 },
  errorButtons: { flexDirection: 'row', gap: 10 },
  errorButton: { flex: 1, height: minTouch, borderRadius: 22, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14 },
  errorPrimary: { backgroundColor: colors.rust },
  errorSecondary: { backgroundColor: colors.ink2, borderWidth: hairline, borderColor: colors.line },
  bottom: { ...StyleSheet.absoluteFillObject, justifyContent: 'flex-end', gap: 10 },
  tipRow: { paddingHorizontal: 20 },
  tip: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    paddingLeft: 14,
    paddingRight: 6,
    paddingVertical: 4,
    borderRadius: 14,
    backgroundColor: 'rgba(248,246,241,0.96)',
  },
  tipIcon: { marginTop: 14 },
  tipOk: { minWidth: minTouch, minHeight: minTouch, alignItems: 'center', justifyContent: 'center' },
  grow: { flex: 1 },
  tipText: { flex: 1, paddingVertical: 12 },
  controls: { height: 120, justifyContent: 'center' },
  liveRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 36 },
  libraryButton: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: 'rgba(0,0,0,0.45)',
    borderWidth: hairline,
    borderColor: 'rgba(255,255,255,0.3)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  hidden: { opacity: 0 },
  dimmed: { opacity: 0.3 },
  shutter: { width: 76, height: 76, alignItems: 'center', justifyContent: 'center' },
  shutterRing: { position: 'absolute', width: 76, height: 76, borderRadius: 38, borderWidth: 4, borderColor: '#FFFFFF' },
  shutterFill: { width: 64, height: 64, borderRadius: 32, backgroundColor: '#FFFFFF' },
  spacer: { width: 52, height: 52 },
  frozenRow: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 20 },
  retake: { height: 52, paddingHorizontal: 20, borderRadius: 26, backgroundColor: 'rgba(255,255,255,0.18)', justifyContent: 'center' },
  scansLeft: { marginTop: -14 },
});
