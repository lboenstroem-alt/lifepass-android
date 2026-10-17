/**
 * The installation id (iOS InstallationId): one id per install, kept in the
 * Keystore, never touched by a sign-out.
 */
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';

import { secureStoreState } from '@test/mocks/expoSecureStore';

import { registeredHookIds, runSignOutCleaners } from '../../app/signOut';
import { currentInstallationId, INSTALLATION_ID_KEY, resetInstallationIdCacheForTests } from '../installationId';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

let minted = 0;
beforeEach(() => {
  resetInstallationIdCacheForTests();
  minted = 0;
  jest.spyOn(Crypto, 'randomUUID').mockImplementation(() => {
    minted += 1;
    return `0000000${minted}-0000-4000-8000-000000000000` as `${string}-${string}-${string}-${string}-${string}`;
  });
});

it('is minted once and stays the same across calls and relaunches', async () => {
  const first = await currentInstallationId();
  expect(first).toMatch(UUID);
  expect(await currentInstallationId()).toBe(first);
  resetInstallationIdCacheForTests(); // a relaunch
  expect(await currentInstallationId()).toBe(first);
  expect(minted).toBe(1);
  expect(secureStoreState.peek(INSTALLATION_ID_KEY)).toBe(first);
});

it('concurrent first calls share one id', async () => {
  const [a, b, c] = await Promise.all([currentInstallationId(), currentInstallationId(), currentInstallationId()]);
  expect(new Set([a, b, c]).size).toBe(1);
  expect(minted).toBe(1);
});

it('survives a sign-out: no cleaner touches it', async () => {
  const id = await currentInstallationId();
  expect(registeredHookIds().signOut.some((hook) => hook.includes('installation'))).toBe(false);
  await runSignOutCleaners({ memberId: '8c2c1b36-2a7e-4b1f-9e0e-2f1c4f0a9c11' });
  resetInstallationIdCacheForTests();
  expect(await currentInstallationId()).toBe(id);
});

it('a fresh install gets a fresh id', async () => {
  const first = await currentInstallationId();
  secureStoreState.reset(); // the app's data is gone
  resetInstallationIdCacheForTests();
  expect(await currentInstallationId()).not.toBe(first);
});

it('a Keystore that refuses gives a temporary id instead of throwing, and the next call stores a real one', async () => {
  const setItem = jest.spyOn(SecureStore, 'setItemAsync').mockRejectedValueOnce(new Error('keystore locked'));
  const temporary = await currentInstallationId();
  expect(temporary).toMatch(UUID);
  expect(secureStoreState.peek(INSTALLATION_ID_KEY)).toBeNull();
  setItem.mockRestore();
  const real = await currentInstallationId();
  expect(real).not.toBe(temporary);
  expect(secureStoreState.peek(INSTALLATION_ID_KEY)).toBe(real);
});

it('a Keystore that cannot be read does not throw either', async () => {
  jest.spyOn(SecureStore, 'getItemAsync').mockRejectedValue(new Error('broken'));
  await expect(currentInstallationId()).resolves.toMatch(UUID);
});
