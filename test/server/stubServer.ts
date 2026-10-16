/**
 * A fake LifePass API (and Supabase) for unit tests: the Android port of the
 * iOS `LifePassTests/StubServer.swift`.
 *
 * WHY. The money paths (walk-in consent, the 402 re-offer, the pay-and-save
 * card rails, the hosted checkout confirm) are decided by what the server
 * answers, and only a test that sees what the phone SENT, and what it did with
 * the answer, can say they are right. Every request a test makes goes through
 * msw: requests to the API host are recorded (method, path, query, headers,
 * JSON body) and answered by the test's `respond` function or its routes.
 * Nothing ever leaves the process: a request to any other host is refused
 * with a network error and fails the test (see `stubNetwork` below).
 *
 * Usage:
 *
 *   import { api, Reply } from '@test/server';
 *
 *   api.on('POST', '/check-ins/walk-in', Reply.ok({ checkInId: '…' }));
 *   await confirmWalkIn(…);
 *   const sent = api.sent('/check-ins/walk-in');
 *   expect(Object.keys(sent.body as object).sort()).toEqual([...]);
 *   expect(sent.headers['idempotency-key']).toBe('walkin-key-1');
 *
 * Like iOS, an API request nobody answered gets a 500 `internal_error`
 * problem, so a test that forgot a route fails loudly instead of hanging.
 */
import { delay, http, HttpResponse, type HttpHandler } from 'msw';
import { setupServer } from 'msw/native';

import { TEST_API_BASE, TEST_SUPABASE_URL } from './testEnv';

export type StubMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS';

export interface StubRequest {
  readonly method: string;
  readonly url: string;
  readonly host: string;
  /**
   * The path as the services name it: relative to `/api/v1` on the API host,
   * the full pathname on any other host. No query string.
   */
  readonly path: string;
  readonly query: Readonly<Record<string, string>>;
  /** Header names are lower case, as `fetch` normalises them. */
  readonly headers: Readonly<Record<string, string>>;
  /** The parsed JSON body; `undefined` when there was none or it was not JSON. */
  readonly body: unknown;
  /** The raw body text, for key-order or casing assertions. */
  readonly rawBody: string | null;
  /** Named segments of the route that matched (`/venues/:id` gives `id`). */
  readonly params: Readonly<Record<string, string>>;
  /** The request's own abort signal (a client timeout aborts it). */
  readonly signal: AbortSignal;
}

export type StubReply =
  | {
      readonly kind: 'http';
      readonly status: number;
      readonly body: string | null;
      readonly headers: Readonly<Record<string, string>>;
      readonly delayMs?: number;
    }
  /** No answer at all: offline, DNS or TLS failure (`fetch` rejects). */
  | { readonly kind: 'network-error'; readonly delayMs?: number }
  /** Never answers; the request ends only when the client aborts it. */
  | { readonly kind: 'hang' };

export type Responder = (request: StubRequest) => StubReply | Promise<StubReply>;

const JSON_TYPE = 'application/json';
const PROBLEM_TYPE = 'application/problem+json';

/** Replies, named after the iOS `StubServer.Reply` helpers. */
export const Reply = {
  /** `{ ok: true, data }`, the success envelope every API route uses. */
  ok(data: unknown, status = 200): StubReply {
    return Reply.json(status, { ok: true, data });
  },

  /** Any JSON body, verbatim (no envelope). */
  json(status: number, body: unknown, headers: Record<string, string> = {}): StubReply {
    return {
      kind: 'http',
      status,
      body: JSON.stringify(body),
      headers: { 'content-type': JSON_TYPE, ...lowerCaseKeys(headers) },
    };
  },

  /**
   * An RFC 9457 problem, `type` built the way the server builds it
   * (`https://lifepass.is/problems/<slug>`). `extra` adds members such as
   * `reason`, `offer`, `errors` or `retryAfter`.
   */
  problem(
    status: number,
    slug: string,
    extra: Record<string, unknown> = {},
    headers: Record<string, string> = {},
  ): StubReply {
    return {
      kind: 'http',
      status,
      body: JSON.stringify({
        type: `https://lifepass.is/problems/${slug}`,
        title: slug,
        status,
        detail: `Server detail for ${slug}.`,
        ...extra,
      }),
      headers: { 'content-type': PROBLEM_TYPE, ...lowerCaseKeys(headers) },
    };
  },

  /** A non-problem body, e.g. an HTML page from the edge or a gateway. */
  raw(status: number, text: string, contentType = 'text/html; charset=utf-8'): StubReply {
    return { kind: 'http', status, body: text, headers: { 'content-type': contentType } };
  },

  /** A body-less answer (204 by default). */
  empty(status = 204, headers: Record<string, string> = {}): StubReply {
    return { kind: 'http', status, body: null, headers: lowerCaseKeys(headers) };
  },

  /** The transport fails: no connection, DNS or TLS. `fetch` rejects. */
  fail(): StubReply {
    return { kind: 'network-error' };
  },

  /** No answer until the client gives up (use it to test timeouts). */
  hang(): StubReply {
    return { kind: 'hang' };
  },

  /** `reply`, after `ms` milliseconds (works with fake timers too). */
  delayed(ms: number, reply: StubReply): StubReply {
    if (reply.kind === 'hang') return reply;
    return { ...reply, delayMs: ms };
  },
};

interface Route {
  readonly method: string | '*';
  readonly matcher: (path: string) => Record<string, string> | null;
  readonly reply: StubReply | ((request: StubRequest) => StubReply | Promise<StubReply>);
  readonly once: boolean;
  used: boolean;
}

/** One faked host. `api` and `supabase` below are the two the app uses. */
export class StubHost {
  /** Every request since the last `reset()`, in order. */
  readonly requests: StubRequest[] = [];

  /**
   * Answers a request no route matched. Defaults to the host's fallback
   * (a 500 `internal_error` problem for the API, as on iOS).
   */
  respond: Responder;

  private routes: Route[] = [];

  constructor(
    /** e.g. `https://api.lifepass.test/api/v1`; requests under it are ours. */
    readonly base: string,
    /** Stripped from `path`, so `/api/v1/profile` is recorded as `/profile`. */
    private readonly pathPrefix: string,
    private readonly fallback: Responder,
  ) {
    this.respond = fallback;
  }

  /**
   * Answers `method path` with `reply`. `path` may name segments
   * (`/venues/:venueId/reviews`), match anything after a `*`, or be a RegExp
   * tested against the recorded path. Later routes win over earlier ones.
   */
  on(
    method: StubMethod | '*',
    path: string | RegExp,
    reply: StubReply | ((request: StubRequest) => StubReply | Promise<StubReply>),
  ): this {
    this.routes.unshift({ method, matcher: compilePath(path), reply, once: false, used: false });
    return this;
  }

  /** Like `on`, but answers one request only. */
  once(
    method: StubMethod | '*',
    path: string | RegExp,
    reply: StubReply | ((request: StubRequest) => StubReply | Promise<StubReply>),
  ): this {
    this.routes.unshift({ method, matcher: compilePath(path), reply, once: true, used: false });
    return this;
  }

  /** The last request sent to `path` (and `method`); throws when none was. */
  sent(path: string, method?: StubMethod): StubRequest {
    const match = [...this.requests]
      .reverse()
      .find((r) => r.path === path && (!method || r.method === method));
    if (!match) {
      const seen = this.requests.map((r) => `${r.method} ${r.path}`).join(', ') || 'nothing';
      throw new Error(`nothing sent to ${method ? `${method} ` : ''}${path} (sent: ${seen})`);
    }
    return match;
  }

  /** Every request sent to `path` (and `method`), oldest first. */
  sentAll(path: string, method?: StubMethod): StubRequest[] {
    return this.requests.filter((r) => r.path === path && (!method || r.method === method));
  }

  reset(): void {
    this.requests.length = 0;
    this.routes = [];
    this.respond = this.fallback;
  }

  /** The msw handler that records and answers this host's requests. */
  handler(): HttpHandler {
    return http.all(`${this.base}/*`, async ({ request }) => {
      const recorded = await record(request, this.pathPrefix);
      const { route, params } = this.match(recorded);
      const withParams = recorded.withParams(params);
      // Recorded BEFORE it is answered (as on iOS), so a responder can count
      // the requests that came before it ("the second poll says paid").
      this.requests.push(withParams);
      let reply: StubReply;
      if (!route) reply = await this.respond(withParams);
      else if (typeof route.reply === 'function') reply = await route.reply(withParams);
      else reply = route.reply;
      return toResponse(reply, request.signal);
    });
  }

  private match(request: RecordedRequest): { route: Route | null; params: Record<string, string> } {
    for (const route of this.routes) {
      if (route.once && route.used) continue;
      if (route.method !== '*' && route.method !== request.method) continue;
      const params = route.matcher(request.path);
      if (!params) continue;
      route.used = true;
      return { route, params };
    }
    return { route: null, params: {} };
  }
}

/** The LifePass API at `TEST_API_BASE`. */
export const api = new StubHost(TEST_API_BASE, '/api/v1', () => Reply.problem(500, 'internal_error'));

/**
 * Supabase (auth and storage) at `TEST_SUPABASE_URL`. Unanswered requests get
 * GoTrue's shape of a 500 so a test that forgot a route fails loudly.
 */
export const supabase = new StubHost(TEST_SUPABASE_URL, '', () =>
  Reply.json(500, { code: 500, error_code: 'unexpected_failure', msg: 'stub: no route' }),
);

const strayRequests: string[] = [];
let straysAllowed = false;

/**
 * The last line of defence: any request to a host the stubs do not own is
 * recorded and refused with a network error, so it can never reach a real
 * server. `jest.setup.ts` fails the test after the fact.
 */
const strayHandler = http.all('*', ({ request }) => {
  strayRequests.push(`${request.method} ${request.url}`);
  return HttpResponse.error();
});

export const server = setupServer(api.handler(), supabase.handler(), strayHandler);

export const stubNetwork = {
  start(): void {
    server.listen({ onUnhandledRequest: 'error' });
  },
  stop(): void {
    server.close();
  },
  /** Back to the initial handlers and empty recordings. */
  reset(): void {
    server.resetHandlers();
    api.reset();
    supabase.reset();
    strayRequests.length = 0;
    straysAllowed = false;
  },
  /** For a test that deliberately hits an unknown host (e.g. offline checks). */
  allowStrayRequests(): void {
    straysAllowed = true;
  },
  /** Requests that went to a host no stub owns since the last reset. */
  strayRequests(): readonly string[] {
    return [...strayRequests];
  },
  /** Throws when a test reached for a host the stubs do not own. */
  assertNoStrayRequests(): void {
    if (straysAllowed || strayRequests.length === 0) return;
    const list = strayRequests.map((r) => `  - ${r}`).join('\n');
    throw new Error(
      `A test sent requests to hosts the stub server does not own (refused, never sent):\n${list}\n` +
        'Route them through the API client (env.apiBaseUrl), add a handler with server.use(...), ' +
        'or call stubNetwork.allowStrayRequests() in a test that means it.',
    );
  },
};

// ---------------------------------------------------------------------------

interface RecordedRequest extends StubRequest {
  withParams(params: Record<string, string>): RecordedRequest;
}

async function record(request: Request, pathPrefix: string): Promise<RecordedRequest> {
  const url = new URL(request.url);
  let path = url.pathname;
  if (pathPrefix && path.startsWith(pathPrefix)) path = path.slice(pathPrefix.length) || '/';
  const query: Record<string, string> = {};
  url.searchParams.forEach((value, key) => {
    query[key] = value;
  });
  const headers: Record<string, string> = {};
  request.headers.forEach((value, key) => {
    headers[key.toLowerCase()] = value;
  });
  let rawBody: string | null = null;
  let body: unknown;
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    rawBody = await request.clone().text();
    if (rawBody === '') rawBody = null;
    if (rawBody !== null) {
      try {
        body = JSON.parse(rawBody);
      } catch {
        body = undefined;
      }
    }
  }
  const base = {
    method: request.method.toUpperCase(),
    url: request.url,
    host: url.host,
    path,
    query,
    headers,
    body,
    rawBody,
    signal: request.signal,
  };
  const make = (params: Record<string, string>): RecordedRequest => ({
    ...base,
    params,
    withParams: (next) => make(next),
  });
  return make({});
}

async function toResponse(reply: StubReply, signal: AbortSignal): Promise<Response> {
  if (reply.kind === 'hang') {
    await new Promise<void>((resolve) => {
      if (signal.aborted) resolve();
      else signal.addEventListener('abort', () => resolve(), { once: true });
    });
    return HttpResponse.error();
  }
  if (reply.delayMs) await delay(reply.delayMs);
  if (reply.kind === 'network-error') return HttpResponse.error();
  return new HttpResponse(reply.body, { status: reply.status, headers: reply.headers });
}

function compilePath(path: string | RegExp): (candidate: string) => Record<string, string> | null {
  if (path instanceof RegExp) {
    return (candidate) => {
      const match = path.exec(candidate);
      return match ? { ...(match.groups ?? {}) } : null;
    };
  }
  const names: string[] = [];
  const pattern = path
    .split('/')
    .map((segment) => {
      if (segment === '*') return '.*';
      if (segment.startsWith(':')) {
        names.push(segment.slice(1));
        return '([^/]+)';
      }
      return segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    })
    .join('/');
  const regex = new RegExp(`^${pattern}$`);
  return (candidate) => {
    const match = regex.exec(candidate);
    if (!match) return null;
    const params: Record<string, string> = {};
    names.forEach((name, i) => {
      params[name] = decodeURIComponent(match[i + 1] ?? '');
    });
    return params;
  };
}

function lowerCaseKeys(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) out[key.toLowerCase()] = value;
  return out;
}
