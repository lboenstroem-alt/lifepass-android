# Google Play Data safety answers (LifePass for Android 3.1.0)

Play Console → Policy and programs → App content → **Data safety** →
Start (or Manage). Fill it in as below, then submit it with the release.

**Where these answers come from.** The iOS privacy manifest
(`LifePass 2/PrivacyInfo.xcprivacy`, iOS 3.1.0 at 7a020ee) and its App Store
privacy label (iOS `RELEASE-2.5.0.md` section 1), and the Privacy Policy at
https://www.lifepass.is/privacy (version 2026-10-v18). Each answer was then
checked against what this Android build actually does. Where Android differs
from iOS, the row says so. The three must tell one story: if the app, the
policy or one of these answers changes, change the other two.

**Not ads, not tracking.** The app shows no ads, reads no advertising ID
(`com.google.android.gms.permission.AD_ID` is blocked in `app.json`) and has
no analytics or crash SDK of its own (`src/lib/analytics.ts` sends nothing).
Two SDKs inside the app still send technical data to their makers, and the
form must say so (checked in the 3.1.0 build, 28 Oct 2026):

- **Mapbox** (the Explore map). Its telemetry is switched off at start
  (`src/features/explore/map/mapbox.ts`), but the SDK still sends Mapbox its
  monthly-user count at every app start: a per-install id, the phone model
  and the Android version. This cannot be switched off.
- **Google ML Kit** (inside the camera library's QR and barcode reader).
  When a member scans, ML Kit sends Google diagnostics with a
  per-installation id: device and app info, performance and error codes
  (Google's ML Kit Android data disclosure). The codes themselves are read
  on the phone.

## 1. Data collection and security

| Question | Answer |
|---|---|
| Does your app collect or share any of the required user data types? | **Yes** |
| Is all of the user data collected by your app encrypted in transit? | **Yes** (every call is HTTPS: the LifePass API, Supabase, Kling's and Kenni's pages, Open Food Facts, Mapbox, Google ML Kit) |
| Which methods of account creation does your app support? | **Username and password** (email and password) and **OAuth** (Continue with Google, Continue with Apple) |
| Delete account URL | **https://www.lifepass.is/delete-account**, once that public page is live (section 5). Not `/profile`: it sends a signed-out visitor to the sign-in form, so it shows no steps |
| Do you provide a way for users to request that some or all of their data is deleted? | **Yes**. In the app: Profile → the gear (Account) → **Delete account**. Health data alone: Account → Body and goals (or the gear on the Plan tab) → delete all health data → **Delete everything**. On the web: lifepass.is/profile. By email: support@lifepass.is |
| Has your app undergone an independent security review (MASA)? | **No** (unless you commission one) |
| Families policy | Not applicable (target audience is 18 and over) |

Play's account-deletion rule wants the linked page itself to name the app
or developer, show the way to delete prominently, and say what is deleted
and what is kept. A sign-in form shows none of that, and a deletion answer
Play doesn't accept gets the update rejected. So the URL needs a public page
first (section 5); it is a web change, not an app change.

## 2. Data types collected

"Shared" is **No** for every row (see section 3 for why). Every row is
**collected**, not processed ephemerally unless the row says so.

| Play category → type | Collected on Android | Required or optional | Purposes to tick | iOS label row |
|---|---|---|---|---|
| Personal info → **Name** | Given at sign-up (or by Google or Apple) and shown on the member card | Required | App functionality, Account management | Contact Info → Name |
| Personal info → **Email address** | The sign-in identity; receipts, booking and service emails; marketing emails only with the sign-up switch on (Privacy 3.1) | Required | App functionality, Account management, Developer communications, **Advertising or marketing** (see note A) | Contact Info → Email Address |
| Personal info → **User IDs** | The account's own id, which every request is made as | Required | App functionality, Account management | Identifiers → User ID |
| Personal info → **Other info** | The kennitala, verified through Kenni (needed for a monthly membership), and the nationality given at sign-up or on the profile (a Bokun venue needs it for the ticket) | Optional | App functionality, Fraud prevention, security and compliance (the kennitala stops duplicate and shared memberships) | Other Data → Other Data Types |
| Financial info → **Purchase history** | Memberships, passes, bookings and check-ins. Card details are never collected: the card is entered on Kling's own page | Required | App functionality | Purchases → Purchase History |
| Health and fitness → **Health info** | Weight, height, target weight, the body log, sex, age band and activity level for the calorie goal, the health questions a workout plan asks, the weekly check-in answers, the food log (foods, kcal and macros), the calorie and nutrition goal, and the words of "describe what you ate". Behind a separate health consent, 18 and over | Optional | App functionality | Health & Fitness → Health |
| Health and fitness → **Fitness info** | Workout plans, workouts and sets, logged workouts, how a session felt, the monthly feedback switches | Optional | App functionality | Health & Fitness → Fitness |
| Photos and videos → **Photos** | A meal photo, sent once to make the estimate: LifePass never stores it; Anthropic, our processor, deletes it within 30 days under its standard retention (Privacy 2.G and 4.E). The phone shrinks it and strips its metadata first | Optional | App functionality | User Content → Photos or Videos |
| Location → **Approximate location** | The Coach's "near me": a position rounded to about a kilometre on the phone, and again on the server. **Processed ephemerally: No** (see note B) | Optional | App functionality | Location → Coarse Location |
| App activity → **Other user-generated content** | Coach chat messages, foods a member creates, venue reviews (rating, comment, visit date), reports of a review, and reports of a Coach reply (Android only: the reply's own words as shown, for a day plan its intro and its steps' notes, a reason and an optional note of up to 500 characters; nothing else of the chat, so the member's own messages never travel with it; deleted 180 days after the report, or at once with the account) | Optional | App functionality | User Content → Other User Content |
| App activity → **In-app search history** | Venue and class searches: the typed words go to the LifePass API in the request address, and hosting logs keep those for up to 90 days. Food searches are sent in the request body and not kept. **Processed ephemerally: No** | Optional | App functionality | (not on the iOS label) |
| App activity → **Other actions** | Saved venues and activities (the heart), kept with the account until unsaved, and whether a monthly feedback report was seen or dismissed | Optional | App functionality | (not on the iOS label) |
| Messages → **Other in-app messages** | The Coach chat, a conversation with the AI Coach (there is no messaging between members). Anthropic keeps it up to 30 days. Also under user-generated content above; declaring both is the safe side | Optional | App functionality | User Content → Other User Content |
| App info and performance → **Diagnostics** | Google ML Kit's own diagnostics when the camera reads a QR code or barcode: device and app info, performance and error codes, sent to Google | Required (any scan sends it) | Analytics | (iOS uses Apple's own reader) |
| **Device or other IDs** | Mapbox's per-install id, sent at every app start for Mapbox's monthly-user count, and ML Kit's per-installation id, sent with its diagnostics when a member scans. Neither is an advertising ID | Required | App functionality, Analytics | Identifiers → Device ID (iOS: its install id, for Apple Health uploads) |

**Note A, marketing email.** The sign-up screen has a marketing switch
(off by default) and the Privacy Policy section 3.1 says we send marketing
emails to those who turn it on, so Play's "Advertising or marketing"
purpose belongs on Email address. The iOS label leaves "Developer's
Advertising or Marketing" unticked; consider ticking it there too, so the
two stores agree with the policy.

**Note B, not ephemeral.** Play counts data as processed ephemerally only
when it is kept no longer than the one request needs. The server turns the
rounded position into the nearest town and region for the model, but a
generated day plan of nearby places stays in the host's short response
cache, found by a one-way code (Privacy v18, Coach row), so neighbours with
the same rounded position can share it. That outlives the request, so the
answer is No. No is never wrong; Yes could be.

## 3. Why "Shared" is No

Play counts data as **shared** when it goes to a third party, except to a
service provider processing it on our behalf, for a legal reason, or when
the member starts the transfer and expects it. Every recipient falls under
one of those:

| Recipient | What it gets | Why it is not "sharing" |
|---|---|---|
| Supabase (database, sign-in), Vercel (hosting), Resend (email), Anthropic (Coach, meal estimates and meal descriptions), Abler (booking system) | What it needs to run the service | Processors under data processing agreements (Privacy section 4) |
| Kling | Name, email, kennitala and payment details, when the member starts a subscription or saves a card | The member starts it, on Kling's own page; Kling needs it to set up the payment agreement (Privacy 4.D) |
| Partner venues, Bokun | The member's name at check-in or booking; nationality for a Bokun ticket | The member books or checks in at that venue (user-initiated) |
| Google or Apple sign-in | Only what the member's own Google or Apple account sends us | The member chooses the provider; nothing goes from us to them |

Straight from the phone, with nothing about the member from us:

- **Open Food Facts** gets the barcode a member scans, the phone's internet
  address and the app version (Privacy 4.J). No account, cookie or LifePass
  id. A product barcode is not member data in Play's list.
- **Mapbox** draws the Explore map tiles. Telemetry is off, but the SDK
  sends its monthly-user count at every app start: a per-install id, the
  phone model and the Android version (Device or other IDs above). It never
  gets the member's location fix; it gets the tiles for the area on screen,
  which after Locate is the area around the member.
- **Google ML Kit** reads QR codes and barcodes on the phone. When a member
  scans, Google receives ML Kit's diagnostics with a per-installation id
  (Diagnostics and Device or other IDs above); Google says it does not pass
  them on to third parties. It never gets the code or the camera image.
- **The phone's speech service** (Google's, on the phone where it can) turns
  Coach dictation into text. LifePass never receives the recording; only
  the text, if the member sends it, which is a Coach message above.
- **Open-Meteo** gets one fixed Reykjavík point for the Home weather line.
- **Unsplash** serves the photos behind the sign-in screens (plain image
  requests).

## 4. Not collected (leave unticked)

| Type | Why |
|---|---|
| Location → Precise location | The map dot, the distance sort and the Coach's 15-minute drive (a straight line on Android) are worked out on the phone. The precise fix never leaves it |
| Personal info → Address, Phone number, Race and ethnicity, Political or religious beliefs, Sexual orientation | Not asked. Nationality is not ethnicity; it is under Other info |
| Financial info → User payment info, Credit score, Other financial info | Cards are entered on Kling's page, never in the app |
| Messages → Emails, SMS or MMS | None. (Other in-app messages is ticked for the Coach chat above) |
| Audio | Dictation stays with the phone's speech service; no recording reaches us |
| Photos and videos → Videos | None |
| Files and docs, Calendar, Contacts | None. The body export is a file the member saves or shares themselves |
| App activity → App interactions, Installed apps | No analytics is sent (`src/lib/analytics.ts` is a no-op in release builds). Search history and Other actions are ticked above |
| Web browsing | None |
| App info and performance → Crash logs, Other | No crash SDK. (Diagnostics is ticked above, for ML Kit) |

## 5. Before you submit: two fixes outside the app

**1. A public account-deletion page.** Publish
https://www.lifepass.is/delete-account (English and Icelandic, no sign-in)
and enter it as the Delete account URL in section 1. It should:

- name LifePass and SportA ehf.;
- give the three ways: in the app (Profile → the gear → Delete account), on
  the web (sign in at lifepass.is/profile → Delete account) and by email
  (support@lifepass.is);
- say what is deleted and when, and what is kept and for how long, in the
  Privacy Policy's own words (section 7): account details go within 30 days
  after the later of the request and the end of a period already paid for;
  transaction, booking and check-in records stay 7 years (bookkeeping and
  venue reconciliation).

**2. Android lines in the Privacy Policy.** The Privacy Policy (2026-10-v18)
describes the **iOS** app's device features and says nothing about the
Android app's equivalents. Members reading it from the Play listing should
find their phone described. The policy needs an Android line in each of
these places (owner wording, agent can draft the web PR):

- **Coach short-drive search:** on Android the app measures a straight line
  on the phone to the nearest venues; no map provider gets the position
  (iOS asks Apple Maps).
- **Microphone and speech recognition:** on Android the phone's own speech
  service (Google's) turns speech into text, on the phone where it can,
  under Google's terms (iOS uses Apple's).
- **Map tiles:** the Android app draws its maps with Mapbox, telemetry off.
  Mapbox receives the technical request data for the tiles and, at every
  app start, a per-install id with the phone model and Android version for
  its monthly-user count (iOS uses MapKit). Section 4.E names Mapbox only
  for the website; add the app.
- **QR and barcode reading:** on Android the camera reads codes with Google
  ML Kit, on the phone. When a member scans, Google receives ML Kit's
  technical diagnostics with a per-installation id, not the code or the
  image. Add Google (ML Kit) to the processor list in section 4.
- **Reports of a Coach reply** (Android only for now): a member can
  report a Coach chat reply or a day plan (never a reply in the health
  lane); LifePass stores the reply's words (for a day plan, its intro and
  its steps' notes), the reason, the optional note, the language, the
  reporting account and when, for the LifePass team to review, and
  deletes it 180 days after it was made or at once with the account. None
  of the member's own messages is sent.
- **The data inventory** (lifepass-monorepo `docs/14_DATA_INVENTORY.md`)
  lists Mapbox only for the website and has no ML Kit row; add both, and
  the Coach reports table.
- **Apple Health:** already scoped to "versions of the app that include
  Apple Health", so nothing to change; Android has no Health Connect.

Until that edition is live, these Data safety answers are still accurate
(they describe what leaves the phone); the gap is only in the policy text.
Publish the edition close to the listing going public, so the form, the
policy and the app tell one story.

## 6. When these answers must change

- **Health Connect** (owner decision: not built). If it ships: Health info
  and Fitness info gain the Health Connect data, and Play's Health Connect
  permissions declaration is needed too.
- **An upgrade of Mapbox or of the camera library** (expo-camera brings ML
  Kit): re-read what the new SDK sends before the release.
- **Any analytics, crash or attribution SDK**: a Data safety change first
  (App activity, App info and performance, maybe Device IDs).
- **The member-feedback release after 3.1.0** (visit ratings, saved hikes
  and sights, the Google Play review ask): ratings are public user content,
  already covered by "Other user-generated content"; re-read this page
  against that build before its release.
