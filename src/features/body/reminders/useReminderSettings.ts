/**
 * The Reminders section's state (iOS BodyAndGoalsView's five reminder
 * `@State`s, `notificationsDenied`, `loadReminderPreferences`,
 * `writeReminderPreferences`, `refreshNotificationAuthorisation` and
 * `requestAuthorisationIfNeeded`).
 *
 * - The rows show what is stored, and the default for anything that is not.
 * - A member's change writes all five choices, reports it and asks for a
 *   resync (./preferences.ts). Reading them back NEVER writes: the write
 *   hangs off the change, not off the value.
 * - Turning a reminder ON asks for the permission, but only if it was never
 *   asked: a member who already said no is shown "Notifications are off" and
 *   Open Settings instead of a second dialog.
 * - Every read of the permission records it for Plan's adopted banner.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import { permissionStatus, requestIfUndetermined } from '../../../notifications';

import {
  DEFAULT_REMINDER_PREFERENCES,
  loadReminderPreferences,
  requestReminderSync,
  writeNotificationsDenied,
  writeReminderPreferences,
  type ReminderChangeKind,
  type ReminderPreferences,
} from './preferences';

export interface ReminderSettings {
  readonly preferences: ReminderPreferences;
  /** The phone refuses notifications: every row is off and Open Settings shows. */
  readonly notificationsDenied: boolean;
  /** Read the stored choices again (on appear, and after a wipe deleted them). */
  reload(): Promise<void>;
  /** Read the permission again (on appear, and on return from the system settings). */
  refreshPermission(): Promise<void>;
  /** A member's change. `turnedOn`: a reminder was switched on, so ask for the permission if never asked. */
  change(patch: Partial<ReminderPreferences>, kind: ReminderChangeKind, turnedOn?: boolean): void;
}

export function useReminderSettings(profileId: string | null): ReminderSettings {
  const [preferences, setPreferences] = useState<ReminderPreferences>(DEFAULT_REMINDER_PREFERENCES);
  const [notificationsDenied, setNotificationsDenied] = useState(false);
  const current = useRef(preferences);
  /** Moves on every member change: a read that started before one must not overwrite it. */
  const edits = useRef(0);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const reload = useCallback(async () => {
    if (!profileId) return;
    const startedAt = edits.current;
    const stored = await loadReminderPreferences(profileId);
    if (!mounted.current || edits.current !== startedAt) return;
    current.current = stored;
    setPreferences(stored);
  }, [profileId]);

  const refreshPermission = useCallback(async () => {
    const denied = (await permissionStatus()) === 'denied';
    if (mounted.current) setNotificationsDenied(denied);
    if (profileId) await writeNotificationsDenied(profileId, denied);
  }, [profileId]);

  const askIfNeeded = useCallback(async () => {
    if ((await permissionStatus()) !== 'undetermined') return;
    await requestIfUndetermined();
    await refreshPermission();
    requestReminderSync();
  }, [refreshPermission]);

  const change = useCallback(
    (patch: Partial<ReminderPreferences>, kind: ReminderChangeKind, turnedOn = false) => {
      edits.current += 1;
      const next = { ...current.current, ...patch };
      current.current = next;
      setPreferences(next);
      if (turnedOn) void askIfNeeded();
      if (profileId) void writeReminderPreferences(profileId, next, kind);
    },
    [askIfNeeded, profileId],
  );

  return { preferences, notificationsDenied, reload, refreshPermission, change };
}
