# Deploying Protocol: Selene

The game is live at **https://selene.schellekensdigital.be** (also
`https://web-production-73a9ffba.up.railway.app`). It runs as three Railway services in the
project **protocol-selene** (region EU West, `europe-west4`), all deploying the `main` branch of
this repository:

| Service | What | Built from | Public |
|---|---|---|---|
| **Postgres** | accounts, cloud saves, settings, leaderboard scores | Railway's PostgreSQL template | no |
| **api** | the Rust API (`api/`): accounts, saves, settings, the leaderboard's server-side test | `api/Dockerfile` | no |
| **web** | Caddy serving the game (the Vite build) and passing `/api/*` to **api** | `web/Dockerfile` | yes |

The browser only ever talks to **web**, so the game and its API share one site: the
session cookie is first-party and there is no CORS. **api** is only reachable over
Railway's private network.

The game also works without the server: saves and settings then stay in the browser,
and the account and leaderboard say they are offline.

A push to `main` redeploys the services whose files changed (their watch paths below).
The API runs its database migrations (`api/migrations/`) when it starts.

## How the project is set up

Railway's config-as-code files (`railway.json`) are deprecated, so the settings live on
the services themselves. This is how they were made with the Railway CLI
(`npm i -g @railway/cli`, then `railway login`), from the repository root:

```sh
railway init --name protocol-selene
railway add --database postgres
railway add --service api --repo Andreas-Schellekens/FactoryGame --branch main \
  --variables 'DATABASE_URL=${{Postgres.DATABASE_URL}}' --variables 'PORT=8080' \
  --variables 'COOKIE_SECURE=1' --variables 'RAILWAY_DOCKERFILE_PATH=api/Dockerfile'
railway add --service web --repo Andreas-Schellekens/FactoryGame --branch main \
  --variables 'API_UPSTREAM=${{api.RAILWAY_PRIVATE_DOMAIN}}:8080' \
  --variables 'RAILWAY_DOCKERFILE_PATH=web/Dockerfile'
railway variable set PORT=8080 --service web
railway domain --service web --port 8080
railway domain selene.schellekensdigital.be --service web --port 8080
```

The custom domain needs two records in the `schellekensdigital.be` zone (Cloudflare, DNS only,
not proxied), which `railway domain` prints: a CNAME `selene` → the target Railway gives
(`p3vpi2kz.up.railway.app`) and a TXT `_railway-verify.selene` with its verification token.
They were added with the `cf` CLI (`cf dns records create -z <zone> --body '{…}'`); Railway
then issues the HTTPS certificate itself.

Plus, per service (Settings in the dashboard, or `serviceInstanceUpdate` through
`railway api`):

| Service | Dockerfile | Healthcheck | Watch paths |
|---|---|---|---|
| api | `api/Dockerfile` | `/api/health` (120 s) | `api/**`, `src/grid.js`, `src/config.js`, `src/campaign.js`, `src/benchmark.js` |
| web | `web/Dockerfile` | `/` | `web/**`, `src/**`, `public/**`, `index.html`, `vite.config.js`, `package.json`, `package-lock.json` |

Variables: **api** has `DATABASE_URL` (Postgres's private URL, as a reference), `PORT=8080`
and `COOKIE_SECURE=1`; **web** has `API_UPSTREAM` (the api's private address) and
`PORT=8080`. The api service has no public domain. Never set `RELAX_LIMITS` on Railway.

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
