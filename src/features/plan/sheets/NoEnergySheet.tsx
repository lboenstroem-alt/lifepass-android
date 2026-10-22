/**
 * "No energy today?" (iOS `NoEnergySheet`, Views/Health/NoEnergySheet.swift,
 * `ios-ux.md` 8): one humane tap when the day is not happening.
 *
 * THE POINT OF THIS SHEET IS THAT NOTHING MOVES BY ITSELF. A plan that
 * silently reshuffles around a missed day teaches a member that the plan is
 * not real; a plan that simply marks them down teaches them to stop opening
 * it. So the member chooses, the choices are two, and both keep the plan
 * going: move it to tomorrow (a swap when tomorrow holds a session), or skip
 * it with a reason.
 *
 * Which choices appear is the server's answer (../noEnergy/rules.ts). A move
 * refused while the sheet is open (`session_move_limit`,
 * `session_move_past_week`) keeps the sheet up, takes the move away and says
 * why; `session_action_not_allowed` means the card is stale, and the sheet
 * closes while Plan reads the day again. Offline, every choice is off.
 *
 * Opened from a missed row's "Skip it" it starts on the reasons and offers no
 * move. THE SKIP REASON NEVER GOES TO ANALYTICS: why a member skipped is a
 * health signal.
 *
 * Controlled (plan 3.0.3): the Today card shows it and closes it. Locked
 * while a move or skip is in flight.
 */
import { Ionicons } from '@expo/vector-icons';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View, type Text } from 'react-native';

import { newIdempotencyKey } from '../../../api';
import { LPText, PrimaryButton, Sheet } from '../../../components/ui';
import { postSessionAction, SessionAction, useHealthStore, type SessionActionBody, type SkipReason } from '../../../health';
import { useT } from '../../../i18n';
import { track } from '../../../lib/analytics';
import { colors, hairline, radius } from '../../../theme';
import ChoiceChip from '../logWorkout/ChoiceChip';
import {
  blockedLineKey,
  moveCopy,
  noEnergyFailure,
  offersMove,
  offersSkip,
  SKIP_REASON_CHOICES,
  type MoveRefusal,
  type NoEnergyMode,
} from '../noEnergy/rules';

import type { PlanSessionRef } from './types';

export interface NoEnergySheetProps {
  readonly visible: boolean;
  readonly onClose: () => void;
  readonly session: PlanSessionRef;
  /** Tomorrow's session title when tomorrow holds one: the move becomes a swap. */
  readonly tomorrowTitle?: string | null;
  /** Opened from a missed row: straight to the skip reasons. */
  readonly startsInSkipMode?: boolean;
  /** The server's answer to the move or skip: a decoded `SessionActionResponse` from the health API. */
  readonly onResult: (result: unknown) => void;
  /** The plan changed elsewhere (409): Plan re-reads. */
  readonly onChangedElsewhere: () => void;
}

type BusyKey = 'move' | 'skip-confirm';

/** The 2 × 2 grid of reasons: Time and Tired, then Sore and Other. */
const REASON_ROWS: readonly (readonly SkipReason[])[] = [SKIP_REASON_CHOICES.slice(0, 2), SKIP_REASON_CHOICES.slice(2, 4)];

export default function NoEnergySheet({
  visible,
  onClose,
  session,
  tomorrowTitle = null,
  startsInSkipMode = false,
  onResult,
  onChangedElsewhere,
}: NoEnergySheetProps) {
  const { t } = useT();
  const titleRef = useRef<Text>(null);
  const [mode, setMode] = useState<NoEnergyMode>(startsInSkipMode ? 'skipReason' : 'choose');
  const [reason, setReason] = useState<SkipReason | null>(null);
  const [busy, setBusyState] = useState<BusyKey | null>(null);
  // Read at once by a second tap in the same frame, before React renders.
  const busyRef = useRef<BusyKey | null>(null);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [moveRefused, setMoveRefused] = useState<MoveRefusal | null>(null);
  const isOffline = useHealthStore((state) => state.lastError?.isOffline === true);

  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const setBusy = (key: BusyKey | null) => {
    busyRef.current = key;
    if (alive.current) setBusyState(key);
  };

  const context = { moveRefused, startsInSkipMode };
  const canMove = offersMove(session, context);
  const canSkip = offersSkip(session);
  const blocked = blockedLineKey(session, context);
  const move = moveCopy(tomorrowTitle);

  const post = async (body: SessionActionBody, busyKey: BusyKey, onSuccess: () => void) => {
    if (busyRef.current !== null) return;
    setBusy(busyKey);
    setErrorKey(null);
    try {
      // A fresh key per tap: each is its own action (iOS mints one per post).
      const response = await postSessionAction(session.id, body, newIdempotencyKey());
      onSuccess();
      onResult(response);
      onClose();
    } catch (error) {
      const failure = noEnergyFailure(error);
      switch (failure.kind) {
        case 'cancelled':
          break;
        case 'moveRefused':
          // The sheet stays open and turns into the skip it can still offer,
          // rather than closing on a refusal.
          track('workout_move_refused', { reason: failure.reason });
          if (alive.current) {
            setMoveRefused(failure.reason);
            setMode('choose');
          }
          break;
        case 'changed':
          onChangedElsewhere();
          onClose();
          break;
        case 'offline':
          if (alive.current) setErrorKey('health.offline.action_hint');
          break;
        case 'other':
          if (failure.api) useHealthStore.getState().handle(error, { foreground: true });
          if (alive.current) setErrorKey('common.error_body');
          break;
      }
    } finally {
      setBusy(null);
    }
  };

  const moveIt = () =>
    void post(SessionAction.move, 'move', () => track('workout_moved', { kind: tomorrowTitle === null ? 'move' : 'swap' }));

  const skipIt = () => {
    if (reason === null) return;
    // No reason param: why a member skipped is a health signal, and the
    // analytics allow-list keeps it out.
    void post(SessionAction.skip(reason), 'skip-confirm', () => track('workout_skipped'));
  };

  const errorLine = errorKey ? (
    <LPText size={13} color={colors.destructive} accessibilityLiveRegion="polite" testID="noenergy.error">
      {t(errorKey)}
    </LPText>
  ) : null;

  return (
    <Sheet visible={visible} onClose={onClose} busy={busy !== null} initialFocusRef={titleRef} testID="noenergy.sheet">
      {mode === 'choose' ? (
        <View style={styles.page} testID="noenergy.choose">
          <View style={styles.header}>
            <LPText ref={titleRef} serif size={24} color={colors.paper} accessibilityRole="header">
              {t('noenergy.title')}
            </LPText>
            <LPText size={14} color={colors.paper2}>
              {t('noenergy.body')}
            </LPText>
          </View>

          {blocked ? (
            <LPText size={13} color={colors.paper2} testID="noenergy.blocked">
              {t(blocked)}
            </LPText>
          ) : null}

          {canMove ? (
            <OptionCard
              icon="arrow-redo-outline"
              title={t(move.titleKey, move.params)}
              subtitle={t(move.subtitleKey)}
              busy={busy === 'move'}
              disabled={busy !== null || isOffline}
              dimmed={isOffline}
              onPress={moveIt}
              testID="noenergy.move"
            />
          ) : null}

          {canSkip ? (
            <OptionCard
              icon="play-skip-forward-outline"
              title={t('noenergy.skip')}
              subtitle={t('noenergy.skip_sub')}
              busy={false}
              disabled={busy !== null || isOffline}
              dimmed={isOffline}
              onPress={() => setMode('skipReason')}
              testID="noenergy.skip"
            />
          ) : null}

          {errorLine}

          {isOffline ? (
            <LPText size={12} color={colors.paper3} testID="noenergy.offline">
              {t('health.offline.action_hint')}
            </LPText>
          ) : null}
        </View>
      ) : (
        <View style={styles.page} testID="noenergy.reasons">
          <LPText ref={titleRef} serif size={24} color={colors.paper} accessibilityRole="header">
            {t('noenergy.skip_title')}
          </LPText>

          <View style={styles.grid}>
            {REASON_ROWS.map((row) => (
              <View key={row.join('-')} style={styles.gridRow}>
                {row.map((option) => (
                  <ChoiceChip
                    key={option}
                    title={t(`noenergy.reason.${option}`)}
                    selected={reason === option}
                    onPress={() => setReason(option)}
                    style={styles.reason}
                    testID={`noenergy.reason.${option}`}
                  />
                ))}
              </View>
            ))}
          </View>

          {errorLine}

          <PrimaryButton
            title={t('noenergy.skip_confirm')}
            onPress={skipIt}
            disabled={reason === null || isOffline}
            loading={busy === 'skip-confirm'}
            testID="noenergy.skipConfirm"
          />

          {!startsInSkipMode ? (
            <Pressable
              onPress={() => setMode('choose')}
              accessibilityRole="button"
              accessibilityLabel={t('common.back')}
              style={({ pressed }) => [styles.back, pressed && styles.pressed]}
              testID="noenergy.back"
            >
              <LPText size={13} weight="semibold" color={colors.paper2}>
                {t('common.back')}
              </LPText>
            </Pressable>
          ) : null}
        </View>
      )}
    </Sheet>
  );
}

/** A choice of the first step: an icon, a title and a line under it, a spinner while it posts. */
function OptionCard({
  icon,
  title,
  subtitle,
  busy,
  disabled,
  dimmed,
  onPress,
  testID,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  subtitle: string;
  busy: boolean;
  disabled: boolean;
  dimmed: boolean;
  onPress: () => void;
  testID: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityHint={subtitle}
      accessibilityState={{ disabled, busy }}
      style={({ pressed }) => [styles.option, dimmed && styles.dimmed, pressed && !disabled && styles.pressed]}
      testID={testID}
    >
      <View style={styles.optionIcon}>
        <Ionicons name={icon} size={20} color={colors.rust} />
      </View>
      <View style={styles.optionTexts}>
        <LPText size={15} weight="semibold" color={colors.paper}>
          {title}
        </LPText>
        <LPText size={13} color={colors.paper2}>
          {subtitle}
        </LPText>
      </View>
      {busy ? <ActivityIndicator size="small" color={colors.paper2} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  page: { gap: 16, paddingTop: 8, paddingBottom: 24 },
  header: { gap: 8 },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    minHeight: 64,
    borderRadius: radius.card,
    backgroundColor: colors.ink2,
    borderWidth: hairline,
    borderColor: colors.line,
  },
  optionIcon: { width: 26, height: 26, alignItems: 'center', justifyContent: 'center' },
  optionTexts: { flex: 1, gap: 3 },
  grid: { gap: 10 },
  gridRow: { flexDirection: 'row', gap: 10 },
  reason: { flex: 1, minHeight: 48, paddingHorizontal: 8 },
  back: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' },
  dimmed: { opacity: 0.5 },
  pressed: { opacity: 0.85 },
});
