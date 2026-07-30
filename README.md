# GlobeTrotter — Phase 1: The Monolith (Yaoundé edition)

A single Node.js/Express server that handles the API and serves the frontend,
storing data in one JSON file (`data/db.json`) — as required for Phase 1. The
travel-recommendation twist: instead of generic global destinations, it
surfaces real restaurants, ice cream/dessert spots, malls, attractions,
hotels and petrol stations around **Yaoundé, Cameroon**, and lets a user
save and share day-trip itineraries built from them.

## Stack

- Node.js + Express (monolith)
- JSON file storage (`data/db.json`) — no database yet, by design
- JWT auth (`jsonwebtoken` + `bcryptjs`)
- Vanilla HTML/CSS/JS frontend (`public/`), multi-page — no build step, no framework
- Jest + Supertest for testing
- Docker + docker-compose

## Endpoints

| Method | Path                              | Auth?    | Description |
|--------|-----------------------------------|----------|--------------|
| POST   | /api/auth/register                | —        | Create an account (`name`, `username`, `email`, `password`, `phone?`, `homeCity?`), returns a JWT |
| POST   | /api/auth/login                   | —        | Log in with `{ identifier, password }` — `identifier` matches email OR username |
| GET    | /api/destinations                 | —        | Search/filter places (`?category=`, `?q=`, `?neighborhood=`); each result includes `placeId`/`localImagePath` (`null` until enriched, see [Photos](#photos)) |
| GET    | /api/destinations/categories      | —        | The 6 category ids/labels |
| GET    | /api/destinations/:id             | —        | One place |
| GET    | /api/recommendations              | optional | Personalized if logged in, popular otherwise |
| POST   | /api/itineraries                  | required | Create an itinerary |
| GET    | /api/itineraries                  | required | List your itineraries |
| GET    | /api/itineraries/:id              | required | One of your itineraries |
| PUT    | /api/itineraries/:id              | required | Update title/items |
| DELETE | /api/itineraries/:id              | required | Delete |
| POST   | /api/itineraries/:id/share        | required | Generate a public share link |
| GET    | /api/shared/:shareId              | —        | View a shared itinerary (no login) |
| GET    | /api/profile                      | required | Get the current user's profile (no passwordHash) |
| PUT    | /api/profile                      | required | Update `name`, `phone`, `homeCity` (not email/username/password) |
| GET    | /api/config                       | —        | Frontend-facing config, currently `{ googleMapsEmbedKey }` — see [Maps](#maps) |
| GET    | /api/health                       | —        | Health check (used by Docker) |

### Destination categories

`restaurant`, `ice_cream`, `mall`, `fun_place`, `hotel`, `petrol_station`.

## Pages

| Path                          | File                          | Auth?        | Description |
|--------------------------------|-------------------------------|--------------|--------------|
| `/`                            | `public/index.html`           | Public       | Marketing landing page |
| `/login.html`                  | `public/login.html`           | Public       | Log in (email or username) |
| `/signup.html`                 | `public/signup.html`          | Public       | Create an account |
| `/app.html`                    | `public/app.html`             | Required     | Browse & search places |
| `/place.html?id=X`             | `public/place.html`           | —            | Place detail |
| `/trip-builder.html`           | `public/trip-builder.html`    | Required     | Build/edit an itinerary (`?editId=X` to edit) |
| `/my-trips.html`               | `public/my-trips.html`        | Required     | List your saved itineraries |
| `/trip.html?id=X`              | `public/trip.html`            | Required     | One itinerary — share/edit/delete |
| `/shared.html?shareId=X`       | `public/shared.html`          | Public       | Read-only shared itinerary view |
| `/profile.html`                | `public/profile.html`         | Required     | Edit account details |

Pages marked "Required" redirect to `/login.html?redirect=<page>` in JS if
there's no token in `localStorage`.

## Local setup (no Docker)

```bash
npm install
cp .env.example .env      # then edit JWT_SECRET to any long random string
npm run dev                # nodemon, restarts on file changes
# or: npm start
```

Visit `http://localhost:4000`.

## Photos

Two ways a destination gets a photo, checked in this order by the frontend:

1. **Google-enriched** (`localImagePath`) — via the optional
   `scripts/enrich-places.js` script, see below.
2. **Manually-added** (`image`) — a file dropped straight into
   `public/assets/images/` and referenced by hand in `data/db.json`; see
   `public/assets/images/README.md` for the current list.

Destinations with neither field show a plain "no photo yet" placeholder
instead — the app works fully either way.

### scripts/enrich-places.js (optional)

A manual, one-off script — **not** run by the server, and the server never
requires it. For each destination missing a `localImagePath`, it looks the
place up via the Google Places API and:

- Finds its `placeId` (Find Place from Text).
- Fetches its real Google `rating` (stored as `googleRating`, separate from
  the hand-entered `rating` field, which is left untouched as a fallback)
  and one photo reference (Place Details).
- Downloads that photo to `public/images/places/<destination-id>.jpg`.
- Writes `placeId`, `googleRating` and `localImagePath` back into
  `data/db.json`.

Requires a Google Cloud project with the **Places API** enabled and billing
attached (the free tier easily covers this project's ~26 destinations).

```bash
# in .env:
GOOGLE_PLACES_API_KEY=your-key-here

node scripts/enrich-places.js
```

It's safe to re-run — destinations that already have a `localImagePath` are
skipped, so re-running only fetches newly added destinations. To regenerate
a specific photo, delete that destination's `localImagePath` field in
`data/db.json` and run the script again.

## Maps

The place detail page (not cards) shows a "Location" section: an embedded
Google Map (Maps Embed API, "place" mode — uses `placeId` if the
destination has one, otherwise falls back to its lat/lng) plus a "Get
Directions" button that asks the browser for the visitor's location and
switches the embed to driving directions.

The embed key is never baked into a static JS file — the frontend fetches
it once from `GET /api/config` (`{ googleMapsEmbedKey }`), which reads it
server-side from `GOOGLE_MAPS_EMBED_KEY`.

To enable it:

1. Enable the **Maps Embed API** on the same Google Cloud project as
   Places (see above).
2. Set `GOOGLE_MAPS_EMBED_KEY=<your key>` in `.env`.
3. Restrict the key by **HTTP referrer** in Google Cloud Console before
   using it beyond local dev.

Without a key, the page shows a plain "Map unavailable" placeholder (with
the place's address as text) instead of a broken iframe — the app works
fully either way.

## Testing

Tests use Jest + Supertest. Each test file gets its own temporary copy of
`data/db.json`, so tests never touch your real data and can run in any order.

```bash
npm test                 # run once
npm run test:watch       # re-run on change
npm run test:coverage    # with a coverage report
```

If you're new to testing: every test follows **Arrange → Act → Assert** —
set something up, do the thing, check the result. Start by reading
`tests/health.test.js`, it's the simplest one in the project.

## Docker

```bash
docker compose up --build
```

This builds the image, starts the container, maps **host port 4001** to the
container's port 4000 (so visit `http://localhost:4001`, not 4000 — see
`docker-compose.yml`), and bind-mounts `./data` so your JSON "database"
survives rebuilds. Stop with `docker compose down` (or `Ctrl+C` then `docker
compose down` if run in the foreground).

Set a real `JWT_SECRET` for anything beyond local testing:

```bash
JWT_SECRET=$(openssl rand -hex 32) docker compose up --build
```

## Project structure

```
src/
  app.js                Express app assembly (used directly by tests)
  server.js             Entry point — loads .env, starts listening
  middleware/            auth.js, errorHandler.js
  routes/                auth, destinations, recommendations, itineraries, shared, profile, config
  utils/dataStore.js     JSON file read/write with a write queue
data/db.json             Seed data — 6 categories of real Yaoundé places
public/
  index.html, login.html, signup.html, app.html, place.html,
  trip-builder.html, my-trips.html, trip.html, shared.html, profile.html
  css/styles.css          Shared stylesheet (white background, red accent)
  js/api.js               Shared fetch/auth/nav/draft-trip helpers
  js/<page>.js            One script per page
  assets/images/          Manually-added destination photos — see Photos above
  images/places/          Google-enriched destination photos (scripts/enrich-places.js output)
scripts/enrich-places.js Optional manual script — see Photos above
tests/                   Jest + Supertest suites
```

## Known Phase 1 limitations (by design)

These are the limitations the course wants you to *feel*, not accidents:
- JSON file storage has no transactions or indexing, and doesn't scale past
  a handful of concurrent writers.
- No horizontal scaling — one process, one file.
- No caching, no message queue, no circuit breakers — that's Phase 4.
- No containers-behind-a-load-balancer — that's Phase 3.
