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
// A fixture switch is opted into per test (`withFixture` in test/harness).
delete process.env.EXPO_PUBLIC_FIXTURE;
