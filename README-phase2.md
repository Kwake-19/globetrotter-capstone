# GlobeTrotter — Phase 2: Microservices

Phase 1's monolith (still at the repo root, untouched — see
[README.md](README.md)) is decomposed here into three independent services
behind an API Gateway. Same product, same frontend, same JWTs — just split
along its natural seams: users, itineraries, and destinations/recommendations.

## Architecture

```
                        ┌──────────────┐
                        │  API Gateway │  :4000  (serves public/, proxies /api/*)
                        └──────┬───────┘
              ┌────────────────┼────────────────┐
              ▼                ▼                 ▼
      ┌───────────────┐ ┌────────────────┐ ┌────────────────────┐
      │  User Service  │ │Itinerary Service│ │Recommendation Service│
      │     :4001      │ │      :4002      │ │        :4003         │
      └───────┬────────┘ └───────┬─────────┘ └──────────┬──────────┘
              ▼                  ▼                       ▼
        user-service/     itinerary-service/     recommendation-service/
         data/db.json       data/db.json              data/db.json
       ({ users: [] })    ({ itineraries: [] })   ({ destinations: [] })
```

| Service | Owns | Endpoints |
|---|---|---|
| **User Service** | `users` | `/api/auth/*`, `/api/profile` |
| **Itinerary Service** | `itineraries` | `/api/itineraries/*`, `/api/shared/:shareId` |
| **Recommendation Service** | `destinations` | `/api/destinations/*`, `/api/recommendations`, `/api/search` |
| **API Gateway** | nothing (stateless) | serves `public/`, `/api/config`, proxies everything else |

Each service is its own Node project (own `package.json`, `Dockerfile`,
tests) with its **own JSON-file datastore** — same read/write-queue pattern
Phase 1 used, just one file per service instead of one shared file. No
service reads another's `data/db.json` directly.

### Inter-service communication

**Synchronous (REST):**
- Itinerary Service calls Recommendation Service (`GET /api/destinations`)
  to validate `destinationId`s when creating/editing a trip, and to enrich
  a shared itinerary's stops with place details (`services/itinerary-service/src/utils/recommendationClient.js`).
- Recommendation Service calls Itinerary Service (`GET /api/itineraries`,
  forwarding the caller's own JWT) to personalize `/api/recommendations`
  for a logged-in user (`services/recommendation-service/src/utils/itineraryClient.js`).
  If Itinerary Service is unreachable, it degrades to non-personalized
  results instead of failing the request — a bug in one service shouldn't
  crash another (see the diagram's "Isolation" benefit).

**Asynchronous (RabbitMQ):** when a trip is created or gets new stops,
Itinerary Service publishes an `itinerary.created` / `itinerary.updated`
event (`services/itinerary-service/src/events/publisher.js`). Recommendation
Service consumes it (`services/recommendation-service/src/events/consumer.js`)
and bumps a `timesAdded` counter on the referenced destinations — a small,
eventually-consistent read model used as a tie-breaker in ranking. If
RabbitMQ is down, publishing/consuming just logs a warning and retries in
the background; it never blocks a request.

**Auth:** User Service is the only one that issues JWTs. All three
services share the same `JWT_SECRET` and verify tokens locally — no
service calls User Service just to check a token.

## Running locally (no Docker)

Each service needs its own `npm install` and its own `.env` (copy each
`.env.example`). Start all four in separate terminals:

```bash
cd services/user-service && npm install && cp .env.example .env && npm run dev
cd services/itinerary-service && npm install && cp .env.example .env && npm run dev
cd services/recommendation-service && npm install && cp .env.example .env && npm run dev
cd services/gateway && npm install && cp .env.example .env && npm run dev
```

Make sure `JWT_SECRET` is the **same value** in all three backend
services' `.env` files. RabbitMQ is optional for local dev — without it,
Itinerary/Recommendation Service log a warning and keep working; only the
`timesAdded` popularity counter won't update. To run one locally:

```bash
docker run -d --name rabbitmq -p 5672:5672 -p 15672:15672 rabbitmq:3-management-alpine
```

Visit `http://localhost:4000` — the gateway serves the same frontend as
Phase 1 unchanged (it talks to `/api/...` on its own origin either way).

## Running with Docker Compose

```bash
JWT_SECRET=$(openssl rand -hex 32) docker compose -f docker-compose.phase2.yml up --build
```

Brings up RabbitMQ + all four services on one Docker network. Visit
`http://localhost:4000`. RabbitMQ's management UI is at
`http://localhost:15672` (guest/guest). Each service's `data/` folder is
bind-mounted so its JSON store survives rebuilds, same as Phase 1.

Phase 1's `docker-compose.yml` still works standalone on port 4001 — the
two don't conflict as long as you don't run both at once (or just note
Phase 2's gateway is on 4000).

## Testing

Each service has its own Jest + Supertest suite, run independently:

```bash
cd services/user-service && npm test
cd services/itinerary-service && npm test
cd services/recommendation-service && npm test
cd services/gateway && npm test
```

Itinerary Service's and Recommendation Service's tests use
[`nock`](https://github.com/nock/nock) to stub the other service's HTTP
responses, so no other service needs to be running for a single service's
tests to pass.

## What changed vs. Phase 1

- One JSON file → three, one per service, each owned exclusively by that
  service.
- One Express app → four (three domain services + a gateway), each
  independently startable, testable and deployable.
- Direct in-process function calls between "destinations" and
  "itineraries" logic → real network calls (REST + one async event).
- `/api/config` and `/api/health` moved to the gateway (not owned by any
  single domain).

## Known Phase 2 limitations (by design)

- Still JSON-file storage, not a real database — Phase 2 is about service
  boundaries, not persistence technology.
- No service discovery — service URLs are hardcoded via env vars, which is
  fine for a fixed docker-compose network but wouldn't scale to services
  that come and go dynamically.
- No circuit breakers/retries beyond the one fallback in `/api/recommendations`
  — that's Phase 4 (Resilience).
- No distributed tracing — a request spanning gateway → recommendation → itinerary
  has no shared trace/correlation ID yet, so debugging across services
  means reading each one's logs separately.
- Single VM/Docker Compose, not containers behind a load balancer — that's
  Phase 3.
