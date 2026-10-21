/**
 * What a session actually asks of you, before you start it (iOS
 * `SessionPreviewSheet`, `ios-ux.md` 3.9.3).
 *
 * Opened from a future day's Preview, the rest day's "Do the session planned
 * for Thursday today", and (PLAN-4) a programme overview's day row and a
 * proposal's week 1. It is a READ with at most one action on it
 * (./previewRules.ts): Start today's session, or pull a later one to today
 * with "Do it today". A refusal hides the button with the "changed" toast;
 * offline says it needs a connection and keeps the button for another try.
 *
 * Controlled: the host shows it and closes it. Start runs once the sheet has
 * gone (a sheet still sliding away cannot hand over to the full-screen
 * runner in the same moment); a pull hands its answer to `onPulled` and
 * closes. The host keys it by session, so each opening starts clean.
 */
import { useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, View, type Text } from 'react-native';

import { newIdempotencyKey } from '../../../api';
import { Card, LPText, PrimaryButton, Sheet } from '../../../components/ui';
import {
  exerciseLine,
  postSessionAction,
  SessionAction,
  useHealthStore,
  type ExerciseBlockView,
  type SessionActionResponse,
  type SessionView,
} from '../../../health';
import { useT } from '../../../i18n';
import { track } from '../../../lib/analytics';
import { colors, hairline } from '../../../theme';
import { previewMetaLine } from '../today/copy';

import { previewAction, pullFailure } from './previewRules';

export type SessionPreviewSheetProps = {
  visible: boolean;
  onClose: () => void;
  /** Runs once the sheet has fully left the screen. */
  onClosed?: () => void;
  session: SessionView;
  /**
   * Where the member came from, for `workout_pulled.entry`: `preview` (a
   * Preview tap), `rest_row` (the rest day's row) or `log_sheet` (the Log a
   * workout sheet's link). Two doors into one sheet that the data has to be
   * able to tell apart.
   */
  entry?: string;
  /** Today, planned, and the runner runs it: the sheet offers Start (`canStartRunnerToday`). */
  canStart?: boolean;
  /** Start: runs once the sheet has gone. */
  onStart?: () => void;
  /** A pull succeeded: the host replaces its day, week and upcoming. */
  onPulled?: (response: SessionActionResponse) => void;
  testID?: string;
};

export default function SessionPreviewSheet({
  visible,
  onClose,
  onClosed,
  session,
  entry = 'preview',
  canStart = false,
  onStart,
  onPulled,
  testID = 'plan.preview',
}: SessionPreviewSheetProps) {
  const { t } = useT();
  const titleRef = useRef<Text>(null);
  const [isPulling, setIsPulling] = useState(false);
  const [pullHidden, setPullHidden] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const afterClose = useRef<(() => void) | null>(null);
  const pulling = useRef(false);
  const blocks = session.blocks ?? [];
  const action = previewAction(session, { canStart, pullHidden });

  const pull = async () => {
    if (pulling.current) return;
    pulling.current = true;
    setIsPulling(true);
    setErrorKey(null);
    try {
      const response = await postSessionAction(session.id, SessionAction.pull, newIdempotencyKey());
      track('workout_pulled', { entry });
      setIsPulling(false);
      onPulled?.(response);
      onClose();
    } catch (error) {
      setIsPulling(false);
      const failure = pullFailure(error);
      if (failure.kind === 'hide') {
        // The server refused the move: the button goes away rather than
        // sitting there offering something that cannot happen.
        setPullHidden(true);
        useHealthStore.getState().setToast('health.err.changed');
      } else if (failure.kind === 'message') {
        setErrorKey(failure.key);
      }
    } finally {
      pulling.current = false;
    }
  };

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      busy={isPulling}
      initialFocusRef={titleRef}
      onClosed={() => {
        const next = afterClose.current;
        afterClose.current = null;
        next?.();
        onClosed?.();
      }}
      testID={testID}
    >
      <View style={styles.content}>
        <View style={styles.header}>
          <LPText ref={titleRef} serif size={24} color={colors.paper} accessibilityRole="header">
            {session.title ?? t('plan.today.rest_title')}
          </LPText>
          <LPText size={13} color={colors.paper2}>
            {previewMetaLine(session, t)}
          </LPText>
          {session.lighter === true ? (
            <View style={styles.chip}>
              <LPText size={11} weight="semibold" color={colors.signal}>
                {t('plan.lighter_chip')}
              </LPText>
            </View>
          ) : null}
        </View>

        {blocks.length === 0 ? (
          <LPText size={14} color={colors.paper2}>
            {t('history.detail.no_sets')}
          </LPText>
        ) : (
          <Card>
            {blocks.map((block, index) => (
              <View key={`${block.exerciseId ?? 'block'}-${index}`}>
                {index > 0 ? <View style={styles.rule} /> : null}
                <BlockRow block={block} />
              </View>
            ))}
          </Card>
        )}

        {errorKey ? (
          <LPText size={13} color={colors.destructive} testID={`${testID}.error`}>
            {t(errorKey)}
          </LPText>
        ) : null}

        {action === 'start' ? (
          <PrimaryButton
            title={t('plan.start')}
            onPress={() => {
              afterClose.current = onStart ?? null;
              onClose();
            }}
            testID={`${testID}.start`}
          />
        ) : null}
        {action === 'pull' ? (
          isPulling ? (
            <View style={styles.spinner} testID={`${testID}.pulling`}>
              <ActivityIndicator color={colors.rust} />
            </View>
          ) : (
            <PrimaryButton title={t('plan.do_today')} onPress={() => void pull()} testID={`${testID}.pull`} />
          )
        ) : null}

        <LPText size={12} color={colors.paper3}>
          {t('health.disclaimer')}
        </LPText>
      </View>
    </Sheet>
  );
}

/** One block: its name, its dose, its equipment and its first cue. */
function BlockRow({ block }: { block: ExerciseBlockView }) {
  const { t } = useT();
  const cue = block.cues?.[0];
  return (
    <View style={styles.block}>
      <LPText size={15} weight="semibold" color={colors.paper}>
        {block.name ?? ''}
      </LPText>
      <LPText size={13} color={colors.paper2}>
        {exerciseLine(block, t)}
      </LPText>
      {block.equipmentLabel ? (
        <LPText size={12} color={colors.paper3}>
          {block.equipmentLabel}
        </LPText>
      ) : null}
      {cue ? (
        <LPText size={12} color={colors.paper3}>
          {cue}
        </LPText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  content: { gap: 18, paddingTop: 8, paddingBottom: 16 },
  header: { gap: 8 },
  chip: { alignSelf: 'flex-start', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 999, backgroundColor: colors.rust3 },
  rule: { height: hairline, backgroundColor: colors.line },
  block: { gap: 5, paddingHorizontal: 14, paddingVertical: 12 },
  spinner: { height: 52, alignItems: 'center', justifyContent: 'center' },
});
