/**
 * One key per user action, reused across retries until the action is over
 * (iOS mints a UUID per action; the old Android cancel used a deterministic
 * `cancel-${id}` that replayed an earlier refusal forever).
 */
import { ActionKeys, isValidIdempotencyKey, newIdempotencyKey } from '../idempotency';

describe('newIdempotencyKey', () => {
  it('is a fresh lowercase UUID the server accepts', () => {
    const a = newIdempotencyKey();
    const b = newIdempotencyKey();
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(a).not.toBe(b);
    expect(isValidIdempotencyKey(a)).toBe(true);
  });

  it("uses expo-crypto's UUID when the platform answers", () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Crypto = require('expo-crypto') as typeof import('expo-crypto');
    const spy = jest.spyOn(Crypto, 'randomUUID').mockReturnValue('0B7D4A62-3C9E-4F1A-A2D5-6E8F9C1B2A34');
    expect(newIdempotencyKey()).toBe('0b7d4a62-3c9e-4f1a-a2d5-6e8f9c1b2a34');
    spy.mockRestore();
  });

  it('knows the server rule (8 to 128 of [A-Za-z0-9_.:-])', () => {
    expect(isValidIdempotencyKey('walkin-key-1')).toBe(true);
    expect(isValidIdempotencyKey('short')).toBe(false);
    expect(isValidIdempotencyKey('has space in it')).toBe(false);
    expect(isValidIdempotencyKey('x'.repeat(129))).toBe(false);
  });
});

describe('ActionKeys', () => {
  it('reuses a key until the action is settled', () => {
    const keys = new ActionKeys();
    const first = keys.keyFor('booking-1');
    expect(keys.keyFor('booking-1')).toBe(first);
    expect(keys.peek('booking-1')).toBe(first);
    expect(keys.keyFor('booking-2')).not.toBe(first);

    keys.settle('booking-1');
    expect(keys.peek('booking-1')).toBeUndefined();
    expect(keys.keyFor('booking-1')).not.toBe(first);

    keys.clear();
    expect(keys.peek('booking-2')).toBeUndefined();
  });
});
