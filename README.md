# VeriPool 2.o

A campus ride-requesting and real-time-tracking app, built by implementing the
system described in:

> Hana E. Elmalah and Catherine M. Elias, **"User-to-Vehicle Interaction in
> Smart Mobility: The GO-DRiVeS Autonomous Ride-Sharing Application,"**
> arXiv:2601.12367 [cs.HC], Jan 2026. — a copy is in [`docs/`](docs/GO-DRiVeS_carpooling_app_2601.12367.pdf).

GO-DRiVeS is an on-demand ride-sharing/requesting app for university
students and staff, built with React Native (Expo) + Node.js/Express +
MongoDB + Socket.IO. This project follows that same stack and re-implements
its core functionality end to end:

- **Registration & fully automated validation** (Sec. II-B.1, automated) —
  a rider or driver registers with their university ID, name, phone, and
  password, and verifies their email with a 6-digit code. **Riders are
  approved instantly** on verification. **Drivers** additionally attach a
  driving license photo, which is automatically OCR-checked (name match,
  license number found, not expired) — passing drivers are approved
  instantly too, and drivers who fail a check are automatically **rejected**
  with the specific reason, and can register again with a clearer photo.
  There is no admin accept/reject step anywhere — the Admin screen is a
  read-only log of what the automation decided. Login is by an
  auto-generated `first.last` username.
- **Ride requesting** (Sec. II-B.2) — a rider picks a pickup and drop-off
  point and a seat count; the request is broadcast over Socket.IO to every
  available car with enough free seats, in a **first-come-first-served**
  queue; a driver accepts (if seats are compatible) or rejects.
- **Real-time tracking** (Sec. II-B.3) — the ride walks through the paper's
  six stages — *Start Journey → Head to Pickup → I Have Arrived → Start
  Ride → End Ride → Finish* — with the driver's live position pushed to the
  rider over a socket as it updates.
- **Safe drop-off hotspots** (not from the paper) — riders can only be
  dropped off at one of 100 public, well-lit spots that are staffed or busy
  (police stations, hospitals, bus/railway stations, campus gates, malls,
  fuel stations, banks with CCTV) — twenty each in Nitte, Karkala, Mulki,
  Surathkal and Mangaluru, with coordinates from OpenStreetMap. Enforced by the backend
  (`backend/src/utils/hotspots.js`).
- **Posted rides with routes** (not from the paper) — besides on-demand
  requests, a driver can **post a ride** ahead of time: start, destination,
  optional stops to pass through, seats and departure time. Every stop is a
  safe hotspot, and riders along the way **find and book seats** between any
  two stops (`backend/src/controllers/offerController.js`).
- **Geohash route planning** (not from the paper) — `backend/src/utils/geohash.js`
  implements geohashing (encode/decode, neighbours, cells along a path, a
  geohash spatial index). `backend/src/utils/routePlanner.js` uses it to
  build a graph joining each hotspot to its 4 nearest (found via the geohash
  index), then runs **A\*** to offer route options: *Fastest*, *Most riders on
  the way* (edges into stops with riders waiting in their geohash catchment
  are discounted, so the route bends towards demand when the detour is
  small), *Direct*, and the driver's own via-stops. Matching a rider to
  posted rides is an indexed lookup on the geohash cells of each route's
  stops (3×3 cells around the rider ≈ 600 m walk), not a scan of every ride.
  Demand comes from pending on-demand requests plus recent "find a ride"
  searches (`DemandPing`, auto-deleted after 45 min).
- **Fair pricing** (not from the paper) — `backend/src/utils/pricing.js`.
  Fares are a cost share, not a taxi meter: the trip's fuel + wear cost
  (₹103/L ÷ 15 km/L + ₹1.5/km wear ≈ ₹8.37/km, configurable with
  `FUEL_PRICE_PER_LITRE`, `CAR_MILEAGE_KMPL`, `WEAR_PER_KM`) is split equally
  **per leg** between the driver and everyone on board for that leg. Riders
  pay only for the legs they travel; a new rider can only lower others'
  fares; no surge; the driver always carries one share, so they never
  profit; and nobody pays more than the fare quoted when they booked.
  On-demand requests use the same rule with one group (trip cost ÷ (seats + 1)
  × seats).
- **AI customer care chat** (not from the paper) — riders and drivers tap
  **🎧 Help** to chat with an AI assistant powered by Claude
  (`backend/src/services/supportAI.js`, model `claude-opus-5`). It knows how
  the app works, the safe hotspots and the user's latest ride; it tells
  anyone in danger to call 112 and flags the thread 🚨 Emergency, and flags
  "Needs agent" when a person should step in. Any admin replies live from
  **🎧 Support inbox**; while a human has replied in the last 15 minutes the
  AI stays quiet. Needs `ANTHROPIC_API_KEY` in `backend/.env` (paid API,
  [console.anthropic.com](https://console.anthropic.com)) — without it, or
  if the API fails, a keyword FAQ bot answers instead.
- **Night-aware safety with route-deviation alerts** (not from the paper —
  this build's main novel contribution). Full write-up and numbers in
  [`docs/safety-evaluation.md`](docs/safety-evaluation.md).
  - *Night-safe drop-offs:* 29 of the 100 hotspots are tagged as staffed
    all night (police, 24x7 hospitals and terminals, guarded campus
    gates). From 9 pm to 6 am (`backend/src/utils/nightMode.js`) only these
    can be drop-offs — on-demand requests are refused with the nearest
    night-safe alternative, and posted rides leaving at night only let
    riders off at 🌙 stops.
  - *Route corridor:* when the driver taps **Start ride**, the backend
    fetches the real road route (ORS, or the free OSRM server) and checks
    every GPS tick against it (`backend/src/utils/deviationDetector.js`)
    for three signals: off the route (> 250 m for 60 s by day, > 150 m for
    30 s at night), driving back the way it came (1 km / 500 m), and a long
    stop away from any hotspot (5 min / 3 min).
  - *Check-in and escalation* (`backend/src/services/safetyMonitor.js`):
    the rider gets **Are you safe?** with a countdown. **I'm OK** clears
    it; **Get help**, **🆘 SOS** or no answer (120 s / 60 s) posts an 🚨
    Emergency message to support with the driver's details and a map link
    to the last location. The driver only ever sees a neutral "you've left
    the route" notice.
  - *Guardian link:* **📤 Share live trip** gives a link anyone can open in
    a browser, no app or login (`/track/<token>`), showing the route, the
    car, the stage and every alert. It expires 30 min after the ride ends.
  - *Evaluation* (`npm run eval:safety`, seeded and reproducible): 0 false
    alerts in 800 simulated normal trips with noisy GPS and traffic stops;
    detours of 300 m or more caught in 96–100% of trips (median 54 s at
    night, 99 s by day); and a property test of the fare rule — in 20,000
    random rides, a new booking never raised anyone else's fare.
  - *Demo:* set `FORCE_NIGHT_MODE=true` in `backend/.env`, turn off the
    driver's real GPS and switch on **Demo: simulate a detour**.
- **In-ride chat** (not from the paper) — the matched rider and driver can
  message each other in real time for the duration of the ride.

### Free, real alternatives to the paper's paid APIs

The paper uses Google Maps (via Expo Map), OpenRouteService for optimized
routing, and Expo Location for device GPS. All three have genuinely free
options — no credit card, most need no signup at all:

| Paper | This build | Cost |
|---|---|---|
| Expo Map (Google Maps) | **Real OpenStreetMap tiles via Leaflet** on web (`MiniMap.web.js`); a dependency-free SVG map on native, since `react-native-maps` needs a paid Google key on Android (`MiniMap.js`) | Free, no signup |
| OpenRouteService routing | **Wired for real ORS routing** (`backend/src/utils/geo.js`) — used automatically the moment `ORS_API_KEY` is set in `backend/.env`; falls back to a haversine straight-line estimate when it isn't, so the app runs with zero config | Free tier (2000 req/day), needs a 1-minute signup at [openrouteservice.org](https://openrouteservice.org/dev/#/signup) |
| Expo Location (device GPS) | **Real GPS** (`frontend/src/utils/location.js`) — Expo Location on a phone, the browser's Geolocation API on web. On by default for the driver for the whole active ride; riders can use "📍 My current location" as their pickup. Falls back to a simulated animation toward the pickup/drop-off if the driver turns it off or permission is denied | Free, no signup |
| Email OTP / admin decision emails | Sent from `veripool2026@gmail.com` via Gmail SMTP once `GMAIL_APP_PASSWORD` is set in `backend/.env`; logged to the backend console until then | Free (Gmail App Password — Google Account → Security → 2-Step Verification → App passwords) |

To turn on real routing: sign up free at the link above, create a
Directions API token, and paste it as `ORS_API_KEY=` in `backend/.env`
(restart the backend). Everything else — the data model, the API, the
Socket.IO event flow, the FIFO request queue, the stage machine — is a
real, working implementation, not a mock.

### Automated driver-license check — what it actually is

Sec. II-B.1.b's "Validation Process" is automated here, but the license
check (`backend/src/services/licenseCheck.js`) is **OCR-based plausibility
checking, not official government verification**. There's no free,
legitimate way for a student project to query a real license database
(that needs a paid KYC provider — Setu/IDfy/Signzy — or a DigiLocker
government partnership, plus business registration). What it does instead,
for free, with Tesseract.js:

- the license photo is OCR'd
- the registrant's first & last name must both appear in the text
- something that looks like a license number (mixed letters+digits) must be found
- a date on the card must be found and be in the future

All four passing → auto-approved. Anything failing → auto-rejected, with
the specific reason returned to the driver and emailed — never a human
in the loop either way. This is disclosed to the driver at signup, not
just here.

## Stack

- **Frontend:** React Native (Expo, SDK 57) — `frontend/`
- **Backend:** Node.js + Express — `backend/`
- **Database:** MongoDB (local, `mongodb://127.0.0.1:27017/veripool2`)
- **Real-time:** Socket.IO
- **Auth:** JWT (7-day expiry) + bcrypt password hashing

## Running it

**Prerequisites:** Node.js, MongoDB running locally (`mongodb://127.0.0.1:27017`).

```bash
# Backend
cd backend
npm install
npm run seed     # creates the Admin account (admin.veripool / admin12345)
npm run dev       # http://localhost:5050

# Frontend (in another terminal)
cd frontend
npm install
npm run web       # opens in a browser at http://localhost:8082
# or: npm start    (Expo Go on a phone) / npm run android
```

`run-web.bat` in this folder starts the web frontend directly.

Without `GMAIL_APP_PASSWORD` set, OTP codes print to the backend's console
log instead of arriving by email — check there during local testing.

### Demo walkthrough

1. Register as a rider — verify the emailed (or console-logged) OTP code
   and you're straight into the app.
2. Register as a driver (toggle "I have a car", set seats, attach a license
   photo) → verify its OTP → automatically approved if the license check
   passes, or automatically rejected with the reason shown if it doesn't
   (try again with a clearer photo). No admin step either way.
3. (Optional) Log in as `admin.veripool` / `admin12345` to see the
   read-only log of what the automation decided — there's nothing to click.
4. Log in as the driver → flip **Available** on.
5. Log in as the rider → **Where to?** → pick a pickup/drop-off pin → **Confirm request**.
6. Log in as the driver → the request appears in the queue → **Accept**.
7. The rider's app jumps to the tracking screen automatically (pushed over
   the socket, no reload). Either side can open **Chat** to message the
   other in real time. The driver taps through *Head to pickup → I've
   arrived → Start ride → End ride → Finish*, and the rider watches the
   stage list and the car marker (real or simulated GPS) update live.

## API

| Method | Route | Auth | Description |
|---|---|---|---|
| POST | `/api/auth/register` | no | Create account (multipart if a driver's license photo is attached) — sends an OTP |
| POST | `/api/auth/verify-otp` | no | Confirm the emailed code — auto-approves riders and license-passing drivers, auto-rejects the rest |
| POST | `/api/auth/resend-otp` | no | Resend the code (30s cooldown) |
| POST | `/api/auth/login` | no | Login by username or email (must be `accepted`) |
| GET | `/api/auth/me` | yes | Current user |
| GET | `/api/admin/recent` | admin | Read-only log of what the automation decided — no accept/reject endpoint exists |
| POST | `/api/rides` | rider | Request a ride |
| GET | `/api/rides/mine` | yes | My rides (rider or driver) |
| GET | `/api/rides/queue` | driver | Pending requests, FIFO |
| GET | `/api/rides/:id` | party | Ride detail |
| POST | `/api/rides/:id/accept` | driver | Accept a pending ride |
| POST | `/api/rides/:id/reject` | driver | Decline a pending ride |
| POST | `/api/rides/:id/cancel` | rider | Cancel your own pending ride |
| POST | `/api/rides/:id/stage` | driver | Advance the ride's stage |
| GET | `/api/rides/:id/messages` | party | Chat history for the ride |
| POST | `/api/rides/:id/messages` | party | Send a chat message |
| POST | `/api/drivers/availability` | driver | Toggle availability |
| POST | `/api/rides/:id/safety/respond` | rider | Answer a safety check-in: `{ answer: "ok" }` or `"help"` |
| POST | `/api/rides/:id/safety/sos` | rider | Alert support now |
| POST | `/api/rides/:id/share` | rider | Create the guardian live-tracking link |
| GET | `/api/safety/mode` | no | Whether night mode is on, and the detector thresholds |
| GET | `/api/track/:token` | link | Guardian view of a shared ride (the `/track/:token` page polls this) |
| GET | `/api/support/messages` | rider/driver | My customer care conversation |
| POST | `/api/support/messages` | rider/driver | Message support (bot replies instantly) |
| GET | `/api/support/threads` | admin | Support inbox with unread counts |
| GET | `/api/support/threads/:userId` | admin | One conversation (marks it read) |
| POST | `/api/support/threads/:userId` | admin | Reply as a support agent |

Socket.IO events (client connects with `{ auth: { token } }`):
`ride:new-request`, `ride:accepted`, `ride:stage`, `ride:driver-arrived`,
`ride:ended`, `ride:location` (client → server, fanned out to the rider),
`ride:message`, `ride:cancelled`, `support:message`, `ride:safety-alert` and
`ride:safety-escalated` (to the rider), `ride:safety-notice` (to the driver).

## Relationship to `../VeriPool`

This is a separate, from-scratch build in its own folder — it doesn't share
code with the sibling `VeriPool/` project (which has its own auth +
blockchain-ledger foundation). It reuses the same visual style/patterns
where they made sense, since both target the same React
Native/Express/MongoDB stack.

## What's not built

Per the paper's own "Future Recommendations":
- Improved multi-request management (the paper flags this as future work too)
- Real route optimization via VROOM/ORS instead of the haversine fallback (works once `ORS_API_KEY` is set)
- Deployment

Added in this build, still outstanding:
- Real email delivery needs `GMAIL_APP_PASSWORD` set (see above) — until then OTP/decision emails log to console
- Official government license verification (RTO/DigiLocker) — not free/feasible for a student project; the automated check is OCR-based plausibility checking (see the disclosure above), by design, with no human review step at all
