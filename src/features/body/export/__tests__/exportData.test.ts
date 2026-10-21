/**
 * "Download my data" (iOS `BodyAndGoalsView.export`): the server's answer
 * kept whole in `lifepass-export-<server day>.json`, handed to the share
 * sheet, and deleted once the sheet answers; the limit's own line, the
 * generic one for anything else, silence for a cancelled call, and the
 * outcome reported without anything from the file.
 */
import { api, Reply } from '@test/server';
import * as Sharing from 'expo-sharing';
import { Directory, File, Paths } from 'expo-file-system';

import { TransportError } from '../../../../api';
import { stubApiClientPerTest } from '../../../../api/testing';
import { healthLocalStore } from '../../../../health';
import * as analytics from '../../../../lib/analytics';
import { exportErrorKey, fetchExportFile, shareExportFile } from '../exportData';
import { startExport } from '../startExport';

jest.mock('expo-sharing', () => ({
  isAvailableAsync: jest.fn(async () => true),
  shareAsync: jest.fn(async () => undefined),
}));

stubApiClientPerTest();

const EXPORT = { format: '2026-09-v3', profile: { locale: 'is', id: 'p-1' }, health: { mealLogs: [{ id: 'meal-1' }] }, aNewKey: 'kept' };
const OCT_21 = new Date('2026-10-21T23:30:00Z');

function exportFiles(): string[] {
  const cache = new Directory(Paths.cache);
  if (!cache.exists) return [];
  return cache
    .list()
    .filter((entry): entry is File => entry instanceof File && entry.name.startsWith('lifepass-export-'))
    .map((file) => file.name);
}

const share = Sharing.shareAsync as jest.Mock;
const available = Sharing.isAvailableAsync as jest.Mock;

beforeEach(() => {
  share.mockImplementation(async () => undefined);
  available.mockImplementation(async () => true);
});

afterEach(async () => {
  await healthLocalStore.clearExports();
});

describe('reading the export', () => {
  it("writes the server's answer whole, every key kept, under the server's day", async () => {
    api.on('GET', '/account/export', Reply.ok(EXPORT));
    const fetched = await fetchExportFile(OCT_21);
    expect(fetched.kind).toBe('ready');
    expect(exportFiles()).toEqual(['lifepass-export-2026-10-21.json']);
    const text = await healthLocalStore.exportFile('2026-10-21').text();
    expect(JSON.parse(text)).toEqual(EXPORT);
  });

  it('429 account_export_limit has its own line; anything else the generic one', async () => {
    api.on('GET', '/account/export', Reply.problem(429, 'account_export_limit', {}, { 'Retry-After': '3600' }));
    await expect(fetchExportFile(OCT_21)).resolves.toEqual({ kind: 'failed', errorKey: 'bodygoals.export.limit', outcome: 'limit' });

    api.on('GET', '/account/export', Reply.problem(500, 'internal_error'));
    await expect(fetchExportFile(OCT_21)).resolves.toEqual({ kind: 'failed', errorKey: 'common.error_body', outcome: 'error' });
    expect(exportFiles()).toEqual([]);
  });

  it('anything that is not the limit problem is the generic line', () => {
    expect(exportErrorKey(new Error('boom'))).toEqual({ errorKey: 'common.error_body', outcome: 'error' });
    expect(exportErrorKey(new TransportError('offline'))).toEqual({ errorKey: 'common.error_body', outcome: 'error' });
  });
});

describe('sharing it', () => {
  it('the file is there while the share sheet is up and gone once it answers', async () => {
    api.on('GET', '/account/export', Reply.ok(EXPORT));
    const fetched = await fetchExportFile(OCT_21);
    if (fetched.kind !== 'ready') throw new Error('not ready');
    let seenDuringShare: string[] = [];
    share.mockImplementation(async (uri: string, options: object) => {
      seenDuringShare = exportFiles();
      expect(uri).toBe(fetched.uri);
      expect(options).toEqual({ mimeType: 'application/json', UTI: 'public.json' });
    });
    await expect(shareExportFile(fetched.uri)).resolves.toBe(true);
    expect(seenDuringShare).toEqual(['lifepass-export-2026-10-21.json']);
    expect(exportFiles()).toEqual([]);
  });

  it('a share sheet that cannot be shown still deletes the file', async () => {
    api.on('GET', '/account/export', Reply.ok(EXPORT));
    const fetched = await fetchExportFile(OCT_21);
    if (fetched.kind !== 'ready') throw new Error('not ready');
    share.mockRejectedValueOnce(new Error('no activity'));
    await expect(shareExportFile(fetched.uri)).resolves.toBe(false);
    expect(exportFiles()).toEqual([]);

    const again = await fetchExportFile(OCT_21);
    if (again.kind !== 'ready') throw new Error('not ready');
    available.mockResolvedValueOnce(false);
    await expect(shareExportFile(again.uri)).resolves.toBe(false);
    expect(exportFiles()).toEqual([]);
  });
});

describe('the whole tap', () => {
  it('reports ok, then shares; the outcome carries nothing from the file', async () => {
    const track = jest.spyOn(analytics, 'track');
    api.on('GET', '/account/export', Reply.ok(EXPORT));
    const calls: string[] = [];
    share.mockImplementation(async () => {
      calls.push('share');
    });
    await startExport({
      onReady: () => calls.push('ready'),
      onFailed: (key) => calls.push(`failed ${key}`),
      onCancelled: () => calls.push('cancelled'),
    });
    expect(calls).toEqual(['ready', 'share']);
    expect(track).toHaveBeenCalledWith('health_export_requested', { outcome: 'ok' });
  });

  it('the limit: its line and outcome `limit`', async () => {
    const track = jest.spyOn(analytics, 'track');
    api.on('GET', '/account/export', Reply.problem(429, 'account_export_limit'));
    const failed = jest.fn();
    await startExport({ onReady: jest.fn(), onFailed: failed, onCancelled: jest.fn() });
    expect(failed).toHaveBeenCalledWith('bodygoals.export.limit');
    expect(track).toHaveBeenCalledWith('health_export_requested', { outcome: 'limit' });
    expect(share).not.toHaveBeenCalled();
  });
});
