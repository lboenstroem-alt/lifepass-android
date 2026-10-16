// Runs before every test file, ahead of the test framework and of any module
// the test imports. It pins the build-time environment the app reads from
// `process.env.EXPO_PUBLIC_*` (see `src/config/env.ts`), so a developer's
// shell or `.env` can never change what a test sees, and so every network
// call aims at a host that cannot resolve (`test/server/testEnv.ts`).
import {
  TEST_API_BASE,
  TEST_MAPBOX_TOKEN,
  TEST_SUPABASE_ANON_KEY,
  TEST_SUPABASE_URL,
} from '../server/testEnv';

process.env.EXPO_PUBLIC_LIFEPASS_API_URL = TEST_API_BASE;
process.env.EXPO_PUBLIC_SUPABASE_URL = TEST_SUPABASE_URL;
process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = TEST_SUPABASE_ANON_KEY;
process.env.EXPO_PUBLIC_MAPBOX_TOKEN = TEST_MAPBOX_TOKEN;
// Off by default, like the iOS test host built without LP_SOCIAL_SIGN_IN.
delete process.env.EXPO_PUBLIC_SOCIAL_SIGN_IN;
// A fixture switch is opted into per test:
//   setEnv({ EXPO_PUBLIC_FIXTURE: 'state=active-plan' })   (from '@test/harness')
delete process.env.EXPO_PUBLIC_FIXTURE;

// THE PHONE IS NOT NODE. Jest runs on Node, whose globals include APIs the
// phone's engine (Hermes, React Native 0.81) does not have: no `crypto`
// (Expo's runtime adds only TextDecoder, URL, URLSearchParams and
// structuredClone), no `Buffer`, and RN's AbortSignal is the abort-controller
// polyfill, without `timeout` or `any`. Code that used them would pass every
// test and crash on a device (an Idempotency-Key from `crypto.randomUUID()`,
// a client timeout from `AbortSignal.timeout(ms)`), so they are removed here.
// App code uses expo-crypto and the API client's own timeout (eslint.config.js
// refuses the globals too). Harness code that needs them imports 'node:crypto'
// or 'node:buffer'.
const testGlobal = globalThis as Record<string, unknown>;
for (const name of ['crypto', 'Buffer']) {
  if (Object.getOwnPropertyDescriptor(testGlobal, name)?.configurable === false) {
    throw new Error(`test/setup/env.ts cannot remove the Node global "${name}"`);
  }
  delete testGlobal[name];
}
// AbortSignal is the host's own class, shared with Node's fetch: hide the two
// statics from the test realm instead of deleting them from the class.
const DEVICE_MISSING_SIGNAL_STATICS = new Set<PropertyKey>(['timeout', 'any']);
testGlobal.AbortSignal = new Proxy(AbortSignal, {
  get: (target, key, receiver) =>
    DEVICE_MISSING_SIGNAL_STATICS.has(key) ? undefined : Reflect.get(target, key, receiver),
  has: (target, key) => !DEVICE_MISSING_SIGNAL_STATICS.has(key) && Reflect.has(target, key),
});
