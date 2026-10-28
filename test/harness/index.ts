/**
 * Small test helpers that every package can use.
 *
 *   setEnv({ EXPO_PUBLIC_SOCIAL_SIGN_IN: 'YES' });   // this test only
 *   setEnv({ EXPO_PUBLIC_FIXTURE: 'state=active-plan,language=is' });
 *   setDev(false);                                    // behave like a release bundle
 *
 * Both are undone after the test by `jest.setup.ts`.
 *
 * `process.env` is changed IN PLACE, never replaced: the app reads it through
 * `expo/virtual/env`, which holds the object it saw at load time, so a test
 * that assigns `process.env = {...}` silently stops reaching the app.
 */
type Restore = () => void;

const restores: Restore[] = [];

/** Sets (or, with `undefined`, removes) environment variables for this test. */
export function setEnv(vars: Record<string, string | undefined>): void {
  for (const [key, value] of Object.entries(vars)) {
    const had = Object.prototype.hasOwnProperty.call(process.env, key);
    const before = process.env[key];
    restores.push(() => {
      if (had) process.env[key] = before;
      else delete process.env[key];
    });
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

/** Sets `__DEV__` for this test; `false` behaves like a release bundle. */
export function setDev(value: boolean): void {
  const g = globalThis as { __DEV__?: boolean };
  const before = g.__DEV__;
  restores.push(() => {
    g.__DEV__ = before;
  });
  g.__DEV__ = value;
}

/** Undoes every `setEnv` / `setDev` of the test, newest first. */
export function restoreTestGlobals(): void {
  while (restores.length) restores.pop()!();
}
