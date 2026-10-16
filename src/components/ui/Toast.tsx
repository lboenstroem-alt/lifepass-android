// A short message at the bottom of the screen, gone after a few seconds.
// iOS has two, and they differ in look and time:
//
//   kind 'health'  iOS HealthToast (healthToast(key:)): "this was changed on
//                  another device", the local-wipe notice. A centred message,
//                  3.2 s, 110 pt up.
//   kind 'meal'    iOS MealToastCenter.show: everything the food log says
//                  ("Saved offline", "Changed elsewhere", "Food added" with
//                  Undo, "Saved to lunch" with Food diary). A left-aligned row
//                  at least 44 tall, 4 s WITH OR WITHOUT an action, 96 pt up
//                  (the app-wide meal chrome; the capture page passes its own
//                  `bottomOffset`, 40 or 100 by its tray).
//
// A toast with an action is always the meal kind (HealthToast has none); one
// without is the health kind unless it says `kind: 'meal'`, which every port
// of a MealToastCenter.show(message:) call must.
//
//   showToast(t('health.err.changed'));                                  // HealthToast
//   showToast(t('health.saved_offline'), { kind: 'meal' });              // MealToastCenter
//   showToast(t('food.added'), { action: { label: t('plan.undo'), onPress: undo } });
//
// One at a time: a new toast replaces the current one, as on iOS. TalkBack
// hears every toast as it appears (iOS posts the same announcement). A toast
// with an action also honours Android's "Time to take action" setting, so a
// member who asked for more time gets it before the Undo disappears.
// `durationMs` overrides the kind's time.
//
// The app shell mounts one ToastHost (in UiKitProvider) above the tab bar.
import { useEffect, useRef, useState } from 'react';
import { Animated, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useReduceMotion } from '../../hooks/useReduceMotion';
import { colors } from '../../theme';
import { announce, recommendedTimeout } from './a11y';
import { createHostStore } from './hostStore';
import LPText from './LPText';

export type ToastAction = { label: string; onPress: () => void };

/** Which iOS toast this is (see the top of this file). */
export type ToastKind = 'health' | 'meal';

export type ToastOptions = {
  action?: ToastAction;
  /** Default: 'meal' with an action, 'health' without. */
  kind?: ToastKind;
  /** Overrides the kind's time on screen. */
  durationMs?: number;
  /** Distance above the bottom edge, for this toast (the meal capture page: 40 or 100). */
  bottomOffset?: number;
};

type ToastItem = {
  id: number;
  message: string;
  kind: ToastKind;
  action?: ToastAction;
  durationMs: number;
  bottomOffset?: number;
};

/** HealthToast stays 3.2 s. */
export const TOAST_MS = 3200;
/** MealToastCenter.show's default, with or without an action. */
export const MEAL_TOAST_MS = 4000;
/** @deprecated The same 4 s as MEAL_TOAST_MS, which applies with or without an action. */
export const ACTION_TOAST_MS = MEAL_TOAST_MS;

const KIND_MS: Record<ToastKind, number> = { health: TOAST_MS, meal: MEAL_TOAST_MS };

/** How far up iOS draws each: HealthToast 110 pt, the app-wide meal toasts 96 pt. */
export const TOAST_BOTTOM_OFFSET: Record<ToastKind, number> = { health: 110, meal: 96 };

const current = createHostStore<ToastItem | null>(null);
let nextId = 1;

/** Show a toast from anywhere; replaces the one on screen. */
export function showToast(message: string, options: ToastOptions = {}): void {
  if (!message) return;
  if (__DEV__ && current.listenerCount() === 0) {
    console.warn('[ui] showToast() with no ToastHost mounted; mount UiKitProvider in the app shell.');
  }
  const kind: ToastKind = options.action ? 'meal' : (options.kind ?? 'health');
  const durationMs = options.durationMs ?? KIND_MS[kind];
  current.set({ id: nextId++, message, kind, action: options.action, durationMs, bottomOffset: options.bottomOffset });
  announce(message);
}

/** Removes the toast on screen, if any. */
export function dismissToast(): void {
  current.set(null);
}

export type ToastHostProps = {
  /**
   * Distance from the bottom of the screen for every toast that does not
   * give its own. Omitted, each kind sits where iOS draws it
   * (TOAST_BOTTOM_OFFSET: health 110 pt, meal 96 pt). The navigation bar
   * inset is added to it.
   */
  bottomOffset?: number;
};

export function ToastHost({ bottomOffset }: ToastHostProps) {
  const toast = current.use();
  const insets = useSafeAreaInsets();
  const reduceMotion = useReduceMotion();
  const progress = useRef(new Animated.Value(0)).current;
  const [shown, setShown] = useState<ToastItem | null>(toast);

  // Keep the last toast drawn while it fades out.
  useEffect(() => {
    if (toast) setShown(toast);
    Animated.timing(progress, {
      toValue: toast ? 1 : 0,
      duration: reduceMotion ? 0 : 200,
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished && !toast) setShown(null);
    });
  }, [toast, progress, reduceMotion]);

  // Self-dismiss after its time.
  useEffect(() => {
    if (!toast) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let alive = true;
    const hide = () => {
      if (current.get()?.id === toast.id) current.set(null);
    };
    if (toast.action) {
      void recommendedTimeout(toast.durationMs).then((ms) => {
        if (alive) timer = setTimeout(hide, ms);
      });
    } else {
      timer = setTimeout(hide, toast.durationMs);
    }
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, [toast]);

  if (!shown) return null;

  const translateY = progress.interpolate({ inputRange: [0, 1], outputRange: [reduceMotion ? 0 : 24, 0] });
  const row = shown.kind === 'meal';
  const offset = shown.bottomOffset ?? bottomOffset ?? TOAST_BOTTOM_OFFSET[shown.kind];

  return (
    <View pointerEvents="box-none" style={[StyleSheet.absoluteFill, styles.layer]}>
      <Animated.View
        style={[
          styles.toast,
          row ? styles.row : styles.plain,
          { marginBottom: offset + insets.bottom, opacity: progress, transform: [{ translateY }] },
        ]}
        testID="toast"
      >
        <LPText
          size={13}
          weight="medium"
          color={colors.ink}
          align={row ? 'left' : 'center'}
          style={row ? styles.grow : undefined}
        >
          {shown.message}
        </LPText>
        {shown.action ? (
          <Pressable
            onPress={() => {
              const action = shown.action;
              if (current.get()?.id === shown.id) current.set(null);
              action?.onPress();
            }}
            accessibilityRole="button"
            accessibilityLabel={shown.action.label}
            style={({ pressed }) => [styles.action, pressed && styles.pressed]}
          >
            <LPText size={13} weight="semibold" color={colors.rust2}>
              {shown.action.label}
            </LPText>
          </Pressable>
        ) : null}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  layer: { justifyContent: 'flex-end', alignItems: 'stretch' },
  toast: {
    backgroundColor: colors.paper,
    borderRadius: 12,
    shadowColor: '#000000',
    shadowOpacity: 0.18,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
  // iOS HealthToast: centred, 16 x 11 padding, 24 pt from the sides.
  plain: { marginHorizontal: 24, paddingHorizontal: 16, paddingVertical: 11 },
  // iOS MealToastOverlay: a row at least 44 tall, 16 x 4 padding, 20 pt from the sides.
  row: {
    marginHorizontal: 20,
    paddingHorizontal: 16,
    paddingVertical: 4,
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  grow: { flex: 1 },
  action: { minHeight: 44, justifyContent: 'center' },
  pressed: { opacity: 0.7 },
});
