/**
 * The server's JPEG fixtures (`image.test.ts`), rebuilt byte for byte as iOS
 * `MealImageEncoderTests` builds them: five hand-made images with every kind
 * of segment that could carry a member value, and the answers the server's
 * `stripJpegMetadata` gives for them.
 */
export function bytes(text: string): number[] {
  return Array.from(new TextEncoder().encode(text));
}

export function segment(marker: number, payload: readonly number[]): number[] {
  const length = payload.length + 2;
  return [0xff, marker, length >> 8, length & 0xff, ...payload];
}

export function sofPayload(width: number, height: number): number[] {
  return [8, height >> 8, height & 0xff, width >> 8, width & 0xff, 1, 1, 0x11, 0];
}

export const sof0 = segment(0xc0, sofPayload(64, 64));
export const dqt = segment(0xdb, new Array<number>(65).fill(1));
export const dht = segment(0xc4, new Array<number>(20).fill(2));
export const jfif = segment(0xe0, [...bytes('JFIF\u0000'), 1, 1, 0, 0, 1, 0, 1, 0, 0]);
export const adobe = segment(0xee, [...bytes('Adobe'), 0, 100, 0, 0, 0, 0, 0]);
export const entropy = [0x12, 0x34, 0xff, 0x00, 0x56, 0x78];
export const sosHeader = segment(0xda, [1, 1, 0, 0, 63, 0]);
export const end = [0xff, 0xd9];

export const GPS_MARKER = '64.1466N21.9426W';
export const COMMENT_TEXT = 'shot at home by Gudrun';
export const exifWithGPS = segment(0xe1, [...bytes('Exif\u0000\u0000'), ...bytes(GPS_MARKER)]);
export const xmp = segment(0xe1, bytes('http://ns.adobe.com/xap/1.0/\u0000<x:xmpmeta/>'));
export const icc = segment(0xe2, [...bytes('ICC_PROFILE\u0000'), ...new Array<number>(8).fill(3)]);
export const iptc = segment(0xed, bytes('Photoshop 3.0\u0000IPTC'));
export const comment = segment(0xfe, bytes(COMMENT_TEXT));
export const jfxx = segment(0xe0, [...bytes('JFXX\u0000'), ...new Array<number>(4).fill(9)]);

export const u8 = (values: readonly number[]): Uint8Array => Uint8Array.from(values);

export const dirty = u8([0xff, 0xd8, ...jfif, ...exifWithGPS, ...xmp, ...icc, ...iptc, ...comment, ...dqt, ...sof0, ...dht, ...sosHeader, ...entropy, ...end]);
export const clean = u8([0xff, 0xd8, ...jfif, ...dqt, ...sof0, ...dht, ...sosHeader, ...entropy, ...end]);
export const trailing = u8([...clean, ...exifWithGPS, ...comment]);
export const inScan = u8([0xff, 0xd8, ...dqt, ...sof0, ...dht, ...sosHeader, ...entropy, ...exifWithGPS, ...end]);
export const progressive = u8([
  0xff, 0xd8, ...dqt, ...segment(0xc2, sofPayload(800, 600)), ...dht, ...sosHeader, ...entropy, ...comment, ...sosHeader, ...entropy, ...end,
]);

/** Every marker byte that follows a 0xFF (not a stuffed 0xFF00 or a fill byte). */
export function markers(data: Uint8Array): number[] {
  const found: number[] = [];
  for (let index = 0; index + 1 < data.length; index += 1) {
    if (data[index] === 0xff && data[index + 1] !== 0x00 && data[index + 1] !== 0xff) found.push(data[index + 1]!);
  }
  return found;
}

/** The bytes as text (lossy), to look for planted words. */
export function text(data: Uint8Array): string {
  return new TextDecoder('utf-8', { fatal: false }).decode(data);
}

/** True when `needle` occurs in `haystack`. */
export function containsBytes(haystack: Uint8Array, needle: readonly number[]): boolean {
  outer: for (let start = 0; start + needle.length <= haystack.length; start += 1) {
    for (let index = 0; index < needle.length; index += 1) {
      if (haystack[start + index] !== needle[index]) continue outer;
    }
    return true;
  }
  return false;
}
