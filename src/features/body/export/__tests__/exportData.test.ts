/**
 * "Download my data" (iOS `BodyAndGoalsView.export`): the server's answer
 * kept whole in `lifepass-export-<server day>.json`, handed to the share
 * sheet, and deleted once the chosen app has had its time with it
 * (./cleanup.ts), at once when no sheet opened; nothing written or shared
 * for a page or member that has gone; the limit's own line, the generic one
 * for anything else, silence for a cancelled call, and the outcome reported
 * without anything from the file.
 */
import { api, Reply } from '@test/server';
import * as Sharing from 'expo-sharing';
import { Directory, File, Paths } from 'expo-file-system';

import { TransportError } from '../../../../api';
import { stubApiClientPerTest } from '../../../../api/testing';
import { healthLocalStore } from '../../../../health';
import * as analytics from '../../../../lib/analytics';
import { EXPORT_SHARE_GRACE_MS, resetExportCleanupForTests } from '../cleanup';
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

/** LifePass in front; the files really go. */
const appState = { currentState: 'active' as string, addEventListener: () => ({ remove: () => undefined }) };

beforeEach(() => {
  share.mockImplementation(async () => undefined);
  available.mockImplementation(async () => true);
  appState.currentState = 'active';
  resetExportCleanupForTests({ appState, clear: () => healthLocalStore.clearExports() });
});

afterEach(async () => {
  resetExportCleanupForTests();
  jest.useRealTimers();
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
  it('the file is there while the share sheet is up, and for a while after it answers, then goes', async () => {
    api.on('GET', '/account/export', Reply.ok(EXPORT));
    const fetched = await fetchExportFile(OCT_21);
    if (fetched.kind !== 'ready') throw new Error('not ready');
    let seenDuringShare: string[] = [];
    share.mockImplementation(async (uri: string, options: object) => {
      seenDuringShare = exportFiles();
      expect(uri).toBe(fetched.uri);
      expect(options).toEqual({ mimeType: 'application/json', UTI: 'public.json' });
    });
    jest.useFakeTimers();
    await expect(shareExportFile(fetched.uri)).resolves.toBe(true);
    expect(seenDuringShare).toEqual(['lifepass-export-2026-10-21.json']);
    // Android's chooser can answer before the chosen app has read it.
    expect(exportFiles()).toEqual(['lifepass-export-2026-10-21.json']);
    await jest.advanceTimersByTimeAsync(EXPORT_SHARE_GRACE_MS);
    expect(exportFiles()).toEqual([]);
  });

  it('a share sheet that cannot be shown deletes the file at once', async () => {
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

  it('a new export replaces a file still waiting out its time', async () => {
    api.on('GET', '/account/export', Reply.ok(EXPORT));
    const first = await fetchExportFile(new Date('2026-10-20T12:00:00Z'));
    if (first.kind !== 'ready') throw new Error('not ready');
    await shareExportFile(first.uri);
    expect(exportFiles()).toEqual(['lifepass-export-2026-10-20.json']);
    await fetchExportFile(OCT_21);
    expect(exportFiles()).toEqual(['lifepass-export-2026-10-21.json']);
  });
});

describe('a page or member that has gone', () => {
  it('a read that lands after: nothing written', async () => {
    api.on('GET', '/account/export', Reply.ok(EXPORT));
    await expect(fetchExportFile(OCT_21, () => false)).resolves.toEqual({ kind: 'stale' });
    expect(exportFiles()).toEqual([]);
  });

  it('gone by the time the share would open: no sheet, the file deleted', async () => {
    api.on('GET', '/account/export', Reply.ok(EXPORT));
    const fetched = await fetchExportFile(OCT_21);
    if (fetched.kind !== 'ready') throw new Error('not ready');
    await expect(shareExportFile(fetched.uri, () => false)).resolves.toBe(false);
    expect(share).not.toHaveBeenCalled();
    expect(exportFiles()).toEqual([]);
  });

  it('the whole tap: nothing said, nothing shared, nothing reported', async () => {
    const track = jest.spyOn(analytics, 'track');
    api.on('GET', '/account/export', Reply.ok(EXPORT));
    const calls: string[] = [];
    await startExport({
      isCurrent: () => false,
      onReady: () => calls.push('ready'),
      onFailed: (key) => calls.push(`failed ${key}`),
      onCancelled: () => calls.push('cancelled'),
    });
    expect(calls).toEqual(['cancelled']);
    expect(share).not.toHaveBeenCalled();
    expect(track).not.toHaveBeenCalledWith('health_export_requested', expect.anything());
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
