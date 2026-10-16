/**
 * Test support for anything that calls the API: a client signed in against
 * the stub server (test/server), the Android twin of iOS
 * `StubServer.client(refreshedToken:onRevoked:)`.
 *
 *   import { stubApiClientPerTest } from '../../api/testing';
 *
 *   const session = stubApiClientPerTest();         // every test signed in
 *   ...
 *   expect(api.sent('/profile').headers.authorization).toBe('Bearer test-token');
 *   expect(session.revoked).toBe(0);
 *
 * The client's token functions are fakes; requests still go through the real
 * client, fetch and msw, so headers, bodies, 401 recovery and timeouts are
 * the app's own. Never imported by app code.
 *
 * And the contract check every service test ends with (the iOS
 * ContractFixtureTests idea: look at what the phone SENT):
 *
 *   api.on('POST', '/check-ins/walk-in', replyFromContract('POST', '/check-ins/walk-in', 201));
 *   await confirmWalkIn(...);
 *   const sent = expectSentToMatchContract('POST', '/check-ins/walk-in');
 *   expect(Object.keys(sent.body as object).sort()).toEqual([...]);
 */
import { expectRequestValid, sampleResponse, type SampleMode } from '@test/contract';
import { api, Reply, type StubMethod, type StubReply, type StubRequest } from '@test/server';

import { createApiClient, setSharedApiClient, type ApiClient } from './client';

export const TEST_ACCESS_TOKEN = 'test-token';
export const TEST_REFRESHED_TOKEN = 'refreshed-token';

export interface StubApiClientOptions {
  /** The session's token; `null` is signed out. Default `test-token`. */
  readonly token?: string | null | (() => Promise<string | null>);
  /** What a refresh after a 401 answers. Default `refreshed-token`. Throw `RefreshRefusedError` to refuse. */
  readonly refreshedToken?: () => Promise<string | null>;
  /** Called when the client ends a revoked session. */
  readonly onRevoked?: () => void;
  /** Whether the phone is offline when a request fails. Default online. */
  readonly isDeviceOffline?: () => Promise<boolean>;
  /** The default ceiling, for timeout tests. */
  readonly defaultTimeoutMs?: number;
}

export interface StubApiSession {
  readonly client: ApiClient;
  /** How many times the client ended a revoked session. */
  readonly revoked: number;
  /** How many times the client asked for a refresh. */
  readonly refreshes: number;
}

/** A client on the stub server with a fixed session (not installed anywhere). */
export function createStubApiClient(options: StubApiClientOptions = {}): StubApiSession {
  const state = { revoked: 0, refreshes: 0 };
  const token = options.token === undefined ? TEST_ACCESS_TOKEN : options.token;
  const client = createApiClient({
    accessToken: typeof token === 'function' ? token : async () => token,
    refreshAccessToken: async () => {
      state.refreshes += 1;
      return options.refreshedToken ? options.refreshedToken() : TEST_REFRESHED_TOKEN;
    },
    endRevokedSession: async () => {
      state.revoked += 1;
      options.onRevoked?.();
    },
    isDeviceOffline: options.isDeviceOffline ?? (async () => false),
    defaultTimeoutMs: options.defaultTimeoutMs,
  });
  return {
    client,
    get revoked() {
      return state.revoked;
    },
    get refreshes() {
      return state.refreshes;
    },
  };
}

/** Installs a stub client behind `apiGet`/`apiPost`/... until `restore()`. */
export function installStubApiClient(options: StubApiClientOptions = {}): StubApiSession & { restore(): void } {
  const session = createStubApiClient(options);
  setSharedApiClient(session.client);
  return Object.assign(session, { restore: () => setSharedApiClient(null) });
}

/**
 * Call at the top of a test file (or a `describe`): every test runs signed
 * in on a fresh stub client, and the app's client is back afterwards. The
 * returned handle reads the current test's session.
 */
export function stubApiClientPerTest(options: StubApiClientOptions = {}): StubApiSession {
  let current: StubApiSession | null = null;
  beforeEach(() => {
    current = installStubApiClient(options);
  });
  afterEach(() => {
    setSharedApiClient(null);
    current = null;
  });
  const active = (): StubApiSession => {
    if (!current) throw new Error('stubApiClientPerTest: read the session inside a test');
    return current;
  };
  return {
    get client() {
      return active().client;
    },
    get revoked() {
      return active().revoked;
    },
    get refreshes() {
      return active().refreshes;
    },
  };
}

/**
 * The last request sent to `method path`, checked against the contract: its
 * JSON body (keys, types, enums, formats), path and query parameters, and the
 * Idempotency-Key on every write the contract marks as retry-safe. Returns the
 * request for the test's own assertions.
 */
export function expectSentToMatchContract(method: StubMethod, path: string): StubRequest {
  const sent = api.sent(path, method);
  expectRequestValid(sent);
  return sent;
}

/**
 * A success envelope around the contract's own sample of the answer (its
 * example when it has one, else built from the schema: `minimal` has only
 * the required keys, `full` every documented one).
 */
export function replyFromContract(
  method: StubMethod,
  path: string,
  status = 200,
  mode: SampleMode = 'minimal',
): StubReply {
  return Reply.ok(sampleResponse(method, path, status, mode), status);
}
