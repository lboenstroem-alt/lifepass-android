// The generated iOS tables and the generator that writes them
// (scripts/import-ios-strings.py).
//
// The tables are only as good as the copy is identical to iOS's, so these
// check that the committed files agree with each other (tables, manifest),
// that the counts are the Swift dictionaries' counts, and that the generator
// refuses exactly what the iOS DEBUG build traps on (a key two packs define,
// a pack redefining a base key). `scripts/ci.sh` re-runs the generator over
// the iOS sources when LIFEPASS_IOS_SERVICES points at them and fails on any
// difference, so the committed tables cannot drift from iOS. Copy Android
// ships before iOS has it is in ../ahead-of-ios.json, which the generator
// applies, so the tables still equal its output.
import { execFileSync, spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

import ahead from '../ahead-of-ios.json';
import manifest from '../strings.manifest.json';
import { generatedTables } from '../tables';
import { baseDictionary, healthPacks, LANGS, placeholders } from './dictionaries';

const ROOT = path.join(__dirname, '..', '..', '..');
const SCRIPT = path.join(ROOT, 'scripts', 'import-ios-strings.py');

describe('the committed tables', () => {
  it('have every key in both languages', () => {
    expect(Object.keys(generatedTables.is).sort()).toEqual(Object.keys(generatedTables.en).sort());
  });

  it('are the iOS dictionaries merged: base 1,093 keys, six health packs, one intentional override', () => {
    expect(manifest.intentionalOverrides).toEqual(['coach.greeting']);
    expect(manifest.dictionaries.map((d) => d.name)).toEqual([
      'base',
      'core',
      'plan',
      'meals',
      'consent',
      'runner',
      'appleHealth',
    ]);
    // iOS 2.5.6 (161a0a8): Localization.swift and the six LocalizationHealth packs.
    expect(Object.fromEntries(manifest.dictionaries.map((d) => [d.name, d.keys.length]))).toEqual({
      base: 1093,
      core: 50,
      plan: 648,
      meals: 245,
      consent: 137,
      runner: 125,
      appleHealth: 63,
    });
    for (const dictionary of manifest.dictionaries) {
      expect([dictionary.name, dictionary.enOnly, dictionary.isOnly]).toEqual([dictionary.name, [], []]);
    }

    const union = new Set(manifest.dictionaries.flatMap((d) => [...d.keys, ...d.enOnly]));
    expect(new Set(Object.keys(generatedTables.en))).toEqual(union);
    // 1,093 base keys + 1,268 pack keys, the override counted once.
    expect(Object.keys(generatedTables.en)).toHaveLength(2360);
    expect(manifest.counts).toEqual({ en: 2360, is: 2360 });
  });

  it('give each key to one dictionary only, apart from the override', () => {
    const owner = new Map<string, string>();
    for (const dictionary of manifest.dictionaries) {
      for (const key of [...dictionary.keys, ...dictionary.enOnly, ...dictionary.isOnly]) {
        const first = owner.get(key);
        if (first !== undefined) {
          expect([key, first, dictionary.name]).toEqual(['coach.greeting', 'base', dictionary.name]);
        }
        owner.set(key, dictionary.name);
      }
    }
  });

  it('carry every ahead-of-iOS change, and the manifest lists exactly those', () => {
    type Side = Partial<Record<'en' | 'is', Record<string, string>>>;
    for (const change of ahead.changes as { change: string; ios: Side; android: Side }[]) {
      for (const lang of LANGS) {
        const android = change.android[lang] ?? {};
        for (const [key, value] of Object.entries(android)) {
          expect([change.change, lang, key, generatedTables[lang][key]]).toEqual([change.change, lang, key, value]);
        }
        for (const key of Object.keys(change.ios[lang] ?? {}).filter((k) => !(k in android))) {
          expect([change.change, lang, key, generatedTables[lang][key]]).toEqual([change.change, lang, key, undefined]);
        }
      }
    }
    // A change iOS has landed drops out of the manifest when the tables are
    // regenerated: then delete it from ahead-of-ios.json too.
    expect(manifest.aheadOfIos).toEqual(ahead.changes.map((c) => c.change));
  });

  it('keep every {placeholder} of the English value in the Icelandic one', () => {
    const lost = Object.entries(generatedTables.en).filter(([key, value]) =>
      placeholders(value).some((p) => !(generatedTables.is[key] ?? '').includes(p)),
    );
    expect(lost.map(([key]) => key)).toEqual([]);
  });

  it('rebuild the base and every health pack with values in both languages', () => {
    expect(Object.keys(baseDictionary.en)).toHaveLength(1092);
    expect(healthPacks.map((p) => p.name)).toEqual(['core', 'plan', 'meals', 'consent', 'runner', 'appleHealth']);
    for (const dictionary of [baseDictionary, ...healthPacks]) {
      for (const lang of LANGS) {
        expect(Object.values(dictionary[lang]).every((v) => typeof v === 'string')).toBe(true);
      }
    }
  });
});

// The generator itself, run over small Swift sources shaped like iOS's.

const PACK_FILES = [
  ['core', 'LocalizationHealth.swift'],
  ['plan', 'LocalizationHealth+Plan.swift'],
  ['meals', 'LocalizationHealth+Meals.swift'],
  ['consent', 'LocalizationHealth+Consent.swift'],
  ['runner', 'LocalizationHealth+Runner.swift'],
  ['appleHealth', 'LocalizationHealth+AppleHealth.swift'],
] as const;

type Entries = Record<string, string>;

/** Every temporary folder a test made, removed after the suite. */
const temporary: string[] = [];

function makeTemp(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  temporary.push(dir);
  return dir;
}

afterAll(() => {
  for (const dir of temporary) fs.rmSync(dir, { recursive: true, force: true });
});

/** Values are written into the literal as given: Swift escapes and all. */
function swiftDictionary(declaration: string, entries: Entries): string {
  const lines = Object.entries(entries).map(([k, v]) => `        "${k}": "${v}",`);
  return `    ${declaration}: [String: String] = [\n${lines.join('\n')}\n    ]\n`;
}

/** Write a fake "LifePass 2/Services" folder and return its path. */
function writeSources(
  base: { en: Entries; is: Entries },
  packs: Partial<Record<(typeof PACK_FILES)[number][0], { en: Entries; is: Entries }>> = {},
  extraBase = '',
): string {
  const dir = makeTemp('lp-ios-strings-');
  fs.writeFileSync(
    path.join(dir, 'Localization.swift'),
    'enum LPStrings {\n' +
      '    // A comment with "quotes" and [brackets] the parser must skip.\n' +
      swiftDictionary('private static let baseEN', base.en) +
      extraBase +
      swiftDictionary('private static let baseIS', base.is) +
      '}\n',
  );
  for (const [name, file] of PACK_FILES) {
    const pack = packs[name] ?? { en: {}, is: {} };
    fs.writeFileSync(
      path.join(dir, file),
      `extension LPHealthStrings {\n  enum ${name} {\n` +
        swiftDictionary('static let en', pack.en) +
        swiftDictionary('static let `is`', pack.is) +
        '  }\n}\n',
    );
  }
  return dir;
}

/** Write an ahead-of-ios.json with these changes (none by default) and return its path. */
function writeAhead(changes: unknown[] = []): string {
  const file = path.join(makeTemp('lp-ios-ahead-'), 'ahead-of-ios.json');
  fs.writeFileSync(file, JSON.stringify({ changes }));
  return file;
}

function generate(
  services: string,
  aheadFile: string = writeAhead(),
): { status: number | null; stdout: string; stderr: string; out: string } {
  const out = makeTemp('lp-i18n-out-');
  const run = spawnSync('python3', [SCRIPT, services, '--out', out, '--ahead', aheadFile], { encoding: 'utf8' });
  return { status: run.status, stdout: run.stdout, stderr: run.stderr, out };
}

function readJson(dir: string, file: string): unknown {
  return JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
}

describe('scripts/import-ios-strings.py', () => {
  beforeAll(() => {
    // The generator is Python; CI (ubuntu-latest) and macOS both ship it.
    execFileSync('python3', ['--version']);
  });

  it('merges the packs over the base and writes the tables and the manifest', () => {
    const sources = writeSources(
      {
        en: { 'tab.home': 'Home', 'coach.greeting': 'Hi', 'a.joined': 'Line one ' },
        is: { 'tab.home': 'Heim', 'coach.greeting': 'Hæ', 'a.joined': 'Lína' },
      },
      {
        core: { en: { 'tab.plan': 'Plan', 'coach.greeting': 'Hello {name}' }, is: { 'tab.plan': 'Áætlun', 'coach.greeting': 'Halló {name}' } },
        runner: { en: { 'runner.rest': 'Rest \\u{2192} \\"now\\"' }, is: { 'runner.rest': 'Hvíld' } },
      },
    );
    const { status, stderr, out } = generate(sources);
    expect(stderr).toBe('');
    expect(status).toBe(0);
    expect(readJson(out, 'strings.en.json')).toEqual({
      'a.joined': 'Line one ',
      'coach.greeting': 'Hello {name}',
      'runner.rest': 'Rest → "now"',
      'tab.home': 'Home',
      'tab.plan': 'Plan',
    });
    expect(readJson(out, 'strings.is.json')).toMatchObject({ 'coach.greeting': 'Halló {name}', 'tab.plan': 'Áætlun' });
    const written = readJson(out, 'strings.manifest.json') as typeof manifest;
    expect(written.dictionaries.map((d) => [d.name, d.keys])).toEqual([
      ['base', ['a.joined', 'coach.greeting', 'tab.home']],
      ['core', ['coach.greeting', 'tab.plan']],
      ['plan', []],
      ['meals', []],
      ['consent', []],
      ['runner', ['runner.rest']],
      ['appleHealth', []],
    ]);
    expect(written.counts).toEqual({ en: 5, is: 5 });
  });

  it('joins a value written as concatenated literals', () => {
    const sources = writeSources(
      { en: {}, is: {} },
      {},
      '    private static let unused = 0\n',
    );
    // Rewrite the base with a `+` continuation, as Localization.swift does.
    const file = path.join(sources, 'Localization.swift');
    fs.writeFileSync(
      file,
      fs
        .readFileSync(file, 'utf8')
        .replace(
          'private static let baseEN: [String: String] = [\n',
          'private static let baseEN: [String: String] = [\n        "long.line": "One, " + "two.",\n',
        )
        .replace(
          'private static let baseIS: [String: String] = [\n',
          'private static let baseIS: [String: String] = [\n        "long.line": "Eitt, "\n            + "tvö.",\n',
        ),
    );
    const { status, out } = generate(sources);
    expect(status).toBe(0);
    expect(readJson(out, 'strings.en.json')).toEqual({ 'long.line': 'One, two.' });
    expect(readJson(out, 'strings.is.json')).toEqual({ 'long.line': 'Eitt, tvö.' });
  });

  it('refuses a key two packs define, and writes nothing', () => {
    const sources = writeSources(
      { en: {}, is: {} },
      {
        plan: { en: { 'health.same': 'A' }, is: { 'health.same': 'A' } },
        meals: { en: { 'health.same': 'B' }, is: { 'health.same': 'B' } },
      },
    );
    const { status, stderr, out } = generate(sources);
    expect(status).toBe(1);
    expect(stderr).toContain('health.same is defined by both plan and meals');
    expect(fs.readdirSync(out)).toEqual([]);
  });

  it('refuses a pack that redefines a base key other than the override', () => {
    const sources = writeSources(
      { en: { 'tab.home': 'Home' }, is: { 'tab.home': 'Heim' } },
      { core: { en: { 'tab.home': 'Start' }, is: { 'tab.home': 'Byrja' } } },
    );
    const { status, stderr } = generate(sources);
    expect(status).toBe(1);
    expect(stderr).toContain('tab.home (pack core) already exists in the base dictionary');
  });

  it('refuses a key written twice in one dictionary', () => {
    const sources = writeSources({ en: { 'tab.home': 'Home' }, is: { 'tab.home': 'Heim' } });
    const file = path.join(sources, 'Localization.swift');
    fs.writeFileSync(
      file,
      fs.readFileSync(file, 'utf8').replace('"tab.home": "Heim",', '"tab.home": "Heim",\n        "tab.home": "Heima",'),
    );
    const { status, stderr } = generate(sources);
    expect(status).not.toBe(0);
    expect(stderr).toContain('duplicate key tab.home');
  });

  it('records a key that exists in one language only', () => {
    const sources = writeSources({ en: { 'tab.home': 'Home', 'tab.only': 'Only' }, is: { 'tab.home': 'Heim' } });
    const { status, out } = generate(sources);
    expect(status).toBe(0);
    const written = readJson(out, 'strings.manifest.json') as typeof manifest;
    expect(written.dictionaries[0]).toEqual({ name: 'base', keys: ['tab.home'], enOnly: ['tab.only'], isOnly: [] });
  });
});

describe('scripts/import-ios-strings.py, copy ahead of iOS', () => {
  const sources = () =>
    writeSources(
      {
        en: { 'booking.activity': 'Activity', 'venue.hours_this_week': 'This week', 'tab.home': 'Home' },
        is: { 'booking.activity': 'Tími', 'venue.hours_this_week': 'Þessa viku', 'tab.home': 'Heim' },
      },
      { core: { en: { 'tab.plan': 'Plan' }, is: { 'tab.plan': 'Áætlun' } } },
    );
  const activity = {
    change: 'Service row says Þjónusta',
    dictionary: 'base',
    ios: { is: { 'booking.activity': 'Tími' } },
    android: { is: { 'booking.activity': 'Þjónusta' } },
  };
  const usualHours = {
    change: 'Usual hours',
    dictionary: 'base',
    ios: { en: { 'venue.hours_this_week': 'This week' }, is: { 'venue.hours_this_week': 'Þessa viku' } },
    android: { en: { 'venue.hours_usual': 'Usual hours' }, is: { 'venue.hours_usual': 'Almennur opnunartími' } },
  };

  it('applies a change while iOS still has the old text, and lists it in the manifest', () => {
    const { status, stdout, stderr, out } = generate(sources(), writeAhead([activity]));
    expect(stderr).toBe('');
    expect(status).toBe(0);
    expect(stdout).toContain('ahead of iOS: Service row says Þjónusta');
    expect(readJson(out, 'strings.is.json')).toMatchObject({ 'booking.activity': 'Þjónusta', 'tab.home': 'Heim' });
    expect(readJson(out, 'strings.en.json')).toMatchObject({ 'booking.activity': 'Activity' });
    expect((readJson(out, 'strings.manifest.json') as typeof manifest).aheadOfIos).toEqual(['Service row says Þjónusta']);
  });

  it('renames a key in both languages, in the dictionary that owns it', () => {
    const { status, out } = generate(sources(), writeAhead([usualHours]));
    expect(status).toBe(0);
    const en = readJson(out, 'strings.en.json') as Record<string, string>;
    expect(en['venue.hours_usual']).toBe('Usual hours');
    expect(en).not.toHaveProperty('venue.hours_this_week');
    expect(readJson(out, 'strings.is.json')).toMatchObject({ 'venue.hours_usual': 'Almennur opnunartími' });
    const written = readJson(out, 'strings.manifest.json') as typeof manifest;
    expect(written.dictionaries[0]!.keys).toEqual(['booking.activity', 'tab.home', 'venue.hours_usual']);
    expect(written.counts).toEqual({ en: 4, is: 4 });
  });

  it('leaves a change iOS has landed alone, and says to delete it', () => {
    const landed = writeSources({
      en: { 'booking.activity': 'Activity' },
      is: { 'booking.activity': 'Þjónusta' },
    });
    const { status, stderr, out } = generate(landed, writeAhead([activity]));
    expect(status).toBe(0);
    expect(stderr).toContain('iOS has landed "Service row says Þjónusta"; delete it from src/i18n/ahead-of-ios.json');
    expect(readJson(out, 'strings.is.json')).toEqual({ 'booking.activity': 'Þjónusta' });
    expect((readJson(out, 'strings.manifest.json') as typeof manifest).aheadOfIos).toEqual([]);
  });

  it('refuses, writing nothing, when iOS has other text for the key', () => {
    const other = writeSources({
      en: { 'booking.activity': 'Activity' },
      is: { 'booking.activity': 'Afþreying' },
    });
    const { status, stderr, out } = generate(other, writeAhead([activity]));
    expect(status).toBe(1);
    expect(stderr).toContain('iOS has {"is": {"booking.activity": "Afþreying"}}');
    expect(fs.readdirSync(out)).toEqual([]);
  });

  it('refuses, writing nothing, when iOS no longer has the key', () => {
    const gone = writeSources({ en: { 'tab.home': 'Home' }, is: { 'tab.home': 'Heim' } });
    const { status, stderr, out } = generate(gone, writeAhead([activity]));
    expect(status).toBe(1);
    expect(stderr).toContain('"booking.activity": null');
    expect(fs.readdirSync(out)).toEqual([]);
  });

  it('refuses a half-landed rename', () => {
    const half = writeSources({
      en: { 'venue.hours_usual': 'Usual hours' },
      is: { 'venue.hours_this_week': 'Þessa viku' },
    });
    const { status, stderr } = generate(half, writeAhead([usualHours]));
    expect(status).toBe(1);
    expect(stderr).toContain('"Usual hours": iOS has');
  });

  it('refuses a malformed ahead file', () => {
    const plain = sources();
    for (const [changes, message] of [
      [[{ ...activity, android: activity.ios }], 'changes nothing'],
      [[{ ...activity, dictionary: 'nope' }], 'no iOS dictionary named nope'],
      [[{ ...activity, ios: { de: {} } }], 'needs "ios" and "android"'],
      [[{ dictionary: 'base', ios: {}, android: {} }], 'needs a "change" description'],
    ] as const) {
      const { status, stderr, out } = generate(plain, writeAhead([...changes]));
      expect([status, stderr.includes(message)]).toEqual([1, true]);
      expect(fs.readdirSync(out)).toEqual([]);
    }
    const missing = generate(plain, path.join(makeTemp('lp-ios-ahead-'), 'none.json'));
    expect(missing.status).toBe(1);
    expect(missing.stderr).toContain('cannot read');
  });
});
