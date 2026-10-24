# Backend / infra checklist (Android v1)

Provider- and deployment-side items that the Android app **cannot fix in code** —
each one blocks or degrades a client feature until it's configured. None of
these live in this repo; they're in Supabase, Kling, Kenni, or the web
(`lifepass-monorepo`) deployment. Most affect **iOS identically**.

Status legend: ⛔ blocks a feature · ⚠️ degraded / workaround in place · ✅ verified working

---

## ✅ Kenni redirect URI registered — monthly-plan checkout unblocked

**Resolved 2026-07-14 (confirmed working).** The redirect URI is now registered
on the Kenni OIDC client, so "Verify with Kenni.is" completes and monthly-plan
checkout is no longer blocked on this. The Android Kenni flow
(`src/supabase/services/kenni.ts`, `KenniVerificationModal`) works end-to-end.

**Was:** Kenni returned `400 — redirect uri did not match any of the client's
registered redirect uris` because the server's `redirect_uri =
lifepass://kenni-callback` (default of `getKenniNativeRedirectUri()`, override
`KENNI_NATIVE_REDIRECT_URI`) wasn't registered on the client.

**Watch:** if `KENNI_NATIVE_REDIRECT_URI` is ever changed on the web deployment,
the registered URI must be updated to match (and mobile told, so the app's
callback capture still matches).

---

## ⚠️ Android App Links (venue-QR check-in) — app-side done, needs web fingerprint

**What App Links are for here:** per the product contract (monorepo
`server/deep-links.ts`: *"Restrict OS hand-off to the printed venue QR only"*),
only the printed venue QR `https://lifepass.is/scan?v=<uuid>` opens the app —
matching iOS Universal Links. Login/email links are deliberately NOT App Links.

**App-side — DONE (2026-07-14, this repo):**
- `app.json` → `android.intentFilters`: `autoVerify` VIEW filter for
  `https://lifepass.is` path `/scan`.
- Deep-link handler in `App.tsx` routes `…/scan?v=<uuid>` into the Check-in tab
  (`routeToCheckIn` + `navigationRef`), and `CheckInScreen` auto-runs the
  walk-in from the `autoCheckInVenueId` param.
- Shared `src/checkin/walkInQrParser.ts` (port of iOS `WalkInQRParser`) now
  backs BOTH the in-app camera scanner and the deep link — so the scanner also
  accepts the canonical `/scan?v=` poster form, not just a bare UUID.

**Remaining — web/deploy side (NOT this repo):**
1. Serve `https://lifepass.is/.well-known/assetlinks.json` (Next route already
   coded, gated on env): set `ANDROID_PACKAGE_NAME=is.lifepass.android` and
   `ANDROID_SHA256_CERT_FINGERPRINTS=<release signing SHA-256>` on the web
   deployment. It **must be served on the `lifepass.is` host with no redirect**
   and `application/json` — mind the apex→www redirect.
2. Get the release SHA-256: `eas credentials -p android` → copy the SHA256
   Fingerprint (or Play Console → App signing).
3. App Links only verify in a real build (EAS), not Expo Go, and after a
   native rebuild picks up the new `intentFilters`.

Until (1)+(2) land, the intent filter simply doesn't verify and the QR opens the
browser fallback — no regression. The **in-app camera scanner works regardless.**

---

## ⚠️ Email-confirm link doesn't reopen the app (separate from App Links)

**Not an App Link** (the product contract hands off only the venue QR, above),
and iOS confirms via the `lifepass://` scheme, which Android browsers won't
follow from a redirect (lands on `about:blank`).

**Workaround in place & intended:** signup redirects email confirmation to
`https://www.lifepass.is` (`EMAIL_CONFIRM_REDIRECT` in
`src/supabase/services/auth.ts`); the user returns to the app and signs in. This
stays as-is unless the product decides email links should hand off to the app.

---

## ✅ Branded auth email (Supabase Send Email hook → Resend)

**Verified:** a live signup returns `confirmation_sent_at`; the hook renders and
Resend sends. Confirmation emails arrive.

**Watch:** delivery is only as good as Resend's domain verification. If some
recipients don't receive email while others do, check the Resend domain is fully
verified (not test-mode, which only delivers to the account owner). Supabase →
Authentication → Logs shows the hook firing; Resend → Emails shows per-recipient
delivery.

---

## ✅ Supabase redirect allow-list

**Verified:** `lifepass://auth/callback` is honored (GoTrue redirects to it) and
`https://www.lifepass.is` is the Site URL (always allowed). Keep
`lifepass://**` and `https://www.lifepass.is` on the allow-list.

---

## ⚠️ Kling products must be active for checkout to resolve

**Why:** checkout refuses any product with no matching **active** Kling product
(`currency = ISK`, correct type) at the expected `Name` — see monorepo
`docs/02_PAYMENTS.md`. If a plan/pass "Continue" fails with
`checkout_product_not_found` / a Kling catalog error, the Kling product isn't set
up.

**Verify:** each slug the app sells has a live Kling product —
`LifePass Base/Plus/Max`, `Gym/Studio/Pool Day Pass`, `Explorer`, `Adventurer`,
`Local` (Kling `Name` is the join key).

---

## ✅ Payment confirm route deployed

`POST /payments/checkout-sessions/confirm` exists on `main` (Kling has no mobile
webhook, so the app calls confirm + polls `GET /payments/status` on return). If
a future deploy drops it, the app degrades gracefully to polling only.

---

## ⚠️ Update prompt — needs `GET /app-version` deployed and two web settings

The app asks `GET /api/v1/app-version?platform=android` at launch (signed in
or not), and again when it comes back to the foreground: every time while it
is blocked, otherwise once the last answer is 30 minutes old. The route is
anonymous and additive (monorepo branch `feat/app-version-config`, contract
0.43.0). Until it is deployed the app gets an error, fails open and shows
nothing, so nothing breaks. A failed check never blocks.

On the web deployment, the owner controls the prompt with:

- `APP_MIN_VERSION_ANDROID`: below this version the app is blocked behind
  an "Update" button that opens Google Play. Unset means no minimum. It only
  applies while `APP_LATEST_VERSION_ANDROID` is set: without it the server
  answers no minimum.
- `APP_LATEST_VERSION_ANDROID`: the version on Google Play. Google Play has
  no public version lookup, so set it when a release goes live. Below it the
  app shows "A new version is available" (Update / Not now), once per new
  version. Unset means no soft prompt.

**Watch:** set the minimum only after the release it names is live on Google
Play. The server cannot see Google Play, so it relies on
`APP_LATEST_VERSION_ANDROID`: it ignores the minimum while that is unset, and
caps a minimum above it at that version. With the latest version set higher
than what is really live, a minimum above the live release still blocks
members with nothing to install, so keep it equal to the live release.
Only builds that include the prompt ask at all; older builds never see it.
Code: `src/api/appVersion.ts`, `src/features/appUpdate/`.
