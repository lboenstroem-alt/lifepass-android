/**
 * The session's storage: Keystore-encrypted, large sessions intact, and the
 * first Android build's plain copy moved and deleted.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';

import { secureStoreState } from '@test/mocks/expoSecureStore';

import {
  CHUNK_BYTES,
  createSecureSessionStorage,
  readStoredSession,
  splitUtf8,
} from '../secureSessionStorage';

const KEY = 'sb-katielfjlyidadfftsnz-auth-token';

/** A session the size supabase-js writes once a user has metadata and identities. */
function bigSession(): string {
  return JSON.stringify({
    access_token: `eyJ.${'a'.repeat(1200)}.sig`,
    refresh_token: 'refresh-1',
    expires_at: 1_790_000_000,
    token_type: 'bearer',
    user: {
      id: '8c2c1b36-2a7e-4b1f-9e0e-2f1c4f0a9c11',
      email: 'member@example.com',
      user_metadata: { full_name: 'Þórunn Ásgeirsdóttir', locale: 'is', notes: 'ð'.repeat(900) },
      identities: [{ provider: 'email', identity_data: { sub: 'x'.repeat(600) } }],
    },
  });
}

describe('splitting', () => {
  it('never cuts a character, and no piece is over the limit', () => {
    const text = `${'a'.repeat(5)}ð😀${'þ'.repeat(10)}`;
    const pieces = splitUtf8(text, 8);
    expect(pieces.join('')).toBe(text);
    for (const piece of pieces) expect(new TextEncoder().encode(piece).length).toBeLessThanOrEqual(8);
  });

  it('an empty value is one empty piece', () => {
    expect(splitUtf8('')).toEqual(['']);
  });
});

describe('the storage', () => {
  it('round-trips a session well over 2 KB, every piece under the SecureStore limit', async () => {
    const storage = createSecureSessionStorage();
    const value = bigSession();
    expect(new TextEncoder().encode(value).length).toBeGreaterThan(3000);
    await storage.setItem(KEY, value);
    expect(await storage.getItem(KEY)).toBe(value);
    const keys = secureStoreState.keys();
    expect(keys.length).toBeGreaterThan(2);
    for (const key of keys) {
      expect(new TextEncoder().encode(secureStoreState.peek(key)!).length).toBeLessThanOrEqual(CHUNK_BYTES);
    }
    expect(await AsyncStorage.getItem(KEY)).toBeNull();
  });

  it('a small value is stored as it is', async () => {
    const storage = createSecureSessionStorage();
    await storage.setItem(`${KEY}-code-verifier`, 'abc');
    expect(secureStoreState.peek(`${KEY}-code-verifier`)).toBe('abc');
    expect(await storage.getItem(`${KEY}-code-verifier`)).toBe('abc');
  });

  it('a new value replaces the old one and leaves no old pieces behind', async () => {
    const storage = createSecureSessionStorage();
    await storage.setItem(KEY, bigSession());
    const before = secureStoreState.keys();
    const next = bigSession().replace('refresh-1', 'refresh-2');
    await storage.setItem(KEY, next);
    expect(await storage.getItem(KEY)).toBe(next);
    expect(secureStoreState.keys()).toHaveLength(before.length);
    await storage.setItem(KEY, '{"small":true}');
    expect(secureStoreState.keys()).toEqual([KEY]);
  });

  it('remove deletes every piece', async () => {
    const storage = createSecureSessionStorage();
    await storage.setItem(KEY, bigSession());
    await storage.removeItem(KEY);
    expect(secureStoreState.keys()).toEqual([]);
    expect(await storage.getItem(KEY)).toBeNull();
  });

  it('a write cut short leaves the old value readable, never a mix', async () => {
    const storage = createSecureSessionStorage();
    const old = bigSession();
    await storage.setItem(KEY, old);
    const setItem = jest.spyOn(SecureStore, 'setItemAsync');
    // The process "dies" after the first new piece: the head still points at the old ones.
    setItem.mockImplementationOnce(jest.requireActual('expo-secure-store').setItemAsync);
    setItem.mockRejectedValueOnce(new Error('killed'));
    await storage.setItem(KEY, bigSession().replace('refresh-1', 'refresh-9'));
    setItem.mockRestore();
    // The refused write is kept in memory for this run only...
    expect(await storage.getItem(KEY)).toContain('refresh-9');
    // ...and a relaunch reads the old value, whole.
    expect(await createSecureSessionStorage().getItem(KEY)).toBe(old);
  });

  it('a missing piece means no value rather than a broken one', async () => {
    const storage = createSecureSessionStorage();
    await storage.setItem(KEY, bigSession());
    const piece = secureStoreState.keys().find((key) => key !== KEY)!;
    await SecureStore.deleteItemAsync(piece);
    expect(await createSecureSessionStorage().getItem(KEY)).toBeNull();
  });

  it("moves the first build's plain session into the Keystore and deletes the plain copy", async () => {
    const value = bigSession();
    await AsyncStorage.setItem(KEY, value);
    const storage = createSecureSessionStorage();
    expect(await storage.getItem(KEY)).toBe(value);
    expect(await AsyncStorage.getItem(KEY)).toBeNull();
    expect(await createSecureSessionStorage().getItem(KEY)).toBe(value);
  });

  it('a Keystore that cannot be read answers no session and deletes nothing', async () => {
    const storage = createSecureSessionStorage();
    await storage.setItem(KEY, bigSession());
    const read = jest.spyOn(SecureStore, 'getItemAsync').mockRejectedValue(new Error('keystore'));
    expect(await storage.getItem(KEY)).toBeNull();
    read.mockRestore();
    expect(await storage.getItem(KEY)).toBe(bigSession());
  });
});

describe('the stored session, read without the SDK', () => {
  it('reads the user id and tokens of an expired session', async () => {
    const storage = createSecureSessionStorage();
    await storage.setItem(KEY, bigSession());
    const session = await readStoredSession(KEY, storage);
    expect(session?.user.id).toBe('8c2c1b36-2a7e-4b1f-9e0e-2f1c4f0a9c11');
    expect(session?.refresh_token).toBe('refresh-1');
  });

  it('nothing stored, or something that is not a session, is null', async () => {
    const storage = createSecureSessionStorage();
    expect(await readStoredSession(KEY, storage)).toBeNull();
    await storage.setItem(KEY, 'not json');
    expect(await readStoredSession(KEY, storage)).toBeNull();
    await storage.setItem(KEY, JSON.stringify({ access_token: 'a' }));
    expect(await readStoredSession(KEY, storage)).toBeNull();
  });
});
