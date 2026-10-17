/**
 * The readers the health models are decoded with: the TypeScript form of
 * what Swift's `Codable` does in Models/HealthModels.swift.
 *
 * Swift's synthesized decoder is STRICT about types and LENIENT about
 * presence: an optional member that is absent or null is nil, and one that
 * is present with the wrong type throws, taking the enclosing value with it.
 * The health models keep that, and soften it exactly where iOS does
 * (`(try? c.decodeIfPresent(...)) ?? nil`): those members read through
 * `soft`, which turns anything unreadable into null and leaves the rest of
 * the value standing. Every enum reads a value this build has never heard of
 * as `'unknown'` instead of throwing, so a server that ships a new kind
 * never blanks a member's plan.
 *
 * Dependency-free apart from the wire date parser, so the models, the store
 * and the tests can all use it.
 */
import { parseIsoDate } from '../api/wire';

export type Json = Record<string, unknown>;

/** A value the strict reader refuses. Never escapes the decoders' callers as anything but this. */
export class HealthShapeError extends Error {
  constructor(readonly path: string) {
    super(`unexpected shape at ${path}`);
    this.name = 'HealthShapeError';
  }
}

export type Reader<T> = (value: unknown, path: string) => T;

export function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function absent(value: unknown): boolean {
  return value === undefined || value === null;
}

export const object: Reader<Json> = (value, path) => {
  if (!isObject(value)) throw new HealthShapeError(path);
  return value;
};

export const string: Reader<string> = (value, path) => {
  if (typeof value !== 'string') throw new HealthShapeError(path);
  return value;
};

export const boolean: Reader<boolean> = (value, path) => {
  if (typeof value !== 'boolean') throw new HealthShapeError(path);
  return value;
};

/** Swift `Int`: a whole JSON number (72.0 reads as 72; 72.5 throws). */
export const integer: Reader<number> = (value, path) => {
  if (typeof value !== 'number' || !Number.isInteger(value)) throw new HealthShapeError(path);
  return value;
};

/** Swift `Double`: any finite JSON number. */
export const double: Reader<number> = (value, path) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new HealthShapeError(path);
  return value;
};

/** An instant as the API writes it (ISO 8601, with or without fractions); anything else throws. */
export const instant: Reader<Date> = (value, path) => {
  const parsed = parseIsoDate(string(value, path));
  if (!parsed) throw new HealthShapeError(path);
  return parsed;
};

/** `[T]`: every element must read. */
export function arrayOf<T>(read: Reader<T>): Reader<T[]> {
  return (value, path) => {
    if (!Array.isArray(value)) throw new HealthShapeError(path);
    return value.map((item, index) => read(item, `${path}[${index}]`));
  };
}

/**
 * A forward-compatible enum (every health enum's `init(from:)`): a known
 * value, else `'unknown'`. A value that is not a string at all still throws,
 * as `decode(String.self)` does in Swift.
 */
export function enumOf<T extends string>(known: readonly T[]): Reader<T | 'unknown'> {
  return (value, path) => {
    const raw = string(value, path);
    return (known as readonly string[]).includes(raw) ? (raw as T) : 'unknown';
  };
}

/** `decode(_:forKey:)`: present and readable, or the whole value throws. */
export function req<T>(json: Json, key: string, path: string, read: Reader<T>): T {
  return read(json[key], `${path}.${key}`);
}

/** `decodeIfPresent(_:forKey:)`: absent or null is null; present must read. */
export function opt<T>(json: Json, key: string, path: string, read: Reader<T>): T | null {
  const value = json[key];
  return absent(value) ? null : read(value, `${path}.${key}`);
}

/** `(try? decodeIfPresent(_:forKey:)) ?? nil`: absent, null or unreadable is null. */
export function soft<T>(json: Json, key: string, path: string, read: Reader<T>): T | null {
  const value = json[key];
  if (absent(value)) return null;
  try {
    return read(value, `${path}.${key}`);
  } catch {
    return null;
  }
}
