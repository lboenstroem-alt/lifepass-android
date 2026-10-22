/**
 * Route `WorkoutRunner` (plan 3.0.2): the workout runner, a full-screen modal
 * over the tabs (iOS `.fullScreenCover`). The Android port of how iOS Plan
 * presents `WorkoutRunnerView(launch:)`.
 *
 * The route carries the session's id and where the runner was opened from.
 * The screen reads the member's saved workout (`runner.json`), finds the
 * session (./sessionSource.ts), and opens the runner: the saved one when it
 * is this session's (entry `resume`, its clock recovered), else a fresh one.
 * Whether another session's saved workout may be replaced is decided before
 * the runner is opened (RUN-3's launch rule).
 *
 * A saved workout that has outlived its day (the day after its session) is
 * not resumed: a fresh runner opens and writes over it (iOS
 * `RunnerLaunchDecision.decide`, which Plan runs before presenting).
 *
 * A session that cannot be found, no member signed in, or an open that
 * failed (neither happens through Plan or Home, which hand the session
 * over): there is nothing to run, so the page says something went wrong and
 * offers only its close; back closes it too. It never opens an empty
 * workout.
 *
 * A LOCAL WIPE DURING THE OPEN. iOS reads the file and wipes in main-actor
 * turns that cannot interleave; here the read is awaited, and a wipe (a
 * withdrawal, a sign-out) can land in it. The wipe epoch is captured before
 * the read: when it moved, what was read is gone, and the runner does not
 * open. The controller writes under that same epoch, so nothing it was
 * built from is written back.
 *
 * NOTHING REMOVES AN OPEN RUNNER BUT ITS OWN CLOSE. iOS keeps the runner's
 * cover up over a tab switch made for the member (a check-in link, a tapped
 * notification); F4's shell asks the root stack to pop for such a switch,
 * and the runner refuses it, so the switch waits until the runner closes
 * (src/navigation/TabNavigator.tsx holds it). Without this the runner would
 * go with its clock still running in runner.json.
 */
import { Ionicons } from '@expo/vector-icons';
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { LPText } from '../../../components/ui';
import { useT } from '../../../i18n';
import { todayServerDay } from '../../../i18n/format';
import { errorDescription, track } from '../../../lib/analytics';
import type { RootModalProps } from '../../../navigation/types';
import { useAppStore } from '../../../stores/appStore';
import { colors } from '../../../theme';
import { isExpired } from '../model/state';
import { runnerWipeEpoch, wipedSince } from '../persistence/fence';
import { loadRunner } from '../persistence/runnerStore';

import { notifyRunnerClosed } from './closeEvents';
import { RunnerController } from './controller';
import { findRunnerSession } from './sessionSource';
import WorkoutRunnerView from './WorkoutRunnerView';

type Launch = { readonly kind: 'ready'; readonly controller: RunnerController } | { readonly kind: 'missing' };

/** The signed-in member's id, as their health folder is named. */
function memberId(): string | null {
  const app = useAppStore.getState();
  return app.profile?.id ?? app.userId ?? null;
}

export default function WorkoutRunnerScreen({ route, navigation }: RootModalProps<'WorkoutRunner'>) {
  const { sessionId, entry } = route.params;
  const { language } = useT();
  const [launch, setLaunch] = useState<Launch | null>(null);
  const languageAtOpen = useRef(language);
  // True while a runner is up and has not closed: the route refuses removal.
  const holding = useRef(false);

  // No swipe away: leaving goes through the Leave dialog.
  useEffect(() => {
    navigation.setOptions({ gestureEnabled: false });
  }, [navigation]);

  // Only the runner's own close removes it (see the top of this file).
  useEffect(
    () =>
      navigation.addListener('beforeRemove', (event) => {
        if (holding.current) event.preventDefault();
      }),
    [navigation],
  );

  useEffect(() => {
    let cancelled = false;
    const leave = () => {
      holding.current = false;
      if (navigation.canGoBack()) navigation.goBack();
    };
    void (async () => {
      try {
        const profileId = memberId();
        if (!profileId) {
          if (!cancelled) setLaunch({ kind: 'missing' });
          return;
        }
        const epoch = runnerWipeEpoch();
        const saved = await loadRunner(profileId);
        if (cancelled) return;
        if (wipedSince(epoch)) {
          // The workout was discarded with the member's other data while it was read.
          leave();
          return;
        }
        const restored = saved && !isExpired(saved, todayServerDay()) ? saved : null;
        const session = findRunnerSession(sessionId, restored);
        if (!session) {
          setLaunch({ kind: 'missing' });
          return;
        }
        const controller = new RunnerController({
          session,
          restored,
          profileId,
          language: languageAtOpen.current,
          entry,
          wipeEpoch: epoch,
        });
        controller.onClose = (result) => {
          notifyRunnerClosed(result, session.id);
          leave();
        };
        holding.current = true;
        setLaunch({ kind: 'ready', controller });
      } catch (error) {
        // A session or a saved file the runner cannot open: never an empty or half-built workout.
        track('service_error', { op: 'runner_open', error: errorDescription(error) });
        if (!cancelled) setLaunch({ kind: 'missing' });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionId, entry, navigation]);

  if (launch?.kind === 'missing') {
    return <NothingToRun onClose={() => navigation.canGoBack() && navigation.goBack()} />;
  }
  if (launch?.kind !== 'ready') return <View style={styles.page} testID="runner.opening" />;
  return <WorkoutRunnerView controller={launch.controller} />;
}

function NothingToRun({ onClose }: { onClose: () => void }) {
  const { t } = useT();
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.page, { paddingTop: insets.top }]} testID="runner.unavailable">
      <Pressable
        testID="runner.close"
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel={t('common.close')}
        style={styles.close}
      >
        <Ionicons name="close" size={24} color={colors.paper} />
      </Pressable>
      <View style={styles.body}>
        <LPText size={15} color={colors.paper2} align="center">
          {t('common.error_body')}
        </LPText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
    backgroundColor: colors.ink,
  },
  close: {
    width: 44,
    height: 44,
    marginLeft: 6,
    marginTop: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
});
