/**
 * Start and Discard with their questions (iOS ProgramProposalCard's three
 * confirmation dialogs and `adopt` / `discard`), for the proposal card and
 * the programme overview in proposal mode.
 *
 *   const flow = useProposalFlow({ program, entry: 'coach', reminders, onOutcome });
 *   flow.start(startDecision(program, hasLiveProgram));   // the card's Start
 *   flow.askDiscard();
 *
 * - "Replace your current plan?" (a live plan known, or the server's 409
 *   `program_already_active`) and "Switch to the updated plan?" (EVERY
 *   revision) both post again with `replaceActive: true`.
 * - "Discard this plan?" posts the discard.
 * - A refusal that is the card's own business leaves its line
 *   (`errorKey`); a plan changed elsewhere is an outcome (`changed`).
 *
 * The dialogs are iOS `confirmationDialog`s with a visible title: the kit's
 * action sheet (showDialog, presentation 'actionSheet').
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import { showDialog } from '../../../components/ui';
import type { ProgramSummary } from '../../../health';
import { useT } from '../../../i18n';
import { shortDay } from '../../../i18n/format';

import { adoptProposal, discardProposal, type ReminderPreferences } from './proposalActions';
import { DEFAULT_REMINDER_MINUTES, failureErrorKey, type ProposalOutcome, type StartDecision } from './proposalRules';

export interface ProposalFlowOptions {
  readonly program: ProgramSummary | null;
  /** Where Start was tapped (`program_adopted.entry`). */
  readonly entry: 'coach' | 'plan';
  /** The reminder choice Start sends: the card's toggle, or for the weeks screen the card's or the stored one. */
  readonly reminders: () => ReminderPreferences | Promise<ReminderPreferences>;
  readonly onOutcome: (outcome: ProposalOutcome) => void;
}

export interface ProposalFlow {
  /** A Start or a Discard is in flight: every button of the card waits. */
  readonly isBusy: boolean;
  /** The card's inline line (stale revision, offline, generic), or null. */
  readonly errorKey: string | null;
  start(decision: StartDecision): void;
  askDiscard(): void;
}

/** When the updated plan would start if the member switched now ("" when the server did not say). */
export function switchDate(program: Pick<ProgramSummary, 'startsOnIfAdoptedNow'>, lang: Parameters<typeof shortDay>[1]): string {
  return program.startsOnIfAdoptedNow ? shortDay(program.startsOnIfAdoptedNow, lang) : '';
}

export function useProposalFlow(options: ProposalFlowOptions): ProposalFlow {
  const { t, language } = useT();
  const [isBusy, setBusy] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  // Synchronous guard: a double tap lands before the state re-renders.
  const busy = useRef(false);
  const alive = useRef(true);
  const latest = useRef(options);
  latest.current = options;
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const finish = useCallback(() => {
    busy.current = false;
    if (alive.current) setBusy(false);
  }, []);

  const begin = useCallback((): boolean => {
    if (busy.current) return false;
    busy.current = true;
    setBusy(true);
    setErrorKey(null);
    return true;
  }, []);

  const askReplace = useCallback(() => {
    showDialog({
      presentation: 'actionSheet',
      titleVisibility: 'visible',
      title: t('program.replace.title'),
      message: t('program.replace.body'),
      buttons: [
        { label: t('program.replace.confirm'), role: 'destructive', onPress: () => void adoptRef.current(true) },
        { label: t('common.cancel'), role: 'cancel' },
      ],
      testID: 'program.replaceDialog',
    });
  }, [t]);

  const adopt = useCallback(
    async (replaceActive: boolean) => {
      const { program, entry, reminders, onOutcome } = latest.current;
      if (!program || !begin()) return;
      let reminderChoice: ReminderPreferences;
      try {
        reminderChoice = await reminders();
      } catch {
        reminderChoice = { remindersOn: true, minutes: DEFAULT_REMINDER_MINUTES };
      }
      const result = await adoptProposal({ program, replaceActive, reminders: reminderChoice, entry });
      finish();
      if (result.kind === 'started') {
        onOutcome('started');
        return;
      }
      if (result.failure === 'alreadyActive') {
        askReplace();
        return;
      }
      if (result.failure === 'changed') {
        onOutcome('changed');
        return;
      }
      if (alive.current) setErrorKey(failureErrorKey(result.failure));
    },
    [askReplace, begin, finish],
  );
  // The replace question's button posts through the newest `adopt`.
  const adoptRef = useRef(adopt);
  adoptRef.current = adopt;

  const discard = useCallback(async () => {
    const { program, onOutcome } = latest.current;
    if (!program || !begin()) return;
    const result = await discardProposal(program);
    finish();
    if (result.kind === 'discarded') {
      onOutcome('discarded');
      return;
    }
    if (result.failure === 'changed') {
      onOutcome('changed');
      return;
    }
    if (alive.current) setErrorKey(failureErrorKey(result.failure));
  }, [begin, finish]);

  const start = useCallback(
    (decision: StartDecision) => {
      const program = latest.current.program;
      if (!program || busy.current) return;
      if (decision === 'adopt') {
        void adopt(false);
        return;
      }
      if (decision === 'replace') {
        askReplace();
        return;
      }
      // A REVISION ALWAYS ASKS, naming the day the updated plan would start.
      showDialog({
        presentation: 'actionSheet',
        titleVisibility: 'visible',
        title: t('program.revision.switch.title'),
        message: t('program.revision.switch.body', { date: switchDate(program, language) }),
        buttons: [
          { label: t('program.revision.switch.confirm'), role: 'destructive', onPress: () => void adoptRef.current(true) },
          { label: t('common.cancel'), role: 'cancel' },
        ],
        testID: 'program.switchDialog',
      });
    },
    [adopt, askReplace, language, t],
  );

  const askDiscard = useCallback(() => {
    if (busy.current) return;
    showDialog({
      presentation: 'actionSheet',
      titleVisibility: 'visible',
      title: t('program.discard.title'),
      message: t('program.discard.body'),
      buttons: [
        { label: t('program.discard.confirm'), role: 'destructive', onPress: () => void discard() },
        { label: t('common.cancel'), role: 'cancel' },
      ],
      testID: 'program.discardDialog',
    });
  }, [discard, t]);

  return { isBusy, errorKey, start, askDiscard };
}
