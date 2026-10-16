/**
 * The in-memory sandbox behind expo-file-system, through the package's own
 * JS: the SDK 54 object API and the legacy functions see one disk.
 */
import { Directory, File, Paths } from 'expo-file-system';
import * as Legacy from 'expo-file-system/legacy';

import { fileSystemState } from '@test/mocks/expoFileSystem';

describe('object API (File, Directory, Paths)', () => {
  it('writes and reads a per-profile file under the documents folder', async () => {
    const dir = new Directory(Paths.document, 'health', 'p1');
    dir.create({ intermediates: true });
    const file = new File(dir, 'today.json');
    file.write('{"date":"2026-10-16"}');
    expect(file.exists).toBe(true);
    expect(await file.text()).toBe('{"date":"2026-10-16"}');
    expect(file.textSync()).toBe('{"date":"2026-10-16"}');
    expect(file.name).toBe('today.json');
    expect(fileSystemState.files()).toEqual(['files/health/p1/today.json']);
  });

  it('refuses to write into a folder that does not exist, as Android does', () => {
    expect(() => new File(Paths.document, 'nowhere', 'x.json').write('x')).toThrow(/does not exist/);
  });

  it('lists, deletes a folder with everything in it, and reports what exists', () => {
    fileSystemState.seed('health/p1/today.json', '{}');
    fileSystemState.seed('health/p1/hashes.json', '{}');
    fileSystemState.seed('health/p2/today.json', '{}');
    const p1 = new Directory(Paths.document, 'health', 'p1');
    expect(p1.list().map((entry) => entry.name).sort()).toEqual(['hashes.json', 'today.json']);
    p1.delete();
    expect(p1.exists).toBe(false);
    expect(fileSystemState.files()).toEqual(['files/health/p2/today.json']);
    expect(Paths.info(new Directory(Paths.document, 'health').uri)).toEqual({ exists: true, isDirectory: true });
  });

  it('keeps base64 and bytes intact', async () => {
    const file = new File(Paths.cache, 'photo.jpg');
    file.create();
    file.write('/9j/4AAQ', { encoding: 'base64' });
    expect(file.base64Sync()).toBe('/9j/4AAQ');
    expect(Array.from(await file.bytes()).slice(0, 2)).toEqual([0xff, 0xd8]);
    expect(file.type).toBe('image/jpeg');
  });

  it('create refuses an existing path unless told to overwrite or be idempotent', () => {
    const dir = new Directory(Paths.document, 'outbox');
    dir.create();
    expect(() => dir.create()).toThrow(/already exists/);
    expect(() => dir.create({ idempotent: true })).not.toThrow();
    const file = new File(dir, 'w1.json');
    file.create();
    expect(() => file.create()).toThrow(/already exists/);
    file.create({ overwrite: true });
  });
});

describe('legacy API', () => {
  it('shares the disk with the object API', async () => {
    expect(Legacy.documentDirectory).toBe('file:///data/user/0/is.lifepass.android/files/');
    await Legacy.makeDirectoryAsync(`${Legacy.documentDirectory}runner`, { intermediates: true });
    await Legacy.writeAsStringAsync(`${Legacy.documentDirectory}runner/s1.json`, '{"sets":[]}');
    expect(new File(Paths.document, 'runner', 's1.json').textSync()).toBe('{"sets":[]}');
    expect(await Legacy.readDirectoryAsync(`${Legacy.documentDirectory}runner`)).toEqual(['s1.json']);
    const info = await Legacy.getInfoAsync(`${Legacy.documentDirectory}runner/s1.json`);
    expect(info).toMatchObject({ exists: true, isDirectory: false, size: 11 });
  });

  it('throws on a missing file unless deletion is idempotent', async () => {
    const missing = `${Legacy.documentDirectory}missing.json`;
    await expect(Legacy.readAsStringAsync(missing)).rejects.toThrow();
    await expect(Legacy.deleteAsync(missing)).rejects.toThrow();
    await expect(Legacy.deleteAsync(missing, { idempotent: true })).resolves.toBeUndefined();
    expect((await Legacy.getInfoAsync(missing)).exists).toBe(false);
  });

  it('never downloads in a test', async () => {
    await expect(Legacy.downloadAsync('https://example.com/a.png', `${Legacy.cacheDirectory}a.png`)).rejects.toThrow(
      /not available in tests/,
    );
  });
});

it('starts every test with empty documents and cache folders', () => {
  expect(fileSystemState.files()).toEqual([]);
  expect(new Directory(Paths.document).exists).toBe(true);
  expect(new Directory(Paths.cache).exists).toBe(true);
});
