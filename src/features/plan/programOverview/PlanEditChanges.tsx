/* eslint lifepass/no-literal-copy: "error" */
/**
 * "Changes": what the member changed in the plan by talking to the Coach
 * (COACH-6, OP-62), newest first, on the live plan's overview:
 *
 *   Changes
 *   ┌ Swapped bench press for push-ups on Push days     Undo ┐
 *   │ Thu 23 Oct                                             │
 *   │ No cable machine: 3 exercises changed          Undone  │
 *   └ Wed 22 Oct                                             ┘
 *
 * Undo on a row the server says can still be undone (the same OP-60 the
 * chat's card calls, one key per change). This is also where support sends
 * a member who asks what changed (docs/03): nobody else can see it.
 *
 * Read when the server changes plans by chat or the plan carries a change
 * (`lastEdit`): the list works whatever the feature flag says, so a change
 * applied before the feature was turned off can still be undone. Draws
 * nothing while there is nothing, on an older server, or when the read fails.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { isApiError } from '../../../api';
import { Card, LPText } from '../../../components/ui';
import type { ProgramSummary } from '../../../health';
import { useT } from '../../../i18n';
import { shortDay } from '../../../i18n/format';
import { colors, hairline } from '../../../theme';
import {
  announceUndone,
  fetchPlanEdits,
  isUndoable,
  planEditFailureCopyKey,
  planEditUndoFailure,
  undoEdit,
  usePlanEditOffered,
  type PlanEditView,
} from '../../coach/planEdit';

export default function PlanEditChanges({ program }: { program: Pick<ProgramSummary, 'id' | 'lastEdit'> }) {
  const { t, language } = useT();
  const offered = usePlanEditOffered();
  const reads = offered || program.lastEdit !== null;
  const [edits, setEdits] = useState<readonly PlanEditView[]>([]);
  const [undoing, setUndoing] = useState<string | null>(null);
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({});
  const alive = useRef(true);
  const generation = useRef(0);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    const mine = ++generation.current;
    try {
      const loaded = await fetchPlanEdits(program.id, language);
      if (alive.current && mine === generation.current) setEdits(loaded);
    } catch {
      // An older server, no connection: the list is simply not drawn.
    }
  }, [program.id, language]);

  useEffect(() => {
    if (reads) void load();
  }, [reads, load, program.lastEdit?.editId]);

  if (!reads || edits.length === 0) return null;

  const undo = async (edit: PlanEditView) => {
    if (undoing) return;
    setUndoing(edit.id);
    setErrors((current) => ({ ...current, [edit.id]: '' }));
    try {
      const kept = await undoEdit(program.id, edit.id);
      if (!alive.current) return;
      announceUndone(kept);
    } catch (error) {
      if (!alive.current) return;
      const failure = isApiError(error) ? planEditUndoFailure(error) : 'other';
      if (failure !== 'alreadyUndone') {
        const key = failure === 'offline' ? 'health.offline.action_hint' : (planEditFailureCopyKey(failure) ?? 'common.error_body');
        setErrors((current) => ({ ...current, [edit.id]: key }));
      }
    } finally {
      if (alive.current) setUndoing(null);
    }
    void load();
  };

  return (
    <View style={styles.section} testID="programOverview.changes">
      <LPText size={13} weight="semibold" color={colors.paper2} style={styles.title} accessibilityRole="header">
        {t('coach.planEdit.changesList')}
      </LPText>
      <Card style={styles.card}>
        {edits.map((edit, index) => {
          const canUndo = edit.status === 'applied' && isUndoable(edit);
          const error = errors[edit.id];
          return (
            <View key={edit.id} style={[styles.row, index > 0 && styles.divider]} testID={`programOverview.change.${edit.id}`}>
              <View style={styles.texts}>
                <LPText size={14} color={colors.paper}>
                  {edit.summary}
                </LPText>
                {edit.appliedAt ? (
                  <LPText size={12} color={colors.paper3}>
                    {shortDay(edit.appliedAt, language)}
                  </LPText>
                ) : null}
                {error ? (
                  <LPText size={12} color={colors.destructive} testID={`programOverview.change.${edit.id}.error`}>
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
                  disabled={undoing !== null}
                  accessibilityRole="button"
                  accessibilityLabel={t('coach.planEdit.undo')}
                  accessibilityState={{ disabled: undoing !== null, busy: undoing === edit.id }}
                  style={({ pressed }) => [styles.undo, pressed && styles.pressed]}
                  testID={`programOverview.change.${edit.id}.undo`}
                >
                  {undoing === edit.id ? <ActivityIndicator size="small" color={colors.rust} /> : null}
                  <LPText size={13} weight="semibold" color={colors.accentText}>
                    {t('coach.planEdit.undo')}
                  </LPText>
                </Pressable>
              ) : null}
            </View>
          );
        })}
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: 8 },
  title: { paddingHorizontal: 24 },
  card: { marginHorizontal: 20 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 12, minHeight: 56 },
  divider: { borderTopWidth: hairline, borderTopColor: colors.line },
  texts: { flex: 1, gap: 3 },
  undo: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 6 },
  pressed: { opacity: 0.7 },
});
