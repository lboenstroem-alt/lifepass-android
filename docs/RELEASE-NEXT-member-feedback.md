# Member feedback: the Android release after 3.1.0

**What it is.** Lucas's member-feedback set of 27 October 2026, on Android:
the class room ("Salur"), a heart on every hike and sight, the venue rating
numbers, "How was your visit?" about an hour after a check-in, and a rare
Google Play rating ask. Same behaviour and words as the iOS app version
after 3.1.0 (`lifepass-ios` `feat/member-feedback`), on API contracts
0.44.0, 0.45.0 and 0.46.0, which are live.

**Branch:** `parity/member-feedback` on `lboenstroem-alt/lifepass-android`,
from `candidate/next-release` at b66581c (the Android 3.1.0 candidate). It is
**not merged anywhere**: it ships in the Android version AFTER 3.1.0. Merge
it into the next release branch once 3.1.0 is out. The version is unchanged
(app.json `2.5.6`, versionCode EAS-remote): set it when you build that release.

## Before you submit (pre-release gates)

1. **PRE-RELEASE GATE: the privacy policy edition that covers visit ratings
   must be live on lifepass.is before this version is submitted** (or handed
   to anyone with a real account, an internal test track included). This app
   sends `X-LifePass-Features: visit-rating-prompts` on every request, so from
   its first check-in the server records "requests to rate a visit"
   (`visit_rating_prompts`, kept 90 days) and takes public quick ratings with
   the visit's date. The wording is drafted in the monorepo,
   `docs/14_DATA_INVENTORY.md` section 7, "Quick visit ratings": 2.F (the
   notification an hour after a check-in), 4.I (a rating given when the app
   asks is public; with a comment it shows the visit's date; the Icelandic
   "eða gefur honum einkunn"), and a section 7 row for the requests. The
   edition number is still to be chosen (v19 is reserved for WhatsApp).
2. **A new EAS build is needed.** The release adds one native module,
   `expo-store-review` 9.0.9 (Google Play's In-App Review API,
   `com.google.android.play:review` 2.0.1). An update that only changes
   JavaScript cannot carry it; build with `eas build -p android --profile
   production`. Without the module the app never asks (it checks first) and
   never crashes, but the Play rating card would never show.
3. Google Play submission only with Lucas's explicit OK (standing rule).
   No EAS or Play build was made from this branch and nothing was uploaded or
   submitted (the device check below used a local debug build).
4. **Look at the room, the hearts and the rating numbers on a device.** The
   emulator pass below covered "How was your visit?" and the Account row
   only; the room, the hearts and the venue numbers (A1 to A3) are covered by
   Jest UI tests but have not been seen on an Android phone yet. Do it on a local
   debug build of the release itself, after the merges below (so the Coach
   chat's cards carry the room too), in English, in Icelandic, and in
   Icelandic at font scale 2.0 (the largest):
   - the room: a Classes row and Home's upcoming card ("World Class Laugar &
     Pool · Salur 4"), the class sheet's row ("Room: Salur 3" / "Salur: 3",
     `EXPO_PUBLIC_FIXTURE="classSheet=included"`), My bookings, the Coach
     plan's class card and the chat's class cards;
   - the hearts: a sight's page, Home's Outside card, the search rows, and
     Favourites' "Hikes & sights" / "Útivist", with a saved sight and empty;
   - the numbers: a venue's "4.6 · 23 ratings" / "4,6 · 23 einkunnir", and the
     Equipment and Cleanliness averages ("Tækjabúnaður", "Hreinlæti").

   No sign-in and no server writes. Only the class sheet has a dev fixture;
   the signed-in lists (My bookings, Favourites, Home's upcoming card) and the
   averages (shown once three members gave one) need data the fixtures do
   not have, so serve them from a local stub API: a development build reads
   `EXPO_PUBLIC_LIFEPASS_API_URL`.

## What is in it

| # | Commit | What it does |
|---|---|---|
| 1 | 0b9b6d8 | The vendored API contract 0.46.0 and regenerated types. |
| 2 | 059fae3 | **The class room.** "World Class Laugar & Pool · Salur 4" on class rows, Coach cards, My bookings and Home's upcoming card; the room alone on a venue's own timetable; a "Room" / "Salur" row on the booking sheet and the booking detail ("Salur: 4", never "Salur: Salur 4", in Icelandic). Shown only when the server sends one. |
| 3 | 7e22b47 | **Venue rating numbers.** "4.6 · 23 ratings" / "4,6 · 23 einkunnir" from `totalRatings` (else `totalReviews`; no count at 0), and the Equipment and Cleanliness averages ("Tækjabúnaður", "Hreinlæti") on the reviews section once three members gave one. |
| 4 | 33a3599, 763d441, f5d7be9 | **Hikes and sights.** A heart on every attraction (detail, cards, lists, Home's Outside card), saved with the account; a third Favourites section "Hikes & sights" / "Útivist". Lined up with iOS. |
| 5 | 802bc1e | **A check-in reserves the ask.** The features header on every request; `ratingPrompt` and `lifetimeCheckIns` read fail-soft from the walk-in, the hosted-page confirm and the profile. |
| 6 | f4028e2 | **The Google Play rating ask**, and **Rate LifePass** in Account. |
| 7 | b633f8e | **"How was your visit?"**: the notification, the Home card, the sheet and the thank-you. |
| 8 | e25b130 | Home's Most Popular ranks by every rating (`totalRatings`), as iOS does since d7d3245. |
| 9 | 5eab33b | A development-only fixture for device checks (`visitRating=card|sheet|written|thanks`). |
| 10 | a8319a1 | The comment field keeps its own text (found on the emulator: the controlled field lost letters typed faster than JavaScript answered). |
| 11 | 97d721a | A test that every key the code writes out in a `t()` call is in both tables (`src/i18n/__tests__/keysInCode.test.ts`), so an ahead-of-iOS entry deleted too early fails a test instead of putting raw keys on screen. |

### "How was your visit?" (B1)

- **The server decides when** (at most once a member in 30 days, never the
  same venue twice in 90, only real visits). The app schedules what the
  check-in reserved and shows what the server returns; it decides nothing.
- **The notification.** One local notification about an hour after the
  check-in (`visit-rating-<id>`, on the existing "engagement" channel, in the
  account language): "How was your visit?" / "Tap to rate it — World Class
  Laugar". Only for a member who already allows notifications: it never asks
  for the permission. A newer ask replaces an older one, and it goes when
  the ask is answered, dismissed or closed by the server, when it lapses
  (three days after it is due) and at sign-out. Tapping it opens Home and the
  sheet for the ask the server says is current (nothing if there is none).
- **The Home card**, right under the hero: the title, the venue, "Tap the
  stars to rate it", five stars and "Not now". The app asks the server only
  while Home is on screen, once per return to the foreground, and never
  while a booking, payment or check-in flow is on screen (asking marks the
  ask as shown). No card, and no error, when there is no ask, the server is
  older or the phone is offline.
- **The sheet**: Overall (needed for Send), Equipment and Cleanliness
  ("Optional"), a comment (up to 500 characters, "12/500"), or, for a member
  who already wrote a review of the venue, "Your stars replace the ones on
  your review. Its text stays as it is."; the public note; Send and Not now
  pinned at the bottom, so they stay in reach at every text size (the sheet
  opens full height at the largest sizes and scrolls). TalkBack reads each
  row of stars as one adjustable control: "Overall, 4 out of 5 stars".
- **The thank-you**: "Thanks for rating!", "Your stars now count in the
  venue's rating.", and while the member has no written review, "Want to
  tell other members more?" with "Write a public review" (the venue page,
  where the review form is). Done closes it.
- **Refusals**, as the contract's table says: already rated, expired or
  closed (409), a voided visit (403) and another member's ask (404) close
  the sheet, cancel the notification and say why; no answer, a 5xx or a 400
  keep the sheet with "Couldn't send your rating. Try again." (the same
  answer is sent again under the same Idempotency-Key, so a send that did
  land is answered with the thank-you, never "already rated"); a 429 also
  holds Send back for its Retry-After.

### The Google Play rating ask (B2)

- **When**: after a 4 or 5 star answer, once the thank-you has closed (not
  when the member goes on to write a review); or when the member leaves the
  proof of their fifth check-in or later (never while the proof reception
  reads is up).
- **Gates, all of them**: the account is more than 7 days old; this phone has
  not asked for this account in 4 months (kept per account on the phone,
  recorded whenever Google Play's API is called); no booking, payment or
  check-in flow on screen (one still up a moment after Done is waited out
  for 5 seconds at most). Google Play's own card only, where the phone has
  it; no home-made "Do you like LifePass?". Google keeps its own quota, so
  the card may not appear even when the app asks.
- **Rate LifePass** / **Gefa LifePass einkunn** in Account, "On Google Play"
  / "Á Google Play", under Help & support: always there, never an ask. It
  opens LifePass in the Play Store app, or the web listing.

### Choices made where the brief left room

- The ask's notification uses the existing **engagement** channel (default
  importance), not a channel of its own: a channel's importance can never be
  changed once released, and a member who silenced the nudges has said they
  do not want to be asked things.
- A **404** on Send says "This rating request is closed." (the contract has
  no 404 line; it is the closest).
- A **400** keeps the sheet open with the "Couldn't send" line (the contract
  has no 400 line; a 400 is a client bug).
- The store review's 4 months are **calendar months** (31 October plus 4
  months is the end of February).
- The TalkBack value of a row of stars reuses the reviews page's
  "{count} out of 5 stars" / "{count} af 5 stjörnum".
- The card asks the server only while **Home is the screen in focus** (once
  per return to the foreground): asking marks the ask as shown, and the card
  lives on Home. A member who opens the app on another tab gets the card when
  they reach Home.
- The card sits right under Home's hero (or its header while there are no
  venues), above today's plan.
- **Rate LifePass** sits under Help & support (and Chat on WhatsApp, when
  shown), above Log out.
- "Write a public review" opens the venue page (as the brief says), whose
  reviews section leads to the app's existing "Write a review" form; posting
  it turns the quick rating into the written review (the server takes the
  quick rating over, no 409).

## Copy keys

Every key the brief named is used as named, except where Android differs:

| Brief | Android |
|---|---|
| `visitRating.*` (every row of the contract table) | the same keys, base dictionary, via `src/i18n/ahead-of-ios.json` |
| `account.rateApp.title` | the same key, via `ahead-of-ios.json` |
| `account.rateApp.subtitle` (iOS: "On the App Store") | `account.android.rateApp.subtitle` ("On Google Play" / "Á Google Play") in the ACCT-1 Android pack, plus `account.android.rateApp.hint` for TalkBack |
| `venue.ratings.count` | `venue.ratings.count.one` / `.many` (the app's plural rule) |
| the stars' spoken value | the existing `venue2.a11y.rating` |

**Keep every entry in `src/i18n/ahead-of-ios.json` until the committed
tables are regenerated from an iOS source that has its words.** The tables on
this branch are generated from iOS 161a0a8 (2.5.6), which has none of the
member-feedback keys: the entries are the only thing that puts them in
`strings.en.json` and `strings.is.json`. When the script, run over another
iOS source just to look (say `lifepass-ios` `feat/member-feedback`, with
`--out` somewhere else), says an entry has landed, that is true of that
source only. Delete the entry in the same commit that regenerates the
committed tables from that same source, and only the entries the script
reports as landed for it. Deleted any earlier, regenerating from 161a0a8 (or
from iOS 3.1.0, which has none of them either) takes its keys out of the
tables and the app shows raw keys such as `favourites.tabs.outdoors`.
`generated.test.ts` does not see that (its counts follow the file);
`keysInCode.test.ts` does. The script also refuses, writing nothing, if
iOS words any key differently.

## Merging into the release line

`parity/fix-classes` (the other session's, not yet in `candidate/next-release`
when this was written) changes the same places. When the two branches meet:

1. **The room on the Coach chat's class cards.** fix-classes 8fea0b1 adds
   class cards under a Coach reply. It was cut from b66581c, before rooms,
   so its cards have no room. iOS shows one there ("Hress · Salur 3",
   `CoachClassCardsView`, `ClassRoom.afterVenue`). At the merge:
   - `CoachPlanClass` (`src/features/classes/coachLookup.ts`): keep both
     sides' fields, `room` from here and the chat card's optional `status`,
     `spotsLeft`, `priceLabel` and `surchargeFromIsk` from there.
   - `decodePlanClass` (`src/features/coach/dayPlan/decode.ts`): keep
     `room: readRoom(raw.room)` (`src/api/wire.ts`) beside the card's extras.
     `decodeClassCards` reads every card through it, so absent, null or blank
     is no room.
   - `encodePlanClass`: add `if (session.room != null) json.room =
     session.room;`, or a saved chat loses the room when it is read back.
   - `ClassRow` in `src/screens/coach/ClassCardsMessage.tsx`: the venue line
     `{session.venueName}` becomes
     `{venueWithRoom(session.venueName, session.room)}`
     (`src/copy/classRoom.ts`).
   - Tests, as PlanMessage.test.tsx's "the class card's room (API 0.44.0)": a
     card with `"room": "Salur 3"` decodes it and reads "Venue · Salur 3";
     absent, null and "" read the venue alone; `encodePlanClass` then
     `decodePlanClass` keeps it. The fix-classes tests that build a
     `CoachPlanClass` by hand need `room: null`; tsc and the decode tests
     point at each one.
2. **The tables.** fix-classes 1a658ac regenerates them from iOS
   `release/3.1.0-candidate` and empties `ahead-of-ios.json`, because iOS
   3.1.0 has landed the two older entries (Þjónusta, Usual hours). Resolve
   `ahead-of-ios.json` to this branch's six member-feedback entries (all but
   those two), re-run `python3 scripts/import-ios-strings.py` over the same
   iOS 3.1.0 sources into `src/i18n`, and take the counts in
   `generated.test.ts` from what it prints. Run over iOS 7a020ee with this
   branch's eight entries, it reports the two older ones as landed and all
   six member-feedback entries as ahead of iOS: keep all six (see Copy keys).

## Test results (27 October 2026)

After the review, at 97d721a (the keys test; these notes change no code):
`npx tsc --noEmit` 0 errors; `npx eslint .` 0 errors, 0 warnings;
`TZ=UTC npx jest --maxWorkers=4`: **506 of 506 suites passed; 7,804 tests
passed, 1 skipped** (keysInCode.test.ts adds 1 suite and 4 tests).

At a8319a1, in the branch's worktree (Node 25, Expo SDK 54):

- `npx tsc --noEmit`: 0 errors.
- `npx eslint .`: 0 errors, 0 warnings.
- `TZ=UTC npx jest --maxWorkers=4`: **505 of 505 suites passed; 7,800 tests
  passed, 1 skipped**. The base (b66581c with only the 0.46.0 contract) had
  487 suites and 7,560; the room, hearts and rating numbers brought it to 496
  and 7,673; this work (B1, B2, Most Popular, the fixture) adds 9 suites and
  127 tests.
- The same suite under `TZ=America/New_York` and `TZ=Asia/Tokyo` (CI runs
  both): 504 of 505; the 3 failing tests are all in
  `src/features/meals/diary/__tests__/DiaryScreen.test.tsx`, which fails the
  same way on the base b66581c. Nothing in this release touches meals.
- New tests for B1 and B2 (119 in 9 files, plus 8 in files that were there):
  - the wire: `ratingPrompt` absent, null, unreadable and a value;
    `lifetimeCheckIns` (walk-in, hosted confirm, profile); the answer's body
    and key and the dismiss checked against the vendored contract; the
    header on every request (signed in or not); every refusal's meaning
    (src/api/__tests__/visitRating.test.ts, client.test.ts);
  - the walk-in and the hosted confirm reporting the ask, the count kept for
    the proof, leaving the proof reported only once it is down, nothing after
    a sign-out (walkInVisitRating.test.ts, payments checkInFacts.test.ts);
  - the notification: one at dueAt, the id and route in its payload, the
    engagement channel, the account language, never a permission dialog, at
    most one pending, nothing for an ask already due, cancelled on answer,
    dismiss, lapse and sign-out (visitRating notifications.test.ts);
  - the card and the sheet's rules: once per foreground, never over a flow,
    fail-soft, a shared request, Send's key on retry, the 400/403/404/409/429
    and network cases, "Not now", the sign-out fence (store.test.ts);
  - the screens: the card's words and stars, the sheet's rows in order, the
    adjustable stars ("Overall, 4 out of 5 stars"), the counter, the replace
    note, the thank-you, "Write a public review", the toast for a closed ask,
    the notification tap waiting for a flow, full height at font scale 2, EN
    and IS (VisitRatingUi.test.tsx);
  - the Google Play ask: 7 days, 4 calendar months per account, a flow on
    screen (and waiting one out), both happy moments, Google Play missing,
    a refused card still counted, two moments at once (storeReview.test.ts);
  - what counts as a flow on screen (flowsOnScreen.test.tsx); the tap's
    route and intent (notificationRouter.test.ts); the Account row in both
    languages, market:// then the web listing, never an ask
    (AccountScreen.test.tsx).
- `python3 scripts/import-ios-strings.py` with the iOS 161a0a8 sources leaves
  `src/i18n` unchanged. Against `lifepass-ios/feat/member-feedback` (f723f93,
  which does not have B1 and B2 yet) both new entries are "ahead of iOS" and
  nothing conflicts.
- `npx expo install expo-store-review` added only `expo-store-review` 9.0.9
  (package.json and package-lock.json, nothing else moved).

## Device check (emulator)

A local debug build of this branch (`expo prebuild` and Gradle on this Mac,
not EAS; nothing uploaded) on the Pixel 8 emulator (Android 16, API 36),
started read-only so nothing stayed on it, in a development fixture
(`state=entitled-no-plan,visitRating=card|sheet`, `language=is`). The
fixture answers every visit rating call on the phone: nothing reached the
server, nobody signed in, and Google Play's review card was never asked
for. Checked and
photographed (kept outside the repo, with the other member-feedback shots):

- English: Home's card; the sheet with Overall 4, Equipment 5, Cleanliness
  4 and a comment, the keyboard keeping Send and Not now above it; the
  thank-you with "Write a public review"; Account's "Rate LifePass / On
  Google Play" under Help & support. Tapping the row opened Google Play.
- Icelandic at font scale 2.0 (the largest): the sheet opens full height,
  the form scrolls to the public note and Senda / Ekki núna stay pinned; the
  thank-you with Loka; the card (title and venue wrap, Ekki núna stays at
  the top right, the stars keep their size); "Gefa LifePass einkunn / Á
  Google Play".
- Found and fixed on the device: the comment field dropped letters typed
  very fast (a8319a1).

Not checked on a device: a real check-in's notification and its tap (that
needs a real account and a production check-in), and Google Play's own
review card (Google shows it only to an app installed from Play). The room,
the hearts and the rating numbers have not been seen on a device either:
that is pre-release gate 4.
