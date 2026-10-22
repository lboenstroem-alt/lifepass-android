/**
 * A stand-in for the phone's image pipeline: "photos" are JPEGs built from
 * segments, the way the server's fixtures are, carrying their size in the
 * frame header and the metadata a camera writes (EXIF with GPS, a maker, a
 * comment). Rendering one makes a new JPEG whose entropy data grows with its
 * pixels and its quality, and which (like ImageIO, unlike a careful encoder)
 * writes an EXIF block and an ICC profile name into what it has just drawn,
 * so the byte walk has something to do.
 */
import { base64FromBytes, bytesFromBase64 } from '../base64';
import type { Rect, Size } from '../cropMath';
import type { LoadedMealImage, MealImagePipeline, MealImageSource } from '../encoder';

import { bytes, COMMENT_TEXT, dht, dqt, exifWithGPS, GPS_MARKER, icc, jfif, segment, sofPayload, sosHeader } from './jpegFixtures';

export interface FakePhoto {
  readonly width: number;
  readonly height: number;
  /** EXIF orientation: 5 to 8 swap width and height once applied. */
  readonly orientation?: number;
  /** Bytes per pixel at quality 1 (a busy picture compresses worse). */
  readonly density?: number;
}

/** A camera-style JPEG: frame header with the size, EXIF with GPS and a maker, a comment. */
export function cameraJpeg(photo: FakePhoto): Uint8Array {
  const maker = segment(0xe1, [...bytes('Exif\u0000\u0000'), ...bytes(`Make Apple Model iPhone 17 Pro Max ${GPS_MARKER} orientation=${photo.orientation ?? 1}`)]);
  const commentSegment = segment(0xfe, bytes(COMMENT_TEXT));
  return Uint8Array.from([
    0xff, 0xd8, ...jfif, ...maker, ...exifWithGPS, ...commentSegment, ...dqt,
    ...segment(0xc0, sofPayload(photo.width, photo.height)), ...dht, ...sosHeader, 0x12, 0x34, 0xff, 0xd9,
  ]);
}

/** The size in a JPEG's first frame header, or null. */
export function frameSize(jpeg: Uint8Array): Size | null {
  for (let index = 0; index + 8 < jpeg.length; index += 1) {
    if (jpeg[index] === 0xff && (jpeg[index + 1] === 0xc0 || jpeg[index + 1] === 0xc2)) {
      const height = (jpeg[index + 5]! << 8) | jpeg[index + 6]!;
      const width = (jpeg[index + 7]! << 8) | jpeg[index + 8]!;
      return { width, height };
    }
  }
  return null;
}

/** The EXIF orientation a fake camera JPEG declares. */
function orientationOf(jpeg: Uint8Array): number {
  const match = /orientation=(\d)/.exec(new TextDecoder().decode(jpeg));
  return match ? Number(match[1]) : 1;
}

interface Loaded extends LoadedMealImage {
  readonly density: number;
}

export interface RenderCall {
  readonly crop: Rect | null;
  readonly size: Size;
  readonly quality: number;
}

export class FakePipeline implements MealImagePipeline {
  loads: MealImageSource[] = [];
  renders: RenderCall[] = [];
  released = 0;
  /** Bytes per pixel at quality 1, for every photo loaded from now on (unless the photo says otherwise). */
  density = 0.5;
  /** Makes `render` return something that is not a JPEG. */
  breakRender = false;
  private readonly refs = new Map<object, FakePhoto>();

  /** A camera still held in memory, as a picture ref. */
  pictureRef(photo: FakePhoto): object {
    const ref = {};
    this.refs.set(ref, photo);
    return ref;
  }

  async load(source: MealImageSource): Promise<LoadedMealImage> {
    this.loads.push(source);
    if (source.kind === 'ref') {
      const photo = this.refs.get(source.ref);
      if (!photo) throw new Error('unknown ref');
      return this.upright(photo.width, photo.height, photo.orientation ?? 1, photo.density);
    }
    const prefix = 'data:image/jpeg;base64,';
    if (!source.uri.startsWith(prefix)) throw new Error('not an image');
    const jpeg = bytesFromBase64(source.uri.slice(prefix.length));
    const size = frameSize(jpeg);
    if (!size) throw new Error('not an image');
    return this.upright(size.width, size.height, orientationOf(jpeg));
  }

  private upright(width: number, height: number, orientation: number, density?: number): Loaded {
    const rotated = orientation >= 5;
    return { width: rotated ? height : width, height: rotated ? width : height, density: density ?? this.density };
  }

  async render(image: LoadedMealImage, crop: Rect | null, size: Size, quality: number): Promise<string> {
    this.renders.push({ crop, size, quality });
    if (this.breakRender) return base64FromBytes(Uint8Array.from([1, 2, 3, 4]));
    const { density } = image as Loaded;
    const entropyLength = Math.max(8, Math.round(size.width * size.height * density * quality));
    const entropy = new Uint8Array(entropyLength);
    for (let index = 0; index < entropyLength; index += 1) entropy[index] = (index * 31 + 7) & 0x7f;
    const jpeg = Uint8Array.from([
      0xff, 0xd8, ...jfif, ...exifWithGPS, ...icc, ...dqt,
      ...segment(0xc0, sofPayload(size.width, size.height)), ...dht, ...sosHeader,
    ]);
    const out = new Uint8Array(jpeg.length + entropy.length + 2);
    out.set(jpeg, 0);
    out.set(entropy, jpeg.length);
    out.set([0xff, 0xd9], jpeg.length + entropy.length);
    return base64FromBytes(out);
  }

  release(): void {
    this.released += 1;
  }
}
