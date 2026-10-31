/**
 * The byte walk (iOS MealImageEncoderTests, "The byte walk"), against the
 * SAME JPEG fixtures as the server's `image.test.ts`: what leaves the phone
 * is pixels and only pixels, no place, no time, no camera, no comment.
 */
import { JpegMalformedError, stripJpegMetadata } from '../jpegStrip';

import {
  adobe,
  bytes,
  clean,
  COMMENT_TEXT,
  comment,
  containsBytes,
  dht,
  dirty,
  dqt,
  end,
  entropy,
  GPS_MARKER,
  inScan,
  jfxx,
  markers,
  progressive,
  segment,
  sof0,
  sosHeader,
  text,
  trailing,
  u8,
} from './jpegFixtures';

describe('the byte walk (identical to the server stripJpegMetadata)', () => {
  it('keeps the pixels and the keep list and nothing else', () => {
    expect(stripJpegMetadata(dirty)).toEqual(clean);
  });

  it('removes every segment that could carry a member value', () => {
    const stripped = stripJpegMetadata(dirty);
    for (const planted of ['Exif', GPS_MARKER, 'http://ns.adobe.com/xap/', 'ICC_PROFILE', 'Photoshop 3.0', COMMENT_TEXT]) {
      expect(text(stripped)).not.toContain(planted);
    }
    const found = markers(stripped);
    for (const marker of [0xe1, 0xe2, 0xed, 0xfe]) expect(found).not.toContain(marker);
    // A JFIF header of its own length stays.
    expect(found).toContain(0xe0);
  });

  it('drops a container appended after the end', () => {
    const stripped = stripJpegMetadata(trailing);
    expect(stripped).toEqual(clean);
    expect(text(stripped)).not.toContain(GPS_MARKER);
  });

  it('drops a block planted between the entropy data and the end', () => {
    const stripped = stripJpegMetadata(inScan);
    expect(text(stripped)).not.toContain(GPS_MARKER);
    expect(markers(stripped)).not.toContain(0xe1);
    // The pixels survive intact.
    expect(containsBytes(stripped, entropy)).toBe(true);
  });

  it("drops a comment between a progressive image's scans", () => {
    const stripped = stripJpegMetadata(progressive);
    expect(text(stripped)).not.toContain(COMMENT_TEXT);
    expect(markers(stripped).filter((marker) => marker === 0xda)).toHaveLength(2);
  });

  it('drops a non-JFIF APP0 and keeps an Adobe APP14', () => {
    const image = u8([0xff, 0xd8, ...jfxx, ...adobe, ...dqt, ...sof0, ...dht, ...sosHeader, ...entropy, ...end]);
    const stripped = stripJpegMetadata(image);
    expect(text(stripped)).not.toContain('JFXX');
    expect(text(stripped)).toContain('Adobe');
  });

  // The keep list is a LENGTH, not a prefix: an APP0 that opens "JFIF" and runs on carries whatever it likes.
  it('drops a JFIF APP0 that runs on past its header', () => {
    const smuggled = segment(0xe0, [...bytes('JFIF\u0000'), 1, 1, 0, 0, 1, 0, 1, 0, 0, ...bytes(`GPS ${GPS_MARKER} taken by Gudrun`)]);
    const stripped = stripJpegMetadata(u8([0xff, 0xd8, ...smuggled, ...dqt, ...sof0, ...dht, ...sosHeader, ...entropy, ...end]));
    expect(text(stripped)).not.toContain(GPS_MARKER);
    expect(text(stripped)).not.toContain('JFIF');
  });

  it('drops a JFIF APP0 that declares a thumbnail', () => {
    const withThumbnail = segment(0xe0, [...bytes('JFIF\u0000'), 1, 1, 0, 0, 1, 0, 1, 1, 1, 0xaa, 0xbb, 0xcc]);
    const stripped = stripJpegMetadata(u8([0xff, 0xd8, ...withThumbnail, ...dqt, ...sof0, ...dht, ...sosHeader, ...entropy, ...end]));
    expect(markers(stripped)).not.toContain(0xe0);
  });

  it('drops an Adobe APP14 longer than its twelve bytes', () => {
    const fat = segment(0xee, [...bytes('Adobe'), 0, 100, 0, 0, 0, 0, 0, ...bytes(COMMENT_TEXT)]);
    const stripped = stripJpegMetadata(u8([0xff, 0xd8, ...fat, ...dqt, ...sof0, ...dht, ...sosHeader, ...entropy, ...end]));
    expect(text(stripped)).not.toContain(COMMENT_TEXT);
    expect(text(stripped)).not.toContain('Adobe');
  });

  it('is a fixed point', () => {
    expect(stripJpegMetadata(clean)).toEqual(clean);
  });

  it('refuses what it cannot account for', () => {
    const dac = u8([0xff, 0xd8, ...segment(0xcc, new Array<number>(4).fill(7)), ...dqt, ...sof0, ...dht, ...sosHeader, ...entropy, ...end]);
    expect(() => stripJpegMetadata(dac)).toThrow(JpegMalformedError);
    expect(() => stripJpegMetadata(clean.slice(0, clean.length - 2))).toThrow(JpegMalformedError);
    expect(() => stripJpegMetadata(new Uint8Array(16).fill(5))).toThrow(JpegMalformedError);
    const noFrame = u8([0xff, 0xd8, ...dqt, ...sosHeader, ...entropy, ...end]);
    expect(() => stripJpegMetadata(noFrame)).toThrow(JpegMalformedError);
  });

  it('keeps restart markers inside a scan and a comment after it goes', () => {
    const withRestarts = u8([0xff, 0xd8, ...dqt, ...sof0, ...segment(0xdd, [0, 4]), ...dht, ...sosHeader, 0x11, 0xff, 0xd0, 0x22, 0xff, 0xd1, 0x33, ...comment, ...end]);
    const stripped = stripJpegMetadata(withRestarts);
    expect(markers(stripped)).toEqual([0xd8, 0xdb, 0xc0, 0xdd, 0xc4, 0xda, 0xd0, 0xd1, 0xd9]);
    expect(text(stripped)).not.toContain(COMMENT_TEXT);
  });
});
