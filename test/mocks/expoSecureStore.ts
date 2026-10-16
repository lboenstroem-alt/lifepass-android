/**
 * An in-memory Android Keystore for `expo-secure-store`.
 *
 * Only the NATIVE module is replaced (`expo-secure-store/build/ExpoSecureStore`),
 * so the real JS layer still runs its checks: a key outside `[A-Za-z0-9._-]`
 * or a non-string value throws in a test exactly as it would on a phone. That
 * matters for the session adapter and the installation id, whose keys are
 * built from ids.
 *
 * `options.keychainService` namespaces a value, as on Android, where it picks
 * the SharedPreferences file: the same key under two services is two values.
 */
type Options = { keychainService?: string } | undefined;

const values = new Map<string, string>();

function slot(key: string, options: Options): string {
  return `${options?.keychainService ?? 'key_v1'}\u0000${key}`;
}

const nativeModule = {
  AFTER_FIRST_UNLOCK: 0,
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 1,
  ALWAYS: 2,
  WHEN_PASSCODE_SET_THIS_DEVICE_ONLY: 3,
  ALWAYS_THIS_DEVICE_ONLY: 4,
  WHEN_UNLOCKED: 5,
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 6,
  getValueWithKeyAsync: async (key: string, options?: Options) => values.get(slot(key, options)) ?? null,
  setValueWithKeyAsync: async (value: string, key: string, options?: Options) => {
    values.set(slot(key, options), value);
  },
  deleteValueWithKeyAsync: async (key: string, options?: Options) => {
    values.delete(slot(key, options));
  },
  getValueWithKeySync: (key: string, options?: Options) => values.get(slot(key, options)) ?? null,
  setValueWithKeySync: (value: string, key: string, options?: Options) => {
    values.set(slot(key, options), value);
  },
  canUseBiometricAuthentication: () => false,
};

export default nativeModule;

/** Test controls: what the Keystore holds, and a clean slate. */
export const secureStoreState = {
  /** Every stored key (default service only), sorted. */
  keys(): string[] {
    return [...values.keys()]
      .filter((k) => k.startsWith('key_v1\u0000'))
      .map((k) => k.slice('key_v1\u0000'.length))
      .sort();
  },
  /** The raw value under `key` in the default service, or null. */
  peek(key: string): string | null {
    return values.get(slot(key, undefined)) ?? null;
  },
  size(): number {
    return values.size;
  },
  reset(): void {
    values.clear();
  },
};
