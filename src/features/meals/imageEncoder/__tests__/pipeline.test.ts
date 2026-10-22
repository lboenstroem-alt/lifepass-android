/**
 * The phone's half of the encoder, over a fake expo-image-manipulator that
 * writes its JPEG into cache/ImageManipulator as the real one does, and the
 * in-memory file system: no meal photo is left on disk. The picked copy goes
 * once decoded, the encoder's output once read, and a sweep removes what a
 * crash could have left between a write and its delete.
 */
import { fileSystemState } from '@test/mocks/expoFileSystem';

import { deleteFileQuietly, MEAL_PHOTO_CACHE_FOLDERS, nativeMealImagePipeline, sweepMealPhotoFiles } from '../pipeline';

const CACHE = 'file:///data/user/0/is.lifepass.android/cache';

interface FakeRef {
  width: number;
  height: number;
  released: boolean;
  release(): void;
  saveAsync(options: { format: string; compress: number; base64: boolean }): Promise<{ uri: string; width: number; height: number; base64?: string }>;
}

const mockCalls: { kind: string; value?: unknown }[] = [];
let saved = 0;

function mockFakeRef(width: number, height: number): FakeRef {
  const ref: FakeRef = {
    width,
    height,
    released: false,
    release() {
      ref.released = true;
    },
    async saveAsync(options) {
      mockCalls.push({ kind: 'save', value: options });
      saved += 1;
      const uri = `${CACHE}/ImageManipulator/${saved}.jpg`;
      // The real module writes the file AND returns the base64.
      fileSystemState.seed(uri, 'jpeg bytes');
      return { uri, width, height, base64: '/9j/AAAA' };
    },
  };
  return ref;
}

jest.mock('expo-image-manipulator', () => ({
  SaveFormat: { JPEG: 'jpeg', PNG: 'png' },
  ImageManipulator: {
    manipulate: (source: unknown) => {
      let width = 4032;
      let height = 3024;
      const context = {
        released: false,
        crop(rect: { originX: number; originY: number; width: number; height: number }) {
          mockCalls.push({ kind: 'crop', value: rect });
          width = rect.width;
          height = rect.height;
          return context;
        },
        resize(size: { width: number; height: number }) {
          mockCalls.push({ kind: 'resize', value: size });
          width = size.width;
          height = size.height;
          return context;
        },
        async renderAsync() {
          mockCalls.push({ kind: 'render', value: typeof source === 'string' ? source : 'ref' });
          return mockFakeRef(width, height);
        },
        release() {
          context.released = true;
        },
      };
      return context;
    },
  },
}));

beforeEach(() => {
  fileSystemState.reset();
  mockCalls.length = 0;
  saved = 0;
});

it('decodes a picked photo, then deletes the copy the picker made', async () => {
  const picked = `${CACHE}/ImagePicker/abc.jpeg`;
  fileSystemState.seed(picked, 'original with GPS');
  const loaded = await nativeMealImagePipeline.load({ kind: 'uri', uri: picked, dropAfterLoad: true });
  expect(loaded).toEqual(expect.objectContaining({ width: 4032, height: 3024 }));
  expect(fileSystemState.exists(picked)).toBe(false);
});

it('keeps a file it was not told to drop', async () => {
  const other = `${CACHE}/elsewhere.jpeg`;
  fileSystemState.seed(other, 'x');
  await nativeMealImagePipeline.load({ kind: 'uri', uri: other });
  expect(fileSystemState.exists(other)).toBe(true);
});

it('crops, scales and encodes in memory, and deletes the file the encoder wrote', async () => {
  const loaded = await nativeMealImagePipeline.load({ kind: 'ref', ref: {} });
  const base64 = await nativeMealImagePipeline.render(loaded, { x: 10, y: 20, width: 3000, height: 3000 }, { width: 1024, height: 1024 }, 0.7);
  expect(base64).toBe('/9j/AAAA');
  expect(mockCalls.filter((call) => call.kind !== 'render')).toEqual([
    { kind: 'crop', value: { originX: 10, originY: 20, width: 3000, height: 3000 } },
    { kind: 'resize', value: { width: 1024, height: 1024 } },
    { kind: 'save', value: { format: 'jpeg', compress: 0.7, base64: true } },
  ]);
  expect(fileSystemState.files()).toEqual([]);
});

it('lets go of the decoded image', async () => {
  const loaded = await nativeMealImagePipeline.load({ kind: 'ref', ref: {} });
  nativeMealImagePipeline.release(loaded);
  expect((loaded as unknown as { ref: FakeRef }).ref.released).toBe(true);
});

it('sweeps both cache folders, and only them', () => {
  fileSystemState.seed(`${CACHE}/ImagePicker/left.jpeg`, 'x');
  fileSystemState.seed(`${CACHE}/ImageManipulator/left.jpg`, 'x');
  fileSystemState.seed(`${CACHE}/other/keep.json`, '{}');
  sweepMealPhotoFiles();
  expect(fileSystemState.files()).toEqual(['cache/other/keep.json']);
  expect(MEAL_PHOTO_CACHE_FOLDERS).toEqual(['ImagePicker', 'ImageManipulator']);
  // Nothing there is fine too.
  expect(() => sweepMealPhotoFiles()).not.toThrow();
});

it('deletes quietly what is already gone, and never a remote or data URI', () => {
  expect(() => deleteFileQuietly(`${CACHE}/ImageManipulator/gone.jpg`)).not.toThrow();
  expect(() => deleteFileQuietly('data:image/jpeg;base64,/9j/')).not.toThrow();
  expect(() => deleteFileQuietly(null)).not.toThrow();
});
