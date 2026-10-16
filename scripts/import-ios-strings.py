#!/usr/bin/env python3
r"""Import the iOS app's EN/IS strings into src/i18n/strings.{en,is}.json.

The iOS app (lifepass-ios, "LifePass 2/Services/Localization*.swift") is the
source of truth for every member-facing string. Its dictionaries are Swift
literals: the base `baseEN` / `baseIS` in Localization.swift, plus the health
packs (`static let en` / `static let \`is\``) in LocalizationHealth*.swift,
merged base-first with the packs on top (LPHealthStrings.merged).

Usage:
  python3 scripts/import-ios-strings.py "<path to lifepass-ios>/LifePass 2/Services"

Re-run it whenever iOS adds or changes copy; never hand-edit the JSON. Strings
Android needs that iOS does not have go in src/i18n/strings.android.{en,is}.json.
"""
import json
import os
import re
import sys

SRC = os.path.join(os.path.dirname(__file__), "..", "src", "i18n")

# Merge order matches LPHealthStrings.packsEN / packsIS.
PACKS = [
    ("core", "LocalizationHealth.swift"),
    ("plan", "LocalizationHealth+Plan.swift"),
    ("meals", "LocalizationHealth+Meals.swift"),
    ("consent", "LocalizationHealth+Consent.swift"),
    ("runner", "LocalizationHealth+Runner.swift"),
    ("appleHealth", "LocalizationHealth+AppleHealth.swift"),
]


def unescape(body: str) -> str:
    out = []
    i = 0
    while i < len(body):
        c = body[i]
        if c != "\\":
            out.append(c)
            i += 1
            continue
        n = body[i + 1]
        if n == "u" and body[i + 2] == "{":
            end = body.index("}", i)
            out.append(chr(int(body[i + 3:end], 16)))
            i = end + 1
            continue
        out.append({"n": "\n", "t": "\t", '"': '"', "\\": "\\", "'": "'", "0": "\0", "r": "\r"}[n])
        i += 2
    return "".join(out)


def tokens(text: str):
    """Yield ('str', value) / ('punct', ch) tokens, skipping comments."""
    i = 0
    while i < len(text):
        c = text[i]
        if text.startswith("//", i):
            i = text.index("\n", i) if "\n" in text[i:] else len(text)
        elif text.startswith("/*", i):
            i = text.index("*/", i) + 2
        elif c == '"':
            if text.startswith('"""', i):
                raise ValueError("multi-line string literal not supported at offset %d" % i)
            j = i + 1
            while text[j] != '"':
                j += 2 if text[j] == "\\" else 1
            body = text[i + 1:j]
            if "\\(" in body:
                raise ValueError("interpolation in a string literal: %r" % body)
            yield ("str", unescape(body))
            i = j + 1
        elif c in "[]:,+":
            yield ("punct", c)
            i += 1
        elif c.isspace():
            i += 1
        else:
            raise ValueError("unexpected %r at %d: %r" % (c, i, text[i:i + 40]))


def parse_dict(text: str, start_pattern: str) -> dict:
    m = re.search(start_pattern + r"\s*:\s*\[String\s*:\s*String\]\s*=\s*\[", text)
    if not m:
        raise ValueError("no dictionary literal for " + start_pattern)
    # Find the matching close bracket, skipping strings and comments.
    i = m.end()
    depth = 1
    j = i
    while depth:
        if text.startswith("//", j):
            j = text.index("\n", j)
            continue
        if text.startswith("/*", j):
            j = text.index("*/", j) + 2
            continue
        c = text[j]
        if c == '"':
            j += 1
            while text[j] != '"':
                j += 2 if text[j] == "\\" else 1
        elif c == "[":
            depth += 1
        elif c == "]":
            depth -= 1
        j += 1
    body = text[i:j - 1]
    result = {}
    toks = list(tokens(body))
    k = 0
    while k < len(toks):
        kind, key = toks[k]
        if kind != "str" or toks[k + 1] != ("punct", ":"):
            raise ValueError("bad entry near %r" % (toks[k:k + 4],))
        k += 2
        value = ""
        while True:
            kind, part = toks[k]
            if kind != "str":
                raise ValueError("bad value for %s" % key)
            value += part
            k += 1
            if k < len(toks) and toks[k] == ("punct", "+"):
                k += 1
                continue
            break
        if key in result:
            raise ValueError("duplicate key %s" % key)
        result[key] = value
        if k < len(toks):
            if toks[k] != ("punct", ","):
                raise ValueError("expected , after %s" % key)
            k += 1
    return result


def main():
    services = sys.argv[1]
    base = open(os.path.join(services, "Localization.swift"), encoding="utf-8").read()
    en = parse_dict(base, r"private static let baseEN")
    is_ = parse_dict(base, r"private static let baseIS")
    overrides = {"coach.greeting"}
    for name, filename in PACKS:
        text = open(os.path.join(services, filename), encoding="utf-8").read()
        for lang, table, pattern in (("en", en, r"static let en"), ("is", is_, r"static let `is`")):
            pack = parse_dict(text, pattern)
            for key, value in pack.items():
                if key in table and key not in overrides and lang == "en":
                    print("warning: %s pack %s overrides base key %s" % (lang, name, key), file=sys.stderr)
                table[key] = value
    os.makedirs(SRC, exist_ok=True)
    for lang, table in (("en", en), ("is", is_)):
        path = os.path.join(SRC, "strings.%s.json" % lang)
        with open(path, "w", encoding="utf-8") as f:
            json.dump(dict(sorted(table.items())), f, ensure_ascii=False, indent=1)
            f.write("\n")
    missing_is = sorted(set(en) - set(is_))
    print("en: %d keys, is: %d keys, en-only: %d" % (len(en), len(is_), len(missing_is)))


if __name__ == "__main__":
    main()
