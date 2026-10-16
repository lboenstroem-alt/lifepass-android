/**
 * Response fixtures from the contract, and helpers to break them.
 *
 * The plan asks for response fixtures "from the openapi examples, plus
 * deliberately malformed variants". The contract carries only a handful of
 * examples, so `sampleResponse` uses an example when there is one and
 * otherwise builds a value from the schema:
 *
 *   - `minimal` (the default): only required keys, first enum value, the
 *     smallest number and string the schema allows. What a fail-soft decoder
 *     must survive.
 *   - `full`: every documented key filled in. What a decoder must read
 *     completely.
 *
 * Both are valid against the contract (`test/contract/__tests__` checks every
 * operation). Then `withoutKey` / `withValue` make the malformed variants:
 *
 *   const venue = sampleResponse('GET', '/venues/by-slug/laugar', 200, 'full');
 *   decodeVenue(withValue(venue, 'latitude', 'not a number'));
 */
import { requireOperation, resolvePointer, resolveResponse, type JsonSchema } from './document';

export type SampleMode = 'minimal' | 'full';

/** A last-resort stop; cycles are broken by `chain` long before this. */
const MAX_DEPTH = 80;

/** Deterministic stand-ins for the string formats the contract uses. */
const FORMAT_SAMPLES: Record<string, string> = {
  uuid: '3f2b8c1e-7d4a-4b6e-9c2f-1a2b3c4d5e6f',
  'date-time': '2026-10-02T14:00:00.000Z',
  date: '2026-10-02',
  email: 'member@example.com',
  uri: 'https://www.lifepass.is/',
  binary: 'binary',
};

/**
 * Tried, in order, against a `pattern` the format sample does not meet.
 * Together they satisfy every pattern in contract 0.34.0 (the "samples"
 * test fails on a new pattern none of them meets; add one here).
 */
const PATTERN_CANDIDATES = [
  'abc',
  'abc-def',
  'abcdefgh',
  'abcdefghijklmnop',
  '0123456789abcdef',
  '12345678',
  '2026-10-02',
  'adult',
  '1,2,3,4',
  'food:abc',
  'en',
];

export function sampleFromSchema(schema: JsonSchema, mode: SampleMode = 'minimal'): unknown {
  return build(schema, mode, 0, []);
}

/**
 * A value for the `status` response of `method path`: the contract's example
 * when it has one, else one built from the schema (`mode`).
 */
export function sampleResponse(method: string, path: string, status = 200, mode: SampleMode = 'minimal'): unknown {
  const { operation, template } = requireOperation(method, path);
  const entry = operation.responses?.[String(status)];
  if (!entry) throw new Error(`${method.toUpperCase()} ${template} has no ${status} response in the contract`);
  const response = resolveResponse(entry);
  const media = response.content?.['application/json'] ?? response.content?.['application/problem+json'];
  if (!media?.schema) throw new Error(`${method.toUpperCase()} ${template} ${status} has no JSON body`);
  if (media.example !== undefined) return clone(media.example);
  return sampleFromSchema(media.schema, mode);
}

/** A named component schema (`#/components/schemas/<name>`) as a value. */
export function sampleSchema(name: string, mode: SampleMode = 'minimal'): unknown {
  return sampleFromSchema({ $ref: `#/components/schemas/${name}` }, mode);
}

/** Resolves a `$ref` (keeping sibling keywords) one level. */
function deref(schema: JsonSchema): { schema: JsonSchema; ref: string | null } {
  if (typeof schema.$ref !== 'string') return { schema, ref: null };
  const { $ref, ...siblings } = schema;
  return { schema: { ...resolvePointer<JsonSchema>($ref as string), ...siblings }, ref: $ref as string };
}

/**
 * Folds `allOf` parts into one schema. A key both parts describe must satisfy
 * both, so a property (or an array's `items`) defined twice becomes an
 * `allOf` of the two definitions; `required` is united.
 */
function mergeAllOf(schema: JsonSchema, chain: string[]): JsonSchema {
  const { allOf, ...own } = schema;
  let merged: JsonSchema = {};
  for (const raw of [...((allOf as JsonSchema[] | undefined) ?? []), own]) {
    let part = raw;
    const seen = [...chain];
    while (typeof part.$ref === 'string' && !seen.includes(part.$ref)) {
      seen.push(part.$ref);
      part = deref(part).schema;
    }
    if (Array.isArray(part.allOf)) part = mergeAllOf(part, seen);
    merged = mergeTwo(merged, part);
  }
  delete merged.additionalProperties;
  delete merged.unevaluatedProperties;
  return merged;
}

function mergeTwo(a: JsonSchema, b: JsonSchema): JsonSchema {
  const out: JsonSchema = { ...a, ...b };
  const aProps = (a.properties as Record<string, JsonSchema> | undefined) ?? {};
  const bProps = (b.properties as Record<string, JsonSchema> | undefined) ?? {};
  const properties: Record<string, JsonSchema> = { ...aProps };
  for (const [name, schema] of Object.entries(bProps)) {
    properties[name] = aProps[name] ? { allOf: [aProps[name]!, schema] } : schema;
  }
  if (Object.keys(properties).length) out.properties = properties;
  if (a.items && b.items) out.items = { allOf: [a.items as JsonSchema, b.items as JsonSchema] };
  if (a.type !== undefined && b.type === undefined) out.type = a.type;
  const required = [...new Set([...((a.required as string[]) ?? []), ...((b.required as string[]) ?? [])])];
  if (required.length) out.required = required;
  return out;
}

function build(schema: JsonSchema, mode: SampleMode, depth: number, chain: string[]): unknown {
  if (depth > MAX_DEPTH) return null;
  if (schema.example !== undefined && depth > 0) return clone(schema.example);
  if (typeof schema.$ref === 'string') {
    const ref = schema.$ref;
    const seen = chain.filter((r) => r === ref).length;
    // A schema that contains itself: once more with only required keys, then stop.
    if (seen >= 2) return null;
    return build(deref(schema).schema, seen === 1 ? 'minimal' : mode, depth + 1, [...chain, ref]);
  }
  if ('const' in schema) return clone(schema.const);
  if (Array.isArray(schema.enum)) {
    const nonNull = schema.enum.find((value) => value !== null);
    return clone(nonNull === undefined ? null : nonNull);
  }
  if (schema.default !== undefined) return clone(schema.default);
  if (Array.isArray(schema.allOf)) return build(mergeAllOf(schema, chain), mode, depth + 1, chain);
  const branches = (schema.oneOf ?? schema.anyOf) as JsonSchema[] | undefined;
  if (Array.isArray(branches) && branches.length) {
    const preferred = branches.find((b) => b.type !== 'null') ?? branches[0]!;
    const { oneOf: _o, anyOf: _a, ...rest } = schema;
    const restIsEmpty = Object.keys(rest).length === 0;
    return build(restIsEmpty ? preferred : { allOf: [rest, preferred] }, mode, depth + 1, chain);
  }
  const type = Array.isArray(schema.type)
    ? ((schema.type as string[]).find((t) => t !== 'null') ?? 'null')
    : (schema.type as string | undefined) ?? (schema.properties ? 'object' : undefined);
  switch (type) {
    case 'null':
      return null;
    case 'boolean':
      return false;
    case 'integer':
    case 'number':
      return numberFor(schema, type);
    case 'string':
      return stringFor(schema);
    case 'array': {
      const min = typeof schema.minItems === 'number' ? schema.minItems : 0;
      const count = mode === 'full' ? Math.max(min, 1) : min;
      const items = (schema.items as JsonSchema | undefined) ?? {};
      const out: unknown[] = [];
      for (let i = 0; i < count; i += 1) out.push(build(items, mode, depth + 1, chain));
      if (schema.uniqueItems && out.length > 1) return dedupe(out, items);
      return out;
    }
    case 'object': {
      const properties = (schema.properties as Record<string, JsonSchema> | undefined) ?? {};
      const required = new Set((schema.required as string[] | undefined) ?? []);
      const out: Record<string, unknown> = {};
      for (const [name, propertySchema] of Object.entries(properties)) {
        if (!required.has(name) && mode === 'minimal') continue;
        out[name] = build(propertySchema, mode, depth + 1, chain);
      }
      // A required key the schema never describes still has to be present.
      for (const name of required) if (!(name in out)) out[name] = null;
      const minProperties = typeof schema.minProperties === 'number' ? schema.minProperties : 0;
      for (const [name, propertySchema] of Object.entries(properties)) {
        if (Object.keys(out).length >= minProperties) break;
        if (!(name in out)) out[name] = build(propertySchema, mode, depth + 1, chain);
      }
      return out;
    }
    default:
      return {};
  }
}

function numberFor(schema: JsonSchema, type: 'integer' | 'number'): number {
  let value = 0;
  if (typeof schema.minimum === 'number') value = schema.minimum;
  if (typeof schema.exclusiveMinimum === 'number') value = schema.exclusiveMinimum + (type === 'integer' ? 1 : 0.5);
  if (typeof schema.maximum === 'number' && value > schema.maximum) value = schema.maximum;
  if (typeof schema.multipleOf === 'number') value = Math.ceil(value / schema.multipleOf) * schema.multipleOf;
  return type === 'integer' ? Math.ceil(value) : value;
}

function fitLength(value: string, schema: JsonSchema): string {
  const min = typeof schema.minLength === 'number' ? schema.minLength : 0;
  const max = typeof schema.maxLength === 'number' ? schema.maxLength : Infinity;
  let out = value;
  if ([...out].length < min) out = out.padEnd(min, 'x');
  if ([...out].length > max) out = [...out].slice(0, max).join('');
  return out;
}

function stringFor(schema: JsonSchema): string {
  const format = typeof schema.format === 'string' ? schema.format : undefined;
  const first = format && FORMAT_SAMPLES[format] !== undefined ? FORMAT_SAMPLES[format]! : 'sample';
  if (typeof schema.pattern !== 'string') return fitLength(first, schema);
  const regex = new RegExp(schema.pattern, 'u');
  for (const candidate of [first, ...PATTERN_CANDIDATES]) {
    const fitted = fitLength(candidate, schema);
    if (regex.test(fitted)) return fitted;
  }
  return fitLength(first, schema);
}

function dedupe(values: unknown[], items: JsonSchema): unknown[] {
  const options = Array.isArray(items.enum) ? (items.enum as unknown[]).filter((v) => v !== null) : null;
  if (options && options.length >= values.length) return options.slice(0, values.length).map(clone);
  return values.slice(0, 1);
}

// --- Malformed variants ----------------------------------------------------

type PathSegments = string | readonly (string | number)[];

function segments(path: PathSegments): (string | number)[] {
  if (typeof path !== 'string') return [...path];
  return path.split('.').map((part) => (/^\d+$/.test(part) ? Number(part) : part));
}

/** A copy with the key at `path` (`'venue.slug'`, `'items.0.id'`) removed. */
export function withoutKey<T>(value: T, path: PathSegments): T {
  const copy = clone(value);
  const parts = segments(path);
  const last = parts.pop();
  const parent = walk(copy, parts);
  if (Array.isArray(parent) && typeof last === 'number') parent.splice(last, 1);
  else if (isPlainObject(parent) && last !== undefined) delete parent[String(last)];
  return copy;
}

/** A copy with the value at `path` replaced (created when missing). */
export function withValue<T>(value: T, path: PathSegments, next: unknown): T {
  const copy = clone(value);
  const parts = segments(path);
  const last = parts.pop();
  const parent = walk(copy, parts, true);
  if (last === undefined) return clone(next) as T;
  (parent as Record<string | number, unknown>)[last] = clone(next);
  return copy;
}

function walk(root: unknown, parts: (string | number)[], create = false): unknown {
  let node: unknown = root;
  for (const part of parts) {
    const container = node as Record<string | number, unknown>;
    if (container[part] === undefined && create) container[part] = {};
    node = container[part];
    if (node === undefined || node === null) throw new Error(`no value at ${parts.join('.')}`);
  }
  return node;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function clone<T>(value: T): T {
  return value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T);
}
