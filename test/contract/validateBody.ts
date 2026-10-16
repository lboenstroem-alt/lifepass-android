/**
 * Contract checks: what the phone sends, and what it must be able to read,
 * against the vendored LifePass Mobile API contract (`openapi.json`).
 *
 * The Android port of the iOS `ContractFixtureTests` idea. 2.3.0 on iOS
 * shipped a walk-in the server refused on every activity because nothing
 * looked at a request body. Every service test here validates the exact body
 * it sent (key set, types, enums, formats; `additionalProperties: false` in
 * the contract makes an extra key an error) and the Idempotency-Key header on
 * every write the contract marks as retry-safe.
 *
 *   const sent = api.sent('/check-ins/walk-in');
 *   expectRequestValid(sent);                       // body, headers, query
 *   expect(requestBodyKeys('POST', '/check-ins/walk-in').required).toEqual(['venueId']);
 *   expectResponseDataValid('GET', '/profile', 200, fixture);
 *
 * Response schemas describe the inside of the `{ ok, data }` envelope (see
 * docs/05_MOBILE_API.md, "Successful API route responses use the app
 * envelope"), so pass `data`, not the envelope.
 */
import Ajv2020, { type ErrorObject, type ValidateFunction } from 'ajv/dist/2020';
import addFormats from 'ajv-formats';

import {
  findOperation,
  openApi,
  requireOperation,
  resolvePointer,
  resolveResponse,
  type JsonSchema,
  type OpenApiParameter,
  type ResolvedOperation,
} from './document';

const SPEC_ID = 'lifepass-openapi';

export interface ContractResult {
  readonly valid: boolean;
  readonly errors: readonly string[];
  /** The contract template the call resolved to, e.g. `/venues/{venueId}`. */
  readonly template: string | null;
}

let bodyAjv: Ajv2020 | null = null;
let paramAjv: Ajv2020 | null = null;
const compiled = new Map<string, ValidateFunction>();

function makeAjv(coerceTypes: boolean): Ajv2020 {
  // `strict: false`: the contract carries OpenAPI annotations (`example`)
  // and unions ajv's strict mode would refuse; the meta-schema still applies.
  const ajv = new Ajv2020({ strict: false, allErrors: true, allowUnionTypes: true, coerceTypes });
  addFormats(ajv);
  // OpenAPI's `format: binary` marks a multipart file part; any value passes.
  ajv.addFormat('binary', true);
  ajv.addSchema(openApi() as unknown as JsonSchema, SPEC_ID);
  return ajv;
}

function ajvFor(kind: 'body' | 'param'): Ajv2020 {
  if (kind === 'body') return (bodyAjv ??= makeAjv(false));
  // Query and path values arrive as strings; `?limit=20` is an integer.
  return (paramAjv ??= makeAjv(true));
}

/** Rewrites local `#/…` refs so a fragment compiles against the whole document. */
function anchored(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(anchored);
  if (!schema || typeof schema !== 'object') return schema;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(schema)) {
    out[key] = key === '$ref' && typeof value === 'string' && value.startsWith('#/')
      ? `${SPEC_ID}${value}`
      : anchored(value);
  }
  return out;
}

function validatorFor(cacheKey: string, schema: JsonSchema, kind: 'body' | 'param'): ValidateFunction {
  const key = `${kind}:${cacheKey}`;
  let fn = compiled.get(key);
  if (!fn) {
    fn = ajvFor(kind).compile(anchored(schema) as JsonSchema);
    compiled.set(key, fn);
  }
  return fn;
}

function describe(errors: ErrorObject[] | null | undefined, where: string): string[] {
  return (errors ?? []).map((e) => {
    const at = `${where}${e.instancePath || ''}`;
    const params = e.params && Object.keys(e.params).length ? ` ${JSON.stringify(e.params)}` : '';
    return `${at} ${e.message ?? 'is invalid'}${params}`;
  });
}

/** The schema of the JSON media type (`application/json`, `…+json`), if any. */
function jsonSchemaOf(content: Record<string, { schema?: JsonSchema }> | undefined): JsonSchema | null {
  if (!content) return null;
  const type =
    ['application/json', 'application/problem+json'].find((t) => t in content) ??
    Object.keys(content).find((t) => /[/+]json$/.test(t));
  return (type && content[type]?.schema) || null;
}

// --- Request side ----------------------------------------------------------

/** The JSON schema of the request body, or null when the call takes none. */
export function requestBodySchema(method: string, path: string): JsonSchema | null {
  const { operation } = requireOperation(method, path);
  const body = operation.requestBody?.$ref
    ? resolvePointer<{ content?: Record<string, { schema?: JsonSchema }> }>(operation.requestBody.$ref)
    : operation.requestBody;
  return jsonSchemaOf(body?.content);
}

/** Collects the top-level properties and required keys, through `$ref` and `allOf`. */
function objectShape(schema: JsonSchema, seen = new Set<string>()): { properties: Set<string>; required: Set<string> } {
  const properties = new Set<string>();
  const required = new Set<string>();
  const ref = schema.$ref;
  if (typeof ref === 'string' && !seen.has(ref)) {
    seen.add(ref);
    const inner = objectShape(resolvePointer<JsonSchema>(ref), seen);
    inner.properties.forEach((p) => properties.add(p));
    inner.required.forEach((r) => required.add(r));
  }
  for (const part of (schema.allOf as JsonSchema[] | undefined) ?? []) {
    const inner = objectShape(part, seen);
    inner.properties.forEach((p) => properties.add(p));
    inner.required.forEach((r) => required.add(r));
  }
  Object.keys((schema.properties as Record<string, unknown> | undefined) ?? {}).forEach((p) => properties.add(p));
  ((schema.required as string[] | undefined) ?? []).forEach((r) => required.add(r));
  return { properties, required };
}

/**
 * The keys the contract allows in a request body, and the ones it requires,
 * both sorted. For key-set assertions like the iOS
 * `XCTAssertEqual(Set(body.keys), [...])`.
 */
export function requestBodyKeys(method: string, path: string): { properties: string[]; required: string[] } {
  const schema = requestBodySchema(method, path);
  if (!schema) return { properties: [], required: [] };
  const shape = objectShape(schema);
  return { properties: [...shape.properties].sort(), required: [...shape.required].sort() };
}

export function validateRequestBody(method: string, path: string, body: unknown): ContractResult {
  const resolved = findOperation(method, path);
  if (!resolved) return notInContract(method, path);
  const schema = requestBodySchema(method, path);
  if (!schema) {
    const empty = body === undefined || body === null;
    return {
      valid: empty,
      errors: empty ? [] : [`body: the contract takes no JSON body for ${method.toUpperCase()} ${resolved.template}`],
      template: resolved.template,
    };
  }
  if (body === undefined) {
    const required = resolved.operation.requestBody?.required === true;
    return {
      valid: !required,
      errors: required ? ['body: required by the contract, none sent'] : [],
      template: resolved.template,
    };
  }
  const validate = validatorFor(`req ${resolved.method} ${resolved.template}`, schema, 'body');
  const valid = validate(body) as boolean;
  return { valid, errors: valid ? [] : describe(validate.errors, 'body'), template: resolved.template };
}

/** True when the contract lists the Idempotency-Key header on this call. */
export function declaresIdempotencyKey(method: string, path: string): boolean {
  return requireOperation(method, path).parameters.some(
    (p) => p.in === 'header' && p.name.toLowerCase() === 'idempotency-key',
  );
}

/**
 * The server's rule for the key (docs: "8–128 chars from `[A-Za-z0-9_.:-]`"),
 * stricter than the length-only schema in the contract.
 */
const IDEMPOTENCY_KEY = /^[A-Za-z0-9_.:-]{8,128}$/;

export interface RequestLike {
  readonly method: string;
  readonly path: string;
  readonly query?: Readonly<Record<string, string>>;
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: unknown;
}

/**
 * The whole request against the contract: the body, path parameters, query
 * parameters (an undocumented one is an error), and the Idempotency-Key on
 * every write that declares it. Takes a recorded `StubRequest` as is.
 */
export function validateRequest(request: RequestLike): ContractResult {
  const resolved = findOperation(request.method, request.path);
  if (!resolved) return notInContract(request.method, request.path);
  const errors: string[] = [...validateRequestBody(request.method, request.path, request.body).errors];
  errors.push(...checkParameters(resolved, 'path', resolved.pathParams));
  errors.push(...checkParameters(resolved, 'query', request.query ?? {}));
  const headers = lowerKeys(request.headers ?? {});
  if (declaresIdempotencyKey(request.method, request.path)) {
    const key = headers['idempotency-key'];
    if (!key) errors.push('header Idempotency-Key: required on this write, none sent');
    else if (!IDEMPOTENCY_KEY.test(key)) {
      errors.push(`header Idempotency-Key: "${key}" is not 8-128 chars of [A-Za-z0-9_.:-]`);
    }
  }
  return { valid: errors.length === 0, errors, template: resolved.template };
}

function checkParameters(
  resolved: ResolvedOperation,
  location: 'path' | 'query',
  values: Readonly<Record<string, string>>,
): string[] {
  const declared = resolved.parameters.filter((p): p is OpenApiParameter => p.in === location);
  const errors: string[] = [];
  for (const parameter of declared) {
    const value = values[parameter.name];
    if (value === undefined) {
      if (parameter.required) errors.push(`${location} ${parameter.name}: required, none sent`);
      continue;
    }
    if (!parameter.schema) continue;
    // Wrapped in an object: ajv coerces a string to the declared type
    // (`?limit=20` is an integer) only where it can write the result back.
    const validate = validatorFor(
      `${location} ${resolved.method} ${resolved.template} ${parameter.name}`,
      { type: 'object', properties: { value: parameter.schema }, required: ['value'] },
      'param',
    );
    const ok = validate({ value: coerceArrayParam(parameter.schema, value) }) as boolean;
    if (!ok) {
      const unwrapped = (validate.errors ?? []).map((e) => ({
        ...e,
        instancePath: e.instancePath.replace(/^\/value/, ''),
      }));
      errors.push(...describe(unwrapped, `${location} ${parameter.name}`));
    }
  }
  if (location === 'query') {
    for (const name of Object.keys(values)) {
      if (!declared.some((p) => p.name === name)) {
        errors.push(`query ${name}: not a parameter of ${resolved.method} ${resolved.template}`);
      }
    }
  }
  return errors;
}

function coerceArrayParam(schema: JsonSchema, value: string): unknown {
  // `guestAgeBands=adult,child` is a comma-joined array (form style, explode false).
  if (schema.type === 'array') return value === '' ? [] : value.split(',');
  return value;
}

// --- Response side ---------------------------------------------------------

/** The JSON schema for a response status (exact, then `2XX`, then `default`). */
export function responseSchema(method: string, path: string, status: number): JsonSchema | null {
  const { operation } = requireOperation(method, path);
  const responses = operation.responses ?? {};
  const entry =
    responses[String(status)] ?? responses[`${String(status)[0]}XX`] ?? responses.default;
  if (!entry) return null;
  return jsonSchemaOf(resolveResponse(entry).content as Record<string, { schema?: JsonSchema }> | undefined);
}

/** `data` (the inside of the envelope, or a problem body) against the contract. */
export function validateResponseData(method: string, path: string, status: number, data: unknown): ContractResult {
  const resolved = findOperation(method, path);
  if (!resolved) return notInContract(method, path);
  const schema = responseSchema(method, path, status);
  if (!schema) {
    return {
      valid: false,
      errors: [`response: the contract lists no JSON body for ${status} on ${resolved.method} ${resolved.template}`],
      template: resolved.template,
    };
  }
  const validate = validatorFor(`res ${resolved.method} ${resolved.template} ${status}`, schema, 'body');
  const valid = validate(data) as boolean;
  return { valid, errors: valid ? [] : describe(validate.errors, 'data'), template: resolved.template };
}

/** A named component schema (`#/components/schemas/<name>`) against a value. */
export function validateSchema(name: string, value: unknown): ContractResult {
  if (!openApi().components.schemas[name]) {
    return { valid: false, errors: [`no schema named ${name} in the contract`], template: null };
  }
  const validate = validatorFor(`schema ${name}`, { $ref: `#/components/schemas/${name}` }, 'body');
  const valid = validate(value) as boolean;
  return { valid, errors: valid ? [] : describe(validate.errors, name), template: null };
}

// --- Throwing forms, for tests ---------------------------------------------

function assertValid(result: ContractResult, what: string): void {
  if (result.valid) return;
  throw new Error(`${what} breaks the API contract:\n  ${result.errors.join('\n  ')}`);
}

export function expectRequestValid(request: RequestLike): void {
  assertValid(validateRequest(request), `${request.method.toUpperCase()} ${request.path}`);
}

export function expectRequestBodyValid(method: string, path: string, body: unknown): void {
  assertValid(validateRequestBody(method, path, body), `the body of ${method.toUpperCase()} ${path}`);
}

export function expectResponseDataValid(method: string, path: string, status: number, data: unknown): void {
  assertValid(validateResponseData(method, path, status, data), `the ${status} answer to ${method.toUpperCase()} ${path}`);
}

export function expectSchemaValid(name: string, value: unknown): void {
  assertValid(validateSchema(name, value), `this ${name}`);
}

function notInContract(method: string, path: string): ContractResult {
  return {
    valid: false,
    errors: [`${method.toUpperCase()} ${path} is not in the API contract ${openApi().info.version}`],
    template: null,
  };
}

function lowerKeys(headers: Readonly<Record<string, string>>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) out[key.toLowerCase()] = value;
  return out;
}
