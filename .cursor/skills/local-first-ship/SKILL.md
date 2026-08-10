---
name: local-first-ship
description: >-
  Local-first debug and ship flow for warcraft-logging WCL ingest/API work.
  Probe new endpoints, schema shapes, and ranking objects locally with
  WCL_DEBUG / npm run debug:wcl, fix parsers against real payloads, then push
  to main and verify Railway refresh job counters. Use when changing WCL
  GraphQL queries, ranking parsers, ingest, aggregates, or when production
  jobs show rankingsSeen=0 / empty aggregates.
---

# Local-first ship (warcraft-logging)

## Process (verbatim)

test new endpoints/schema/objects whatever locally, then when ready, you push changes to main

## Why this exists

Production Railway logs barely show GraphQL payloads. A job can look “successful”
(`status: completed`, `errorCount: 0`) while storing nothing — because WCL returned
rows the parser did not understand.

### How we found the empty-rankings bug

1. **Job counters first** (`GET /v1/jobs`):
   - `completed` + `errorCount: 0` + `rankingsSeen: 0` ⇒ API likely OK, **parse/shape bug**
   - `errorCount > 0` / `detailsJson.errors` ⇒ request/auth/rate-limit failures
   - Season/dungeons present via `GET /v1/meta/dungeons` but aggregate empty ⇒ rankings path broken
2. **Do not trust container logs** for request bodies; this app does not log HTTP/WCL shapes by default.
3. **Local DB-free probe** with `WCL_DEBUG=1` + `npm run debug:wcl` dumped the raw
   `characterRankings` sample and showed nested ids:
   - Actual: `report: { code, fightID }`
   - Parser expected: top-level `reportID` / `fightID`
   - Result: 100 raw → 0 parsed (`droppedMissingIds`)
4. **Fix against the sample**, re-run probe until `parsedCount` / top rows look right, then ship.

## Default workflow

Copy and track:

```
Local-first ship:
- [ ] 1. Reproduce with counters / local probe (not Railway guesswork)
- [ ] 2. Dump real endpoint/schema/object shapes locally
- [ ] 3. Fix parser/query against that sample
- [ ] 4. Re-run local probe; confirm non-zero parsed rows
- [ ] 5. Push to main only when ready
- [ ] 6. Wait for Railway SUCCESS, POST /v1/refresh, verify job counters + aggregate
```

### 1. Local setup

- `.env` from `.env.example` (gitignored). Need at least `WCL_CLIENT_ID`, `WCL_CLIENT_SECRET`.
- Set `WCL_DEBUG=1` while investigating.
- `npm install` + `npx prisma generate` as needed.
- Full ingest needs Postgres. If none locally, use `npm run debug:wcl` for ranking/schema work (no DB).

### 2. Probe new endpoints / schema / objects locally

```bash
# All current-season dungeons for allowlisted spec
npm run debug:wcl

# Single encounter
npx tsx src/scripts/debug-wcl-rankings.ts <encounterId>
```

Script lives at `src/scripts/debug-wcl-rankings.ts`. It checks rate limit, zone pick,
and per-encounter `characterRankings` parse counts.

When adding a new WCL field/query:

1. Call it locally (debug script or small `tsx` probe).
2. Log **raw sample keys** before writing production parser code.
3. Prefer nested paths WCL actually returns (`report.code`, `allCharacters`, etc.).
4. Treat `amount` vs `score` carefully — for `playerscore`, prefer `score`.

Ingest path also logs:  
`[ingest] Class/Spec @ Dungeon (id): N rankings, keeping K`  
Enable via normal run with `WCL_DEBUG=1` for GraphQL parse details.

### 3. Interpret outcomes

| Signal | Meaning |
|--------|---------|
| Auth / HTTP / GraphQL errors | Creds, query args, or schema mismatch |
| `rankingsLength > 0`, `parsedCount = 0` | **Parser shape bug** (this was the production failure) |
| `parsedCount > 0`, empty companions | Companion array key wrong (`allCharacters` vs `team`) |
| Rows with empty `report.code` | Skip (leaderboard stubs); not a hard failure |

### 4. When ready: push to main

Only after local probe shows expected parsed data:

1. Commit the fix (user must ask / confirm before commit).
2. Push to `main` (GitHub → Railway auto-deploy for this project).
3. Poll deploy until `SUCCESS` (not just “build queued”).
4. Trigger ingest:

```bash
curl -X POST "https://warcraft-logging-production.up.railway.app/v1/refresh?wait=0" ^
  -H "Authorization: Bearer <REFRESH_TOKEN>"
```

5. Verify:

```bash
curl https://warcraft-logging-production.up.railway.app/v1/jobs
curl "https://warcraft-logging-production.up.railway.app/v1/aggregate/Evoker/Devastation?includeRuns=1"
```

Expect `rankingsSeen > 0`, `runsCreated`/`runsSkipped` moving, aggregate `dungeons` non-empty.

## Agent rules for this repo

- **Local first** for any new WCL endpoint, ranking object, or parser change.
- **Do not declare ingest healthy** from `status: completed` alone — read `rankingsSeen` / aggregate.
- **Do not commit or push** unless the user explicitly asks.
- Keep `WCL_DEBUG` useful but cheap; avoid logging secrets or full gear dumps in production by default (`WCL_DEBUG=1` only).
- `.env` stays local; never commit it.

## Season target (PTR)

Production targets **Mythic+ Season 2 (PTR)** via `WCL_ZONE_ID=56`.

- Scheduler runs every `INGEST_CRON_HOURS` (default `1`) and claims `INGEST_SPECS_PER_TICK` (default `6`) DPS specs from the allowlist cursor.
- Stops a batch early if WCL spend exceeds `WCL_RATE_LIMIT_MAX_RATIO`.
- Manual `POST /v1/refresh` does the next batch; `?all=1` forces every spec (avoid unless you have budget).

No Railway cron job is required — the Node process timer handles it while the service is up.

## Local UI

Static viewer in `public/` is served by the API at `/` (`npm run dev` → open the printed localhost URL).

- Defaults API base to `/remote` (proxies Railway) so you can visualize remote data without local Postgres.
- Clear the API base field to use same-origin (local server + local DB).
- Shows dungeon aggregates, leaderboard runs, compare tables, and job counters (`rankingsSeen`, etc.).

## Key files

- `public/` — local data viewer (HTML/CSS/JS)
- `src/wcl/queries.ts` — zone pick, rankings fetch/parse
- `src/wcl/graphql.ts` — GraphQL client (errors logged on failure)
- `src/jobs/ingest.ts` — job counters + per-dungeon ingest log line
- `src/scripts/debug-wcl-rankings.ts` — DB-free local probe
- `src/scripts/run-ingest.ts` — full local ingest (needs `DATABASE_URL`)
