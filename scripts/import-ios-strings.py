#!/usr/bin/env python3
r"""Import the iOS app's EN/IS strings into src/i18n/strings.{en,is}.json.

The iOS app (lifepass-ios, "LifePass 2/Services/Localization*.swift") is the
source of truth for every member-facing string. Its dictionaries are Swift
literals: the base `baseEN` / `baseIS` in Localization.swift, plus the health
packs (`static let en` / `static let \`is\``) in LocalizationHealth*.swift,
merged base-first with the packs on top (LPHealthStrings.merged).

Usage:
  python3 scripts/import-ios-strings.py "<path to lifepass-ios>/LifePass 2/Services" [--out DIR] [--ahead FILE]

Writes, into src/i18n (or DIR):
  strings.en.json, strings.is.json   the merged tables the app reads
  strings.manifest.json              which dictionary (base or pack) owns each
                                     key, for the copy-rule tests that iOS runs
                                     per pack (LocalizationKeyTests and friends)

Exits non-zero, writing nothing, when two packs define one key or a pack
redefines a base key other than the intentional override: the inputs the iOS
DEBUG build traps on. Re-run it whenever iOS adds or changes copy; never
hand-edit the JSON. Strings Android needs that iOS does not have go in the
owning package's pack, src/i18n/android/<package-id>.ts.

AHEAD OF iOS. An iOS copy change Android ships before the iOS sources the
tables come from have it is written in src/i18n/ahead-of-ios.json (or FILE),
never typed into the JSON: the iOS text it replaces and the Android text.
The generator applies a change while iOS still has the old text, so a
re-import (or the CI drift check) cannot quietly undo it; says so when iOS has
landed it (delete the entry then); and exits non-zero, writing nothing, when
iOS has anything else, so a different iOS key or word is seen before a build.
"""
import json
import os
import re
import sys

SRC = os.path.join(os.path.dirname(__file__), "..", "src", "i18n")

# The copy changes Android ships ahead of the iOS sources (see AHEAD OF iOS).
AHEAD = os.path.join(SRC, "ahead-of-ios.json")

LANGS = ("en", "is")

# The one key a pack deliberately replaces in the base dictionary
# (LPHealthStrings.intentionalOverrides). Any other collision is a mistake.
INTENTIONAL_OVERRIDES = {"coach.greeting"}

# Merge order matches LPHealthStrings.packsEN / packsIS.
PACKS = [
    ("core", "LocalizationHealth.swift"),
    ("plan", "LocalizationHealth+Plan.swift"),
    ("meals", "LocalizationHealth+Meals.swift"),
    ("consent", "LocalizationHealth+Consent.swift"),
    ("runner", "LocalizationHealth+Runner.swift"),
    ("appleHealth", "LocalizationHealth+AppleHealth.swift"),
    ("planEdit", "LocalizationHealth+PlanEdit.swift"),
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


class MergeError(ValueError):
    """Two dictionaries define one key: the generator refuses, as the iOS
    DEBUG build traps (LPHealthStrings.merged)."""


def merge(base: dict, packs: list, lang: str) -> dict:
    """LPHealthStrings.merged: the packs over the base, in order.

    iOS traps in DEBUG when a key is defined by two packs, or when a pack
    redefines a base key that is not an intentional override. The generator
    refuses the same inputs, so a table it writes is one the DEBUG app would
    have launched with.
    """
    result = dict(base)
    owner = {}
    for name, values in packs:
        for key, value in values.items():
            if key in owner:
                raise MergeError("%s string %s is defined by both %s and %s" % (lang, key, owner[key], name))
            if key in base and key not in INTENTIONAL_OVERRIDES:
                raise MergeError("%s string %s (pack %s) already exists in the base dictionary" % (lang, key, name))
            owner[key] = name
            result[key] = value
    return result


class AheadError(ValueError):
    """An ahead-of-iOS change that does not fit the iOS sources (or a
    malformed ahead-of-ios.json): the generator refuses to guess."""


def load_ahead(path: str) -> list:
    """The changes in an ahead-of-ios.json, checked for shape."""
    try:
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
    except OSError as error:
        raise AheadError("cannot read %s: %s" % (path, error.strerror or error))
    except ValueError as error:
        raise AheadError("%s is not JSON: %s" % (path, error))
    changes = data.get("changes") if isinstance(data, dict) else None
    if not isinstance(changes, list):
        raise AheadError('%s needs a "changes" list' % path)
    for change in changes:
        name = change.get("change") if isinstance(change, dict) else None
        if not isinstance(name, str) or not name:
            raise AheadError('%s: every change needs a "change" description' % path)
        if not isinstance(change.get("dictionary"), str):
            raise AheadError('%s: "%s" needs a "dictionary" (base or a pack name)' % (path, name))
        sides = [change.get("ios"), change.get("android")]
        for side in sides:
            if not isinstance(side, dict) or not set(side) <= set(LANGS) or not all(
                isinstance(values, dict) and all(isinstance(k, str) and isinstance(v, str) for k, v in values.items())
                for values in side.values()
            ):
                raise AheadError('%s: "%s" needs "ios" and "android" as {"en"|"is": {key: text}}' % (path, name))
        if all(change["ios"].get(lang, {}) == change["android"].get(lang, {}) for lang in LANGS):
            raise AheadError('%s: "%s" changes nothing' % (path, name))
    return changes


def ahead_state(values: dict, old: dict, new: dict) -> str:
    """'landed' when iOS already has the Android text, 'pending' when it still
    has the text the change replaces, 'other' when it has neither."""
    if all(values.get(k) == v for k, v in new.items()) and not any(k in values for k in set(old) - set(new)):
        return "landed"
    if all(values.get(k) == v for k, v in old.items()) and not any(k in values for k in set(new) - set(old)):
        return "pending"
    return "other"


def apply_ahead(sources: dict, changes: list):
    """Apply each pending change to the parsed iOS dictionaries, in place.

    `sources` maps a dictionary name to {"en": {...}, "is": {...}}. Returns
    (the changes applied, the changes iOS has landed). Raises AheadError, so
    nothing is written, when iOS has something else for a change's keys.
    """
    applied, landed = [], []
    for change in changes:
        name = change["change"]
        dictionary = sources.get(change["dictionary"])
        if dictionary is None:
            raise AheadError('"%s": no iOS dictionary named %s' % (name, change["dictionary"]))
        langs = [lang for lang in LANGS if change["ios"].get(lang, {}) != change["android"].get(lang, {})]
        states = {
            lang: ahead_state(dictionary[lang], change["ios"].get(lang, {}), change["android"].get(lang, {}))
            for lang in langs
        }
        if all(state == "landed" for state in states.values()):
            landed.append(name)
            continue
        if all(state == "pending" for state in states.values()):
            for lang in langs:
                for key in change["ios"].get(lang, {}):
                    del dictionary[lang][key]
                dictionary[lang].update(change["android"].get(lang, {}))
            applied.append(name)
            continue
        keys = sorted({k for lang in langs for side in ("ios", "android") for k in change[side].get(lang, {})})
        found = {lang: {k: dictionary[lang].get(k) for k in keys} for lang in langs}
        raise AheadError(
            '"%s": iOS has %s, neither the text it replaces nor the Android text. '
            "Update src/i18n/ahead-of-ios.json (and the code that reads the key) to what iOS has now."
            % (name, json.dumps(found, ensure_ascii=False, sort_keys=True))
        )
    return applied, landed


def manifest_entry(name: str, en: dict, is_: dict) -> dict:
    """One dictionary's keys: those in both languages, then any in one only."""
    return {
        "name": name,
        "keys": sorted(set(en) & set(is_)),
        "enOnly": sorted(set(en) - set(is_)),
        "isOnly": sorted(set(is_) - set(en)),
    }


def write_json(path: str, value) -> None:
    with open(path, "w", encoding="utf-8") as f:
        json.dump(value, f, ensure_ascii=False, indent=1)
        f.write("\n")


def take_option(args: list, flag: str, default):
    """Remove `flag VALUE` from args and return VALUE (default when absent),
    or None when the flag has no value after it."""
    if flag not in args:
        return default
    index = args.index(flag)
    if index + 1 >= len(args):
        return None
    value = args[index + 1]
    del args[index:index + 2]
    return value


def main(argv):
    args = list(argv)
    out = take_option(args, "--out", SRC)
    ahead_path = take_option(args, "--ahead", AHEAD)
    if out is None or ahead_path is None or len(args) != 1:
        # A flag with nothing after it, or no sources: say how to call, no traceback.
        print(__doc__, file=sys.stderr)
        return 2
    services = args[0]

    base_text = open(os.path.join(services, "Localization.swift"), encoding="utf-8").read()
    base = {
        "en": parse_dict(base_text, r"private static let baseEN"),
        "is": parse_dict(base_text, r"private static let baseIS"),
    }
    sources = {"base": base}
    for name, filename in PACKS:
        text = open(os.path.join(services, filename), encoding="utf-8").read()
        sources[name] = {"en": parse_dict(text, r"static let en"), "is": parse_dict(text, r"static let `is`")}

    try:
        applied, landed = apply_ahead(sources, load_ahead(ahead_path))
    except AheadError as error:
        print("error: %s" % error, file=sys.stderr)
        return 1

    packs = {lang: [(name, sources[name][lang]) for name, _ in PACKS] for lang in LANGS}
    try:
        tables = {lang: merge(base[lang], packs[lang], lang) for lang in LANGS}
    except MergeError as error:
        print("error: %s" % error, file=sys.stderr)
        return 1

    manifest = {
        "about": "Generated by scripts/import-ios-strings.py from the iOS dictionaries. Do not edit.",
        "intentionalOverrides": sorted(INTENTIONAL_OVERRIDES),
        # The ahead-of-ios.json changes these tables carry that iOS does not have yet.
        "aheadOfIos": applied,
        "dictionaries": [manifest_entry("base", base["en"], base["is"])]
        + [manifest_entry(name, sources[name]["en"], sources[name]["is"]) for name, _ in PACKS],
        "counts": {lang: len(tables[lang]) for lang in LANGS},
    }

    os.makedirs(out, exist_ok=True)
    for lang in LANGS:
        write_json(os.path.join(out, "strings.%s.json" % lang), dict(sorted(tables[lang].items())))
    write_json(os.path.join(out, "strings.manifest.json"), manifest)

    for entry in manifest["dictionaries"]:
        print(
            "%-12s %4d keys in both languages, %d English only, %d Icelandic only"
            % (entry["name"], len(entry["keys"]), len(entry["enOnly"]), len(entry["isOnly"]))
        )
    print("merged: en %d keys, is %d keys" % (len(tables["en"]), len(tables["is"])))
    for name in applied:
        print("ahead of iOS: %s" % name)
    for name in landed:
        print(
            "note: iOS has landed \"%s\"; delete it from src/i18n/ahead-of-ios.json" % name,
            file=sys.stderr,
        )
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
