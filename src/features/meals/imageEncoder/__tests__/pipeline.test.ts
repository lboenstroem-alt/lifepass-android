/**
 * The phone's half of the encoder, over a fake expo-image-manipulator whose
 * `saveAsync` writes its JPEG into cache/ImageManipulator as the real one
 * does, a fake of the app's own module (modules/lifepass-meal-image), and the
 * in-memory file system.
 *
 * With the app's module (every build from this code): no meal photo is ever
 * written; the JPEG is compressed in memory and `saveAsync` is never called.
 * Without it (an old dev client): no meal photo is LEFT on disk; the picked
 * copy goes once decoded, the encoder's output once read, and a sweep
 * removes what a crash could have left between a write and its delete.
 */
import { fileSystemState } from '@test/mocks/expoFileSystem';

import { setMealImageNativeForTests, type MealImageNative } from '../nativeImage';
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
  // A binary without the app's module, unless a test says otherwise.
  setMealImageNativeForTests(null);
});

afterAll(() => {
  setMealImageNativeForTests(undefined);
});

describe("with the app's own module: nothing is ever written", () => {
  function installNative(): jest.Mocked<MealImageNative> {
    const native: jest.Mocked<MealImageNative> = {
      encodeJpegAsync: jest.fn(async (image: object, quality: number) => {
        mockCalls.push({ kind: 'encode', value: { width: (image as FakeRef).width, quality } });
        return '/9j/BBBB';
      }),
      pickImageAsync: jest.fn(async () => null),
    };
    setMealImageNativeForTests(native);
    return native;
  }

  it('crops and scales, then compresses into memory', async () => {
    installNative();
    const loaded = await nativeMealImagePipeline.load({ kind: 'ref', ref: {} });
    const base64 = await nativeMealImagePipeline.render(loaded, { x: 10, y: 20, width: 3000, height: 3000 }, { width: 1024, height: 1024 }, 0.55);
    expect(base64).toBe('/9j/BBBB');
    expect(mockCalls.filter((call) => call.kind !== 'render')).toEqual([
      { kind: 'crop', value: { originX: 10, originY: 20, width: 3000, height: 3000 } },
      { kind: 'resize', value: { width: 1024, height: 1024 } },
      { kind: 'encode', value: { width: 1024, quality: 0.55 } },
    ]);
    // The manipulator's file-writing save is never used, and no file ever existed.
    expect(saved).toBe(0);
    expect(fileSystemState.files()).toEqual([]);
  });

  it('decodes a picked photo from its own URI and never deletes it', async () => {
    installNative();
    const picked = 'content://media/picker/0/com.android.providers.media.photopicker/media/1000000042';
    const loaded = await nativeMealImagePipeline.load({ kind: 'uri', uri: picked });
    expect(loaded).toEqual(expect.objectContaining({ width: 4032, height: 3024 }));
    expect(mockCalls).toEqual([{ kind: 'render', value: picked }]);
    // Even told to drop it, a content URI (the member's own photo) is never touched.
    await expect(nativeMealImagePipeline.load({ kind: 'uri', uri: picked, dropAfterLoad: true })).resolves.toBeTruthy();
    expect(fileSystemState.files()).toEqual([]);
  });

  it('lets a failed encoding through as a failure', async () => {
    const native = installNative();
    native.encodeJpegAsync.mockRejectedValueOnce(new Error('ERR_MEAL_IMAGE_ENCODE'));
    const loaded = await nativeMealImagePipeline.load({ kind: 'ref', ref: {} });
    await expect(nativeMealImagePipeline.render(loaded, null, { width: 512, height: 512 }, 0.7)).rejects.toThrow('ERR_MEAL_IMAGE_ENCODE');
  });
});

describe('without it (a binary built before the module): nothing is left on disk', () => {
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

  it('crops and scales in memory, and deletes the file the manipulator encodes into once read', async () => {
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
