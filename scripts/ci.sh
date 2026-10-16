#!/usr/bin/env bash
# The checks every pull request must pass (parity plan 8.1). Run with
# `npm run ci`; GitHub runs it on every pull request and push to main
# (.github/workflows/ci.yml). Exits non-zero on the first failing step.
#
# Always:
#   1. TypeScript, strict, zero errors.
#   2. ESLint, zero errors (warnings are legacy debt; the copy and
#      feature-boundary rules are errors where they apply).
#   3. Jest, the whole suite, in UTC and again under America/New_York and
#      Asia/Tokyo: LifePass shows Reykjavik time (UTC, no daylight saving)
#      whatever the phone's zone, so a test that only passes in UTC has
#      leaked the device zone into the app.
#   4. Generated API types are current, once F2 has added src/api/openapi.d.ts.
#
# When the inputs are available (they live outside this public repo):
#   LIFEPASS_OPENAPI=<monorepo>/apps/web/openapi.yaml
#       the vendored contract (test/contract/openapi.json) matches it.
#   LIFEPASS_IOS_SERVICES="<lifepass-ios>/LifePass 2/Services"
#       the generated i18n tables match the iOS strings.
#   LIFEPASS_CI_DOCTOR=1
#       `expo-doctor` (needs the network).
set -euo pipefail

cd "$(dirname "$0")/.."

step() { printf '\n\033[1m== %s\033[0m\n' "$*"; }

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

step "TypeScript"
npx tsc --noEmit

step "ESLint"
npx eslint .

for zone in UTC America/New_York Asia/Tokyo; do
  step "Jest (TZ=$zone)"
  TZ="$zone" npx jest --ci --silent
done

if [[ -f src/api/openapi.d.ts ]]; then
  step "Generated API types are current"
  npx openapi-typescript test/contract/openapi.json -o "$TMP/openapi.d.ts" >/dev/null
  if ! diff -q "$TMP/openapi.d.ts" src/api/openapi.d.ts >/dev/null; then
    echo "src/api/openapi.d.ts is stale: run npm run gen:api-types and commit the result." >&2
    exit 1
  fi
fi

if [[ -n "${LIFEPASS_OPENAPI:-}" ]]; then
  step "Vendored API contract matches $LIFEPASS_OPENAPI"
  node scripts/vendor-openapi.mjs "$LIFEPASS_OPENAPI" "$TMP/openapi.json" >/dev/null
  if ! diff -q "$TMP/openapi.json" test/contract/openapi.json >/dev/null; then
    echo "test/contract/openapi.json is stale: run npm run contract:vendor -- <openapi.yaml> and commit it." >&2
    exit 1
  fi
fi

if [[ -n "${LIFEPASS_IOS_SERVICES:-}" ]]; then
  step "Generated i18n tables match the iOS strings"
  if [[ -f scripts/export-ios-strings.mjs ]]; then
    node scripts/export-ios-strings.mjs "$LIFEPASS_IOS_SERVICES"
  else
    python3 scripts/import-ios-strings.py "$LIFEPASS_IOS_SERVICES"
  fi
  if ! git diff --quiet -- src/i18n; then
    git --no-pager diff --stat -- src/i18n >&2
    echo "The i18n tables are stale: commit the regenerated files." >&2
    exit 1
  fi
fi

if [[ "${LIFEPASS_CI_DOCTOR:-}" == "1" ]]; then
  step "expo-doctor"
  npx expo-doctor
fi

step "All checks passed"
