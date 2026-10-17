/**
 * Every file of health data this app keeps on the phone: the Android port of
 * iOS Services/HealthLocalStore.swift. One place, one set of rules, because
 * the rules are not negotiable:
 *
 * - `<app files>/health/<profileId>/`: the app's internal storage
 *   (`Paths.document`), which no other app can read, never shared storage.
 * - NEVER BACKED UP. The app turns Android backup off (`allowBackup: false`,
 *   config F0), so nothing here reaches Google Drive or a device-to-device
 *   transfer; iOS excludes the folder from iCloud for the same reason. A
 *   restored phone starts from the server, which is the record anyway.
 * - Scoped by profile id, so signing into a second account on one handset
 *   can never show the first account's day.
 *
 * Android has no locked-phone file protection to mirror (an app never runs
 * before the first unlock unless it opts in, and LifePass does not), but a
 * file can still fail to read (a storage error). A read therefore tells
 * "absent" from "could not read" (`readOutcome`), as iOS does: an outbox that
 * took an unreadable file for an empty queue would write its next item over
 * the real one (`mergeOutbox`).
 *
 * Every disk touch runs on ONE serial queue, in the order it was asked for,
 * so a wipe can never interleave with a cache write and a read sees every
 * write queued before it.
 */
import { Directory, File, Paths } from 'expo-file-system';

import { encodeBody } from '../api/wire';

/** The files a profile folder holds. One name per file so no caller invents one. */
export const HEALTH_FILES = {
  /** The last successful Today read for today. */
  today: 'today.json',
  /** Unsent workout Save calls. */
  workoutOutbox: 'outbox.json',
  /** Unsent meal writes. */
  mealOutbox: 'meal-outbox.json',
  /** Items picked in the capture page and not yet saved. */
  tray: 'tray.json',
  /** Presets and my foods. */
  foods: 'foods.json',
  /** A workout in progress. */
  runner: 'runner.json',
  /** Wearable per-day change hashes (Health Connect is not built; kept so a wipe names every file). */
  wearableHashes: 'ah-hashes.json',
} as const;

export type HealthFile = keyof typeof HEALTH_FILES;

/** The prefix of a data export's scratch file in the cache folder. */
export const EXPORT_FILE_PREFIX = 'lifepass-export-';

/** What a read found, when "absent" and "could not read" must not be confused. */
export type ReadOutcome<T> =
  | { readonly kind: 'value'; readonly value: T }
  /** No file, or one whose shape no longer decodes (deleted, so it cannot fail again on every launch). */
  | { readonly kind: 'absent' }
  /** The file is there and could not be read. */
  | { readonly kind: 'unreadable' };

// ---------------------------------------------------------------------------
// The queue

let queue: Promise<unknown> = Promise.resolve();

/** Runs `work` after everything queued before it; its own failure never blocks the queue. */
function enqueue<T>(work: () => T | Promise<T>): Promise<T> {
  const run = queue.then(work, work);
  queue = run.catch(() => undefined);
  return run;
}

/** Resolves once everything queued so far has run (tests, and a caller that must see the disk settled). */
export function settled(): Promise<void> {
  return enqueue(() => undefined);
}

// ---------------------------------------------------------------------------
// Paths

/**
 * A profile id as a folder name: profile ids are lower-case UUIDs, and
 * anything else (a path separator above all) is refused rather than joined
 * into a path.
 */
function safeProfileId(profileId: string): string | null {
  const id = profileId.trim().toLowerCase();
  return /^[0-9a-z-]{1,64}$/.test(id) ? id : null;
}

function healthRoot(): Directory {
  return new Directory(Paths.document, 'health');
}

function folder(profileId: string): Directory | null {
  const id = safeProfileId(profileId);
  return id ? new Directory(healthRoot(), id) : null;
}

function fileFor(file: HealthFile, profileId: string): File | null {
  const dir = folder(profileId);
  return dir ? new File(dir, HEALTH_FILES[file]) : null;
}

/** The file's URI (tests and diagnostics); null for an id that is not one. */
export function healthFileUri(file: HealthFile, profileId: string): string | null {
  return fileFor(file, profileId)?.uri ?? null;
}

// ---------------------------------------------------------------------------
// Reading

function readOutcomeNow<T>(file: HealthFile, profileId: string, decode: (json: unknown) => T): Promise<ReadOutcome<T>> | ReadOutcome<T> {
  const handle = fileFor(file, profileId);
  if (!handle || !handle.exists) return { kind: 'absent' };
  return handle.text().then(
    (text) => {
      try {
        return { kind: 'value', value: decode(JSON.parse(text)) } as const;
      } catch {
        // A cache that no longer decodes is simply not a cache.
        try {
          handle.delete();
        } catch {
          // Gone already.
        }
        return { kind: 'absent' } as const;
      }
    },
    () => ({ kind: 'unreadable' }) as const,
  );
}

/** What the file holds, queued behind every write asked for before it. */
export function readOutcome<T>(file: HealthFile, profileId: string, decode: (json: unknown) => T): Promise<ReadOutcome<T>> {
  return enqueue(() => readOutcomeNow(file, profileId, decode));
}

/** The decoded file, or null when it is absent, unreadable or stale in shape. */
export async function read<T>(file: HealthFile, profileId: string, decode: (json: unknown) => T): Promise<T | null> {
  const outcome = await readOutcome(file, profileId, decode);
  return outcome.kind === 'value' ? outcome.value : null;
}

// ---------------------------------------------------------------------------
// Writing

function writeNow(text: string, file: HealthFile, profileId: string): boolean {
  const dir = folder(profileId);
  const target = fileFor(file, profileId);
  if (!dir || !target) return false;
  try {
    dir.create({ intermediates: true, idempotent: true });
    // Written beside the target, then moved over it: a process killed mid-write
    // leaves the old file (or none), never half of one.
    const scratch = new File(dir, `${HEALTH_FILES[file]}.tmp`);
    if (scratch.exists) scratch.delete();
    scratch.write(text);
    if (target.exists) target.delete();
    scratch.move(target);
    return true;
  } catch {
    return false;
  }
}

/**
 * Queues a write of `value` as JSON (dates as ISO instants). Resolves to
 * whether it was written; callers that only cache need not wait.
 */
export function write(value: unknown, file: HealthFile, profileId: string): Promise<boolean> {
  const text = typeof value === 'string' ? value : encodeBody(value);
  return enqueue(() => writeNow(text, file, profileId));
}

/** Queues the removal of one file. */
export function remove(file: HealthFile, profileId: string): Promise<void> {
  return enqueue(() => {
    const handle = fileFor(file, profileId);
    try {
      if (handle?.exists) handle.delete();
    } catch {
      // Nothing to remove.
    }
  });
}

/**
 * Queues the removal of everything this profile ever wrote. The local wipe
 * runs it on a sign-out, a withdrawal here or elsewhere, a verified minor and
 * an account deletion.
 */
export function deleteProfileFolder(profileId: string): Promise<void> {
  return enqueue(() => {
    const dir = folder(profileId);
    try {
      if (dir?.exists) dir.delete();
    } catch {
      // Nothing to remove.
    }
  });
}

/** Whether this profile has written anything at all (the reconcile check). */
export function profileFolderExists(profileId: string): Promise<boolean> {
  return enqueue(() => folder(profileId)?.exists === true);
}

/** When a file was last written, for the "saved at" line on a cached screen. */
export function modifiedAt(file: HealthFile, profileId: string): Promise<Date | null> {
  return enqueue(() => {
    const handle = fileFor(file, profileId);
    if (!handle?.exists) return null;
    const time = handle.modificationTime;
    return typeof time === 'number' && Number.isFinite(time) ? new Date(time) : null;
  });
}

// ---------------------------------------------------------------------------
// The export scratch file

/** Where the data export of `day` is written before it is shared. */
export function exportFile(day: string): File {
  return new File(Paths.cache, `${EXPORT_FILE_PREFIX}${day}.json`);
}

/**
 * Writes the export for the share sheet and answers its URI. The caller
 * deletes it when the sheet closes; the wipe removes any left behind.
 */
export function writeExport(text: string, day: string): Promise<string> {
  return enqueue(() => {
    const handle = exportFile(day);
    if (handle.exists) handle.delete();
    handle.write(text);
    return handle.uri;
  });
}

/** Removes every export scratch file. */
export function clearExports(): Promise<void> {
  return enqueue(() => {
    try {
      const cache = new Directory(Paths.cache);
      if (!cache.exists) return;
      for (const entry of cache.list()) {
        if (entry instanceof File && entry.name.startsWith(EXPORT_FILE_PREFIX)) {
          try {
            entry.delete();
          } catch {
            // Already gone.
          }
        }
      }
    } catch {
      // No cache folder to look in.
    }
  });
}

// ---------------------------------------------------------------------------
// The outbox adoption rule

/**
 * How an outbox takes a read of its file as its queue. An unreadable read
 * leaves the queue UNADOPTED: nothing is written over the file, the read runs
 * again later, and anything queued meanwhile is merged in rather than lost.
 * Before this rule (iOS 2.5.0) a failed read became `[]`, the queue was
 * marked loaded, and the next Save wrote a one-item queue over the file.
 *
 * The disk queue comes first; an item queued meanwhile that is already on
 * disk (the same id) is not doubled.
 */
export function mergeOutbox<Item extends { readonly id: string }>(
  outcome: ReadOutcome<readonly Item[]>,
  queuedMeanwhile: readonly Item[],
): { items: Item[]; adopted: boolean } {
  switch (outcome.kind) {
    case 'unreadable':
      return { items: [...queuedMeanwhile], adopted: false };
    case 'absent':
      return { items: [...queuedMeanwhile], adopted: true };
    case 'value': {
      const onDisk = outcome.value;
      const fresh = queuedMeanwhile.filter((item) => !onDisk.some((existing) => existing.id === item.id));
      return { items: [...onDisk, ...fresh], adopted: true };
    }
  }
}
