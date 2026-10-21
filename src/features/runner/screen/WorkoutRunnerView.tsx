/**
 * The workout runner's page (iOS `WorkoutRunnerView`, `ios-ux.md` 7.3): a
 * full-screen page on the paper surface with the top bar, the exercise card
 * in a scroll view, and the bottom bar; the Undo toast over it; the Leave
 * dialog and RUN-3's sheets on top.
 *
 * WHAT RUNS WHILE IT IS UP:
 * - the clock: `controller.tick` twice a second (the controller publishes the
 *   displayed second only when it changes);
 * - the app's comings and goings (AppState): leaving pauses the active clock
 *   and schedules the rest alert, returning removes it and catches up;
 * - the local wipe: the runner closes as discarded and writes nothing back;
 * - Android's back: the Leave dialog, never a silent close;
 * - the keyboard: the page is lifted above it (the app is edge to edge, so
 *   Android no longer shrinks the window), keeping the bottom bar in reach.
 *
 * The page scrolls back to the top whenever the exercise changes.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Dimensions, Keyboard, ScrollView, StyleSheet, View, type KeyboardEvent } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useA11ySize } from '../../../hooks/useA11ySize';
import { useHealthStore } from '../../../health/store';
import { useT } from '../../../i18n';
import { useHardwareBack } from '../../../navigation/guards';
import { colors } from '../../../theme';
import { onRunnerWiped } from '../persistence/wiped';

import type { RunnerController } from './controller';
import RunnerBottomBar from './RunnerBottomBar';
import RunnerExerciseCard from './RunnerExerciseCard';
import RunnerLeaveDialog from './RunnerLeaveDialog';
import RunnerSheets, { type RunnerSheet } from './RunnerSheets';
import RunnerTopBar from './RunnerTopBar';
import RunnerUndoToast from './RunnerUndoToast';
import { RunnerControllerContext, useRunner } from './useRunner';

/** How often the page asks the controller for the time (iOS: every 500 ms). */
export const RUNNER_TICK_MS = 500;

export interface WorkoutRunnerViewProps {
  readonly controller: RunnerController;
}

export default function WorkoutRunnerView({ controller }: WorkoutRunnerViewProps) {
  return (
    <RunnerControllerContext.Provider value={controller}>
      <RunnerPage />
    </RunnerControllerContext.Provider>
  );
}

function RunnerPage() {
  const { controller, snapshot } = useRunner();
  const { language } = useT();
  const insets = useSafeAreaInsets();
  const { isAccessibilitySize } = useA11ySize();
  const isOffline = useHealthStore((s) => s.lastError?.isOffline === true);
  const [leaveVisible, setLeaveVisible] = useState(false);
  const [sheet, setSheet] = useState<RunnerSheet | null>(null);
  const keyboardHeight = useKeyboardHeight();
  const scroll = useRef<ScrollView>(null);
  const { state } = snapshot;

  // The account language, for the alert and the announcements.
  useEffect(() => {
    controller.language = language;
  }, [controller, language]);

  // Up: written down, counted once, caught up. Gone: nothing it started outlives it.
  useEffect(() => {
    controller.appeared();
    return () => controller.disappeared();
  }, [controller]);

  // The clock.
  useEffect(() => {
    const timer = setInterval(() => controller.tick(new Date()), RUNNER_TICK_MS);
    return () => clearInterval(timer);
  }, [controller]);

  // Leaving the app and coming back.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (status) => controller.appStateChanged(status === 'active'));
    return () => subscription.remove();
  }, [controller]);

  // The local wipe (a sign-out, a withdrawal, a verified minor).
  useEffect(() => onRunnerWiped(() => controller.wiped()), [controller]);

  // A new exercise starts at its top.
  useEffect(() => {
    scroll.current?.scrollTo({ y: 0, animated: false });
  }, [state.index]);

  const openLeave = useCallback(() => {
    Keyboard.dismiss();
    setLeaveVisible(true);
  }, []);

  const openFinish = useCallback(() => {
    Keyboard.dismiss();
    setSheet('finish');
  }, []);

  // Back opens the Leave dialog; it never closes the runner by itself. (A
  // dialog or a sheet that is up takes back first.)
  useHardwareBack(() => {
    if (!controller.isClosed) openLeave();
    return true;
  });


  return (
    <View style={[styles.page, { paddingTop: insets.top, paddingBottom: keyboardHeight }]} testID="runner.page">
      <RunnerTopBar state={state} elapsedSeconds={controller.elapsedSeconds} onClose={openLeave} />
      <ScrollView
        ref={scroll}
        style={styles.scroll}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        showsVerticalScrollIndicator={false}
        testID="runner.scroll"
      >
        <RunnerExerciseCard
          controller={controller}
          state={state}
          accessibilityLayout={isAccessibilitySize}
          onSwap={() => setSheet('swap')}
        />
      </ScrollView>
      <RunnerBottomBar
        controller={controller}
        state={state}
        isResting={controller.isResting}
        bottomInset={keyboardHeight > 0 ? 0 : insets.bottom}
        onFinish={openFinish}
      />
      {snapshot.skipUndo ? (
        <RunnerUndoToast
          messageKey={snapshot.skipToastKey}
          id={snapshot.skipToastId}
          onUndo={() => controller.undoSkip()}
        />
      ) : null}
      <RunnerLeaveDialog
        visible={leaveVisible}
        canSkipWorkout={controller.canSkipWorkout && !isOffline}
        onClose={() => setLeaveVisible(false)}
        onSaveAndFinish={openFinish}
        onLater={() => controller.leaveLater()}
        onSkipWorkout={() => setSheet('skipWorkout')}
        onDiscard={() => controller.discard()}
      />
      <RunnerSheets controller={controller} sheet={sheet} onClose={() => setSheet(null)} isOffline={isOffline} />
    </View>
  );
}

/**
 * How much of the screen the keyboard covers while it is up, else 0. Some
 * phones under-report the keyboard's height (they miss the navigation bar
 * strip), so its top edge in screen coordinates decides too (as the Coach
 * screen measures it).
 */
function useKeyboardHeight(): number {
  const [height, setHeight] = useState(0);
  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', (event: KeyboardEvent) => {
      const { height: reported = 0, screenY } = event.endCoordinates ?? {};
      const screenHeight = Dimensions.get('screen').height;
      setHeight(typeof screenY === 'number' ? Math.max(reported, screenHeight - screenY) : reported);
    });
    const hide = Keyboard.addListener('keyboardDidHide', () => setHeight(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  return height;
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
    backgroundColor: colors.ink,
  },
  scroll: {
    flex: 1,
  },
  content: {
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 28,
  },
});
