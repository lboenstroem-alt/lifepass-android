/**
 * Where the Supabase session lives on the phone: encrypted storage, never
 * plain AsyncStorage.
 *
 * WHY. The session holds the refresh token, which is the member's account on
 * this phone. The first Android build kept it in AsyncStorage, a plain file
 * that Auto Backup could copy off the device. iOS keeps it in the Keychain
 * (supabase-swift's default). This adapter keeps it in expo-secure-store,
 * whose values are encrypted with a key held in the Android Keystore, which
 * never leaves the device.
 *
 * LARGE VALUES. A Supabase session (two tokens plus the user object with its
 * metadata and identities) is often larger than the 2048 bytes SecureStore
 * promises per value. Supabase's "LargeSecureStore" recipe encrypts the value
 * with AES and keeps only the key in SecureStore, which needs a cipher
 * library this app does not ship. This adapter splits a large value into
 * chunks instead, each one its own SecureStore entry, so every byte of the
 * session is Keystore-encrypted:
 *
 *   sb-<ref>-auth-token            "lp-chunks:v1:<generation>:<count>"
 *   sb-<ref>-auth-token.<gen>.0    first chunk
 *   sb-<ref>-auth-token.<gen>.1    ...
 *
 * A write stores the new chunks under a new generation first and only then
 * points the head at them, and deletes the old generation last, so a write
 * cut short by the process dying leaves the old value readable, never a mix.
 * A small value is stored directly under the key.
 *
 * MIGRATION. Installs from the first Android build have their session in
 * AsyncStorage under the same key. The first read finds it there, moves it
 * into SecureStore and deletes the plain copy, so nobody is signed out by the
 * update. Every later write and removal deletes any plain copy too.
 *
 * FAILURES. A Keystore that refuses a write keeps the value in memory for
 * this run (the member stays signed in until the app is closed) rather than
 * failing the sign-in or falling back to a plain file. A read that fails
 * answers null: supabase-js then sees no session and deletes nothing.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';

/** The storage shape supabase-js accepts (`SupportedStorage`). */
export interface SessionStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

/** Bytes per SecureStore entry: under the 2048 SecureStore promises, with room to spare. */
export const CHUNK_BYTES = 1800;

const HEAD_PREFIX = 'lp-chunks:v1:';
const HEAD = /^lp-chunks:v1:([A-Za-z0-9]+):(\d+)$/;

/** Bytes a code point takes in UTF-8. */
function utf8Length(codePoint: number): number {
  if (codePoint < 0x80) return 1;
  if (codePoint < 0x800) return 2;
  if (codePoint < 0x10000) return 3;
  return 4;
}

/** `value` cut into pieces of at most `limit` UTF-8 bytes, never inside a character. */
export function splitUtf8(value: string, limit: number = CHUNK_BYTES): string[] {
  const chunks: string[] = [];
  let current = '';
  let bytes = 0;
  for (const char of value) {
    const size = utf8Length(char.codePointAt(0) ?? 0);
    if (bytes + size > limit && current) {
      chunks.push(current);
      current = '';
      bytes = 0;
    }
    current += char;
    bytes += size;
  }
  if (current || chunks.length === 0) chunks.push(current);
  return chunks;
}

function byteLength(value: string): number {
  let bytes = 0;
  for (const char of value) bytes += utf8Length(char.codePointAt(0) ?? 0);
  return bytes;
}

function parseHead(head: string | null): { generation: string; count: number } | null {
  if (!head) return null;
  const match = HEAD.exec(head);
  if (!match) return null;
  return { generation: match[1]!, count: Number(match[2]) };
}

function chunkKey(key: string, generation: string, index: number): string {
  return `${key}.${generation}.${index}`;
}

let generationCounter = 0;

/** A new generation tag (SecureStore keys allow `[A-Za-z0-9._-]`). */
function newGeneration(): string {
  generationCounter = (generationCounter + 1) % 1_679_616;
  return `${Date.now().toString(36)}${generationCounter.toString(36)}`;
}

export interface SecureSessionStorageOptions {
  /** Passed to SecureStore (it picks the Android preferences file). */
  readonly keychainService?: string;
}

/** A SecureStore-backed storage for `createClient({ auth: { storage } })`. */
export function createSecureSessionStorage(options: SecureSessionStorageOptions = {}): SessionStorage {
  const storeOptions: SecureStore.SecureStoreOptions = options.keychainService
    ? { keychainService: options.keychainService }
    : {};
  /** Values the Keystore refused to store, kept for this run only. */
  const memory = new Map<string, string>();

  // supabase-js serialises most of its storage use behind its own lock, but
  // not all of it; one queue here keeps a read from seeing half a write.
  let tail: Promise<unknown> = Promise.resolve();
  function serial<T>(work: () => Promise<T>): Promise<T> {
    const run = tail.then(work, work);
    tail = run.catch(() => undefined);
    return run;
  }

  async function readSecure(key: string): Promise<string | null> {
    const head = await SecureStore.getItemAsync(key, storeOptions);
    const chunked = parseHead(head);
    if (!chunked) return head;
    const parts: string[] = [];
    for (let i = 0; i < chunked.count; i += 1) {
      const part = await SecureStore.getItemAsync(chunkKey(key, chunked.generation, i), storeOptions);
      // A chunk that is missing means the value cannot be trusted: no value.
      if (part === null) return null;
      parts.push(part);
    }
    return parts.join('');
  }

  async function deleteChunks(key: string, chunked: { generation: string; count: number } | null): Promise<void> {
    if (!chunked) return;
    for (let i = 0; i < chunked.count; i += 1) {
      try {
        await SecureStore.deleteItemAsync(chunkKey(key, chunked.generation, i), storeOptions);
      } catch {
        // An orphaned chunk holds nothing readable without its head.
      }
    }
  }

  async function writeSecure(key: string, value: string): Promise<void> {
    let previous: { generation: string; count: number } | null = null;
    try {
      previous = parseHead(await SecureStore.getItemAsync(key, storeOptions));
    } catch {
      previous = null;
    }
    if (byteLength(value) <= CHUNK_BYTES) {
      await SecureStore.setItemAsync(key, value, storeOptions);
    } else {
      const generation = newGeneration();
      const chunks = splitUtf8(value);
      for (let i = 0; i < chunks.length; i += 1) {
        await SecureStore.setItemAsync(chunkKey(key, generation, i), chunks[i]!, storeOptions);
      }
      await SecureStore.setItemAsync(key, `${HEAD_PREFIX}${generation}:${chunks.length}`, storeOptions);
    }
    await deleteChunks(key, previous);
  }

  async function removePlainCopy(key: string): Promise<void> {
    try {
      await AsyncStorage.removeItem(key);
    } catch {
      // Nothing more to do; the next write tries again.
    }
  }

  return {
    getItem: (key) =>
      serial(async () => {
        if (memory.has(key)) return memory.get(key)!;
        let value: string | null;
        try {
          value = await readSecure(key);
        } catch {
          return null;
        }
        if (value !== null) return value;

        // The first Android build kept the session in plain AsyncStorage.
        let plain: string | null = null;
        try {
          plain = await AsyncStorage.getItem(key);
        } catch {
          plain = null;
        }
        if (plain === null) return null;
        try {
          await writeSecure(key, plain);
          if ((await readSecure(key)) === plain) await removePlainCopy(key);
        } catch {
          // Left where it was: the next read tries the move again.
        }
        return plain;
      }),

    setItem: (key, value) =>
      serial(async () => {
        try {
          await writeSecure(key, value);
          memory.delete(key);
        } catch {
          memory.set(key, value);
        }
        await removePlainCopy(key);
      }),

    removeItem: (key) =>
      serial(async () => {
        memory.delete(key);
        let previous: { generation: string; count: number } | null = null;
        try {
          previous = parseHead(await SecureStore.getItemAsync(key, storeOptions));
        } catch {
          previous = null;
        }
        try {
          await SecureStore.deleteItemAsync(key, storeOptions);
        } catch {
          // The head is what makes the chunks readable; try the chunks anyway.
        }
        await deleteChunks(key, previous);
        await removePlainCopy(key);
      }),
  };
}

/** The app's session storage (one instance, shared by the Supabase client and `readStoredSession`). */
export const secureSessionStorage: SessionStorage = createSecureSessionStorage();

/** The parts of a stored Supabase session the app reads without the SDK. */
export interface StoredSession {
  readonly access_token: string;
  readonly refresh_token: string;
  readonly expires_at?: number;
  readonly user: { readonly id: string } & Record<string, unknown>;
  readonly [key: string]: unknown;
}

/**
 * The session supabase-js stored under `key`, read straight from storage
 * WITHOUT a refresh: it may be expired, but its presence means a refresh
 * token is on the phone and the member is not signed out (iOS
 * `AuthService.storedSession`). Null when there is none or it is not a
 * session.
 */
export async function readStoredSession(
  key: string,
  storage: SessionStorage = secureSessionStorage,
): Promise<StoredSession | null> {
  let raw: string | null;
  try {
    raw = await storage.getItem(key);
  } catch {
    return null;
  }
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  // Some supabase-js versions wrap it as `{ currentSession }`.
  const candidate = (parsed as { currentSession?: unknown }).currentSession ?? parsed;
  if (typeof candidate !== 'object' || candidate === null) return null;
  const session = candidate as Partial<StoredSession>;
  if (typeof session.access_token !== 'string' || typeof session.refresh_token !== 'string') return null;
  if (typeof session.user !== 'object' || session.user === null || typeof session.user.id !== 'string') return null;
  return session as StoredSession;
}
