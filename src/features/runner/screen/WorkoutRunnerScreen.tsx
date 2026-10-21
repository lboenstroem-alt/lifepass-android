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
 * A session that cannot be found, or no member signed in, leaves at once:
 * there is nothing to run.
 */
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { useT } from '../../../i18n';
import type { RootModalProps } from '../../../navigation/types';
import { useAppStore } from '../../../stores/appStore';
import { colors } from '../../../theme';
import { loadRunner } from '../persistence/runnerStore';

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

  // No swipe away: leaving goes through the Leave dialog.
  useEffect(() => {
    navigation.setOptions({ gestureEnabled: false });
  }, [navigation]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const profileId = memberId();
      if (!profileId) {
        if (!cancelled) setLaunch({ kind: 'missing' });
        return;
      }
      const restored = await loadRunner(profileId);
      if (cancelled) return;
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
      });
      controller.onClose = () => {
        if (navigation.canGoBack()) navigation.goBack();
      };
      setLaunch({ kind: 'ready', controller });
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionId, entry, navigation]);

  useEffect(() => {
    if (launch?.kind === 'missing' && navigation.canGoBack()) navigation.goBack();
  }, [launch, navigation]);

  if (launch?.kind !== 'ready') return <View style={styles.page} testID="runner.opening" />;
  return <WorkoutRunnerView controller={launch.controller} />;
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
    backgroundColor: colors.ink,
  },
});
