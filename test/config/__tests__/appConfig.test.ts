/**
 * The native app configuration, as Expo evaluates it (app.json, app.config.js
 * and the config/fragments plugins), plus eas.json and package.json.
 *
 * F0 acceptance: no `ios` block, both App Link hosts, `allowBackup: false`,
 * the blocked permissions; every EAS profile on production (DECISIONS: no
 * staging); no Health Connect; no push; secrets never embedded.
 */
import { execFileSync } from 'child_process';
import { existsSync, readdirSync, readFileSync } from 'fs';
import path from 'path';

import { PRODUCTION, resolveBaseUrl } from '../../../src/config/env';

const ROOT = path.join(__dirname, '..', '..', '..');
const read = (file: string) => readFileSync(path.join(ROOT, file), 'utf8');
const readJson = <T = Record<string, unknown>>(file: string): T => JSON.parse(read(file)) as T;

// Evaluated JSON config: loosely typed on purpose, the assertions are the types.
type Json = Record<string, any>;

/** `npx expo config --type public`, in a clean Node process (no Jest mocks). */
function publicConfig(extraEnv: Record<string, string> = {}): Json {
  const script =
    "const { getConfig } = require('expo/config');" +
    'const { exp } = getConfig(process.cwd(), { isPublicConfig: true, skipSDKVersionRequirement: true });' +
    "process.stdout.write(JSON.stringify(exp, (k, v) => (typeof v === 'function' ? `[fn ${v.name}]` : v)));";
  const out = execFileSync(process.execPath, ['-e', script], {
    cwd: ROOT,
    env: { ...process.env, ...extraEnv },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  return JSON.parse(out) as Json;
}

let config: Json;
beforeAll(() => {
  config = publicConfig();
}, 60_000);

const pluginNames = (c: Json): string[] =>
  (c.plugins as unknown[]).map((p) => (Array.isArray(p) ? String(p[0]) : String(p)));
const pluginOptions = (c: Json, name: string): Json | undefined => {
  const entry = (c.plugins as unknown[]).find((p) => Array.isArray(p) && p[0] === name) as unknown[] | undefined;
  return entry?.[1] as Json | undefined;
};

describe('app identity', () => {
  it('is the LifePass Android app at version 2.5.6 (D22), with the EAS project kept', () => {
    expect(config.name).toBe('LifePass');
    expect(config.android.package).toBe('is.lifepass.android');
    expect(config.version).toBe('2.5.6');
    expect(readJson<Json>('package.json').version).toBe('2.5.6');
    expect(config.scheme).toBe('lifepass');
    expect(config.owner).toBe('lifepass');
    expect(config.slug).toBe('lifepass-iceland');
    expect(config.extra.eas.projectId).toBe('a5813f67-0cd8-439f-a597-9681dcbc0368');
  });

  it('leaves the versionCode to EAS (remote, above the Play maximum)', () => {
    expect(config.android.versionCode).toBeUndefined();
    expect(readJson<Json>('eas.json').cli.appVersionSource).toBe('remote');
  });
});

describe('Android only (critic-android-only-leftovers)', () => {
  it('has no ios block and never names the native iOS bundle id', () => {
    expect(readJson<Json>('app.json').expo).not.toHaveProperty('ios');
    expect(config).not.toHaveProperty('ios');
    for (const file of ['app.json', 'app.config.js', 'eas.json', 'package.json']) {
      expect(read(file)).not.toContain('is.lifepass.ios');
    }
  });

  it('has no web target', () => {
    expect(config.platforms).toEqual(['android']);
    expect(config).not.toHaveProperty('web');
    const pkg = readJson<Json>('package.json');
    expect(pkg.scripts).not.toHaveProperty('web');
    expect(pkg.dependencies).not.toHaveProperty('react-native-web');
    expect(pkg.dependencies).not.toHaveProperty('react-dom');
    expect(existsSync(path.join(ROOT, 'src/components/VenueMap.web.tsx'))).toBe(false);
  });

  it('refuses an iOS run instead of letting prebuild add one', () => {
    expect(readJson<Json>('package.json').scripts.ios).toMatch(/Android app only.*exit 1/);
  });
});

describe('privacy (platform-privacy-local-data)', () => {
  it('turns Android Auto Backup off', () => {
    expect(config.android.allowBackup).toBe(false);
  });

  it('blocks storage, media, background location, overlay and advertising-id permissions', () => {
    expect(config.android.blockedPermissions).toEqual(
      expect.arrayContaining([
        'android.permission.READ_MEDIA_IMAGES',
        'android.permission.READ_MEDIA_VIDEO',
        'android.permission.READ_EXTERNAL_STORAGE',
        'android.permission.WRITE_EXTERNAL_STORAGE',
        'android.permission.ACCESS_BACKGROUND_LOCATION',
        'android.permission.SYSTEM_ALERT_WINDOW',
        'com.google.android.gms.permission.AD_ID',
      ]),
    );
  });

  it('asks for precise and approximate location, and the microphone for dictation', () => {
    expect(config.android.permissions).toEqual(
      expect.arrayContaining([
        'android.permission.ACCESS_FINE_LOCATION',
        'android.permission.ACCESS_COARSE_LOCATION',
        'android.permission.RECORD_AUDIO',
      ]),
    );
  });

  it('never embeds the Mapbox download token in the app config', () => {
    const withToken = publicConfig({ MAPBOX_DOWNLOAD_TOKEN: 'sk.SENTINEL-not-a-token' });
    expect(JSON.stringify(withToken)).not.toContain('SENTINEL');
    expect(pluginOptions(withToken, '@rnmapbox/maps')).toBeUndefined();
  }, 60_000);
});

describe('App Links (5.4, D19, D23)', () => {
  const filters = () => config.android.intentFilters as Json[];

  it('claims /scan on both lifepass.is and www.lifepass.is, verified', () => {
    const scan = filters().find((f) => f.data.some((d: Json) => d.pathPrefix === '/scan'));
    expect(scan).toBeDefined();
    expect(scan!.autoVerify).toBe(true);
    expect(scan!.category).toEqual(expect.arrayContaining(['BROWSABLE', 'DEFAULT']));
    expect(scan!.data).toEqual([
      { scheme: 'https', host: 'lifepass.is', pathPrefix: '/scan' },
      { scheme: 'https', host: 'www.lifepass.is', pathPrefix: '/scan' },
    ]);
  });

  it('claims the auth email return https://www.lifepass.is/app/auth-callback', () => {
    const auth = filters().find((f) => f.data.some((d: Json) => d.pathPrefix === '/app/auth-callback'));
    expect(auth).toMatchObject({
      action: 'VIEW',
      autoVerify: true,
      data: [{ scheme: 'https', host: 'www.lifepass.is', pathPrefix: '/app/auth-callback' }],
    });
  });

  it('claims nothing else on the web', () => {
    const hosts = filters().flatMap((f) => f.data.map((d: Json) => `${d.host}${d.pathPrefix}`));
    expect(hosts.sort()).toEqual(['lifepass.is/scan', 'www.lifepass.is/app/auth-callback', 'www.lifepass.is/scan']);
  });
});

describe('config fragments', () => {
  /* eslint-disable @typescript-eslint/no-require-imports */
  const appConfig = require(path.join(ROOT, 'app.config.js'));
  const notifications = require(path.join(ROOT, 'config/fragments/notifications.js'));
  const buildProperties = require(path.join(ROOT, 'config/fragments/buildProperties.js'));
  const healthConnect = require(path.join(ROOT, 'config/fragments/healthConnect.js'));
  /* eslint-enable @typescript-eslint/no-require-imports */

  it('composes every fragment file, in the documented order', () => {
    const files = readdirSync(path.join(ROOT, 'config/fragments'))
      .filter((f) => f.endsWith('.js') && !f.startsWith('_'))
      .map((f) => f.replace(/\.js$/, ''));
    expect([...appConfig.FRAGMENTS].sort()).toEqual(files.sort());
    expect(appConfig.FRAGMENTS).toEqual([
      'mapbox',
      'notifications',
      'camera',
      'imagePicker',
      'background',
      'buildProperties',
      'speech',
      'healthConnect',
    ]);
  });

  it('registers each plugin once', () => {
    expect(() => appConfig({ config: { plugins: ['expo-notifications'] } })).toThrow(/registered twice/);
    const names = pluginNames(config);
    expect(new Set(names).size).toBe(names.length);
  });

  it('uses a monochrome notification icon and the brand accent (push-setup)', () => {
    const options = pluginOptions(config, 'expo-notifications');
    expect(options).toMatchObject({ icon: './assets/notification-icon.png', color: '#4785C2' });
    const png = readFileSync(path.join(ROOT, 'assets/notification-icon.png'));
    expect(png.subarray(1, 4).toString()).toBe('PNG');
    expect(png.readUInt32BE(16)).toBe(96); // width
    expect(png.readUInt32BE(20)).toBe(96); // height
    expect(png[25]).toBe(6); // RGBA: transparency carries the glyph
    expect(png.equals(readFileSync(path.join(ROOT, 'assets/icon.png')))).toBe(false);
    expect(notifications.NOTIFICATION_ICON).toBe(options!.icon);
  });

  it('targets an API level Google Play accepts', () => {
    expect(pluginOptions(config, 'expo-build-properties')?.android).toEqual(buildProperties.ANDROID_SDK);
    expect(buildProperties.ANDROID_SDK.targetSdkVersion).toBeGreaterThanOrEqual(35);
    expect(buildProperties.ANDROID_SDK.compileSdkVersion).toBeGreaterThanOrEqual(buildProperties.ANDROID_SDK.targetSdkVersion);
  });

  it('keeps Health Connect out (owner decision, 16 Oct 2026)', () => {
    const input = { plugins: [] };
    expect(healthConnect(input)).toBe(input);
    const pkg = readJson<Json>('package.json');
    expect({ ...pkg.dependencies, ...pkg.devDependencies }).not.toHaveProperty('react-native-health-connect');
    expect(JSON.stringify(config)).not.toMatch(/health-connect|permission\.health\./);
  });

  it('registers background work, dictation and the map', () => {
    expect(pluginNames(config)).toEqual(
      expect.arrayContaining(['@rnmapbox/maps', 'expo-background-task', 'expo-notifications', 'expo-build-properties']),
    );
    expect(pluginNames(config).some((n) => n.includes('expo-speech-recognition'))).toBe(true);
  });
});

describe('EAS profiles: production everywhere (DECISIONS: no staging)', () => {
  const eas = readJson<Json>('eas.json');
  const resolve = (name: string): Json => {
    const profile = eas.build[name] as Json;
    const parent = profile.extends ? resolve(profile.extends) : {};
    return { ...parent, ...profile, env: { ...(parent.env ?? {}), ...(profile.env ?? {}) } };
  };

  it.each(['development', 'preview', 'production'])('%s talks to production', (name) => {
    const profile = resolve(name);
    expect(profile.environment).toBe('production');
    expect(profile.env.EXPO_PUBLIC_LIFEPASS_API_URL).toBe(PRODUCTION.apiBaseUrl);
    expect(profile.env.EXPO_PUBLIC_SUPABASE_URL).toBe(PRODUCTION.supabaseUrl);
    expect(profile.env.EXPO_PUBLIC_SUPABASE_ANON_KEY).toBe(PRODUCTION.supabaseAnonKey);
    expect(profile.env.EXPO_PUBLIC_SOCIAL_SIGN_IN).toBe('YES');
    // The values survive the app's own resolution unchanged.
    expect(resolveBaseUrl(profile.env.EXPO_PUBLIC_LIFEPASS_API_URL, 'fallback')).toBe(PRODUCTION.apiBaseUrl);
    // Fixture switches never reach a build.
    expect(profile.env).not.toHaveProperty('EXPO_PUBLIC_FIXTURE');
  });

  it('never names staging or a secret', () => {
    const text = read('eas.json');
    expect(text).not.toMatch(/staging/i);
    expect(text).not.toMatch(/sk\.|service_role|MAPBOX_DOWNLOAD_TOKEN"\s*:/);
  });

  it('builds a signed app bundle with a remote, auto-incremented versionCode', () => {
    const production = resolve('production');
    expect(production.autoIncrement).toBe(true);
    expect(production.android.buildType).toBe('app-bundle');
    expect(resolve('development').developmentClient).toBe(true);
  });

  it('submits to the production track as a draft the owner releases by hand', () => {
    expect(eas.submit.production.android).toEqual({ track: 'production', releaseStatus: 'draft' });
  });
});

describe('push-setup: local notifications only', () => {
  const sourceFiles = (dir: string): string[] =>
    readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((entry) => {
      const rel = path.join(dir, entry.name);
      if (entry.isDirectory()) return entry.name === '__tests__' ? [] : sourceFiles(rel);
      return /\.(ts|tsx|js)$/.test(entry.name) ? [rel] : [];
    });

  it('never asks for a push token anywhere in the app', () => {
    const offenders = [...sourceFiles('src'), 'App.tsx', 'index.ts'].filter((file) =>
      /getExpoPushTokenAsync|getDevicePushTokenAsync/.test(read(file)),
    );
    expect(offenders).toEqual([]);
  });

  it('ships no Firebase configuration', () => {
    expect(existsSync(path.join(ROOT, 'google-services.json'))).toBe(false);
    expect(config.android.googleServicesFile).toBeUndefined();
  });
});

describe('repository hygiene', () => {
  it('ignores native folders, env files and keys', () => {
    const ignore = read('.gitignore');
    for (const entry of ['/android', '/ios', '.env', '*.jks', 'node_modules/']) expect(ignore).toContain(entry);
  });

  it('documents every EXPO_PUBLIC variable the app reads in .env.example, without values', () => {
    const example = read('.env.example');
    const envSource = read('src/config/env.ts') + read('src/dev/fixtures.ts');
    const used = [...new Set(envSource.match(/EXPO_PUBLIC_[A-Z_]+/g) ?? [])];
    for (const name of used) expect(example).toMatch(new RegExp(`^#? ?${name}=`, 'm'));
    expect(example).not.toMatch(/=\s*(sk\.|pk\.)/);
  });
});
