/**
 * The byte walk that leaves a meal photo with pixels and nothing else: the
 * port of iOS `MealImageEncoder.strip` (Services/MealImageEncoder.swift),
 * which is itself identical to the server's `stripJpegMetadata`.
 *
 * WHY A BYTE WALK AFTER A REDRAW. Android's `Bitmap.compress` writes a bare
 * JFIF file today, but nothing promises it always will on every phone's
 * codec, and iOS learned that ImageIO writes an EXIF block, an APP13 and an
 * ICC profile name even into an image it has just drawn. So the JPEG that
 * leaves the phone is walked segment by segment with the SAME keep list as
 * the server:
 *
 *   kept     SOI, DQT, DHT, DRI, every SOFn frame header, a JFIF APP0 of
 *            exactly its own 14 bytes with no thumbnail, an Adobe APP14 of
 *            exactly 12 bytes, every scan with its entropy data, EOI
 *   dropped  APP1 to APP13, APP15 and COM (EXIF, GPS, XMP, ICC, IPTC,
 *            Photoshop blocks, comments), a JFIF APP0 that runs on or
 *            declares a thumbnail, any APP0 that is not JFIF, an APP14 of
 *            another length, and anything after EOI
 *   refused  any marker it cannot account for: an image that cannot be
 *            fully accounted for is not sent
 *
 * Pure and synchronous over bytes, so it is unit tested against the server's
 * own fixtures (./__tests__/jpegStrip.test.ts).
 */

/** The byte walk met something it cannot account for (iOS `Failure.malformed`). */
export class JpegMalformedError extends Error {
  constructor() {
    super('malformed');
    this.name = 'JpegMalformedError';
  }
}

const SOI = 0xd8;
const EOI = 0xd9;
const SOS = 0xda;
const COM = 0xfe;
const DQT = 0xdb;
const DHT = 0xc4;
const DRI = 0xdd;
const APP0 = 0xe0;
const APP14 = 0xee;
const APP15 = 0xef;
const TEM = 0x01;
const RST_FIRST = 0xd0;
const RST_LAST = 0xd7;

/**
 * Every Start Of Frame flavour. 0xC4 (DHT), 0xC8 (JPG) and 0xCC (DAC) sit in
 * the same range and are not frame headers.
 */
const SOF_MARKERS: ReadonlySet<number> = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
const KEEP_MARKERS: ReadonlySet<number> = new Set([...SOF_MARKERS, DQT, DHT, DRI]);

const JFIF_ID = [0x4a, 0x46, 0x49, 0x46, 0x00]; // "JFIF\0"
const ADOBE_ID = [0x41, 0x64, 0x6f, 0x62, 0x65]; // "Adobe"

function startsWith(bytes: Uint8Array, start: number, end: number, prefix: readonly number[]): boolean {
  if (end - start < prefix.length) return false;
  for (let index = 0; index < prefix.length; index += 1) {
    if (bytes[start + index] !== prefix[index]) return false;
  }
  return true;
}

/** A JFIF header of exactly its own 14 bytes, declaring no thumbnail. */
function isJfifHeader(image: Uint8Array, start: number, end: number): boolean {
  if (end - start !== 14 || !startsWith(image, start, end, JFIF_ID)) return false;
  return image[start + 12] === 0 && image[start + 13] === 0;
}

/** The marker byte at `offset` (after any fill bytes) and where it sits. */
function markerAt(image: Uint8Array, offset: number): { readonly marker: number; readonly at: number } {
  if (image[offset] !== 0xff) throw new JpegMalformedError();
  let at = offset + 1;
  while (at < image.length && image[at] === 0xff) at += 1;
  if (at >= image.length) throw new JpegMalformedError();
  return { marker: image[at]!, at };
}

/** A segment's declared length, which counts its own two length bytes. */
function segmentLength(image: Uint8Array, lengthAt: number): number {
  if (lengthAt + 1 >= image.length) throw new JpegMalformedError();
  const length = (image[lengthAt]! << 8) | image[lengthAt + 1]!;
  if (length < 2 || lengthAt + length > image.length) throw new JpegMalformedError();
  return length;
}

/** Where a scan's entropy-coded data ends: the next real marker (not a stuffed 0xFF00 or a restart). */
function endOfScan(image: Uint8Array, from: number): number {
  let index = from;
  while (index + 1 < image.length) {
    if (image[index] !== 0xff) {
      index += 1;
      continue;
    }
    const next = image[index + 1]!;
    if (next === 0x00 || (next >= RST_FIRST && next <= RST_LAST)) {
      index += 2;
      continue;
    }
    if (next === 0xff) {
      index += 1;
      continue;
    }
    return index;
  }
  throw new JpegMalformedError();
}

/** Appends byte ranges without copying twice. */
class ByteSink {
  private chunks: Uint8Array[] = [];
  private length = 0;

  push(source: Uint8Array, start: number, end: number): void {
    if (end <= start) return;
    this.chunks.push(source.subarray(start, end));
    this.length += end - start;
  }

  pushBytes(...bytes: number[]): void {
    this.chunks.push(Uint8Array.from(bytes));
    this.length += bytes.length;
  }

  toBytes(): Uint8Array {
    const out = new Uint8Array(this.length);
    let offset = 0;
    for (const chunk of this.chunks) {
      out.set(chunk, offset);
      offset += chunk.length;
    }
    return out;
  }
}

/**
 * The JPEG with every segment that could carry a member value removed.
 * Throws `JpegMalformedError` for anything it cannot account for.
 */
export function stripJpegMetadata(image: Uint8Array): Uint8Array {
  if (image.length < 4 || image[0] !== 0xff || image[1] !== SOI) throw new JpegMalformedError();
  const kept = new ByteSink();
  kept.pushBytes(0xff, SOI);
  let offset = 2;
  let sawFrame = false;
  let sawEnd = false;
  while (offset + 1 < image.length) {
    const { marker, at } = markerAt(image, offset);
    if (marker === EOI) {
      kept.pushBytes(0xff, EOI);
      sawEnd = true;
      break;
    }
    if (marker === TEM || (marker >= RST_FIRST && marker <= RST_LAST)) {
      kept.push(image, at - 1, at + 1);
      offset = at + 1;
      continue;
    }
    const lengthAt = at + 1;
    const length = segmentLength(image, lengthAt);
    const segmentEnd = lengthAt + length;
    const payloadStart = lengthAt + 2;

    if (marker === SOS) {
      if (!sawFrame) throw new JpegMalformedError();
      const scanEnd = endOfScan(image, segmentEnd);
      kept.push(image, at - 1, scanEnd);
      offset = scanEnd;
      continue;
    }
    if (SOF_MARKERS.has(marker)) sawFrame = true;
    if (KEEP_MARKERS.has(marker)) {
      kept.push(image, at - 1, segmentEnd);
    } else if (marker === APP0) {
      if (isJfifHeader(image, payloadStart, segmentEnd)) kept.push(image, at - 1, segmentEnd);
    } else if (marker === APP14) {
      if (segmentEnd - payloadStart === 12 && startsWith(image, payloadStart, segmentEnd, ADOBE_ID)) {
        kept.push(image, at - 1, segmentEnd);
      }
    } else if (marker === COM || (marker > APP0 && marker <= APP15)) {
      // Metadata: dropped.
    } else {
      throw new JpegMalformedError();
    }
    offset = segmentEnd;
  }
  if (!sawFrame || !sawEnd) throw new JpegMalformedError();
  return kept.toBytes();
}
