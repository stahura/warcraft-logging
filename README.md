# warcraft-logging

Backend service that pulls **top Mythic+ score runs** from the [Warcraft Logs](https://www.warcraftlogs.com/api/docs) GraphQL API, stores them in Postgres, and exposes aggregates that the WCL UI does not.

**v1 allowlist:** Devastation Evoker only (edit [`src/config/allowlist.ts`](src/config/allowlist.ts) to add specs).

## What it computes (per dungeon)

For the top **N** score runs (default 20):

- Average key level
- Average DPS (the ranked player)
- Average place among the **3 DPS** in the key (1 / 2 / 3)
- Most common companion DPS specs

## Credentials (no deploy required first)

1. Open https://www.warcraftlogs.com/api/clients and create a client.
2. Redirect URL can be a **placeholder** such as `http://localhost:3000/callback` — the **client credentials** flow used here never redirects.
3. Copy `Client ID` + `Client Secret` into Railway (or `.env`).

Public rankings do not require a paid WCL plan.

## Stack

- TypeScript + Hono
- Prisma + Postgres
- Railway (Docker)
- Scheduled ingest every 48h + manual `POST /v1/refresh`

## Local development

```bash
cp .env.example .env
# fill DATABASE_URL, WCL_*, REFRESH_TOKEN

npm install
npx prisma db push
npm run dev
```

Manual ingest:

```bash
curl -X POST http://localhost:3000/v1/refresh \
  -H "Authorization: Bearer $REFRESH_TOKEN"
```

Query aggregates:

```bash
curl http://localhost:3000/v1/aggregate/Evoker/Devastation
curl "http://localhost:3000/v1/aggregate/Evoker/Devastation?includeRuns=1"
```

## Railway deploy

1. Create a Railway project from this repo.
2. Add a **Postgres** plugin and link `DATABASE_URL`.
3. Set env vars:

| Variable | Notes |
|----------|--------|
| `WCL_CLIENT_ID` | From WCL API clients |
| `WCL_CLIENT_SECRET` | From WCL API clients |
| `REFRESH_TOKEN` | Secret you invent for refresh auth |
| `INGEST_LIMIT` | Optional, default `20` |
| `INGEST_CRON_HOURS` | Optional, default `48` |

4. Deploy. Container runs `prisma db push` then starts the API.
5. Trigger the first ingest:

```bash
curl -X POST https://<your-app>.up.railway.app/v1/refresh \
  -H "Authorization: Bearer $REFRESH_TOKEN"
```

6. Read results:

```bash
curl https://<your-app>.up.railway.app/v1/aggregate/Evoker/Devastation
curl https://<your-app>.up.railway.app/v1/jobs
```

## API

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Liveness + config status |
| GET | `/v1/meta/dungeons` | Active season dungeons |
| GET | `/v1/meta/classes` | Allowlisted specs |
| GET | `/v1/aggregate/:class/:spec` | Aggregates (`?includeRuns=1` for row detail) |
| GET | `/v1/jobs` | Recent ingest jobs |
| POST | `/v1/refresh` | Manual ingest (`Bearer` refresh token) |

## Incremental ingest

Each job:

1. Fetches current top-N `playerscore` rankings per dungeon for allowlisted specs.
2. Rewrites leaderboard slots 1..N.
3. **Skips** DamageDone enrichment when `reportCode + fightId` already exists with target DPS.
4. Recomputes per-dungeon aggregates from current slots.

## Expanding beyond Devastation

Add entries to `SPEC_ALLOWLIST` in `src/config/allowlist.ts`:

```ts
export const SPEC_ALLOWLIST = [
  { className: "Evoker", specName: "Devastation" },
  { className: "Mage", specName: "Fire" },
];
```

Then redeploy and refresh.
