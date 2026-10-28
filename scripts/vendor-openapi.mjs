#!/usr/bin/env node
// Vendor the LifePass Mobile API contract into this repo as
// `test/contract/openapi.json`.
//
//   node scripts/vendor-openapi.mjs <path/to/monorepo/apps/web/openapi.yaml> [out.json]
//
// WHY A COPY, AND WHY STRIPPED. The contract lives in the private monorepo,
// and this repository is public. The app's tests (ajv body checks, the
// generated `src/api/openapi.d.ts`) need the machine-readable part only:
// paths, parameters, schemas, enums and the few examples. The prose
// (`description`, `summary`, `info.description`, tag descriptions) explains
// server internals and business rules that have no place in a public repo, so
// it is dropped here. Re-run the script whenever the monorepo bumps
// `info.version`; CI compares nothing against the monorepo (it is not
// reachable from here), so the vendored version is what the tests assert.
//
// NORMALISED FOR JSON SCHEMA 2020-12. The document is OpenAPI 3.1, whose
// schemas are JSON Schema 2020-12, but a few schemas still use the 3.0
// `nullable: true` keyword, which 2020-12 ignores. Left alone, ajv would
// reject a `null` the server is allowed to send. Each one is rewritten to the
// 3.1 spelling (`type: [T, "null"]`, or `anyOf` with `{ type: "null" }` around
// a `$ref`), so the vendored file says exactly what the server means.
//
// One more normalisation, for the same reason: an `allOf` that extends a
// schema closed with `additionalProperties: false` (e.g. PerformedExerciseView
// = HealthPerformedExercise + `name`) can never validate in JSON Schema, since
// the closed part rejects the keys the other part adds. The contract means
// "these keys and no others", which 2020-12 spells `unevaluatedProperties:
// false` on the `allOf`. The closed part is inlined without its
// `additionalProperties`, and the `allOf` gets `unevaluatedProperties: false`.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';

const here = dirname(fileURLToPath(import.meta.url));
const [, , input, outputArg] = process.argv;
if (!input) {
  console.error('usage: node scripts/vendor-openapi.mjs <openapi.yaml> [out.json]');
  process.exit(2);
}
const output = resolve(outputArg ?? resolve(here, '../test/contract/openapi.json'));

/** Keywords whose value is a map from NAMES to objects, never a keyword set. */
const NAME_MAPS = new Set([
  'properties',
  'patternProperties',
  '$defs',
  'definitions',
  'schemas',
  'paths',
  'responses',
  'content',
  'headers',
  'securitySchemes',
  'examples',
  'links',
  'callbacks',
  'requestBodies',
  'encoding',
  'variables',
  'mapping',
]);

/** Prose keywords dropped wherever they are keywords (never property names). */
const PROSE = new Set(['description', 'summary']);

function stripProse(node) {
  if (Array.isArray(node)) return node.map(stripProse);
  if (!node || typeof node !== 'object') return node;
  const out = {};
  for (const [key, value] of Object.entries(node)) {
    if (PROSE.has(key) && typeof value === 'string') continue;
    if (key === 'externalDocs') continue;
    if (NAME_MAPS.has(key) && value && typeof value === 'object' && !Array.isArray(value)) {
      const map = {};
      for (const [name, child] of Object.entries(value)) map[name] = stripProse(child);
      out[key] = map;
    } else {
      out[key] = stripProse(value);
    }
  }
  return out;
}

let rewrittenNullables = 0;

/** Rewrites OpenAPI 3.0 `nullable: true` to its JSON Schema 2020-12 spelling. */
function normaliseNullable(node) {
  if (Array.isArray(node)) return node.map(normaliseNullable);
  if (!node || typeof node !== 'object') return node;
  const out = {};
  for (const [key, value] of Object.entries(node)) out[key] = normaliseNullable(value);
  if (!('nullable' in out)) return out;
  const nullable = out.nullable === true;
  delete out.nullable;
  if (!nullable) return out;
  rewrittenNullables += 1;
  if (out.$ref) {
    const { $ref, ...rest } = out;
    return { ...rest, anyOf: [{ $ref }, { type: 'null' }] };
  }
  if (out.type !== undefined) {
    const types = Array.isArray(out.type) ? out.type : [out.type];
    if (!types.includes('null')) out.type = [...types, 'null'];
  } else if (Array.isArray(out.oneOf) || Array.isArray(out.anyOf)) {
    const key = out.oneOf ? 'oneOf' : 'anyOf';
    out[key] = [...out[key], { type: 'null' }];
  }
  if (Array.isArray(out.enum) && !out.enum.includes(null)) out.enum = [...out.enum, null];
  return out;
}

let reopenedAllOfs = 0;

/** See the header: closed `allOf` parts become one closed `allOf`. */
function reopenClosedAllOf(node, components) {
  if (Array.isArray(node)) return node.map((child) => reopenClosedAllOf(child, components));
  if (!node || typeof node !== 'object') return node;
  const out = {};
  for (const [key, value] of Object.entries(node)) out[key] = reopenClosedAllOf(value, components);
  if (!Array.isArray(out.allOf)) return out;
  let closed = false;
  out.allOf = out.allOf.map((part) => {
    const resolved =
      part && typeof part.$ref === 'string' && part.$ref.startsWith('#/components/schemas/')
        ? components[part.$ref.slice('#/components/schemas/'.length)]
        : part;
    if (!resolved || resolved.additionalProperties !== false) return part;
    closed = true;
    const { additionalProperties: _closed, ...open } = resolved;
    return open;
  });
  if (closed) {
    reopenedAllOfs += 1;
    if (out.unevaluatedProperties === undefined) out.unevaluatedProperties = false;
  }
  return out;
}

const source = YAML.parse(readFileSync(input, 'utf8'));
if (!source || typeof source.openapi !== 'string' || !source.paths) {
  console.error(`${input} is not an OpenAPI document`);
  process.exit(1);
}

const normalised = normaliseNullable(stripProse(source));
const stripped = reopenClosedAllOf(normalised, normalised.components?.schemas ?? {});
// Top-level metadata: keep what identifies the contract, drop the rest.
stripped.info = {
  title: source.info?.title,
  version: source.info?.version,
  ...(source.info?.['x-lifepass-health-contract']
    ? { 'x-lifepass-health-contract': source.info['x-lifepass-health-contract'] }
    : {}),
};
stripped.tags = (source.tags ?? []).map((tag) => ({ name: tag.name }));
stripped.servers = (source.servers ?? []).map((server) => ({ url: server.url }));

mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, `${JSON.stringify(stripped, null, 2)}\n`);
console.log(
  `wrote ${output}: OpenAPI ${stripped.openapi}, contract ${stripped.info.version}, ` +
    `${Object.keys(stripped.paths).length} paths, ` +
    `${Object.keys(stripped.components?.schemas ?? {}).length} schemas, ` +
    `${rewrittenNullables} nullable rewrites, ${reopenedAllOfs} closed allOf rewrites`,
);
