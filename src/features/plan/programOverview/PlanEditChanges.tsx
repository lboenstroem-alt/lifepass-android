/* eslint lifepass/no-literal-copy: "error" */
/**
 * "Changes" on the live plan's overview (COACH-6, OP-62): what was changed
 * in the Coach, when, and whether it was undone, newest first, with Undo on
 * a change the server still says can be undone. The port of iOS
 * `PlanEditChangesSection` (Views/Plan/PlanEditChangesSection.swift).
 *
 *   CHANGES
 *   ┌ Push-ups instead of bench press on Push days        Undo ┐
 *   │ Thu 23 Oct                                               │
 *   │ No cable machine: 3 exercises changed            Undone  │
 *   └ Wed 22 Oct                                               ┘
 *
 * This list is also how support helps a member (docs/03): the changes are
 * theirs, and no admin screen shows them.
 *
 * Shown while the server changes plans by chat or the plan carries a change
 * (`lastEdit`): the list works whatever the feature flag says, so a change
 * applied before the feature was turned off can still be undone. Nothing is
 * drawn while it reads, when there is nothing, or on a server without the
 * list (a 404); a failed read says so.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { isApiError } from '../../../api';
import { Card, Kicker, LPText } from '../../../components/ui';
import { useHealthStore, type ProgramSummary } from '../../../health';
import { useT } from '../../../i18n';
import { shortDay } from '../../../i18n/format';
import { colors, hairline } from '../../../theme';
import {
  announceUndone,
  fetchPlanEdits,
  isMissingRoute,
  isUndoable,
  planEditProblem,
  undoEdit,
  usePlanEditOffered,
  type PlanEditView,
} from '../../coach/planEdit';

type LoadState = 'idle' | 'loading' | 'loaded' | 'failed';

export default function PlanEditChanges({
  program,
  onPlanChanged,
}: {
  program: Pick<ProgramSummary, 'id' | 'lastEdit'>;
  /** A change was undone here: the host reads the plan again. */
  onPlanChanged?: () => void;
}) {
  const { t, language } = useT();
  const offered = usePlanEditOffered();
  const shows = offered || program.lastEdit !== null;
  const [edits, setEdits] = useState<readonly PlanEditView[]>([]);
  const [loadState, setLoadState] = useState<LoadState>('idle');
  const [undoingId, setUndoingId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<{ readonly id: string; readonly key: string } | null>(null);
  const alive = useRef(true);
  const generation = useRef(0);
  const loadedCount = useRef(0);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    const mine = ++generation.current;
    const current = () => alive.current && mine === generation.current;
    if (loadedCount.current === 0) setLoadState('loading');
    try {
      const list = await fetchPlanEdits(program.id, language);
      if (!current()) return;
      loadedCount.current = list.length;
      setEdits(list);
      setLoadState('loaded');
    } catch (error) {
      if (!current() || (isApiError(error) && error.isCancellation)) return;
      // A server without the list, or one rolled back: no section.
      if (isApiError(error) && (isMissingRoute(error) || error.status === 404)) {
        loadedCount.current = 0;
        setEdits([]);
        setLoadState('loaded');
        return;
      }
      setLoadState(loadedCount.current === 0 ? 'failed' : 'loaded');
    }
  }, [program.id, language]);

  // Read again on a new change, and whenever a change was applied or undone
  // in the Coach (iOS `.onReceive(.healthPlanChanged)`), whose new row and
  // Undo belong here at once.
  const planChanged = useHealthStore((s) => s.planChangedNonce);
  useEffect(() => {
    if (shows) void load();
  }, [shows, load, program.lastEdit?.editId, planChanged]);

  const undo = async (edit: PlanEditView) => {
    if (undoingId !== null || edit.status !== 'applied' || !isUndoable(edit)) return;
    setUndoingId(edit.id);
    setRowError(null);
    try {
      const keptRows = await undoEdit(program.id, edit.id, 'changes');
      if (!alive.current) return;
      announceUndone(keptRows);
      onPlanChanged?.();
    } catch (error) {
      if (!alive.current) return;
      const problem = isApiError(error) ? planEditProblem(error) : ({ kind: 'other' } as const);
      switch (problem.kind) {
        case 'undoWindow':
          setRowError({ id: edit.id, key: 'coach.planEdit.error.undoWindow' });
          break;
        case 'undoChanged':
          setRowError({ id: edit.id, key: 'coach.planEdit.error.undoChanged' });
          break;
        case 'notPending':
          onPlanChanged?.();
          break;
        case 'offline':
          setRowError({ id: edit.id, key: 'health.offline.action_hint' });
          break;
        default:
          setRowError({ id: edit.id, key: 'common.error_body' });
      }
    } finally {
      if (alive.current) setUndoingId(null);
    }
    await load();
  };

  if (!shows || loadState === 'idle' || loadState === 'loading') return null;
  if (loadState === 'loaded' && edits.length === 0) return null;

  return (
    <View style={styles.section} testID="programOverview.changes">
      <Kicker text={t('coach.planEdit.changesList')} style={styles.title} accessibilityRole="header" />
      {loadState === 'failed' ? (
        <LPText size={13} color={colors.paper2} style={styles.title} testID="programOverview.changes.failed">
          {t('coach.planEdit.changes.loadFailed')}
        </LPText>
      ) : (
        <Card style={styles.card}>
          {edits.map((edit, index) => {
            const canUndo = edit.status === 'applied' && isUndoable(edit);
            const error = rowError?.id === edit.id ? rowError.key : null;
            return (
              <View key={edit.id} style={[styles.row, index > 0 && styles.divider]} testID={`programOverview.change.${edit.id}`}>
                <View style={styles.texts}>
                  <LPText size={14} color={colors.paper}>
                    {edit.summary || t('coach.planEdit.cardTitle')}
                  </LPText>
                  {edit.appliedAt ? (
                    <LPText size={12} color={colors.paper3}>
                      {shortDay(edit.appliedAt, language)}
                    </LPText>
                  ) : null}
                  {error ? (
                    <LPText size={12} color={colors.paper2} testID={`programOverview.change.${edit.id}.error`}>
                      {t(error)}
                    </LPText>
                  ) : null}
                </View>
                {edit.status === 'undone' ? (
                  <LPText size={12} weight="semibold" color={colors.paper3} testID={`programOverview.change.${edit.id}.undone`}>
                    {t('coach.planEdit.undone')}
                  </LPText>
                ) : canUndo ? (
                  <Pressable
                    onPress={() => void undo(edit)}
                    disabled={undoingId !== null}
                    accessibilityRole="button"
                    accessibilityLabel={t('coach.planEdit.undo')}
                    accessibilityState={{ disabled: undoingId !== null, busy: undoingId === edit.id }}
                    style={({ pressed }) => [styles.undo, pressed && styles.pressed]}
                    testID={`programOverview.change.${edit.id}.undo`}
                  >
                    {undoingId === edit.id ? <ActivityIndicator size="small" color={colors.rust} /> : null}
                    <LPText size={13} weight="semibold" color={colors.accentText}>
                      {t('coach.planEdit.undo')}
                    </LPText>
                  </Pressable>
                ) : null}
              </View>
            );
          })}
        </Card>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: 10 },
  title: { paddingHorizontal: 24 },
  card: { marginHorizontal: 20 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 12, minHeight: 56 },
  divider: { borderTopWidth: hairline, borderTopColor: colors.line },
  texts: { flex: 1, gap: 3 },
  undo: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 6 },
  pressed: { opacity: 0.7 },
});
