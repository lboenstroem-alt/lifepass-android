/**
 * The per-member file store and the outbox adoption rule: the port of iOS
 * OutboxAdoptionTests (an outbox that cannot read its file must not treat
 * the queue as empty) and the HealthLocalStore rules (one folder per member,
 * a read that tells "absent" from "could not read", a cache that no longer
 * decodes is deleted, everything in order on one queue).
 */
import { File } from 'expo-file-system';
import { fileSystemState } from '@test/mocks/expoFileSystem';

import {
  clearExports,
  deleteProfileFolder,
  healthFileUri,
  mergeOutbox,
  modifiedAt,
  profileFolderExists,
  read,
  readOutcome,
  remove,
  settled,
  write,
  writeExport,
  type ReadOutcome,
} from '../localStore';

const MEMBER = '8c2c1b36-2a7e-4b1f-9e0e-2f1c4f0a9c11';
const OTHER = '3c4c1b36-2a7e-4b1f-9e0e-2f1c4f0a9c22';

type Meal = { readonly id: string; readonly key: string };
const meal = (id: string): Meal => ({ id, key: `key-${id}` });
const decodeMeals = (json: unknown): Meal[] => {
  if (!Array.isArray(json)) throw new Error('not a queue');
  return json as Meal[];
};

describe('the outbox adoption rule (iOS OutboxAdoptionTests)', () => {
  it('an unreadable queue is not adopted', () => {
    const { items, adopted } = mergeOutbox<Meal>({ kind: 'unreadable' }, [meal('new')]);
    expect(adopted).toBe(false);
    expect(items.map((item) => item.id)).toEqual(['new']);
  });

  it('on a later read the disk queue comes first and nothing is doubled', () => {
    const { items, adopted } = mergeOutbox({ kind: 'value', value: [meal('a'), meal('b')] }, [meal('b'), meal('new')]);
    expect(adopted).toBe(true);
    expect(items.map((item) => item.id)).toEqual(['a', 'b', 'new']);
  });

  it('an absent file is an empty queue', () => {
    const { items, adopted } = mergeOutbox<Meal>({ kind: 'absent' }, []);
    expect(adopted).toBe(true);
    expect(items).toEqual([]);
  });
});

describe('the store', () => {
  it('tells absent from unreadable', async () => {
    expect((await readOutcome('mealOutbox', MEMBER, decodeMeals)).kind).toBe('absent');
    await expect(write([meal('a')], 'mealOutbox', MEMBER)).resolves.toBe(true);
    const outcome = (await readOutcome('mealOutbox', MEMBER, decodeMeals)) as ReadOutcome<Meal[]>;
    expect(outcome).toEqual({ kind: 'value', value: [meal('a')] });

    const text = jest.spyOn(File.prototype, 'text').mockRejectedValueOnce(new Error('EIO'));
    expect((await readOutcome('mealOutbox', MEMBER, decodeMeals)).kind).toBe('unreadable');
    text.mockRestore();
    // An unreadable file is left alone: the queue on it is still there.
    expect(fileSystemState.read(`health/${MEMBER}/meal-outbox.json`)).toBe(JSON.stringify([meal('a')]));
  });

  it('keeps every member in a folder of their own', async () => {
    await write({ date: '2026-10-17' }, 'today', MEMBER);
    await write({ date: '2026-10-16' }, 'today', OTHER);
    expect(fileSystemState.files()).toEqual([`files/health/${OTHER}/today.json`, `files/health/${MEMBER}/today.json`]);
    expect(await read('today', MEMBER, (json) => json)).toEqual({ date: '2026-10-17' });
  });

  it('a file that no longer decodes is not a cache: it is deleted', async () => {
    fileSystemState.seed(`health/${MEMBER}/today.json`, '{"date": 2026');
    expect(await read('today', MEMBER, (json) => json)).toBeNull();
    expect(fileSystemState.exists(`health/${MEMBER}/today.json`)).toBe(false);

    fileSystemState.seed(`health/${MEMBER}/today.json`, '{"other": true}');
    const strict = (json: unknown) => {
      if (!(json as { date?: string }).date) throw new Error('no date');
      return json;
    };
    expect(await read('today', MEMBER, strict)).toBeNull();
    expect(fileSystemState.exists(`health/${MEMBER}/today.json`)).toBe(false);
  });

  it('writes dates as ISO instants and leaves no scratch file behind', async () => {
    await write({ at: new Date('2026-10-17T09:30:00.250Z') }, 'runner', MEMBER);
    expect(fileSystemState.read(`health/${MEMBER}/runner.json`)).toBe('{"at":"2026-10-17T09:30:00Z"}');
    await write('{"replaced":true}', 'runner', MEMBER);
    expect(fileSystemState.read(`health/${MEMBER}/runner.json`)).toBe('{"replaced":true}');
    expect(fileSystemState.files()).toEqual([`files/health/${MEMBER}/runner.json`]);
  });

  it('refuses a member id that is not one, rather than joining it into a path', async () => {
    expect(healthFileUri('today', '../escape')).toBeNull();
    await expect(write({}, 'today', '../../escape')).resolves.toBe(false);
    expect(fileSystemState.files()).toEqual([]);
    expect(healthFileUri('today', MEMBER.toUpperCase())).toContain(`/health/${MEMBER}/today.json`);
  });

  it('removes one file, or the whole folder, in the order asked', async () => {
    void write([meal('a')], 'mealOutbox', MEMBER);
    void write({ date: '2026-10-17' }, 'today', MEMBER);
    void remove('today', MEMBER);
    await settled();
    expect(fileSystemState.files()).toEqual([`files/health/${MEMBER}/meal-outbox.json`]);
    expect(await profileFolderExists(MEMBER)).toBe(true);

    // A write queued before the wipe never lands after it.
    void write({ date: '2026-10-17' }, 'today', MEMBER);
    await deleteProfileFolder(MEMBER);
    expect(fileSystemState.files()).toEqual([]);
    expect(await profileFolderExists(MEMBER)).toBe(false);
  });

  it('knows when a file was written', async () => {
    expect(await modifiedAt('today', MEMBER)).toBeNull();
    await write({ date: '2026-10-17' }, 'today', MEMBER);
    expect(await modifiedAt('today', MEMBER)).toBeInstanceOf(Date);
  });

  it('the data export is a scratch file the wipe clears', async () => {
    const uri = await writeExport('{"profile":{}}', '2026-10-17');
    expect(uri).toContain('lifepass-export-2026-10-17.json');
    fileSystemState.seed(`${'file:///data/user/0/is.lifepass.android/cache/'}keep-me.txt`, 'x');
    await clearExports();
    expect(fileSystemState.files()).toEqual(['cache/keep-me.txt']);
  });
});
