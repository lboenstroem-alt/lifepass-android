/**
 * Standard base64 (RFC 4648, with padding) over bytes, for the meal photo:
 * the image manipulator hands the JPEG over as base64, the byte walk needs
 * the bytes, and OP-32 takes base64 again.
 *
 * Written out rather than through `atob`/`btoa`: those work on "binary
 * strings" one UTF-16 unit per byte, which doubles a 600 KB photo in memory
 * for nothing, and their presence differs between Hermes versions and the
 * test runner. This works on any engine and only ever holds the bytes and
 * the text.
 */

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

const DECODE: Int16Array = (() => {
  const table = new Int16Array(128).fill(-1);
  for (let index = 0; index < ALPHABET.length; index += 1) table[ALPHABET.charCodeAt(index)] = index;
  return table;
})();

/** Not base64 (a character outside the alphabet, or a bad length). */
export class Base64Error extends Error {
  constructor() {
    super('invalid base64');
    this.name = 'Base64Error';
  }
}

/** The bytes `text` encodes. Whitespace (a wrapped encoder's newlines) is ignored. */
export function bytesFromBase64(text: string): Uint8Array {
  const clean = /\s/.test(text) ? text.replace(/\s+/g, '') : text;
  if (clean.length % 4 !== 0) throw new Base64Error();
  let padding = 0;
  if (clean.endsWith('==')) padding = 2;
  else if (clean.endsWith('=')) padding = 1;
  const out = new Uint8Array((clean.length / 4) * 3 - padding);
  let written = 0;
  for (let index = 0; index < clean.length; index += 4) {
    const values = [0, 0, 0, 0];
    for (let offset = 0; offset < 4; offset += 1) {
      const code = clean.charCodeAt(index + offset);
      if (code === 61 /* = */ && index + offset >= clean.length - padding) {
        values[offset] = 0;
        continue;
      }
      const value = code < 128 ? DECODE[code]! : -1;
      if (value < 0) throw new Base64Error();
      values[offset] = value;
    }
    const triple = (values[0]! << 18) | (values[1]! << 12) | (values[2]! << 6) | values[3]!;
    if (written < out.length) out[written++] = (triple >> 16) & 0xff;
    if (written < out.length) out[written++] = (triple >> 8) & 0xff;
    if (written < out.length) out[written++] = triple & 0xff;
  }
  return out;
}

/** `bytes` as base64 text, padded. */
export function base64FromBytes(bytes: Uint8Array): string {
  const parts: string[] = [];
  // Built in slices so a long photo never makes one giant string concatenation chain.
  const SLICE = 3 * 4096;
  for (let start = 0; start < bytes.length; start += SLICE) {
    const end = Math.min(bytes.length, start + SLICE);
    let chunk = '';
    for (let index = start; index < end; index += 3) {
      const a = bytes[index]!;
      const b = index + 1 < end ? bytes[index + 1]! : 0;
      const c = index + 2 < end ? bytes[index + 2]! : 0;
      const triple = (a << 16) | (b << 8) | c;
      chunk += ALPHABET[(triple >> 18) & 63]! + ALPHABET[(triple >> 12) & 63]!;
      chunk += index + 1 < end ? ALPHABET[(triple >> 6) & 63]! : '=';
      chunk += index + 2 < end ? ALPHABET[triple & 63]! : '=';
    }
    parts.push(chunk);
  }
  return parts.join('');
}
