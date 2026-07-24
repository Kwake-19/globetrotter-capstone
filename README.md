# GlobeTrotter – Travel Assistant

GlobeTrotter is a **monolithic Node.js/Express application** that serves as the starting point for a semester-long capstone project.  
Students build the monolith first, then refactor it into microservices, and finally deploy it to the cloud with resilience patterns using Docker, Kubernetes, and cloud-native tooling.

---

## Project Structure

```
.
├── src/
│   ├── app.js               # Express app factory (routes, middleware, static hosting)
│   ├── server.js             # App entry point - loads .env, starts the HTTP server
│   ├── db.js                 # File-based JSON storage layer
│   ├── middleware/
│   │   └── auth.js           # JWT auth middleware
│   └── routes/
│       ├── auth.js           # Registration, login
│       ├── destinations.js   # Destination listing endpoint
│       └── itineraries.js    # Create / list / share itineraries
├── public/
│   ├── index.html            # Frontend shell
│   ├── app.js                # Places grid, auth forms, itinerary builder, shared view
│   └── styles.css
├── data/
│   ├── seed.json              # Tracked seed destinations
│   └── db.json                 # Created at runtime from seed.json (gitignored)
├── tests/                     # Jest + Supertest suite
├── Dockerfile
├── docker-compose.yml
├── package.json
└── README.md
```

---

## REST API

All API routes are namespaced under `/api`. The static frontend is served from `/`.

| Method | Endpoint                              | Auth required          | Description                                    |
|--------|----------------------------------------|-------------------------|-------------------------------------------------|
| GET    | `/api/health`                          | No                       | Health check                                     |
| POST   | `/api/register`                        | No                       | Register a new user                              |
| POST   | `/api/login`                           | No                       | Authenticate and receive a JWT token             |
| GET    | `/api/destinations`                    | No                       | List the destination catalogue                   |
| POST   | `/api/itineraries`                     | Yes (JWT)                | Create a new itinerary (1-2 destinations)        |
| GET    | `/api/itineraries`                     | Yes (JWT)                | List all itineraries for the logged-in user      |
| POST   | `/api/itineraries/:id/share`           | Yes (JWT, owner only)    | Generate a public share link for an itinerary    |
| GET    | `/api/itineraries/shared/:shareToken`  | No                       | View a shared itinerary without authentication   |

Protected routes expect the header:  
`Authorization: Bearer <your-token>`

### Example requests

```bash
# Register
curl -X POST http://localhost:4000/api/register \
  -H "Content-Type: application/json" \
  -d '{"username": "alice", "password": "s3cr3t"}'

# Login
curl -X POST http://localhost:4000/api/login \
  -H "Content-Type: application/json" \
  -d '{"username": "alice", "password": "s3cr3t"}'
# Save the returned token: TOKEN=<value from .token field>

# List destinations
curl http://localhost:4000/api/destinations

# Create an itinerary (destinationIds come from GET /api/destinations)
curl -X POST http://localhost:4000/api/itineraries \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"title": "Beach Escape", "destinationIds": ["dest-lisbon"], "startDate": "2026-08-01", "endDate": "2026-08-14"}'

# List itineraries
curl http://localhost:4000/api/itineraries \
  -H "Authorization: Bearer $TOKEN"

# Share an itinerary
curl -X POST http://localhost:4000/api/itineraries/<id>/share \
  -H "Authorization: Bearer $TOKEN"

# View the shared itinerary - no auth required
curl http://localhost:4000/api/itineraries/shared/<shareToken>
```

---

## Running Locally

### Prerequisites
- Node.js 18+
- npm

```bash
# 1. Install dependencies
npm install

# 2. Create your .env file
cp .env.example .env
# then set JWT_SECRET, e.g.:
openssl rand -hex 32

# 3. Start the server
npm run dev    # nodemon, reloads on change
npm start      # production
```

The app will be available at `http://localhost:4000`.

---

## Tests

```bash
npm test
```

---

## Running with Docker

```bash
# Build and start
docker compose up --build

# Stop
docker compose down
```

`GET /api/health` returns `{"status":"ok"}` once the container is up.

---

## Data Storage

Data is persisted in a single flat JSON file, `data/db.json`, created automatically on first boot
from the tracked seed file `data/seed.json` (destinations only). `data/db.json` is excluded from
version control via `.gitignore` since it accumulates runtime users and itineraries.

Storage has no locking, so concurrent writes can race — acceptable for this capstone phase, but
worth revisiting before the microservices refactor.

---

## Configuration

| Environment Variable | Default        | Description                                              |
|-----------------------|-----------------|------------------------------------------------------------|
| `JWT_SECRET`          | none (required) | JWT signing key – the server refuses to start without it |
| `PORT`                | `4000`           | Port the app listens on                                    |
| `NODE_ENV`            | `development`    | Runtime environment                                         |

> **Important:** Always set `JWT_SECRET` to a long, random value (e.g. `openssl rand -hex 32`), and never commit `.env` — only `.env.example` is tracked.
