/**
 * The meal photo encoder end to end (iOS MealImageEncoderTests, "A real
 * photo, end to end" and "Where the guide square lands"), over a fake
 * pipeline whose JPEGs carry GPS, a maker and a comment the way a camera
 * writes them. The native decode and JPEG encode are the platform's; the
 * rules (crop, size, quality ladder, floor, byte walk) are tested here.
 */
// Node's, imported: the test realm has no global Buffer, like the phone.
import { Buffer } from 'node:buffer';

import { base64FromBytes, bytesFromBase64 } from '../base64';
import { normalisedGuideRect, pixelCropRect, redrawSize } from '../cropMath';
import {
  encodeMealImage,
  jpegDataUri,
  MEAL_IMAGE_MAX_BYTES,
  MEAL_IMAGE_MIN_SHORT_EDGE,
  MEAL_IMAGE_RETRY_LONG_EDGE,
  MealImageEncoderError,
  type MealImageFailure,
} from '../encoder';
import { stripJpegMetadata } from '../jpegStrip';

import { cameraJpeg, FakePipeline, frameSize, type FakePhoto } from './fakePipeline';
import { COMMENT_TEXT, GPS_MARKER, markers, text } from './jpegFixtures';

const library = (photo: FakePhoto) => ({ kind: 'uri' as const, uri: jpegDataUri(base64FromBytes(cameraJpeg(photo))) });

async function failure(promise: Promise<unknown>): Promise<MealImageFailure | 'none'> {
  try {
    await promise;
    return 'none';
  } catch (error) {
    if (error instanceof MealImageEncoderError) return error.failure;
    throw error;
  }
}

describe('a real photo, end to end', () => {
  it('leaves without GPS, maker or date, and small', async () => {
    const pipeline = new FakePipeline();
    const original = cameraJpeg({ width: 4032, height: 3024 });
    expect(text(original)).toContain(GPS_MARKER); // the fixture really does carry GPS
    const encoded = await encodeMealImage({ kind: 'uri', uri: jpegDataUri(base64FromBytes(original)) }, {}, pipeline);
    const jpeg = bytesFromBase64(encoded.base64);
    for (const marker of [0xe1, 0xe2, 0xe3, 0xed, 0xef, 0xfe]) expect(markers(jpeg)).not.toContain(marker);
    expect(text(jpeg)).not.toContain('iPhone');
    expect(text(jpeg)).not.toContain(GPS_MARKER);
    expect(text(jpeg)).not.toContain(COMMENT_TEXT);
    expect(text(jpeg)).not.toContain('ICC_PROFILE');
    expect(Math.max(encoded.pixelWidth, encoded.pixelHeight)).toBeLessThanOrEqual(1024);
    expect(encoded.byteLength).toBeLessThan(600 * 1024);
    expect(encoded.byteLength).toBe(jpeg.length);
    // The result still decodes (its frame says what was drawn) and is already clean.
    expect(frameSize(jpeg)).toEqual({ width: encoded.pixelWidth, height: encoded.pixelHeight });
    expect(stripJpegMetadata(jpeg)).toEqual(jpeg);
    expect(pipeline.released).toBe(1);
  });

  // A camera capture is cropped to the guide square the member aimed with.
  it('crops a camera capture to the guide square', async () => {
    const pipeline = new FakePipeline();
    const ref = pipeline.pictureRef({ width: 4032, height: 3024 });
    const encoded = await encodeMealImage(
      { kind: 'ref', ref },
      { crop: { kind: 'guide', guide: { x: 60, y: 300, width: 320, height: 320 }, view: { width: 440, height: 956 } } },
      pipeline,
    );
    // The guide is a square, so is what is sent.
    expect(Math.abs(encoded.pixelWidth - encoded.pixelHeight)).toBeLessThanOrEqual(1);
    expect(encoded.pixelWidth).toBeLessThanOrEqual(1024);
    expect(pipeline.renders[0]?.crop).not.toBeNull();
  });

  // The loader applies the orientation (Glide for a file, expo-camera for a
  // still): the encoder works on the upright size and sends upright pixels.
  it('works on the upright image', async () => {
    const encoded = await encodeMealImage(library({ width: 1600, height: 1200, orientation: 6 }), {}, new FakePipeline());
    expect(encoded.pixelWidth).toBeLessThan(encoded.pixelHeight);
  });

  // The retry after a 413 re-encodes at 768 px.
  it('makes the retry encoding smaller', async () => {
    const pipeline = new FakePipeline();
    const first = await encodeMealImage(library({ width: 2000, height: 1500 }), {}, pipeline);
    const retry = await encodeMealImage({ kind: 'uri', uri: jpegDataUri(first.base64) }, { maxLongEdge: MEAL_IMAGE_RETRY_LONG_EDGE }, pipeline);
    expect(Math.max(retry.pixelWidth, retry.pixelHeight)).toBeLessThanOrEqual(768);
  });

  it('refuses bytes that are not an image', async () => {
    const pipeline = new FakePipeline();
    expect(await failure(encodeMealImage({ kind: 'uri', uri: 'data:text/plain;base64,bm90IGFuIGltYWdl' }, {}, pipeline))).toBe('unreadable');
    expect(pipeline.renders).toHaveLength(0);
  });

  it('refuses an encoding the byte walk cannot account for', async () => {
    const pipeline = new FakePipeline();
    pipeline.breakRender = true;
    expect(await failure(encodeMealImage(library({ width: 800, height: 600 }), {}, pipeline))).toBe('malformed');
    expect(pipeline.released).toBe(1);
  });
});

describe('the quality ladder', () => {
  it('starts at 0.7 and stops there when it fits', async () => {
    const pipeline = new FakePipeline();
    await encodeMealImage(library({ width: 4032, height: 3024 }), {}, pipeline);
    expect(pipeline.renders.map((call) => call.quality)).toEqual([0.7]);
    expect(pipeline.renders[0]?.size).toEqual({ width: 1024, height: 768 });
  });

  it('tries 0.55 when 0.7 is over 600 KB', async () => {
    const pipeline = new FakePipeline();
    pipeline.density = 1.3;
    const encoded = await encodeMealImage(library({ width: 4032, height: 3024 }), {}, pipeline);
    expect(pipeline.renders.map((call) => call.quality)).toEqual([0.7, 0.55]);
    expect(encoded.byteLength).toBeLessThanOrEqual(MEAL_IMAGE_MAX_BYTES);
  });

  it('then 768 px at 0.6', async () => {
    const pipeline = new FakePipeline();
    pipeline.density = 2;
    const encoded = await encodeMealImage(library({ width: 4032, height: 3024 }), {}, pipeline);
    expect(pipeline.renders.map((call) => [call.size.width, call.quality])).toEqual([
      [1024, 0.7],
      [1024, 0.55],
      [768, 0.6],
    ]);
    expect(encoded.pixelWidth).toBe(768);
  });

  it('is too large when even that is over the limit', async () => {
    const pipeline = new FakePipeline();
    pipeline.density = 3;
    expect(await failure(encodeMealImage(library({ width: 4032, height: 3024 }), {}, pipeline))).toBe('tooLarge');
    expect(pipeline.renders).toHaveLength(3);
    expect(pipeline.released).toBe(1);
  });
});

describe("the server's floor", () => {
  // A sticker, or a picture saved out of a chat: the phone knows before it asks.
  it('refuses a photo under it as too small, without encoding anything', async () => {
    const pipeline = new FakePipeline();
    expect(await failure(encodeMealImage(library({ width: 40, height: 40 }), {}, pipeline))).toBe('tooSmall');
    expect(pipeline.renders).toHaveLength(0);
  });

  it('is sixty-four pixels exactly, and inclusive', async () => {
    expect(MEAL_IMAGE_MIN_SHORT_EDGE).toBe(64);
    const atTheFloor = await encodeMealImage(library({ width: 200, height: 64 }), {}, new FakePipeline());
    expect(Math.min(atTheFloor.pixelWidth, atTheFloor.pixelHeight)).toBe(64);
    expect(await failure(encodeMealImage(library({ width: 200, height: 63 }), {}, new FakePipeline()))).toBe('tooSmall');
  });

  // A long thin strip is scaled to fit 1,024 px and arrives 51 px tall: judged on what would be SENT.
  it('refuses a strip that shrinks under it too', async () => {
    expect(await failure(encodeMealImage(library({ width: 4000, height: 200 }), {}, new FakePipeline()))).toBe('tooSmall');
  });
});

describe('where the guide square lands', () => {
  it('follows aspect fill', () => {
    // A 3:4 portrait image in a view of the same shape: one to one.
    const same = normalisedGuideRect({ x: 75, y: 100, width: 150, height: 200 }, { width: 300, height: 400 }, { width: 3000, height: 4000 });
    expect(same.x).toBeCloseTo(0.25, 4);
    expect(same.y).toBeCloseTo(0.25, 4);
    expect(same.width).toBeCloseTo(0.5, 4);
    // A tall phone: the 3:4 image is scaled to the height and cropped at the
    // sides, so a centred square covers more of the width.
    const tall = normalisedGuideRect({ x: 60, y: 318, width: 320, height: 320 }, { width: 440, height: 956 }, { width: 3024, height: 4032 });
    expect(tall.x + tall.width / 2).toBeCloseTo(0.5, 3);
    // Still a square in pixels.
    expect(Math.abs(tall.width * 3024 - tall.height * 4032)).toBeLessThanOrEqual(1);
  });

  it('gives the whole image for a degenerate view, and nothing outside it', () => {
    expect(normalisedGuideRect({ x: 0, y: 0, width: 10, height: 10 }, { width: 0, height: 0 }, { width: 100, height: 100 })).toEqual({ x: 0, y: 0, width: 1, height: 1 });
    const overflowing = normalisedGuideRect({ x: -50, y: -50, width: 500, height: 500 }, { width: 300, height: 400 }, { width: 3000, height: 4000 });
    expect(overflowing.x).toBe(0);
    expect(overflowing.x + overflowing.width).toBeLessThanOrEqual(1);
  });

  it('rounds the crop out to whole pixels, and keeps the whole image for a sliver', () => {
    expect(pixelCropRect({ x: 0.25, y: 0.25, width: 0.5, height: 0.5 }, { width: 1001, height: 1001 })).toEqual({ x: 250, y: 250, width: 501, height: 501 });
    expect(pixelCropRect({ x: 0.5, y: 0.5, width: 0.04, height: 0.5 }, { width: 1000, height: 1000 })).toBeNull();
  });

  it('never upscales on the redraw', () => {
    expect(redrawSize({ width: 40, height: 40 }, 1024)).toEqual({ width: 40, height: 40 });
    expect(redrawSize({ width: 4032, height: 3024 }, 1024)).toEqual({ width: 1024, height: 768 });
    expect(redrawSize({ width: 4000, height: 200 }, 1024)).toEqual({ width: 1024, height: 51 });
  });
});

describe('base64', () => {
  it('round-trips every byte value and every padding length', () => {
    for (const length of [0, 1, 2, 3, 4, 5, 255, 256, 12_289]) {
      const data = Uint8Array.from({ length }, (_, index) => (index * 7 + 3) & 0xff);
      const encoded = base64FromBytes(data);
      expect(encoded).toBe(Buffer.from(data).toString('base64'));
      expect(bytesFromBase64(encoded)).toEqual(data);
    }
  });

  it('refuses text that is not base64', () => {
    expect(() => bytesFromBase64('abc')).toThrow();
    expect(() => bytesFromBase64('ab!d')).toThrow();
  });
});
