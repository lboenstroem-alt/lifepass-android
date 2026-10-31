# Google Play store listing: English (3.1.0)

Paste each block into Play Console → Grow users → Store presence → Main
store listing (default language **English (United Kingdom), en-GB**, or
whichever English the transferred listing already uses). The Icelandic
translation is in `store-listing.is.md`.

Where the words come from: the iOS App Store page, the website
(lifepass.is home page, `/app`, `/plans`, `llms.txt`) and the approved App
Store screenshot headlines (October 2026). Every claim is one the iOS app or
the website already makes, checked against this Android build.

Rules this copy keeps (check them again after any edit):

- **No partner is named.** Not every partner allows its name in our
  marketing, so the venue categories carry the message instead. If you
  want names (for search), use only partners cleared for it (the App Store
  creatives' README lists them) and decide that before adding them.
- **No discount or partner code**, not even as an example.
- No prices, no counts that change (venues, towns), no "best" or "#1",
  no emoji, no em or en dashes.
- Nothing about Apple Health or Health Connect: this build has neither.
- "General fitness guidance, not medical advice" stays.

## App name (30 characters max) · 28

```
LifePass: Gyms, Pools & Spas
```

If the transferred listing is simply called "LifePass" and you'd rather
keep it, that is fine too: the name is the only field that must match the
brand, and the short description carries the rest.

## Short description (80 characters max) · 79

```
One pass for gyms, pools, studios and spas in Iceland. Check in with a QR code.
```

## Full description (4,000 characters max) · 3,037

```
LifePass is one pass for wellness and fitness in Iceland. Gyms, swimming pools, yoga and pilates studios, saunas, spas and lagoons in towns around the country, all in one app. Find a place, walk in or book, and check in with a QR code. No paperwork.

How it works
• Pick a plan: a monthly membership, or a visitor pass if you are just visiting.
• Find a venue on the map or in the list, with its usual opening hours, what your plan covers and what members say about it.
• Walk in where the venue allows it, or book a time or a class in a few taps.
• At the door, scan the venue's code and walk right in.

Plans and passes
• Monthly memberships cover a shared bundle of gyms, studios and pools. No commitment, cancel anytime. You verify yourself once with an Icelandic eID.
• Visitor passes are a day pass or a pack of visits, flexible across gyms, studios and pools. No subscription, and no Icelandic eID needed.
• Lagoons and spas are in the app too, paid per visit.
• You pay through Kling, an Icelandic payment provider. Your card details go to Kling's own page, never into the app.
• A receipt arrives by email with every payment, ready to send to your union if you use a fitness subsidy.

The Coach
• An AI Coach in the app, for any LifePass account. Ask about places nearby by typing, or by voice in English.
• Tap Plan my day, answer a few questions and get one plan back: a partner venue, a class you can book, or a hike with a soak after at a partner pool or lagoon nearby.
• Not quite right? Ask for somewhere closer, easier, harder, earlier or later.
• The Coach only suggests. Nothing is booked or paid until you confirm it.

For members aged 18 and over
Included with an active membership at no extra charge. Tracking starts only after you agree, in a separate step, to how we handle your health data.
• A workout plan of 4, 8 or 12 weeks, built from your answers: your goal, the days you can train, where you like to train and anything to plan around. You see the whole plan before it starts.
• Today's workout on your Home screen. Tap Start and the app takes you through it: sets, reps and a rest timer. Skip or swap an exercise, or move the session to tomorrow.
• Change your plan by telling the Coach. You see the change first, and nothing changes until you apply it.
• A meal log: take a photo of your meal, scan a barcode, search, or describe what you ate. Every number is an estimate, and it says so.
• Weight and goals, a weekly check-in, and Your month: a short look back on the 1st of each month, written by our rules, never by AI.

Also in the app
• Sights and hiking trails across Iceland on the map, each with its own card and directions. First the hike, then the hot tub.
• Your bookings in one place, and a reminder on your phone before a class you booked.
• Save the venues you like.
• Venue reviews from members.
• In English and Icelandic.

LifePass needs an account, and most venues need a membership or a pass. General fitness guidance, not medical advice.

Questions? support@lifepass.is
www.lifepass.is
```

## What's new in 3.1.0 (500 characters max) · 406

Play Console → Test and release → Production → Create new release →
Release notes, between `<en-GB>` and `</en-GB>` (or the English tag the
console shows).

```
A new LifePass for Android, rebuilt to work like the iPhone app:
• The Coach: plan your day, get a workout plan, and change it by telling the Coach
• Today's workout with a rest timer, a meal log by photo or barcode, and your weight and goals
• Book classes in a few taps, walk in, and check in with a QR code
• Continue with Google or Apple
• Sights and hiking trails on the map
• In English and Icelandic
```

Only if WhatsApp support is switched on in production **before** you
submit (it is off today; see `RELEASE-3.1.0-android.md`), add this line
at the end (465 characters with it):

```
• Chat with LifePass support on WhatsApp from your Account
```

## Other listing fields

| Field | Value |
|---|---|
| App category | Health & Fitness |
| Tags | Pick from Play's list: Fitness, Wellness (or the closest Play offers) |
| Contact email | support@lifepass.is |
| Website | https://www.lifepass.is |
| Phone | Leave empty unless you want calls from the store page |
| Privacy policy | https://www.lifepass.is/privacy |

## Graphics

Play needs its own assets; the App Store creatives show an iPhone, which Play
reviewers reject on an Android listing.

| Asset | Size | Notes |
|---|---|---|
| App icon | 512 x 512 PNG, 32-bit, up to 1 MB | `assets/icon.png` scaled; no extra badges or text |
| Feature graphic | 1024 x 500 PNG or JPG, no transparency | The brand line "Gyms, pools and spas. One pass." on the screenshot blue `#C9DCF0`, Fraunces 600, no device and no URL |
| Phone screenshots | 2 to 8, 9:16, at least 1080 x 1920 | Captured on the Android emulator in fixture mode (`EXPO_PUBLIC_FIXTURE`, see the README), in English and in Icelandic |

Screenshot headlines: reuse the approved App Store lines (they describe
the same screens), from
`~/Documents/LifePass (SportA ehf)/Product & Tech/App Store & screenshots/2026-10-11_AppStore_Creatives_v1/README.md`:

| # | Screen | Headline |
|---|---|---|
| 1 | Explore map, capital area | Gyms, spas, studios. / Walk in or book. |
| 2 | Classes list | Classes all over town. / One pass. |
| 3 | Class booking sheet | Book a class / in a few taps. |
| 4 | Scan tab | Scan the code. / Walk right in. |
| 5 | Check-in success | Checked in. / That's it. |
| 6 | Coach start screen | Not sure where to go? / Ask the Coach. |
| 7 | Coach plan card | A training plan / built around you. |
| 8 | Profile with a pass | Your pass, / always at hand. |

What may be on a screenshot: only the made-up member (Anna Jónsdóttir,
`anna@example.com`), only partners cleared for marketing (the same list
the App Store screenshots use; no "coming soon" venue), no price, no
discount code, no real person's data.
Fixture mode makes no booking, payment or check-in.
