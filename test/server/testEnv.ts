/**
 * The hosts every test talks to.
 *
 * `.test` is a reserved top-level domain (RFC 2606): it never resolves. Tests
 * point the API client and Supabase at these hosts (see `test/setup/env.ts`),
 * so even a request that somehow slipped past the stub server could not reach
 * production. The app itself only ever talks to production (DECISIONS: there
 * is no staging), which is exactly why no test may.
 */
export const TEST_API_ORIGIN = 'https://api.lifepass.test';
export const TEST_API_BASE = `${TEST_API_ORIGIN}/api/v1`;
export const TEST_SUPABASE_URL = 'https://supabase.lifepass.test';
/** Shaped like a publishable key; worthless anywhere. */
export const TEST_SUPABASE_ANON_KEY = 'sb_publishable_test_only_not_a_real_key';
export const TEST_MAPBOX_TOKEN = 'pk.test-only-not-a-real-token';
