# Deploying Protocol: Selene

The game runs as three Railway services in one project:

| Service | What | Built from | Public |
|---|---|---|---|
| **Postgres** | accounts, cloud saves, settings, leaderboard scores | Railway's PostgreSQL template | no |
| **api** | the Rust API (`api/`): accounts, saves, settings, the leaderboard's server-side test | `api/Dockerfile` (config `api/railway.json`) | no |
| **web** | Caddy serving the game (the Vite build) and passing `/api/*` to **api** | `web/Dockerfile` (config `web/railway.json`) | yes |

The browser only ever talks to **web**, so the game and its API share one site: the
session cookie is first-party and there is no CORS. **api** is only reachable over
Railway's private network.

The game also works without the server: saves and settings then stay in the browser,
and the account and leaderboard say they are offline.

## Railway setup (once)

1. **Project:** New project → choose the region closest to the players (EU West keeps
   the data in the EU).
2. **Database:** + New → Database → PostgreSQL. Railway names it `Postgres`.
3. **API:** + New → GitHub repo → this repository. Then in the service's settings:
   - Name it `api` (the web service finds it as `api.railway.internal`).
   - Settings → Config-as-code → Railway config file: `api/railway.json`.
     (This builds `api/Dockerfile` from the repository root and checks `/api/health`.)
   - Variables:
     - `DATABASE_URL` = `${{Postgres.DATABASE_URL}}` (the private URL)
     - `PORT` = `8080`
     - `COOKIE_SECURE` = `1`
   - No public domain.
4. **Web:** + New → GitHub repo → this repository again. Then:
   - Name it `web`.
   - Railway config file: `web/railway.json`.
   - Variables: `API_UPSTREAM` = `${{api.RAILWAY_PRIVATE_DOMAIN}}:8080`
   - Settings → Networking → Generate domain (or add your own domain).
5. **Branch:** both services deploy the branch set under Settings → Source (`main`
   once iteration 6 is merged). Each service only rebuilds when its own files change
   (`watchPatterns` in its config file).

The API runs its database migrations (`api/migrations/`) when it starts.

## Costs

Railway's Hobby plan ($5 a month, which counts as usage credit) covers this at
hobby-project traffic. In rough terms, while idle: the Rust API uses about 10 MB of memory,
Caddy about 20 MB and Postgres about 100 MB. A leaderboard test takes 1–3 s of CPU.
Visitors download about 27 MB of models and voice clips the first time; after that only
what changed.

## Local development

- `npm run dev`: the game alone (no server needed).
- With the server:
  1. Install PostgreSQL and create a database, e.g. `createdb -U postgres selene_dev`.
  2. Copy `.env.example` to `.env` and fill in `DATABASE_URL` (never commit `.env`).
  3. `npm run dev:api` (Rust; the first build takes a few minutes), and `npm run dev`
     in a second terminal. Vite forwards `/api` to the API on :8787.
- `npm run test:bench` and `cargo test --release` (in `api/`) check the leaderboard's test;
  `node verify-iter6.mjs` drives the whole of iteration 6 in a browser (with the API
  running it also creates and deletes a throwaway account); `node verify-cloud.mjs`
  checks cloud saves across two devices.

## What is stored

Per account: the chosen name, an Argon2id hash of the password and of the recovery
code, session token hashes, cloud saves, settings and leaderboard scores (with the
layout that scored). No e-mail addresses and no IP addresses (rate limits keep IPs in
memory for a few minutes only). Players can download all of it and delete their
account in the game's Account panel.
