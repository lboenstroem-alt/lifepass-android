/**
 * The meal capture page (route `Capture`, the first screen of the root modal
 * `MealCapture`): the Android port of iOS `MealCaptureView` (ios-ux.md 12).
 * Photo, Barcode and Search over one tray, with one review and one save.
 *
 * WHO OPENS IT (route params, iOS `MealCaptureOrigin`):
 *   scanTab  the Scan tab's "Scan your meal": slot by the clock, today, the
 *            last mode used
 *   plan     Plan's meal entries: slot by the clock, the card's date
 *   diary    the diary's "+": Search, that slot and that date
 *   editor   "Add food" on a meal that exists: Search, its slot and date;
 *            the tray's button reads "Add to meal" and hands the items back
 *            (./capturePages.ts `openMealCaptureForEditor`)
 *
 * CLOSING. X or back with items in the tray asks "Discard these items?"
 * (Keep for later, Discard, Keep adding); Keep for later leaves them in
 * tray.json for a day. A save, a gate (403) or a check-in link closes the
 * page without asking. A membership wall shows the gate over whatever is
 * underneath once the page has gone; a check-in link that arrives while the
 * page is over the Scan tab closes it, and the Scan tab then asks about the
 * venue (iOS `consumePendingScan`).
 *
 * THE SCAN TAB'S CAMERA. While this page is up the Scan tab is not focused,
 * so its viewfinder is unmounted and no QR code in view can check anyone in
 * (CHECKIN-1's focus rule, ios-ux.md 11.6). The camera modes mount their own.
 *
 * Over the camera (Photo, Barcode) the page is black, the status bar is
 * hidden and the header floats over the picture; Search and the pushed
 * editors keep the status bar.
 */
import { StackActions } from '@react-navigation/native';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Dialog } from '../../../components/ui';
import { HealthConsentSheet } from '../../../health/ui';
import { openHealthConsent } from '../../../health/consent/presenter';
import { presentMealGate } from '../../../health/gate/mealGate';
import type { HealthAccess } from '../../../health/models';
import { todayServerDay } from '../../../i18n/format';
import { useT } from '../../../i18n';
import { track } from '../../../lib/analytics';
import { useHardwareBack } from '../../../navigation/guards';
import { currentTab, navigationRef } from '../../../navigation/navigationRef';
import type { MealCaptureMode, MealCaptureOrigin, MealCaptureScreenProps } from '../../../navigation/types';
import { useIntentStore } from '../../../stores/intentStore';
import { colors } from '../../../theme';
import FoodSearchMode from '../search/FoodSearchMode';

import CaptureHeader, { CAPTURE_HEADER_HEIGHT } from './CaptureHeader';
import { CAPTURE_MODES, MealCaptureModel, modeUsesCamera, pageToastOffset, photoAllowed, type CaptureCloseTray } from './captureModel';
import { pageKeyOf, peekEditorHandoff, registerCapturePage, takeEditorHandoff, useCapture } from './capturePages';
import { openMealDatePicker } from './datePicker';
import { rememberMode } from './lastMode';
import MealTrayBar from './MealTrayBar';
import { dismissPageToast, showMealToast } from './saveFeedback';
import { BarcodeMode, PhotoMode, type CameraModeProps } from './slots';
import { useKeyboardCoverage } from './useKeyboardHeight';

/** `meal_capture_opened.entry` (iOS `MealCaptureOrigin.analyticsEntry`). */
export function analyticsEntry(origin: MealCaptureOrigin): string {
  return origin === 'scanTab' ? 'scan_tab' : origin;
}

/** The camera mode a package has drawn, or null (MEAL-3 fills ./slots.ts). */
function cameraModeFor(mode: MealCaptureMode): ComponentType<CameraModeProps> | null {
  if (mode === 'photo') return PhotoMode;
  if (mode === 'barcode') return BarcodeMode;
  return null;
}

/** The modes this build can draw, Photo only for the last 30 days (iOS `availableModes`). */
export function availableModes(date: string, today: string = todayServerDay()): MealCaptureMode[] {
  return CAPTURE_MODES.filter((mode) => {
    if (mode === 'search') return true;
    if (cameraModeFor(mode) === null) return false;
    return mode !== 'photo' || photoAllowed(date, today);
  });
}

/** The mode the page opens in: the one asked for when this build draws it, else Search. */
export function openingMode(requested: MealCaptureMode | undefined): MealCaptureMode {
  if (!requested || requested === 'search') return 'search';
  return cameraModeFor(requested) ? requested : 'search';
}

interface LooseRoute {
  readonly key: string;
  readonly state?: { readonly key?: string };
}

interface LooseNavigation {
  getState(): { readonly key: string; readonly routes: readonly LooseRoute[] };
  dispatch(action: object): void;
  goBack(): void;
}

/**
 * The root stack's route that holds the page whose own stack has `pageKey`.
 * Read from the container's whole state: a navigator's own `getState()`
 * leaves its routes' nested states out.
 */
function pageRouteIn(rootKey: string, pageKey: string | null): LooseRoute | null {
  if (!pageKey || !navigationRef.isReady()) return null;
  const tree = navigationRef.getRootState() as unknown as { readonly key: string; readonly routes: readonly LooseRoute[] };
  if (tree.key !== rootKey) return null;
  return tree.routes.find((entry) => entry.state?.key === pageKey) ?? null;
}

export default function MealCaptureScreen({ navigation, route }: MealCaptureScreenProps<'Capture'>) {
  const { t } = useT();
  const insets = useSafeAreaInsets();
  const keyboardCoverage = useKeyboardCoverage();
  const params = route.params;

  const [model] = useState(
    () =>
      new MealCaptureModel({
        origin: params.origin,
        mode: openingMode(params.mode),
        slot: params.slot ? { kind: 'fixed', slot: params.slot } : { kind: 'auto' },
        date: params.date && params.date <= todayServerDay() ? params.date : todayServerDay(),
        onAddToMeal: params.origin === 'editor' ? peekEditorHandoff() : null,
      }),
  );
  const mode = useCapture(model, (s) => s.mode);
  const date = useCapture(model, (s) => s.date);
  const onCamera = modeUsesCamera(mode);
  const modes = useMemo(() => availableModes(date), [date]);

  const [focused, setFocused] = useState(true);
  const [leaveVisible, setLeaveVisible] = useState(false);
  const [localConsent, setLocalConsent] = useState<{ readonly retry: () => Promise<void> } | null>(null);
  const lastLocalConsent = useRef(localConsent);
  if (localConsent) lastLocalConsent.current = localConsent;
  /** A membership wall: shown once the page has gone (iOS `onDisappear`). */
  const pendingGate = useRef<HealthAccess | null>(null);
  const closed = useRef(false);

  const closePage = useCallback(
    (tray: CaptureCloseTray) => {
      // One close at a time: a save's close and a tap on X in the same
      // moment pop the page once.
      if (closed.current) return;
      closed.current = true;
      track('meal_capture_closed', { tray });
      // The page's own toast ("Added" with Undo) leaves with it (iOS draws it
      // in the cover); a save's toast is app-wide and stays.
      dismissPageToast(model);
      // Pop THIS page from the root stack: another page (an editor's Add
      // food) may be over it, and a plain goBack would close that one.
      const root = navigation.getParent() as unknown as LooseNavigation | undefined;
      const rootState = root?.getState();
      const pageRoute = rootState ? pageRouteIn(rootState.key, pageKeyOf(navigation)) : null;
      if (root && rootState && pageRoute) {
        root.dispatch({ ...StackActions.pop(), source: pageRoute.key, target: rootState.key });
        // A screen inside the page may hold the removal (MEAL-4's draft
        // editor asks "keep for later" first): the page is still there, and
        // X, a save's close and the gate's close must work again. The root
        // stack's state is updated synchronously, so this reads the answer.
        if (root.getState().routes.some((entry) => entry.key === pageRoute.key)) closed.current = false;
      } else {
        root?.goBack();
      }
    },
    [model, navigation],
  );

  // The page's own hooks into its model. Run again whenever React sets the
  // effect up again for the same page (new navigation objects, Fast
  // Refresh): binding brings the model back, so the page never keeps a model
  // that ignores every change. Only the page going away disposes it (below).
  useEffect(() => {
    const pageKey = pageKeyOf(navigation);
    const unregister = pageKey ? registerCapturePage(pageKey, model) : () => undefined;
    model.bind({
      close: closePage,
      showGate: (access) => {
        pendingGate.current = access;
        closePage('kept');
      },
      askConsent: (retry) => {
        if (!openHealthConsent({ entry: 'scan', onGranted: retry })) setLocalConsent({ retry });
      },
      openDraftRoute: (mealId) => navigation.navigate('Draft', { mealId }),
    });
    return unregister;
  }, [model, navigation, closePage]);

  // The page has gone: nothing it started may change it, its toast goes, and
  // a membership wall shows the gate over whatever is underneath (iOS
  // `onDisappear`). An editor page has taken its handoff on mount: the next
  // page opened for an editor gets its own.
  useEffect(() => {
    if (model.origin === 'editor') takeEditorHandoff();
    return () => {
      model.dispose();
      dismissPageToast(model);
      const access = pendingGate.current;
      pendingGate.current = null;
      if (access) presentMealGate(access);
    };
  }, [model]);

  // Opened: the analytics, then a tray left within the day.
  useEffect(() => {
    track('meal_capture_opened', { entry: analyticsEntry(model.origin), mode: model.state.mode });
    let cancelled = false;
    void model.restoreTray().then((restored) => {
      if (restored && !cancelled) {
        showMealToast(t('meal.tray.restored'), { bottomOffset: pageToastOffset(model.state.tray.length), page: model });
      }
    });
    return () => {
      cancelled = true;
    };
    // Once per page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model]);

  // Focus: the status bar and back belong to this screen only while it is on top.
  useEffect(() => {
    const offFocus = navigation.addListener('focus', () => setFocused(true));
    const offBlur = navigation.addListener('blur', () => setFocused(false));
    return () => {
      offFocus();
      offBlur();
    };
  }, [navigation]);

  // A check-in link while the page is over the Scan tab: close without
  // asking (the tray stays in tray.json); the Scan tab then takes the venue.
  const scanLinkCount = useIntentStore((s) => s.scanLinkCount);
  const seenLinks = useRef(scanLinkCount);
  useEffect(() => {
    if (scanLinkCount === seenLinks.current) return;
    seenLinks.current = scanLinkCount;
    if (currentTab() === 'Scan') closePage(model.state.tray.length === 0 ? 'empty' : 'kept');
  }, [scanLinkCount, closePage, model]);

  const requestClose = useCallback(() => {
    if (model.state.tray.length > 0 && model.origin !== 'editor') setLeaveVisible(true);
    else closePage('empty');
  }, [model, closePage]);

  useHardwareBack(() => {
    requestClose();
    return true;
  });

  const switchMode = useCallback(
    (next: MealCaptureMode) => {
      if (next === model.state.mode) return;
      if (next === 'photo' && !model.photoAvailable) return;
      model.setMode(next);
      rememberMode(next);
      track('meal_mode_switched', { mode: next });
    },
    [model],
  );

  const changeDate = useCallback(() => {
    openMealDatePicker({
      date: model.state.date,
      allowsOlderThan30Days: model.state.mode !== 'photo',
      doneLabel: t('common.done'),
      cancelLabel: t('common.cancel'),
      onPick: (picked) => {
        const before: MealCaptureMode = model.state.mode;
        model.setDate(picked);
        const after: MealCaptureMode = model.state.mode;
        // An older day has no Photo: the switch to Search is remembered, as iOS's `switchMode(.search)` is.
        if (before === 'photo' && after === 'search') {
          rememberMode('search');
          track('meal_mode_switched', { mode: 'search' });
        }
      },
    });
  }, [model, t]);

  const CameraMode = cameraModeFor(mode);
  // The tray bar is not drawn in Photo (iOS): the shutter owns the bottom.
  const showsTrayBar = mode !== 'photo';
  // Above the keyboard while it is up (its covered strip includes the
  // navigation bar under it), else above the navigation bar.
  const bottom = Math.max(insets.bottom, keyboardCoverage);

  return (
    <View style={[styles.page, { backgroundColor: onCamera ? '#000000' : colors.ink }]} testID="meal.capture">
      <StatusBar hidden={onCamera && focused} style="dark" />
      {onCamera && CameraMode ? (
        <View style={StyleSheet.absoluteFill}>
          <CameraMode model={model} headerHeight={insets.top + CAPTURE_HEADER_HEIGHT} />
        </View>
      ) : null}

      <View style={[styles.column, { paddingTop: onCamera ? insets.top : 0, paddingBottom: bottom + 8 }]} pointerEvents="box-none">
        <View style={{ paddingTop: onCamera ? 0 : insets.top, backgroundColor: onCamera ? 'transparent' : colors.ink }}>
          <CaptureHeader model={model} modes={modes} onClose={requestClose} onSwitchMode={switchMode} onChangeDate={changeDate} />
        </View>
        <View style={styles.content} pointerEvents="box-none">
          {mode === 'search' ? <FoodSearchMode model={model} /> : null}
        </View>
        {showsTrayBar ? (
          <MealTrayBar
            model={model}
            onReview={() => navigation.navigate('Review')}
            onSave={() => {
              void model.commitTray();
            }}
          />
        ) : null}
      </View>

      <Dialog
        visible={leaveVisible}
        onClose={() => setLeaveVisible(false)}
        presentation="actionSheet"
        titleVisibility="visible"
        title={t('meal.leave.title')}
        message={t('meal.leave.body')}
        buttons={[
          { label: t('meal.leave.keep_later'), onPress: () => closePage('kept'), testID: 'meal.leave.keepLater' },
          {
            label: t('meal.leave.discard'),
            role: 'destructive',
            onPress: () => {
              model.discardTray();
              closePage('discarded');
            },
            testID: 'meal.leave.discard',
          },
          { label: t('meal.leave.keep'), role: 'cancel', testID: 'meal.leave.keep' },
        ]}
        testID="meal.leave"
      />

      {lastLocalConsent.current ? (
        <HealthConsentSheet
          visible={localConsent !== null}
          entry="scan"
          onClose={() => setLocalConsent(null)}
          onGranted={lastLocalConsent.current.retry}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1 },
  column: { flex: 1 },
  content: { flex: 1 },
});
