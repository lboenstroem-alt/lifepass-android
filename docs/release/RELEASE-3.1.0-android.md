# LifePass for Android 3.1.0

**Why 3.1.0.** This is the first Android build at parity with the iPhone
app. It has everything iOS 3.0.0 has (the 2.5.6 code plus Coach class
cards) and the five iOS 3.1.0 additions. Its version name matches iOS so
the server's "please update" prompt, which compares the app's own version,
works the same way on both. Google Play has the first Android build today
(version 1.0.0); 3.1.0 replaces it.

**Branch:** `candidate/next-release` in `lifepass-android`
(`feat/ios-parity`, the four iOS 3.1.0 ports and the audit fixes; the
version commit is 235de56). `app.json` says **3.1.0**. The versionCode is
not in the repo: EAS keeps it remotely and adds one on every production
build (`eas.json`: `appVersionSource: remote`, `autoIncrement`). Nothing
has been built on EAS, uploaded or submitted.

**Owner decisions behind it** (16 Oct 2026): no Health Connect for now;
straight to Google Play production, and you press submit; the listing in
English and Icelandic; all code through PRs to `main` of the public repo.

## 1. What the build contains

**Signing in.** Create an account with email and password, or Continue
with Google or Apple (shown when Supabase has the provider on). Email
confirmation and password reset links open the app. Monthly memberships
ask once for the Icelandic eID (Kenni); visitor passes need none.

**Home.** Your next booking, today's workout for members with a plan, the
Reykjavík weather line, the check-in proof after a visit, and the Outside
card with a sight to visit.

**Explore.** The venue list and the map (Mapbox), search, filters, the
location banner, and the sights and hiking trails layer. Each venue page
has photos, what your plan covers, "Usual hours", the Icelandic
description when the app is in Icelandic, reviews (write one, or report
one), and a heart to save it.

**Booking and classes.** Book a time or a class in a few taps, with group
and premium options where the venue has them; the classes feed with its
own booking sheet, "See other times" and card-less class payment; My
bookings with cancel. Back and Confirm stay at the bottom at every text
size (the iOS 3.1.0 booking fix). A reminder before a booked class.

**Scan (check-in).** Scan the QR code at the door, or open a poster link
(a link always asks "Check in at {venue}?" first). Walk-ins with guests,
consent and pay where the venue charges, and every refusal the server can
give, worded as on iOS. The staff proof screen after check-in.

**Plans and payment.** Memberships and visitor passes with live prices,
the discount-code box ("Enter your code", no example code), payment on
Kling's hosted page, and a payment that is still being confirmed is picked
up again even if Android closed the app in the meantime.

**Coach.** Chat (type, or dictate in English), Plan my day, the venue
wizard, class cards you can book from the reply, Get a 4-week plan, Adjust
my plan, and, new in 3.1.0, **change your plan by telling the Coach**: it
shows the change, nothing changes until Apply, and Undo stays. "Change with
Coach" on the Today card and the session preview, and "I don't have this"
in the workout's swap sheet. Saved chats stay on the phone. Android only,
also new in 3.1.0: **"Report this reply"** on the Coach's chat replies and
on a Plan my day plan (the "..." beside the reply or the plan's intro, a
long-press, or TalkBack's action), for Google Play's AI-generated content
policy. Not on the health lane's replies (Get a 4-week plan, Adjust my
plan, changing the plan by telling the Coach); section 5 says why.

**Plan tab** (members 18 and over, after the separate health consent).
Today's card and the session preview, the guided workout with sets, reps,
a rest timer and one "Rest is over" notification, swap, skip, no energy
today, log a workout on any day (it counts toward the week), the programme
overview with its Changes list, history, the weekly check-in and weekly
review, the food card and drafts, Body and goals (weight history, target
weight, calorie goal, reminders, export, delete everything) and Your month
(the monthly feedback, with its notification).

**Meals.** Photo scan, barcode (Open Food Facts), search, presets, quick
add, create a food, the item and meal editors, describe what you ate, the
food diary and meal history.

**Profile and Account.** Bookings and Saved, the member card, language
(English or Icelandic), billing and cards, receipts, plan and usage,
cancel a subscription, company co-pay, referral, legal pages, delete the
account in the app, and, new in 3.1.0, a "Chat on WhatsApp" row under
Help & support that shows only while the server sends a WhatsApp number
(**off today**).

**Updates.** New in 3.1.0: at launch and on each return the app asks
`GET /api/v1/app-version?platform=android`. A newer Play version gets a
one-time "A new version is available" (never while a member is checking
in); a version below the minimum you set gets a full-screen "Please update
LifePass" with only an Update button. No answer means no prompt.

**Android only.** "Report review" on every review card (Google Play's
policy for user content asks for it; iOS has no report action yet), and
"Report this reply" on the Coach's chat replies and day plans (Play's
policy for AI-generated content; not on the health lane, section 5). The
hardware Back button closes sheets and steps back everywhere.

## 2. Known differences from iOS 3.1.0

| Area | iOS 3.1.0 | Android 3.1.0 | Why |
|---|---|---|---|
| Health data | Apple Health: sleep, steps, active energy, resting heart rate, HRV, weight and workouts | **No Health Connect.** Weight is entered by hand; the Apple Health rows, cards and "Connect" entries are not shown; no "lighter session after a short night"; Your month has no sleep or activity | Owner decision (16 Oct) |
| Coach "within a 15-minute drive" | Driving times from Apple Maps | Straight-line distance worked out on the phone | Decision D11; no map provider gets the position |
| Coach dictation | Apple's speech recognition, English | The phone's speech service (Google's), on the phone where it can, English (US) | Decision D12 |
| Maps | Apple Maps (MapKit), labels placed by hand | Mapbox, telemetry off; label overlap is decided by Mapbox | No MapKit on Android |
| Continue with Apple | Native Apple sign-in | Apple's web sign-in in a browser tab, through Supabase. An Apple account made on Android cannot have its Apple token revoked when deleted, and Apple may not send the name | Decision D1; accepted trade-off |
| Email links (confirm, reset) | `lifepass://auth/callback` | The same for now. The app also handles `https://www.lifepass.is/app/auth-callback`; the emails switch to it once that web page exists (section 6) | Decision D23 |
| Poster links (`lifepass.is/scan?v=`) | Universal Links (open the app) | App Links open the app only once `assetlinks.json` verifies on both hosts (section 6). Until then a poster opens the website; the in-app scanner works either way | Web follow-up |
| Update prompt | The server reads the App Store version itself | The server cannot see Google Play: the latest version is `APP_LATEST_VERSION_ANDROID`, set by hand (section 7) | Play has no public lookup |
| Rest timer | One "Rest is over" notification | The same; Android's battery saving can delay it by a little, as there is no exact-alarm permission | Decisions D9, D10 |
| Reviews | Read and write | Read, write and **report** | Decision D5, Play UGC policy |
| Report a Coach reply | Not there | **"Report this reply"** on each Coach chat reply and day plan: a reason (offensive or hateful, harmful or unsafe advice, wrong or misleading, something else) and an optional note; only that reply is sent (for a plan, its intro and its steps' notes). Not on the health lane's replies | Owner decision (28 Oct), Play AI-generated content policy; Android only |
| Deleting the account | One request key per sheet | A new request key after each answer, so "Keep my account" then Delete again is a fresh request | Engineering note in the parity decisions |
| A payment still being confirmed | Continue on another plan starts a new checkout | Continue brings back "Confirming your payment…" until that check ends | Android opens one payment at a time |
| Layout | iPhone and iPad | Phones, portrait only; a tablet shows the phone layout | Not built |

Same on both, for the record: no server push (every reminder is a local
notification), the Home weather line is English only, workout plans and
tracking are for members 18 and over, and WhatsApp stays hidden until the
server sends a number.

## 3. Before building

1. **Merge to `main`.** Open a PR from `candidate/next-release` to `main`
   (Claude can open it on your word) and merge it; build from `main`.
2. **EAS environment.** The production environment must hold
   `EXPO_PUBLIC_MAPBOX_TOKEN` (the Android `pk.` token; without it the map
   is a plain area) and, optionally, `MAPBOX_DOWNLOAD_TOKEN`. Check with
   `eas env:list --environment production`. Every profile, the development
   one included, uses this environment and the production servers.
3. **versionCode above Play's highest.** Play Console → Test and release →
   App bundle explorer shows the highest versionCode uploaded.
   `eas build:version:get -p android` shows the next one; if it is not
   higher, `eas build:version:set -p android` and enter a higher number.
4. **Upload key.** `eas credentials -p android` → the production keystore's
   SHA-256 must equal Play Console → Test and release → App integrity →
   App signing → **Upload key certificate**. If it differs, ask Google for
   an upload key reset there before building (it takes a day or two).
5. **Service account for `eas submit`** (once): Play Console → Users and
   permissions → invite a Google Cloud service account with release rights,
   and keep its JSON key outside the repo (it is git-ignored, but keep it
   out anyway). Without it, upload the `.aab` by hand in step 7.
6. **First build's `coach` Edge Function.** If `supabase functions list`
   (production) still shows `coach`, delete it and unset its
   `ANTHROPIC_API_KEY` secret; anyone with the public key can spend the
   Anthropic budget through it. Not tied to this build, but still open.

**Before submitting: the Coach report endpoint is live.** "Report this
reply" sends `POST /api/v1/coach/reports`. The web release with that
route, its table, the retention job and `/admin/coach-reports` must be in
production before this build is submitted (Play's reviewers may try it).
Check: `curl -i -X POST -H 'Authorization: Bearer invalid' https://www.lifepass.is/api/v1/coach/reports`
(a token that is not a session, so nothing is stored) answers with an
`application/problem+json` refusal (401, `authentication_required`),
**not 404**. Leave the dummy token in: without any token the route's
origin check answers first, with a 403 (`request_origin_not_allowed`),
which proves nothing about the route. A build that reaches members
before the route exists tells them "We couldn't complete that. Try again
or contact support." and stores nothing.

## 4. Build and submit

7. Build: `eas build -p android --profile production` (an `.aab`, signed
   with the EAS upload key, versionCode bumped remotely).
8. Optional but cheap: Play Console → Testing → Internal testing → upload
   the same `.aab`, install it from Play on one phone, sign in and open
   each tab. The owner decision is production, so skip this if you prefer.
9. Upload: `eas submit -p android --profile production --latest`. The
   submit profile puts it on the **production** track as a **draft**
   (`eas.json`), so nothing goes live yet. Claude asks you before running
   this.
10. Play Console → Test and release → Production → the draft release:
    paste the release notes from `store-listing.en.md` and
    `store-listing.is.md`, choose a staged rollout percentage if you want
    one, then **Review release** → **Start rollout to Production**. That
    sends it for review; the button is yours.

## 5. Play Console: everything around the release (owner)

**App signing SHA-256 to Vercel (App Links).** Play Console → Test and
release → App integrity → App signing: copy the **App signing key
certificate** SHA-256 (and the Upload key certificate SHA-256, so EAS
preview builds verify too). Vercel → the web project → Settings → Environment
Variables → Production:

- `ANDROID_PACKAGE_NAME` = `is.lifepass.android`
- `ANDROID_SHA256_CERT_FINGERPRINTS` = `<app signing SHA-256>,<upload SHA-256>`
  (as Play shows them, `AA:BB:…`, comma-separated)

Redeploy, then `curl -i https://www.lifepass.is/.well-known/assetlinks.json`
must answer **200** with JSON naming `is.lifepass.android` (today: 404).

**Store listing.** English and Icelandic text, graphics and screenshot
rules: `store-listing.en.md`, `store-listing.is.md`.

**App content** (Policy and programs → App content):

| Item | Answer |
|---|---|
| Privacy policy | https://www.lifepass.is/privacy |
| Ads | No ads |
| Advertising ID (if asked) | Not used (the permission is blocked in the manifest) |
| Data safety | `data-safety.md` (corrected 28 Oct: Mapbox and Google ML Kit send install ids and diagnostics, so Device or other IDs and Diagnostics are ticked). The Delete account URL is the public **https://www.lifepass.is/delete-account** page, once it is live (`data-safety.md` section 5), not `/profile`, which asks a signed-out reviewer to sign in |
| Government apps | No |
| Financial features | My app doesn't provide any financial features |
| News app | No |
| Health apps | Declare the health features: activity and fitness (workout plans, guided workouts, logged workouts) and nutrition and weight management (meal log, weight, calorie goal). Nothing medical. The app uses no Health Connect permissions, so no Health Connect declaration |
| Target audience and content | **18 and over** only. "Could the store listing unintentionally appeal to children?" No. Workout plans and tracking are 18+, and choosing only adults keeps the app out of the Families policy |
| Content rating | The questionnaire below |
| App access | The instructions below |

**Content rating** (IARC questionnaire; email support@lifepass.is):

- Category: **All other app types** (a membership and fitness app).
- Violence, fear, sexuality, language, controlled substances, crude humour,
  gambling: **No** to all.
- Users interact or exchange content: **Yes**. Members' venue reviews are
  public in the app; there is no chat between members. Reviews can be
  reported in the app and removed by LifePass.
- Shares the user's location with other users: **No**.
- Purchases of digital goods: **No**. LifePass sells access to physical
  venues (memberships, passes, bookings); the Coach, workout plans and meal
  estimates come with the account or the membership at no extra charge.
- Web browser or search engine: **No** (payment and eID pages open in a
  browser tab, but the app is not a browser).

Expect the lowest age ratings with a "Users Interact" note.

**Payments policy** (no form; keep this ready if Play's review asks). Google
Play Billing is for digital goods. LifePass memberships, passes and
bookings buy entry to gyms, pools, studios and lagoons, so they are paid on
Kling's page, as the policy allows for physical goods and services. No
digital content or feature is sold on its own: the Coach works within its
limits for any account, and workout plans, the meal log and tracking come
with an active membership at no extra charge.

**User-generated content (reviews).** What Play's UGC policy asks for,
and where it is:

- Terms for reviews: the Terms of Use at lifepass.is/terms.
- Report in the app: the "..." on any review card → **Report review** →
  a reason (offensive, personal information, not a genuine visit, spam,
  something else). One report per member per review; your own review
  cannot be reported. Android only for now.
- Moderation: lifepass.is/admin/reviews → **Reported** filter → delete with
  a reason (kept in the audit log; the venue's averages are recalculated).
- No member-to-member messaging, so no block feature is needed.

**AI-generated content (Coach).** Play's AI-generated content policy asks
for a way to report offensive AI output without leaving the app. Where it
is:

- Report in the app: every Coach chat reply has a "..." beside it, and so
  does the intro of a "Plan my day" plan (also a long-press on the reply
  or the intro, and a "Report this reply" action for TalkBack) →
  **Report this reply** → a reason (offensive or hateful, harmful or
  unsafe advice, wrong or misleading, something else) and an optional note
  (500 characters) → Send. The toast says "Thanks. We'll look at it."
  Twenty reports per account per 24 hours; after that the sheet says to
  try again later. Never on the member's own messages or on the app's own
  sentences (errors, limits, the venue wizard's lists, a plan's fallback
  intro). Android only for now. To show a reviewer: ask the Coach
  anything, or tap "Plan my day" and answer the four questions.
- Not on the health lane (members 18 and over, after the separate health
  consent): Get a 4-week plan, Adjust my plan and changing the plan by
  telling the Coach have no report action. Their replies are health data;
  a report would copy them into the reports table, which is not kept as
  health data, so they are left out on purpose (data minimisation, privacy
  policy 2.A; the saved chats leave the same turns out). If Play's review
  asks for reporting there too, it needs a report kept with the health
  data, a separate change.
- What is sent: the reply's words exactly as shown (for a day plan, its
  intro and each step's note, as the card draws them), the reason, the
  note and the app language. Nothing else of the conversation; the
  member's own messages and their answers to the plan's questions stay on
  the phone.
- Moderation: lifepass.is/admin/coach-reports (newest first, unreviewed
  first): read the reply, reason and note, mark it reviewed with an
  optional note; every action goes to the admin audit log. A report is
  deleted 180 days after it was made, and at once when the reporting
  account is deleted.
- **The server endpoint must be live before this build is submitted**
  (the check at the end of section 3).

**App access** (App content → App access → "All or some functionality is
restricted" → Add instructions). Use a dedicated review account, the same
one App Store review uses if you have it. Put the email and password **only
in Play Console**, never in this repo. Give it an active membership if you
can (a trial or a company plan), so the reviewer can see the Plan tab.
Paste into "Any other information":

```
Most of LifePass needs a signed-in account: on the first screen tap Log in and use the email and password above.
Explore, venue pages, classes, the map and the Coach work with this account. Please don't confirm a booking, payment or check-in: they are real venues in Iceland.
Monthly memberships need an Icelandic electronic ID (Kenni), which only works with an Icelandic ID and phone, so it can't be completed outside Iceland. Visitor passes don't need it.
Payments open the hosted page of Kling, an Icelandic payment provider. No payment is needed to review the app.
Checking in means scanning the QR code on a poster at a venue's door.
Workout plans and tracking (the Plan tab) are for members aged 18 and over with an active membership, after a separate health consent.
```

## 6. Web follow-ups

1. **assetlinks.json on both hosts, 200 and no redirect.** The www host
   needs only the Vercel variables above. The apex `lifepass.is` answers
   `/.well-known/assetlinks.json` with a **308 to www** from Vercel's domain
   redirect (the Next.js proxy already leaves `/.well-known` alone), and
   Android does not follow redirects when it verifies. The printed posters
   use the apex (`https://lifepass.is/scan?v=…`), so this one matters most.
   Fix: in Vercel → Settings → Domains, let `lifepass.is` serve the project
   instead of redirecting, and move the apex → www redirect into the web app
   for every path except `/.well-known/*` (agent PR plus your domain
   setting). Check: `curl -i https://lifepass.is/.well-known/assetlinks.json`
   answers 200 with no `location`; on a phone with the Play build,
   `adb shell pm verify-app-links --re-verify is.lifepass.android`, then
   `adb shell pm get-app-links is.lifepass.android` shows both hosts
   `verified`.
2. **`/app/auth-callback` page and the Supabase allow-list.** A page at
   `https://www.lifepass.is/app/auth-callback` that keeps the `#…` fragment
   and says "Open LifePass to continue", with a button to
   `lifepass://auth/callback` plus the same fragment (today: 404). Then
   Supabase (production) → Authentication → URL Configuration → Redirect
   URLs: add `https://www.lifepass.is/app/auth-callback`, keep
   `lifepass://**`. After that, a later app release switches
   `AUTH_EMAIL_REDIRECT` in `src/supabase/services/auth.ts` to the App Link.
   Until then the emails use `lifepass://auth/callback`, which already
   works.
3. **`signup_source: 'android'`.** The app writes it on every account it
   creates. `apps/web/src/server/customer/app-download-prompt.ts` counts
   only `"ios"` as an app sign-up; add `"android"`, and name it in
   `docs/05_MOBILE_API.md` and `docs/14_DATA_INVENTORY.md`. (Android
   sign-ups are already caught by the bearer-token sign, so this is a
   second, earlier signal, not a fix of a live problem.)
4. **Google Play links on the website, the day the listing is public**
   (D20): the `/app` page (`components/app-page/app-page-copy.ts`: the FAQ
   still answers "Is there an Android app?" with **No**, and "No iPhone?"
   lines), `components/site/app-store-badge.tsx` (add Google's official
   Get it on Google Play badge), the home page and Coach teasers, the Coach
   plans page, `lib/app-schema.ts` (JSON-LD operating systems),
   `lib/app-store-qr.ts`, the welcome and purchase confirmation emails,
   `llms.txt` and the service-notice definitions. The Play URL is
   `https://play.google.com/store/apps/details?id=is.lifepass.android`
   (already in `server/app-version.ts`).
5. **Privacy Policy, Android lines** (Coach drive search, speech service,
   map tiles): `data-safety.md` section 5. Best live before the listing
   goes public.
6. **WhatsApp** (unchanged from iOS 3.1.0): the Privacy Policy line naming
   WhatsApp/Meta first, then the number in
   `apps/web/src/lib/whatsapp-support-number.ts`. The row then appears in
   3.1.0 on both platforms by itself.

## 7. The update prompt after 3.1.0 is live

- **Set `APP_LATEST_VERSION_ANDROID=3.1.0` only once 3.1.0 is live on
  Google Play for everyone** (rollout at 100 %). Vercel → Settings →
  Environment Variables → Production, then redeploy, then
  `curl "https://www.lifepass.is/api/v1/app-version?platform=android"`
  shows `"latestVersion":"3.1.0"` (today it is `null`, so no Android build
  is prompted). Set it during a staged rollout and members outside the
  rollout would be told to update to a version Play won't give them yet.
- **Then, for every later release:** set it to the new version once that
  version reaches everyone. 3.1.0 members then see "A new version is
  available" once.
- **`APP_MIN_VERSION_ANDROID`: leave it unset.** The server ignores it while
  `APP_LATEST_VERSION_ANDROID` is unset, and caps it at that version. Set
  it only to block an old version, and only once the newer one is live.
  Check the newer version's minimum Android first: 3.1.0 runs on Android 7
  and up (`minSdkVersion 24`, `config/fragments/buildProperties.js`). If a
  later version needs a newer Android, never make it the minimum: phones
  that can't install it would be blocked with nothing to install.
- **1.0.0 never asks.** The first Android build has no check, so neither
  prompt reaches it. Play's automatic updates move most phones; the
  service email (lifepass.is/admin/notices) can tell the rest.
- 3.1.0 compares its own version: it says 3.1.0, so it asks nothing about
  itself.

## 8. Checks run for this release

On `candidate/next-release` with the version at 3.1.0 (28 Oct 2026):

- `npx tsc --noEmit`: no errors.
- `npx eslint .`: no errors.
- `npx jest`: 487 of 487 suites, 7,634 tests passed, 1 skipped.
- No real partner or union discount code anywhere in the repository
  (`git grep` for the known codes finds nothing).

Again with "Report this reply" added, and after its review fixes (the
sheet reopening after a swipe down, a 401 that keeps the session, the day
plan's report; branch `parity/coach-reply-report`, 28 Oct 2026):
`npx tsc --noEmit` and `npx eslint .` with no errors; `TZ=UTC npx jest
--ci --maxWorkers=3`: 489 of 489 suites, 7,684 tests passed, 1 skipped;
the Coach suites (44 suites, 925 tests) also pass under
`TZ=America/New_York` and `TZ=Asia/Tokyo`. The branch's only new copy is
the report sheet's, with no discount code in it.

Not done here, still to do: the EAS production build, an install of that
build on a phone, App Link verification (waits for section 6, item 1),
and a signed-in pass through every tab on the release build. The booking
layout and the update prompt were checked earlier on a 360 dp emulator at
font scale 2 against a local stub.

## 9. Not in 3.1.0

- **Member feedback** (quick visit ratings, the class room "Salur", hearts
  on hikes and sights, the Google Play review ask): branch
  `parity/member-feedback`, for the version after 3.1.0. It needs privacy
  v19 live first and a new EAS build (it adds `expo-store-review`).
- **The attend call carrying `bookingId`** (API 0.47.0): next release, on
  both platforms.
- **Health Connect**: when you ask for it.
