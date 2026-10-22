/**
 * "Choose a photo": with the app's own module, the Photo Picker answers with
 * the photo's own URI and nothing is copied; without it (an old dev client),
 * expo-image-picker's copy is marked for deletion once read, and a pick the
 * page no longer wants is deleted at once.
 */
import { fileSystemState } from '@test/mocks/expoFileSystem';
import * as ImagePicker from 'expo-image-picker';

import { setMealImageNativeForTests, type MealImageNative } from '../../imageEncoder/nativeImage';
import { discardPickedPhoto, pickMealPhoto } from '../pickPhoto';

jest.mock('expo-image-picker', () => ({ launchImageLibraryAsync: jest.fn() }));

const pick = ImagePicker.launchImageLibraryAsync as jest.MockedFunction<typeof ImagePicker.launchImageLibraryAsync>;
const CONTENT = 'content://media/picker/0/com.android.providers.media.photopicker/media/1000000042';
const COPY = 'file:///data/user/0/is.lifepass.android/cache/ImagePicker/abc.jpeg';

function installNative(pickImageAsync: MealImageNative['pickImageAsync']): void {
  setMealImageNativeForTests({ encodeJpegAsync: jest.fn(), pickImageAsync });
}

beforeEach(() => {
  fileSystemState.reset();
  pick.mockReset();
});

afterEach(() => {
  setMealImageNativeForTests(undefined);
});

describe("with the app's own module", () => {
  it('hands back the photo itself, not a copy, and never opens the library picker', async () => {
    installNative(async () => CONTENT);
    expect(await pickMealPhoto()).toEqual({ kind: 'picked', uri: CONTENT, copy: false });
    expect(pick).not.toHaveBeenCalled();
  });

  it('reads backing out as cancelled', async () => {
    installNative(async () => null);
    expect(await pickMealPhoto()).toEqual({ kind: 'cancelled' });
  });

  it('reads an answer without a photo as failed', async () => {
    installNative(async () => {
      throw new Error('ERR_MEAL_IMAGE_PICK');
    });
    expect(await pickMealPhoto()).toEqual({ kind: 'failed' });
  });

  it('never deletes the photo itself when it is not used', () => {
    expect(() => discardPickedPhoto({ kind: 'picked', uri: CONTENT, copy: false })).not.toThrow();
  });
});

describe('without it (an old dev client)', () => {
  beforeEach(() => setMealImageNativeForTests(null));

  it("marks expo-image-picker's copy for deletion once read", async () => {
    pick.mockResolvedValueOnce({ canceled: false, assets: [{ uri: COPY, width: 3000, height: 2000 } as never] });
    expect(await pickMealPhoto()).toEqual({ kind: 'picked', uri: COPY, copy: true });
    expect(pick).toHaveBeenCalledWith(expect.objectContaining({ mediaTypes: ['images'], exif: false, allowsMultipleSelection: false }));
  });

  it('deletes the copy of a pick that is not used', () => {
    fileSystemState.seed(COPY, 'original with GPS');
    discardPickedPhoto({ kind: 'picked', uri: COPY, copy: true });
    expect(fileSystemState.exists(COPY)).toBe(false);
  });

  it('reads a cancel and a failure', async () => {
    pick.mockResolvedValueOnce({ canceled: true, assets: null });
    expect(await pickMealPhoto()).toEqual({ kind: 'cancelled' });
    pick.mockRejectedValueOnce(new Error('no activity'));
    expect(await pickMealPhoto()).toEqual({ kind: 'failed' });
  });
});
