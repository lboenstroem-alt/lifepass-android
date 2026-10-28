# LifePass for Android

The LifePass Android app: one pass for gyms, pools, studios, spas and
lagoons in Iceland, with the Coach, workout plans and a meal log for
members. Expo SDK 54, React Native 0.81 (New Architecture), TypeScript
(strict). Package `is.lifepass.android`, version **3.1.0**.

The native iOS app (`lifepass-ios`) is the source of truth for behaviour,
copy and money rules. This app is at parity with iOS 3.1.0, except where
the release notes say otherwise (no Health Connect, by owner decision):
`docs/release/RELEASE-3.1.0-android.md`.

This repository is **public**. Never commit a secret, a key, a partner's
contract terms, personal data or a real discount code.

## Setup

You need Node 20.19.4 or newer (CI uses 22), and for a device build JDK 17,
the Android SDK and an emulator or a phone.

```bash
npm ci
npx expo run:android     # builds and installs a development build, starts Metro
npx expo start           # Metro only, for a development build already installed
```

Expo Go cannot run the app: Mapbox, the camera scanner, App Links, speech
recognition, background work and the local meal-image module need a
development build. `npx expo run:android` generates the `android/` folder
from `app.json` and `app.config.js` (Continuous Native Generation). It is
git-ignored: change the config, not the folder, and run
`npx expo prebuild --clean` after a config change. Or build in the cloud:
`eas build -p android --profile development`.

## Environment

**Every build talks to production** (`www.lifepass.is` and the production
Supabase project), local and EAS alike; there is no staging. So nothing in
development or testing may create a booking, payment, check-in, review or
account. Tests never reach the network.

The app reads its settings in one place, `src/config/env.ts`. Expo inlines
`EXPO_PUBLIC_*` variables at build time; `eas.json` sets them for EAS
builds, and a git-ignored `.env` (copy `.env.example`) for local runs.

| Variable | Needed | What it is |
|---|---|---|
| `EXPO_PUBLIC_LIFEPASS_API_URL` | No | The LifePass API, `https://www.lifepass.is/api/v1`. Must be the `www.` host: the apex redirect drops the bearer token |
| `EXPO_PUBLIC_SUPABASE_URL` | No | The production Supabase project |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | No | Its publishable key (public by design) |
| `EXPO_PUBLIC_MAPBOX_TOKEN` | For the map | The Android Mapbox `pk.` token. Without it Explore draws a plain area instead of the map. An EAS environment variable, never in git |
| `EXPO_PUBLIC_SOCIAL_SIGN_IN` | No | `YES` lets the build offer Continue with Google and Apple (Supabase must also have the provider on). `eas.json` sets it |
| `EXPO_PUBLIC_FIXTURE` | No | Development builds only: put the app in a known state for screenshots and checks, e.g. `state=active-plan,language=is,tab=4` (keys in `src/dev/fixtures.ts`). Release builds compile it out |
| `MAPBOX_DOWNLOAD_TOKEN` | No | Build time only (Gradle): the Mapbox secret `sk.` token, if Mapbox asks for one |

A missing or unusable server value falls back to production, as iOS does,
so a plain `npx expo run:android` works without a `.env`.

## Scripts

| Command | What it does |
|---|---|
| `npm run typecheck` | `tsc --noEmit`, strict |
| `npm run lint` | ESLint (flat config, `eslint.config.js`) with LifePass's own rules (`eslint/lifepass-plugin.js`): no literal member-facing copy, feature boundaries |
| `npm test` | Jest (`jest-expo`, Android preset), in UTC |
| `npm run ci` | `scripts/ci.sh`: all of the above, Jest again in New York and Tokyo time (the app shows Reykjavík time whatever the phone's zone), and the generated-file checks. GitHub runs it on every PR and push to `main` |
| `npm run contract:vendor -- <monorepo>/apps/web/openapi.yaml` | Refresh the vendored API contract `test/contract/openapi.json` |
| `npm run gen:api-types` | Regenerate `src/api/openapi.d.ts` from the vendored contract |

`scripts/ci.sh` also checks, when you point it at the sources outside this
repo: `LIFEPASS_OPENAPI=<monorepo>/apps/web/openapi.yaml` (the vendored
contract is current) and `LIFEPASS_IOS_SERVICES="<lifepass-ios>/LifePass 2/Services"`
(the string tables match iOS).

## Tests

- Tests live next to the code in `__tests__` folders. React Native Testing
  Library 14 is asynchronous: `await render(...)`, `await fireEvent.press(...)`.
- `test/server`: the stub network (msw). API and Supabase calls are
  answered in-process; any other host is refused and fails the test.
- `test/contract`: requests and responses checked against the vendored
  API contract.
- `test/mocks`: in-memory SecureStore and file system, and a stateful
  expo-notifications (local only; push-token calls throw).
- `test/harness`: `setEnv` and `setDev` for one test. After every test the
  tree is unmounted and the fakes, storage, stub server and language reset.
- `test/config`: the app config (version, permissions, intent filters,
  `eas.json`, what git ignores), `test/lint`: the lint rules.
- The test realm has no `crypto`, `Buffer`, `AbortSignal.timeout` or
  `AbortSignal.any`, like Hermes on the phone; ESLint refuses them in app
  code.

## Architecture

```
index.ts, App.tsx          entry: registers the background task, fonts, providers, the root navigator
app.json, app.config.js    static config, plus one plugin fragment per native concern (config/fragments/)
modules/lifepass-meal-image  a local Expo module (Kotlin) that shrinks a meal photo and strips its metadata

src/
  config/        env.ts (servers and build switches), merchant info
  api/           the API client: auth, retries, Idempotency-Key, the error and refusal model,
                 one file per endpoint group; openapi.d.ts is generated
  supabase/      the one Supabase client (session in Keystore-encrypted storage) and auth services
  stores/        app state (zustand): session, profile, subscription, language, intents, venues, location
  navigation/    the root, auth and tab navigators, every route and its params (types.ts),
                 shared sheets and back guards
  app/           deep-link router, notification router, sign-in and sign-out lifecycle, registrations
  i18n/          t(), tp(), useT(); the generated EN/IS tables; Android-only packs; formatters
  theme/         colour, type and spacing tokens (the iOS palette)
  components/    shared components; components/ui is the UI kit (sheet, dialog, buttons, toast...)
  payments/      the money rails: Kling hosted pages, in-flight records, recovery after Android
                 closes the app mid-payment, outcomes
  health/        health consent, the 18+ gate, health API and local store, wipe
  notifications/ local notifications only: channels, permission asks in context, engagement,
                 health and feedback reminders
  background/    the WorkManager task (expo-background-task) and what runs in it
  lib/           small shared logic: browse order, geo, haptics, analytics (sends nothing)
  dev/           debug-only fixture switches and the UI kit screen
  screens/       the first build's paths: the Home, Explore and Coach tab roots (rebuilt) and the
                 plans view live here; venue, booking and account are re-exports of features/
  features/      one folder per area, each with an index.ts and, where it plugs into
                 another screen, a register.ts and slots/:
    auth, kenni           sign-in, sign-up, password reset, Google and Apple, the eID sheet
    home                  Home tab content
    explore, venue        list, map, filters, venue page, reviews (write and report), favourites
    attractions           sights and hiking trails, their cards and map layer
    booking, classes      booking flow, group and premium, the classes feed and class sheet
    bookings, library     My bookings, Profile (bookings, saved)
    checkin               Scan tab, QR and link rules, walk-ins, staff proof
    plans                 memberships and passes, checkout, discount codes
    account               Account screen, billing, cards, receipts, cancel, co-pay, deletion, WhatsApp
    coach                 chat, wizards, day plans, programmes, Adjust my plan, plan edits
    plan, runner, body    Plan tab, the guided workout, Body and goals
    meals                 photo, barcode, search, editors, describe, diary
    feedback              Your month (monthly feedback)
    appUpdate             the "please update" prompt
    favourites            the saved-venues store
```

Rules the code keeps:

- **Copy.** Every word a member reads comes from `t()` / `tp()` / `useT()`
  in `src/i18n`: the tables generated from iOS, or an Android-only pack
  (`src/i18n/android/<PACKAGE>.ts`, English and Icelandic, no em or en
  dashes, no emoji). The `lifepass/no-literal-copy` lint rule enforces it.
- **Boundaries.** A feature reaches another only through its `index.ts` or
  a published slot (`lifepass/feature-boundaries`).
- **Network.** Every LifePass call goes through `src/api`. The only other
  hosts the app calls are Supabase (auth), Open Food Facts (barcodes, from
  the phone, with nothing about the member), Open-Meteo (Reykjavík weather),
  Mapbox (map tiles, telemetry off) and Unsplash (the sign-in photos).
  Payment, eID and sign-in pages open in a browser tab.
- **Time.** Venue and server times are Reykjavík time (UTC, no daylight
  saving), never the phone's zone.
- **Privacy.** No analytics or crash SDK, no advertising ID, no push token;
  health data stays behind its consent. Anything stored per member
  registers a sign-out cleaner (`src/app/signOut.ts`). Adding a data flow
  means changing the Play Data safety answers (`docs/release/data-safety.md`)
  first.

## Strings from iOS

The English and Icelandic tables (`src/i18n/strings.en.json`,
`strings.is.json`, `strings.manifest.json`) are generated from the iOS
app's Swift dictionaries. Never edit them by hand. To regenerate after iOS
copy changes:

```bash
python3 scripts/import-ios-strings.py "<path to lifepass-ios>/LifePass 2/Services"
npm test -- src/i18n
```

The script merges the base dictionary and the health packs the way iOS
does, and refuses (writing nothing) when two packs define one key. A copy
change Android must ship before iOS has it goes in
`src/i18n/ahead-of-ios.json` (the iOS text and the Android text); the
script applies it, says when iOS has caught up (delete the entry in the
same commit), and refuses if iOS has something else. Words iOS never says
go in the owning Android pack instead.

## Building and releasing

EAS project `@lifepass/lifepass-iceland`. Every profile in `eas.json`
uses the EAS **production** environment and the production servers.

| Profile | Output | Use |
|---|---|---|
| `development` | APK with the dev client | Day-to-day work on a phone or emulator |
| `preview` | APK, internal distribution | Trying a release-like build without Play |
| `production` | AAB (app bundle) | Google Play |

```bash
eas build -p android --profile production              # signed AAB; versionCode +1, kept by EAS
eas build:version:get -p android                        # the next versionCode
eas submit -p android --profile production --latest     # to Play's production track, as a draft
```

- **Version name:** `expo.version` in `app.json` (and `package.json`), kept
  equal to the iOS version this build matches. The server's update prompt
  compares it with `APP_LATEST_VERSION_ANDROID`.
- **versionCode:** remote (`appVersionSource: remote`), never in git; set it
  with `eas build:version:set -p android` if Play's highest is above it.
- **Signing:** EAS holds the upload keystore (`eas credentials -p android`);
  Google Play holds the app signing key.
- **Submitting** puts a draft on the production track. The owner reviews it
  in Play Console and presses **Start rollout**; nobody else does.
- Release steps, the Play Console answers and the web follow-ups for this
  version: `docs/release/RELEASE-3.1.0-android.md`. Store text:
  `docs/release/store-listing.en.md`, `store-listing.is.md`. Data safety:
  `docs/release/data-safety.md`.

## Other docs

- `docs/release/`: the 3.1.0 release (see above).
- `docs/BACKEND_INFRA_CHECKLIST.md`: provider and deployment settings the
  app depends on (Kenni, Supabase, Kling, the update prompt variables),
  started with the first build; where it and the release notes disagree,
  the release notes are current.
- `docs/IOS_ALIGNMENT_CHECKLIST.md`: the first build's July 2026 gap list,
  kept for history; the parity build replaced it.
