/**
 * Idempotency keys for high-value writes (bookings, check-ins, payments,
 * cancels, checkout). The server caches the first answer under a key, so a
 * network retry, or the charge-consent re-POST, can never book or charge
 * twice.
 *
 * THE RULE (iOS, every money path): one key per USER ACTION, minted when the
 * member first acts and reused for every retry of that action, the 402 consent
 * re-POST included, until the server answers it for good. Then the next action
 * gets a new key. A deterministic key (`cancel-${bookingId}`) is wrong: the
 * server would replay the first answer to a later, different attempt (the old
 * Android cancel replayed an earlier refusal forever).
 *
 * The server accepts 8 to 128 characters of `[A-Za-z0-9_.:-]`; a UUID fits.
 */
import * as Crypto from 'expo-crypto';

const KEY_SHAPE = /^[A-Za-z0-9_.:-]{8,128}$/;

/** A fresh key: a lowercase v4 UUID from the platform's secure generator. */
export function newIdempotencyKey(): string {
  const key = Crypto.randomUUID();
  if (typeof key === 'string' && KEY_SHAPE.test(key)) return key.toLowerCase();
  // expo-crypto always answers on a phone. Jest's auto-generated native mock
  // answers `undefined`, and a write must never go out without a key (the
  // server refuses it), so build a v4 UUID from Math.random there. Uniqueness
  // is all a key needs; it is not a secret.
  return fallbackUuid();
}

function fallbackUuid(): string {
  const hex: string[] = [];
  for (let i = 0; i < 32; i += 1) hex.push(Math.floor(Math.random() * 16).toString(16));
  hex[12] = '4';
  hex[16] = ((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  const s = hex.join('');
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`;
}

/** True when `key` is one the server accepts. */
export function isValidIdempotencyKey(key: string): boolean {
  return KEY_SHAPE.test(key);
}

/**
 * Keys for a screen's user actions, one per action id (a booking id for a
 * cancel, `'create'` for a booking attempt):
 *
 *   const keys = new ActionKeys();
 *   await cancelBooking(id, keys.keyFor(id));   // a retry reuses the key
 *   keys.settle(id);                            // after a final answer
 *
 * Settle after the server answered FOR GOOD (success, or a refusal that will
 * not change); keep the key after a transport failure or a timeout, when the
 * first attempt may still have gone through.
 */
export class ActionKeys<Action extends string = string> {
  private readonly keys = new Map<Action, string>();

  /** The action's key, minted on first use and then reused. */
  keyFor(action: Action): string {
    let key = this.keys.get(action);
    if (!key) {
      key = newIdempotencyKey();
      this.keys.set(action, key);
    }
    return key;
  }

  /** The action's current key, without minting one. */
  peek(action: Action): string | undefined {
    return this.keys.get(action);
  }

  /** The action is over: its next attempt is a new action with a new key. */
  settle(action: Action): void {
    this.keys.delete(action);
  }

  /** Forget every key (the screen closed, the member signed out). */
  clear(): void {
    this.keys.clear();
  }
}
