/**
 * The vendored LifePass Mobile API contract (`openapi.json`, written by
 * `scripts/vendor-openapi.mjs` from the monorepo's `apps/web/openapi.yaml`)
 * and lookups into it.
 *
 * Loaded with `fs` rather than `import` so TypeScript does not infer a type
 * for half a megabyte of JSON on every type check.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export type JsonSchema = { [keyword: string]: unknown };

export interface OpenApiParameter {
  name: string;
  in: 'query' | 'header' | 'path' | 'cookie';
  required?: boolean;
  schema?: JsonSchema;
  $ref?: string;
}

export interface OpenApiMediaType {
  schema?: JsonSchema;
  example?: unknown;
}

export interface OpenApiResponse {
  content?: Record<string, OpenApiMediaType>;
  headers?: Record<string, unknown>;
  $ref?: string;
}

export interface OpenApiOperation {
  operationId?: string;
  parameters?: OpenApiParameter[];
  requestBody?: { required?: boolean; content?: Record<string, OpenApiMediaType>; $ref?: string };
  responses?: Record<string, OpenApiResponse>;
  security?: Record<string, string[]>[];
}

export interface OpenApiDocument {
  openapi: string;
  info: { title: string; version: string; 'x-lifepass-health-contract'?: string };
  paths: Record<string, Record<string, OpenApiOperation | OpenApiParameter[]>>;
  components: {
    schemas: Record<string, JsonSchema>;
    parameters?: Record<string, OpenApiParameter>;
    responses?: Record<string, OpenApiResponse>;
  };
}

let cached: OpenApiDocument | null = null;

export function openApi(): OpenApiDocument {
  if (!cached) {
    cached = JSON.parse(readFileSync(join(__dirname, 'openapi.json'), 'utf8')) as OpenApiDocument;
  }
  return cached;
}

/** The contract version the tests assert, e.g. `0.34.0`. */
export function contractVersion(): string {
  return openApi().info.version;
}

const METHODS: HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];

export interface ResolvedOperation {
  method: HttpMethod;
  /** The template as the contract writes it, e.g. `/venues/{venueId}/reviews`. */
  template: string;
  operation: OpenApiOperation;
  /** Path parameters taken from the concrete path. */
  pathParams: Record<string, string>;
  /** Path-item and operation parameters, `$ref`s resolved. */
  parameters: OpenApiParameter[];
}

/**
 * Normalises what a test has in hand (a full URL, a path with `/api/v1`, a
 * query string) to the path the contract lists.
 */
export function contractPath(pathOrUrl: string): string {
  let path = pathOrUrl;
  if (/^https?:\/\//i.test(path)) path = new URL(path).pathname;
  path = path.split('?')[0]!.split('#')[0]!;
  const prefix = path.indexOf('/api/v1');
  if (prefix >= 0) path = path.slice(prefix + '/api/v1'.length);
  if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1);
  return path || '/';
}

/**
 * Finds the operation for a concrete call (`POST /venues/3f2b…/reviews`).
 * A literal segment beats a template one, so `/venues/map` resolves to its
 * own operation rather than `/venues/{venueId}`.
 */
export function findOperation(method: string, pathOrUrl: string): ResolvedOperation | null {
  const verb = method.toUpperCase() as HttpMethod;
  if (!METHODS.includes(verb)) return null;
  const path = contractPath(pathOrUrl);
  const segments = path.split('/');
  let best: { template: string; score: number; params: Record<string, string> } | null = null;
  for (const template of Object.keys(openApi().paths)) {
    const item = openApi().paths[template]!;
    if (!item[verb.toLowerCase()]) continue;
    const parts = template.split('/');
    if (parts.length !== segments.length) continue;
    let score = 0;
    const params: Record<string, string> = {};
    let matched = true;
    for (let i = 0; i < parts.length; i += 1) {
      const part = parts[i]!;
      const segment = segments[i]!;
      const name = /^\{(.+)\}$/.exec(part)?.[1];
      if (name) {
        if (segment === '') {
          matched = false;
          break;
        }
        params[name] = decodeURIComponent(segment);
      } else if (part === segment) {
        score += 1;
      } else {
        matched = false;
        break;
      }
    }
    if (matched && (!best || score > best.score)) best = { template, score, params };
  }
  if (!best) return null;
  const item = openApi().paths[best.template]!;
  const operation = item[verb.toLowerCase()] as OpenApiOperation;
  const shared = (Array.isArray(item.parameters) ? item.parameters : []) as OpenApiParameter[];
  const parameters = [...shared, ...(operation.parameters ?? [])].map(resolveParameter);
  return { method: verb, template: best.template, operation, pathParams: best.params, parameters };
}

export function requireOperation(method: string, pathOrUrl: string): ResolvedOperation {
  const found = findOperation(method, pathOrUrl);
  if (!found) {
    throw new Error(
      `${method.toUpperCase()} ${contractPath(pathOrUrl)} is not in the API contract ${contractVersion()}`,
    );
  }
  return found;
}

/** Follows a local `#/components/...` pointer. */
export function resolvePointer<T = unknown>(ref: string): T {
  if (!ref.startsWith('#/')) throw new Error(`only local refs are supported: ${ref}`);
  let node: unknown = openApi();
  for (const raw of ref.slice(2).split('/')) {
    const key = raw.replace(/~1/g, '/').replace(/~0/g, '~');
    node = (node as Record<string, unknown> | undefined)?.[key];
    if (node === undefined) throw new Error(`dangling ref ${ref}`);
  }
  return node as T;
}

function resolveParameter(parameter: OpenApiParameter): OpenApiParameter {
  return parameter.$ref ? resolvePointer<OpenApiParameter>(parameter.$ref) : parameter;
}

export function resolveResponse(response: OpenApiResponse): OpenApiResponse {
  return response.$ref ? resolvePointer<OpenApiResponse>(response.$ref) : response;
}

/** Every operation in the contract, for whole-contract checks. */
export function allOperations(): ResolvedOperation[] {
  const out: ResolvedOperation[] = [];
  for (const [template, item] of Object.entries(openApi().paths)) {
    for (const verb of METHODS) {
      const operation = item[verb.toLowerCase()] as OpenApiOperation | undefined;
      if (!operation) continue;
      const shared = (Array.isArray(item.parameters) ? item.parameters : []) as OpenApiParameter[];
      out.push({
        method: verb,
        template,
        operation,
        pathParams: {},
        parameters: [...shared, ...(operation.parameters ?? [])].map(resolveParameter),
      });
    }
  }
  return out;
}
