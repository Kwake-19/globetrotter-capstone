# GlobeTrotter — Phase 2: Microservices

Phase 1's monolith (still at the repo root, untouched — see
[README.md](README.md)) is decomposed here into **six independent domain
services behind an API Gateway**. Same product, same frontend, same JWTs —
split along its natural seams: auth, destinations, search, itineraries,
recommendations, and the chatbot.

Phase 2's learning goal is **API design and inter-service communication**,
so every call between services is a plain `fetch()` over HTTP. There is no
message queue (that's Phase 4).

## Architecture

```
                         ┌──────────────┐
        browser  ───────▶│  API Gateway │ :4000   serves public/, verifies the JWT,
                         └──────┬───────┘         forwards identity as headers,
                                │                 502 on a dead upstream
   ┌───────────┬────────────────┼──────────────┬───────────────┬──────────────┐
   ▼           ▼                ▼              ▼               ▼              ▼
┌────────┐ ┌──────────────┐ ┌──────────┐ ┌────────────┐ ┌────────────────┐ ┌──────────┐
│  auth  │ │ destinations │ │  search  │ │ itinerary  │ │ recommendation │ │ chatbot  │
│ :4001  │ │    :4002     │ │  :4003   │ │   :4004    │ │     :4005      │ │  :4006   │
└───┬────┘ └──────┬───────┘ └────┬─────┘ └─────┬──────┘ └───────┬────────┘ └────┬─────┘
    ▼            ▼              │             │               │              │
 users.json  destinations.json │             │               │              │
             (+ reviews)       │             │               │              │
                               └──▶ destinations  ◀───────────┴──────────────┘  (HTTP)
                    itinerary ──▶ destinations                 chatbot ──▶ search ──▶ OpenRouter
                 recommendation ──▶ destinations + itinerary
```

| Service | Owns (data file) | Endpoints it serves |
|---|---|---|
| **api-gateway** | nothing | serves `public/`, `GET /api/config`, `GET /api/health`, routes everything else |
| **auth-service** | `users` (`data/users.json`) | `/api/auth/*` (incl. Google Sign-In), `/api/profile` |
| **destinations-service** | `destinations` + `reviews` (`data/destinations.json`) | `GET /api/destinations`, `/nearby`, `/categories`, `/:id`, `/:id/reviews*`, `/api/admin/destinations*` |
| **search-service** | nothing | `GET /api/destinations/smart-search`, `GET /api/search` |
| **itinerary-service** | `itineraries` (`data/itineraries.json`) | `/api/itineraries/*`, `GET /api/shared/:shareId` |
| **recommendation-service** | nothing | `GET /api/recommendations` |
| **chatbot-service** | nothing | `POST /api/chatbot` |

Each service is its own Node project (own `package.json`, `Dockerfile`,
`.env.example`, tests). The services that own data use the same
read/write-queue JSON-file store Phase 1 used — one file per service. No
service reads another's data file.

## Auth & the trust model

- **api-gateway** is the only service reachable from the host (the only one
  with a `ports:` mapping). It verifies the JWT with `JWT_SECRET`, sets
  `req.userId` / `req.isAdmin` from the token payload, and — when proxying —
  forwards identity **as headers**: `X-User-Id`, `X-Is-Admin: true` (omitted
  entirely for non-admins), and `X-User-Name` (URL-encoded, used by review
  writes). A client-supplied `X-User-*` header is stripped before proxying.
- A missing/invalid token is **not** rejected at the gateway — the request
  proceeds as a guest. Routes that need a user are gated individually
  (`requireUserId` on `/api/profile`, `/api/itineraries`, review writes;
  `requireAdmin` on `/api/admin/*`).
- Downstream services read `x-user-id` / `x-is-admin` / `x-user-name`
  directly, in the same places the monolith did `req.user.id` / an isAdmin
  lookup. Trusting these headers is safe **because** no service except the
  gateway is reachable from outside the Docker network.
- **auth-service** also holds `JWT_SECRET` (it *signs* the tokens at login)
  and `GOOGLE_CLIENT_ID` (it verifies Google id tokens). `isAdmin` is added
  to the token payload at issuance — so granting admin (a manual data edit)
  only takes effect on the user's next login.

## Inter-service calls (all synchronous `fetch`)

| Caller | Callee | Why |
|---|---|---|
| search-service | destinations-service | pull the catalogue, then parse + rank in memory |
| itinerary-service | destinations-service | validate `destinationId`s on create/edit; enrich the shared view |
| recommendation-service | destinations-service | the catalogue to rank (hard dependency → 503 if down) |
| recommendation-service | itinerary-service | the user's trips, for personalization (soft dependency → falls back to popular) |
| chatbot-service | search-service | turn the message into suggested places |
| chatbot-service | OpenRouter | the conversational reply (falls back to a templated reply without a key) |

Every inter-service call has explicit error handling: a dead/erroring
dependency becomes a clear `503` (or a graceful degrade where the feature
allows it), never a crash.

## Running with Docker Compose

```bash
JWT_SECRET=$(openssl rand -hex 32) docker compose -f docker-compose.phase2.yml up --build
```

Then open **http://localhost:4000** — the gateway serves the same Phase 1
frontend, unchanged. Only the gateway is published to the host; the other
six are reachable only by container name on the `globetrotter` network.
Each data-owning service bind-mounts its `data/` folder so its JSON store
survives rebuilds.

Optional keys (all features degrade cleanly without them): `GOOGLE_CLIENT_ID`,
`GOOGLE_MAPS_EMBED_KEY`, `OPENROUTER_API_KEY` (+ `OPENROUTER_MODEL`,
`OPENROUTER_FALLBACK_MODEL`), `GROQ_API_KEY`, `CHATBOT_OPENROUTER_API_KEY`.

Phase 1's own `docker-compose.yml` is untouched and still runs standalone
on port 4001 — the two don't conflict (just don't expect to run both on the
same ports at once).

## Running locally (no Docker)

Each service needs its own `npm install` and `.env` (copy its
`.env.example`). Start them in separate terminals — `JWT_SECRET` must be the
**same value** in `api-gateway` and `auth-service`:

```bash
cd services/auth-service           && npm install && cp .env.example .env && npm run dev
cd services/destinations-service   && npm install && cp .env.example .env && npm run dev
cd services/search-service         && npm install && cp .env.example .env && npm run dev
cd services/itinerary-service      && npm install && cp .env.example .env && npm run dev
cd services/recommendation-service && npm install && cp .env.example .env && npm run dev
cd services/chatbot-service        && npm install && cp .env.example .env && npm run dev
cd services/api-gateway            && npm install && cp .env.example .env && npm run dev
```

The `.env.example` files default every `*_SERVICE_URL` to `localhost:<port>`
for exactly this.

## Testing

Every service has its own Jest + Supertest suite and is runnable in
isolation — search/recommendation/chatbot **mock** their `fetch` calls to
other services:

```bash
cd services/<name> && npm install && npm test
```

The repo-root `npm test` still runs only the Phase 1 monolith suite
(`jest.config.js` now ignores `services/`).

## Health checks

Every service exposes `GET /api/health` → `{ "status": "ok", "service": "<name>" }`,
and every `Dockerfile` has a `HEALTHCHECK` hitting it. `depends_on` in the
compose file waits on `service_healthy` so the gateway only starts once its
dependencies are up.

## Known Phase 2 limitations (by design)

- JSON-file storage, not a database — Phase 2 is about service boundaries.
- Service URLs are hardcoded via env vars — no service discovery.
- No circuit breakers / retries beyond the recommendation soft-fallback —
  that's Phase 4 (Resilience).
- No distributed tracing / correlation IDs — debugging a
  gateway → chatbot → search → destinations chain means reading each log.
- Single Docker Compose network, not containers behind a load balancer —
  that's Phase 3.
