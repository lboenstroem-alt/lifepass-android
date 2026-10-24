/**
 * The update prompt's decision: versions read and compared as the server
 * reads them (3.0.0 vs 3.1.0, 3.10.0 vs 3.9.0, "3.1" is "3.1.0"), the block
 * below the minimum, the soft prompt once per new version, and FAIL OPEN on
 * everything unknown or unreadable.
 */
import { compareAppVersions, decideUpdatePrompt, formatAppVersion, parseAppVersion, type AppVersion } from '../policy';

describe('versions', () => {
  it.each([
    ['3.0.0', [3, 0, 0]],
    ['3.1', [3, 1, 0]],
    ['3', [3, 0, 0]],
    [' 2.5.6 ', [2, 5, 6]],
    ['10.20.30', [10, 20, 30]],
  ] as const)('reads %p', (raw, version) => {
    expect(parseAppVersion(raw)).toEqual(version);
  });

  it.each(['', 'v3.0.0', '3.0.0-beta', '3.0.0.1', '3.a', 'latest', '3..0', '-1.0.0'])('does not read %p', (raw) => {
    expect(parseAppVersion(raw)).toBeNull();
  });

  it('does not read a missing value', () => {
    expect(parseAppVersion(null)).toBeNull();
    expect(parseAppVersion(undefined)).toBeNull();
  });

  const v = (raw: string): AppVersion => parseAppVersion(raw)!;

  it('compares number by number, not as text', () => {
    expect(compareAppVersions(v('3.0.0'), v('3.1.0'))).toBeLessThan(0);
    expect(compareAppVersions(v('3.1.0'), v('3.0.0'))).toBeGreaterThan(0);
    expect(compareAppVersions(v('3.10.0'), v('3.9.0'))).toBeGreaterThan(0);
    expect(compareAppVersions(v('2.5.10'), v('2.5.9'))).toBeGreaterThan(0);
    expect(compareAppVersions(v('3.1'), v('3.1.0'))).toBe(0);
    expect(compareAppVersions(v('4'), v('3.99.99'))).toBeGreaterThan(0);
  });

  it('writes one spelling per version', () => {
    expect(formatAppVersion(v('3.1'))).toBe('3.1.0');
  });
});

describe('the decision', () => {
  const base = { currentVersion: '3.0.0', minimumVersion: null, latestVersion: null, dismissedLatestVersion: null };

  it('says nothing when the server sets nothing', () => {
    expect(decideUpdatePrompt(base)).toEqual({ kind: 'none' });
  });

  it('blocks below the minimum, and only below it', () => {
    expect(decideUpdatePrompt({ ...base, minimumVersion: '3.1.0' })).toEqual({ kind: 'required' });
    expect(decideUpdatePrompt({ ...base, minimumVersion: '3.0.1', latestVersion: '3.2.0' })).toEqual({ kind: 'required' });
    expect(decideUpdatePrompt({ ...base, minimumVersion: '3.0.0' })).toEqual({ kind: 'none' });
    expect(decideUpdatePrompt({ ...base, minimumVersion: '2.9' })).toEqual({ kind: 'none' });
  });

  it('a block is never waved away like the soft prompt', () => {
    expect(
      decideUpdatePrompt({ ...base, minimumVersion: '3.1.0', latestVersion: '3.1.0', dismissedLatestVersion: '3.1.0' }),
    ).toEqual({ kind: 'required' });
  });

  it('offers a newer version on Google Play', () => {
    expect(decideUpdatePrompt({ ...base, latestVersion: '3.1.0' })).toEqual({ kind: 'available', latestVersion: '3.1.0' });
    expect(decideUpdatePrompt({ ...base, latestVersion: '3.1' })).toEqual({ kind: 'available', latestVersion: '3.1.0' });
    expect(decideUpdatePrompt({ ...base, minimumVersion: '2.0.0', latestVersion: '3.0.1' })).toEqual({
      kind: 'available',
      latestVersion: '3.0.1',
    });
  });

  it('says nothing on the latest version or a newer one (a build ahead of the store)', () => {
    expect(decideUpdatePrompt({ ...base, latestVersion: '3.0.0' })).toEqual({ kind: 'none' });
    expect(decideUpdatePrompt({ ...base, latestVersion: '2.9.9' })).toEqual({ kind: 'none' });
  });

  it('offers each new version once: not again for the one waved away, again for a newer one', () => {
    expect(decideUpdatePrompt({ ...base, latestVersion: '3.1.0', dismissedLatestVersion: '3.1.0' })).toEqual({ kind: 'none' });
    expect(decideUpdatePrompt({ ...base, latestVersion: '3.1', dismissedLatestVersion: '3.1.0' })).toEqual({ kind: 'none' });
    expect(decideUpdatePrompt({ ...base, latestVersion: '3.2.0', dismissedLatestVersion: '3.1.0' })).toEqual({
      kind: 'available',
      latestVersion: '3.2.0',
    });
    // A stored value that is not a version does not silence anything.
    expect(decideUpdatePrompt({ ...base, latestVersion: '3.1.0', dismissedLatestVersion: 'garbage' })).toEqual({
      kind: 'available',
      latestVersion: '3.1.0',
    });
  });

  it('fails open: an unknown or unreadable version of the app, the minimum or the latest blocks nothing', () => {
    expect(decideUpdatePrompt({ ...base, currentVersion: null, minimumVersion: '9.0.0', latestVersion: '9.0.0' })).toEqual({
      kind: 'none',
    });
    expect(decideUpdatePrompt({ ...base, currentVersion: '3.0.0-dev', minimumVersion: '9.0.0' })).toEqual({ kind: 'none' });
    expect(decideUpdatePrompt({ ...base, minimumVersion: 'v9' })).toEqual({ kind: 'none' });
    expect(decideUpdatePrompt({ ...base, latestVersion: 'soon' })).toEqual({ kind: 'none' });
  });
});
