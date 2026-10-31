/**
 * Dates, ids and bodies as the API writes and reads them (iOS
 * `APIClient.makeDecoder`, the `.iso8601` encoder and `UUID.wire`).
 */
import { encodeBody, parseIsoDate, snippet, stringifySorted, toWireDate, wireId } from '../wire';

describe('parseIsoDate', () => {
  it('reads Z and +00:00, with and without fractional seconds', () => {
    const expected = Date.UTC(2026, 9, 2, 9, 0, 0);
    for (const raw of [
      '2026-10-02T09:00:00Z',
      '2026-10-02T09:00:00.000Z',
      '2026-10-02T09:00:00+00:00',
      '2026-10-02T09:00:00.000+00:00',
      '2026-10-02T09:00:00.000000Z',
    ]) {
      expect(parseIsoDate(raw)?.getTime()).toBe(expected);
    }
  });

  it('keeps milliseconds and applies offsets', () => {
    expect(parseIsoDate('2026-10-02T09:00:00.123Z')?.getTime()).toBe(Date.UTC(2026, 9, 2, 9, 0, 0, 123));
    expect(parseIsoDate('2026-10-02T11:30:00+02:30')?.getTime()).toBe(Date.UTC(2026, 9, 2, 9, 0, 0));
    expect(parseIsoDate('2026-10-02T04:00:00-05:00')?.getTime()).toBe(Date.UTC(2026, 9, 2, 9, 0, 0));
  });

  it('refuses anything that is not an instant', () => {
    for (const raw of ['2026-10-02', '2026-10-02T09:00:00', 'yesterday', '', '2026-02-31T09:00:00Z', '2026-13-01T00:00:00Z']) {
      expect(parseIsoDate(raw)).toBeNull();
    }
    expect(parseIsoDate(null)).toBeNull();
    expect(parseIsoDate(undefined)).toBeNull();
  });

  it('reads the same instant in any device time zone', () => {
    // The suite also runs under America/New_York and Asia/Tokyo (scripts/ci.sh).
    expect(parseIsoDate('2026-10-02T14:00:00Z')?.toISOString()).toBe('2026-10-02T14:00:00.000Z');
  });
});

describe('writing', () => {
  it('sends dates without milliseconds, as the iOS encoder does', () => {
    expect(toWireDate(new Date('2026-10-02T14:00:00.000Z'))).toBe('2026-10-02T14:00:00Z');
    expect(toWireDate(new Date('2026-10-02T14:00:00.987Z'))).toBe('2026-10-02T14:00:00Z');
  });

  it('sends ids lowercase', () => {
    expect(wireId('3F2B8C1E-7D4A-4B6E-9C2F-1A2B3C4D5E6F')).toBe('3f2b8c1e-7d4a-4b6e-9c2f-1a2b3c4d5e6f');
  });

  it('encodes bodies with wire dates and without undefined members', () => {
    const body = { at: new Date('2026-10-02T14:00:00Z'), nested: { at: new Date('2026-10-03T00:00:00Z') }, gone: undefined, kept: null };
    expect(JSON.parse(encodeBody(body))).toEqual({
      at: '2026-10-02T14:00:00Z',
      nested: { at: '2026-10-03T00:00:00Z' },
      kept: null,
    });
    expect(encodeBody(new Date('2026-10-02T14:00:00Z'))).toBe('"2026-10-02T14:00:00Z"');
    expect(encodeBody([new Date('2026-10-02T14:00:00Z')])).toBe('["2026-10-02T14:00:00Z"]');
  });
});

describe('helpers', () => {
  it('sorts every key and keeps every value', () => {
    expect(stringifySorted({ b: 1, a: [{ d: null, c: 1.5 }] })).toBe(
      '{\n  "a": [\n    {\n      "c": 1.5,\n      "d": null\n    }\n  ],\n  "b": 1\n}',
    );
  });

  it('cuts a snippet', () => {
    expect(snippet('  short  ')).toBe('short');
    expect(snippet('abcdef', 3)).toBe('abc…');
    expect(snippet(null)).toBe('');
  });
});
