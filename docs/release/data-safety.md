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
(`com.google.android.gms.permission.AD_ID` is blocked in `app.json`), has
no analytics or crash SDK (`src/lib/analytics.ts` sends nothing), and the
Mapbox SDK's telemetry is switched off at start (`src/features/explore/map/mapbox.ts`).

## 1. Data collection and security

| Question | Answer |
|---|---|
| Does your app collect or share any of the required user data types? | **Yes** |
| Is all of the user data collected by your app encrypted in transit? | **Yes** (every call is HTTPS: the LifePass API, Supabase, Kling's and Kenni's pages, Open Food Facts) |
| Which methods of account creation does your app support? | **Username and password** (email and password) and **OAuth** (Continue with Google, Continue with Apple) |
| Delete account URL | **https://www.lifepass.is/profile** (sign in, then Delete account) |
| Do you provide a way for users to request that some or all of their data is deleted? | **Yes**. In the app: Profile → the gear (Account) → **Delete account**. Health data alone: Account → Body and goals (or the gear on the Plan tab) → delete all health data → **Delete everything**. On the web: lifepass.is/profile. By email: support@lifepass.is |
| Has your app undergone an independent security review (MASA)? | **No** (unless you commission one) |
| Families policy | Not applicable (target audience is 18 and over) |

If Play's reviewer says the deletion URL must explain the steps without
signing in first: `/profile` sends a signed-out visitor to sign in. A short
public page (or an FAQ answer) saying "Sign in at lifepass.is/profile and
choose Delete account, or email support@lifepass.is" fixes that; it is a
web follow-up, not an app change.

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
| Health and fitness → **Health info** | Weight, height, target weight, the body log, sex, age band and activity level for the calorie goal, the health questions a workout plan asks. Behind a separate health consent, 18 and over | Optional | App functionality | Health & Fitness → Health |
| Health and fitness → **Fitness info** | Workout plans, workouts and sets, logged workouts, how a session felt, the monthly feedback switches | Optional | App functionality | Health & Fitness → Fitness |
| Photos and videos → **Photos** | A meal photo, sent once to make the estimate: LifePass never stores it; Anthropic, our processor, deletes it within 30 days under its standard retention (Privacy 2.G and 4.E). The phone shrinks it and strips its metadata first | Optional | App functionality | User Content → Photos or Videos |
| Location → **Approximate location** | The Coach's "near me": a position rounded to about a kilometre on the phone, and again on the server, used for that request only. **Processed ephemerally: Yes** (the server keeps no position; see note B) | Optional | App functionality | Location → Coarse Location |
| App activity → **Other user-generated content** | Coach chat messages, foods a member creates, venue reviews (rating, comment, visit date) and reports of a review | Optional | App functionality | User Content → Other User Content |

**Note A, marketing email.** The sign-up screen has a marketing switch
(off by default) and the Privacy Policy section 3.1 says we send marketing
emails to those who turn it on, so Play's "Advertising or marketing"
purpose belongs on Email address. The iOS label leaves "Developer's
Advertising or Marketing" unticked; consider ticking it there too, so the
two stores agree with the policy.

**Note B, ephemeral.** Play counts data as processed ephemerally when it is
kept only in memory for the one request. The server turns the rounded
position into the nearest town and region for the model and keeps no copy;
the position comes back to the phone inside the plan and returns to the
server only if the member asks for a change to that plan. If you'd rather
not claim ephemeral processing, answering No only changes how Play words
the row; it is still correct.

## 3. Why "Shared" is No

Play counts data as **shared** when it goes to a third party, except to a
service provider processing it on our behalf, for a legal reason, or when
the member starts the transfer and expects it. Every recipient falls under
one of those:

| Recipient | What it gets | Why it is not "sharing" |
|---|---|---|
| Supabase (database, sign-in), Vercel (hosting), Resend (email), Anthropic (Coach and meal estimates), Abler (booking system) | What it needs to run the service | Processors under data processing agreements (Privacy section 4) |
| Kling | Name, email, kennitala and payment details, when the member starts a subscription or saves a card | The member starts it, on Kling's own page; Kling needs it to set up the payment agreement (Privacy 4.D) |
| Partner venues, Bokun | The member's name at check-in or booking; nationality for a Bokun ticket | The member books or checks in at that venue (user-initiated) |
| Google or Apple sign-in | Only what the member's own Google or Apple account sends us | The member chooses the provider; nothing goes from us to them |

Straight from the phone, with nothing about the member from us:

- **Open Food Facts** gets the barcode a member scans, the phone's internet
  address and the app version (Privacy 4.J). No account, cookie or LifePass
  id. A product barcode is not member data in Play's list.
- **Mapbox** draws the Explore map tiles (telemetry off); it gets the tile
  requests for the area on screen, never the member's position.
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
| Messages (emails, SMS, other in-app messages) | No messaging between members. Coach messages are user content above |
| Audio | Dictation stays with the phone's speech service; no recording reaches us |
| Photos and videos → Videos | None |
| Files and docs, Calendar, Contacts | None. The body export is a file the member saves or shares themselves |
| App activity → App interactions, In-app search history, Installed apps, Other actions | No analytics is sent (`src/lib/analytics.ts` is a no-op in release builds) |
| Web browsing | None |
| App info and performance → Crash logs, Diagnostics, Other | No crash or diagnostics SDK |
| **Device or other IDs** | **Differs from iOS.** iOS declares Device ID for its install id, sent only with Apple Health uploads. This build has no Health Connect and sends no device or install id |

## 5. Before you submit: one fix outside the app

The Privacy Policy (2026-10-v18) describes the **iOS** app's device
features and says nothing about the Android app's equivalents. Members
reading it from the Play listing should find their phone described. The
policy needs an Android line in each of these places (owner wording, agent
can draft the web PR):

- **Coach short-drive search:** on Android the app measures a straight line
  on the phone to the nearest venues; no map provider gets the position
  (iOS asks Apple Maps).
- **Microphone and speech recognition:** on Android the phone's own speech
  service (Google's) turns speech into text, on the phone where it can,
  under Google's terms (iOS uses Apple's).
- **Map tiles:** the Android app draws its maps with Mapbox, telemetry off;
  Mapbox receives the technical request data for the tiles (iOS uses
  MapKit). Section 4.E already names Mapbox for the website.
- **Apple Health:** already scoped to "versions of the app that include
  Apple Health", so nothing to change; Android has no Health Connect.

Until that edition is live, these Data safety answers are still accurate
(they describe what leaves the phone); the gap is only in the policy text.

## 6. When these answers must change

- **Health Connect** (owner decision: not built). If it ships: Health info
  and Fitness info gain the Health Connect data, Device or other IDs
  probably becomes Yes (an install id, as iOS), and Play's Health Connect
  permissions declaration is needed too.
- **Any analytics, crash or attribution SDK**: a Data safety change first
  (App activity, App info and performance, maybe Device IDs).
- **The member-feedback release after 3.1.0** (visit ratings, saved hikes
  and sights, the Google Play review ask): ratings are public user content,
  already covered by "Other user-generated content"; re-read this page
  against that build before its release.
