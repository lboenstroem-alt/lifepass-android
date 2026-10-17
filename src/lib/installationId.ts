/**
 * A stable id for THIS INSTALL of the app: the Android port of iOS
 * `InstallationId` (Services/InstallationId.swift).
 *
 * WHY. A wearable connection is per phone, not per account: the server has to
 * tell "this phone is already uploading" from "a second device wants to take
 * over". A random UUID minted on first need answers that without ever touching
 * the advertising id, ANDROID_ID, or anything else that follows a person
 * across apps. The server only ever sees a salted hash of it.
 *
 * WHERE. expo-secure-store, i.e. encrypted with a key in the Android
 * Keystore. A Keystore key never leaves the device, so even if the encrypted
 * value travelled in a backup it could not be read on another phone: the
 * twin of iOS's `AfterFirstUnlockThisDeviceOnly`. (`allowBackup` is off for
 * the app anyway.)
 *
 * IT SURVIVES SIGN-OUT ON PURPOSE, and is never registered with the sign-out
 * wipe. It identifies the phone, not the member: deleting it on sign-out
 * would make the same handset look like a new device every time. It carries
 * no personal data. Declared as "Device or other IDs" in the Play Data
 * safety form.
 */
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';

/** iOS keeps it under service `is.lifepass.installation`, account `installation-id`. */
export const INSTALLATION_ID_KEY = 'is.lifepass.installation.installation-id';

let known: string | null = null;
let pending: Promise<string> | null = null;

async function read(): Promise<string | null> {
  try {
    const value = await SecureStore.getItemAsync(INSTALLATION_ID_KEY);
    return value ? value : null;
  } catch {
    return null;
  }
}

async function readOrMint(): Promise<string> {
  const existing = await read();
  if (existing) return existing;
  const minted = Crypto.randomUUID();
  try {
    await SecureStore.setItemAsync(INSTALLATION_ID_KEY, minted);
  } catch {
    // The Keystore refused (rare: a locked profile during a background
    // wake). A temporary id is better than a crash, and the next call tries
    // to store a real one.
  }
  return (await read()) ?? minted;
}

/**
 * The id, minted on first use. Concurrent first calls share one mint, and a
 * stored value is remembered for the life of the process. Never throws: when
 * the Keystore refuses, a temporary UUID is returned (and not remembered, so
 * the next call stores the real one).
 */
export function currentInstallationId(): Promise<string> {
  if (known) return Promise.resolve(known);
  if (!pending) {
    pending = readOrMint()
      .then(async (id) => {
        // Remember it only once it is really stored.
        if ((await read()) === id) known = id;
        return id;
      })
      .finally(() => {
        pending = null;
      });
  }
  return pending;
}

/** Forgets the in-memory copy (tests; the stored value is untouched). */
export function resetInstallationIdCacheForTests(): void {
  known = null;
  pending = null;
}
