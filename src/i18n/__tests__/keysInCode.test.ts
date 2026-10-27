// Every key the app's code writes out in a t() call is in both tables.
//
// `lookup` (../index.ts) falls back to the key itself, so a key the tables
// lack is shown on screen as "favourites.tabs.outdoors" and nothing else
// fails. The keys most at risk are the ones Android ships ahead of iOS
// (../ahead-of-ios.json): scripts/import-ios-strings.py generates the tables
// from an iOS source plus those entries, so an entry deleted before the
// tables come from an iOS source that has its words takes its keys out of the
// tables with it, and generated.test.ts still passes (its counts follow the
// file). Keep every entry until the script, run over the iOS source the
// committed tables are generated from, reports it as landed.
//
// This reads every call of t, tp, translate, translatePlural and lookup in
// src/ (tests excepted) whose key is written out: a string, or each string arm
// of a `? :`, `??` or `||`. A plural's base needs its `.one` and its `.many`.
// A key built at run time (`attraction.kind.${kind}`) is not read here; the
// feature's own copy test holds those.
import fs from 'fs';
import path from 'path';
import ts from 'typescript';

import { tables } from '../tables';

const ROOT = path.join(__dirname, '..', '..', '..');
const SRC = path.join(ROOT, 'src');

/** The calls whose first argument is a key: t('a.b'), translate('a.b', lang), lookup('a.b', lang). */
const KEY_CALLS: ReadonlySet<string> = new Set(['t', 'translate', 'lookup']);

/** The plural calls, whose first argument is a base read as `.one` and `.many`. */
const PLURAL_CALLS: ReadonlySet<string> = new Set(['tp', 'translatePlural']);

type KeyUse = { readonly key: string; readonly where: string };

/** The keys an argument names when they are written out; none for one built at run time. */
function writtenKeys(node: ts.Expression): string[] {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return [node.text];
  if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isSatisfiesExpression(node)) {
    return writtenKeys(node.expression);
  }
  if (ts.isConditionalExpression(node)) return [...writtenKeys(node.whenTrue), ...writtenKeys(node.whenFalse)];
  if (
    ts.isBinaryExpression(node) &&
    (node.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken || node.operatorToken.kind === ts.SyntaxKind.BarBarToken)
  ) {
    return [...writtenKeys(node.left), ...writtenKeys(node.right)];
  }
  return [];
}

/** Every key `source` writes out in a key call, a plural's as its `.one` and `.many`. */
function keysWrittenIn(source: string, fileName: string): KeyUse[] {
  const kind = fileName.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, kind);
  const uses: KeyUse[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const name = ts.isIdentifier(callee) ? callee.text : ts.isPropertyAccessExpression(callee) ? callee.name.text : null;
      const first = node.arguments[0];
      if (name !== null && first !== undefined && (KEY_CALLS.has(name) || PLURAL_CALLS.has(name))) {
        const where = `${fileName}:${file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1}`;
        for (const key of writtenKeys(first)) {
          for (const read of PLURAL_CALLS.has(name) ? [`${key}.one`, `${key}.many`] : [key]) {
            uses.push({ key: read, where });
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return uses;
}

/** The uses whose key either table lacks, as "key (file:line)". */
function missingFromTables(uses: readonly KeyUse[]): string[] {
  return uses.filter(({ key }) => !(key in tables.en && key in tables.is)).map(({ key, where }) => `${key} (${where})`);
}

/** Every .ts and .tsx file of the app: no test, no test folder, no declaration file. */
function appSources(dir: string): string[] {
  const files: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== '__tests__') files.push(...appSources(full));
    } else if (/\.tsx?$/.test(entry.name) && !/\.d\.ts$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
      files.push(full);
    }
  }
  return files;
}

describe('the keys the app writes out', () => {
  const uses = appSources(SRC).flatMap((file) => keysWrittenIn(fs.readFileSync(file, 'utf8'), path.relative(ROOT, file)));

  it('are read from the app’s own calls (a check that finds none would pass anything)', () => {
    // About 2,100 when this was written.
    expect(uses.length).toBeGreaterThan(1500);
  });

  it('are all in both tables, the keys shipped ahead of iOS included', () => {
    expect(missingFromTables(uses)).toEqual([]);
  });
});

describe('reading the keys out of the code', () => {
  const source = [
    "t('tab.home');",
    'translate(`booking.room.label`, lang);',
    "translator.t(saved ? 'favourites.heart.saveFailed' : ('favourites.heart.removeFailed'));",
    "t(custom ?? 'visitRating.card.title');",
    "tp('venue.ratings.count', count);",
    "translatePlural('venue.ratings.sub_a11y', count, lang, { label });",
    't(`attraction.kind.${kind}`);',
    't(key);',
    "other('not.a.key');",
  ].join('\n');

  it('takes a written key, each arm of a ? : or ??, and a plural’s two forms, and nothing built at run time', () => {
    expect(keysWrittenIn(source, 'example.tsx')).toEqual([
      { key: 'tab.home', where: 'example.tsx:1' },
      { key: 'booking.room.label', where: 'example.tsx:2' },
      { key: 'favourites.heart.saveFailed', where: 'example.tsx:3' },
      { key: 'favourites.heart.removeFailed', where: 'example.tsx:3' },
      { key: 'visitRating.card.title', where: 'example.tsx:4' },
      { key: 'venue.ratings.count.one', where: 'example.tsx:5' },
      { key: 'venue.ratings.count.many', where: 'example.tsx:5' },
      { key: 'venue.ratings.sub_a11y.one', where: 'example.tsx:6' },
      { key: 'venue.ratings.sub_a11y.many', where: 'example.tsx:6' },
    ]);
  });

  it('names a key the tables lack, with where it is used', () => {
    const uses = keysWrittenIn("t('tab.home');\nt(open ? 'tab.explore' : 'tab.nowhere');\ntp('tab.plan', 2);", 'screen.tsx');
    expect(missingFromTables(uses)).toEqual([
      'tab.nowhere (screen.tsx:2)',
      'tab.plan.one (screen.tsx:3)',
      'tab.plan.many (screen.tsx:3)',
    ]);
  });
});
