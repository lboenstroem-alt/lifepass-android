#!/usr/bin/env python3
r"""Regenerate the server refusal-code fixture the refusal table is tested against.

Writes src/api/__tests__/serverRefusalCodes.ts: every code that any file in
the import closure of the API routes behind the app's refusal call sites can
raise. Those routes are POST /bookings, the booking preview, the class and
slot timetables, cancel, the booking payment session and its confirm, the
walk-in and its preview, and the plan or pass checkout.
src/api/__tests__/memberRefusal.test.ts then fails, naming the code, for
every code the refusal table neither words nor accounts for.

This is the Android twin of the iOS generator behind
LifePassTests/MemberRefusalTests.swift (`serverRefusalCodes`, v4, route
import closure). Run against the commit iOS used (98fe5d2d) it reproduces
that fixture's 292 codes exactly.

Usage (read-only: `git show` on the given revision, nothing is checked out):
  python3 -I scripts/gen-refusal-fixture.py <lifepass-monorepo> [<rev>]

<rev> defaults to origin/main. Re-run it when the API contract version moves.

How it reads the server. From each route file it follows every value import
(`@/` and relative, `import()` too; `import type` is skipped) and reads, in
every file it reaches:
- each string literal in a `new DomainError(` (or a DomainError subclass's
  `super(`) first argument, so a code picked by a ternary is in the list (a
  literal compared in the condition is not), and the values of a constant
  map the argument indexes (`DISCOUNT_CODE_ERROR_CODES[reason]`);
- each `{ code: "x", message }` refusal handed to a shared gate (a provider
  adapter's code among them);
- each `lifepass.is/problems/<slug>` a route or helper builds itself.
Two edges are cut, each for a reason: the post-check-in health hook (which
catches and logs every error) is read but not followed, and from the member
dashboard file only `upsertCustomerProfile`, the one function the auth actor
imports, is read. Notification templates are skipped. The check-in void
domain file is read in full as well (not followed), so the list never
shrinks if an import moves. Codes are folded to the table's spelling
(lowercase, `-` to `_`).
"""
import os
import posixpath
import re
import subprocess
import sys

OUT = os.path.join(os.path.dirname(__file__), "..", "src", "api", "__tests__", "serverRefusalCodes.ts")

WEB = "apps/web/src/"
ROUTES = [
    "app/api/v1/bookings/route.ts",
    "app/api/v1/activities/[activityId]/booking-preview/route.ts",
    "app/api/v1/activities/[activityId]/classes/route.ts",
    "app/api/v1/activities/[activityId]/availability/route.ts",
    "app/api/v1/bookings/[bookingId]/cancel/route.ts",
    "app/api/v1/bookings/payment-sessions/route.ts",
    "app/api/v1/bookings/payment-sessions/confirm/route.ts",
    "app/api/v1/check-ins/walk-in/route.ts",
    "app/api/v1/check-ins/walk-in/preview/route.ts",
    "app/api/v1/payments/checkout-sessions/route.ts",
]
READ_IN_FULL = ["server/domain/check-in-void.ts"]
NOT_FOLLOWED = ["server/health/check-in-hook.ts"]
ONLY_FUNCTION = {"server/customer/dashboard.ts": "upsertCustomerProfile"}
SKIPPED_DIRS = ["/notifications/templates/"]

IMPORT = re.compile(r'(?:^|\n)\s*(?:import|export)\s+(type\s+)?([^;]*?)\s+from\s+["\']([^"\']+)["\']', re.S)
BARE_IMPORT = re.compile(r'(?:^|\n)\s*import\s+["\']([^"\']+)["\']')
DYNAMIC_IMPORT = re.compile(r'import\(\s*["\']([^"\']+)["\']\s*\)')
CODE_LITERAL = re.compile(r'"([a-z0-9][a-z0-9_-]*)"|\'([a-z0-9][a-z0-9_-]*)\'')
COMPARED = re.compile(r'[!=]==?\s*("[^"]*"|\'[^\']*\')|("[^"]*"|\'[^\']*\')\s*[!=]==?')


def git(repo, *args):
    return subprocess.run(["git", "-C", repo, *args], capture_output=True, text=True, check=True).stdout


def imports(src):
    found = []
    for match in IMPORT.finditer(src):
        type_only, clause, spec = match.groups()
        if type_only:
            continue
        clause = clause.strip()
        if clause.startswith("{") and clause.endswith("}"):
            names = [n.strip() for n in clause[1:-1].split(",") if n.strip()]
            if names and all(n.startswith("type ") for n in names):
                continue
        found.append(spec)
    return found + BARE_IMPORT.findall(src) + DYNAMIC_IMPORT.findall(src)


def first_argument(src, start):
    """The text of a call's first argument; `start` is just after `(`."""
    depth, i = 0, start
    while i < len(src):
        ch = src[i]
        if ch in "\"'`":
            quote, i = ch, i + 1
            while i < len(src) and src[i] != quote:
                i += 2 if src[i] == "\\" else 1
        elif ch in "([{":
            depth += 1
        elif ch in ")]}":
            if depth == 0:
                return src[start:i]
            depth -= 1
        elif ch == "," and depth == 0:
            return src[start:i]
        i += 1
    return src[start:]


def argument_codes(arg, src):
    codes = {a or b for a, b in CODE_LITERAL.findall(COMPARED.sub("", arg))}
    indexed = re.match(r"\s*([A-Z_][A-Z0-9_]*)\s*\[", arg)
    if indexed:
        table = re.search(r"const\s+" + indexed.group(1) + r"\b[^=]*=\s*\{(.*?)\};", src, re.S)
        if table:
            codes |= set(re.findall(r':\s*"([a-z0-9_-]+)"', table.group(1)))
    return codes


def codes_in(src):
    codes = set()
    for match in re.finditer(r"new\s+DomainError\s*\(", src):
        codes |= argument_codes(first_argument(src, match.end()), src)
    if re.search(r"extends\s+DomainError", src):
        for match in re.finditer(r"\bsuper\s*\(", src):
            codes |= argument_codes(first_argument(src, match.end()), src)
    codes |= set(re.findall(r'\{\s*code:\s*["\']([a-z0-9_-]+)["\']\s*,\s*message\b', src))
    codes |= set(re.findall(r"lifepass\.is/problems/([A-Za-z0-9_-]+)", src))
    return codes


def only_function(src, name):
    start = src.find(f"export async function {name}")
    if start < 0:
        start = src.find(f"export function {name}")
    if start < 0:
        return ""
    end = src.find("\nexport ", start + 10)
    return src[start:] if end < 0 else src[start:end]


def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    repo = sys.argv[1]
    rev = sys.argv[2] if len(sys.argv) > 2 else "origin/main"
    commit = git(repo, "rev-parse", "--short=8", rev).strip()
    version = re.search(r'^\s*version:\s*"([^"]+)"', git(repo, "show", f"{rev}:apps/web/openapi.yaml"), re.M)
    files = set(git(repo, "ls-tree", "-r", "--name-only", rev, "--", WEB).split())

    def resolve(spec, importer):
        if spec.startswith("@/"):
            base = WEB + spec[2:]
        elif spec.startswith("."):
            base = posixpath.normpath(posixpath.join(posixpath.dirname(importer), spec))
        else:
            return None
        for candidate in (base, base + ".ts", base + ".tsx", base + "/index.ts", base + "/index.tsx"):
            if candidate in files and candidate.endswith((".ts", ".tsx")) and not re.search(r"\.test\.tsx?$", candidate):
                return candidate
        return None

    read_in_full = {WEB + p for p in READ_IN_FULL}
    queue = [WEB + p for p in ROUTES] + sorted(read_in_full)
    seen, followed, codes = set(), set(), set()
    while queue:
        path = queue.pop()
        if path in seen:
            continue
        seen.add(path)
        if any(d in path for d in SKIPPED_DIRS):
            continue
        src = git(repo, "show", f"{rev}:{path}")
        relative = path[len(WEB):]
        if relative in ONLY_FUNCTION:
            codes |= codes_in(only_function(src, ONLY_FUNCTION[relative]))
            continue
        codes |= codes_in(src)
        if relative in NOT_FOLLOWED or (path in read_in_full and path not in followed):
            continue
        for spec in imports(src):
            target = resolve(spec, path)
            if target:
                followed.add(target)
                queue.append(target)

    folded = sorted({c.lower().replace("-", "_") for c in codes})
    lines = [
        "// GENERATED by scripts/gen-refusal-fixture.py; do not edit by hand.",
        f"// Server {commit} (API contract {version.group(1) if version else '?'}): "
        f"{len(seen)} files in the refusal routes' import closure, {len(folded)} codes.",
        "// Every code those routes can answer with, in the refusal table's spelling.",
        "export const SERVER_REFUSAL_CODES_SOURCE = {",
        f"  commit: '{commit}',",
        f"  contractVersion: '{version.group(1) if version else ''}',",
        "} as const;",
        "",
        "export const SERVER_REFUSAL_CODES: readonly string[] = [",
    ]
    lines += [f"  '{code}'," for code in folded]
    lines += ["];", ""]
    with open(OUT, "w", encoding="utf-8") as handle:
        handle.write("\n".join(lines))
    print(f"{len(folded)} codes from {len(seen)} files at {commit} -> {os.path.relpath(OUT)}", file=sys.stderr)


if __name__ == "__main__":
    main()
