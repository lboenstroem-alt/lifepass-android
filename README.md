# LifePass for Android

The LifePass Android app (Expo SDK 54, React Native 0.81, TypeScript), being
built to parity with the native LifePass iOS app 2.5.6. The iOS app is the
source of truth for behaviour, copy and money rules.

This is a short working README. The full one is written at release.

## Run it

```bash
npm ci
npx expo run:android     # a development build on an emulator or device
npx expo start           # Metro, for an installed development build
```

Expo Go cannot run the app: Mapbox, App Links, speech recognition and
background work need a development build (`eas build -p android --profile development`).

## Environment

Every build, local or EAS, talks to **production** (`www.lifepass.is` and the
production Supabase project); there is no staging. For a local run, copy
`.env.example` to `.env`: it sets the public production API and Supabase
values, which the legacy API and Supabase clients still need (they stop the
app at launch without them, until F2 and F3 move them onto
`src/config/env.ts`, which falls back to production by itself). Never commit
a secret: this repository is public.

Because the app talks to production, nothing in development or testing may
create bookings, payments, check-ins, reviews or accounts. Tests never reach
the network (see below).

## Checks

```bash
npm run typecheck   # tsc, strict
npm run lint        # ESLint (flat config, eslint.config.js)
npm test            # Jest (jest-expo, Android preset)
npm run ci          # all of the above, Jest in three time zones, generated-file checks
```

- `test/server`: the stub network (msw). API and Supabase calls are recorded
  and answered in-process; any other host is refused and fails the test.
- `test/contract`: request and response checks against the vendored API
  contract (`test/contract/openapi.json`, refreshed with
  `npm run contract:vendor -- <monorepo>/apps/web/openapi.yaml`).
- `test/mocks`: an in-memory SecureStore and file system, and a stateful
  expo-notifications (local only; push-token calls throw).
- `test/harness`: `setEnv` and `setDev` for one test. React Native Testing
  Library 14 is asynchronous: `await render(...)`, `await fireEvent.press(...)`.
  After every test the tree is unmounted, then the fakes, AsyncStorage, the
  stub server and the language are reset.
- The test realm has no `crypto`, `Buffer`, `AbortSignal.timeout` or
  `AbortSignal.any`, like the phone (Hermes); ESLint refuses them in app code.
- Debug-only fixture switches (`EXPO_PUBLIC_FIXTURE`, `src/dev/fixtures.ts`)
  stand the app up in a known state for screenshots, like the iOS
  `-LPScreenshot*` launch arguments. Release bundles compile them out.

## Native configuration

`app.json` holds the static config; `app.config.js` composes one plugin
fragment per native concern from `config/fragments/`. Android only: there is
no iOS or web build from this repository.
