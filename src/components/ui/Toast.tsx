// A short message at the bottom of the screen, gone after a few seconds:
// iOS HealthToast ("this was changed on another device", the local-wipe
// notice) and MealToastCenter (a toast with one action: "Food diary",
// "Undo", "Check").
//
//   showToast(t('meal.saved'), { action: { label: t('meal.food_diary'), onPress: openDiary } });
//
// One at a time: a new toast replaces the current one, as on iOS. TalkBack
// hears every toast as it appears (iOS posts the same announcement).
//
// TIMING. 3.2 s without an action (HealthToast), 4 s with one
// (MealToastCenter's default); `durationMs` overrides. A toast with an action
// also honours Android's "Time to take action" setting, so a member who asked
// for more time gets it before the Undo disappears.
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

export type ToastOptions = {
  action?: ToastAction;
  durationMs?: number;
};

type ToastItem = { id: number; message: string; action?: ToastAction; durationMs: number };

/** HealthToast stays 3.2 s. */
export const TOAST_MS = 3200;
/** MealToastCenter's default, used for toasts with an action. */
export const ACTION_TOAST_MS = 4000;

const current = createHostStore<ToastItem | null>(null);
let nextId = 1;

/** Show a toast from anywhere; replaces the one on screen. */
export function showToast(message: string, options: ToastOptions = {}): void {
  if (!message) return;
  if (__DEV__ && current.listenerCount() === 0) {
    console.warn('[ui] showToast() with no ToastHost mounted; mount UiKitProvider in the app shell.');
  }
  const durationMs = options.durationMs ?? (options.action ? ACTION_TOAST_MS : TOAST_MS);
  current.set({ id: nextId++, message, action: options.action, durationMs });
  announce(message);
}

/** Removes the toast on screen, if any. */
export function dismissToast(): void {
  current.set(null);
}

export type ToastHostProps = {
  /**
   * Distance from the bottom of the screen, above the tab bar (iOS draws
   * health toasts 110 pt up and meal toasts 96 pt up). The navigation bar
   * inset is added to it.
   */
  bottomOffset?: number;
};

export function ToastHost({ bottomOffset = 110 }: ToastHostProps) {
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
  const withAction = !!shown.action;

  return (
    <View pointerEvents="box-none" style={[StyleSheet.absoluteFill, styles.layer]}>
      <Animated.View
        style={[
          styles.toast,
          withAction ? styles.withAction : styles.plain,
          { marginBottom: bottomOffset + insets.bottom, opacity: progress, transform: [{ translateY }] },
        ]}
        testID="toast"
      >
        <LPText
          size={13}
          weight="medium"
          color={colors.ink}
          align={withAction ? 'left' : 'center'}
          style={withAction ? styles.grow : undefined}
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
  plain: { marginHorizontal: 24, paddingHorizontal: 16, paddingVertical: 11 },
  withAction: {
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
