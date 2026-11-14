# Data: Aiven Postgres + pgvector + LISTEN/NOTIFY, Drizzle, PGlite fixture, Aiven Runtime

_Foundation note, Sat 14 Nov. Sources: aiven.io docs (pricing, pg free tier, connection limits, list of extensions, use-pgvector, connect-node, Runtime overview / deploy-apps / connect-services-to-apps / compose-files), the Aiven blogs on PG 18 UUIDv7 and Aiven Apps, the postgres.js releases, the Drizzle vector guide, and npm, all fetched 14 Nov. No Aiven resources were created. Spike: `scratch/spikes/data/` (`spike.mjs`, `snapshot.mjs`, `drizzle.mjs`, `socket2.mjs`, `sse.mjs`), run on Windows 11 with Node 24.22._

## 0. Measured (PGlite 0.5.16 = **PostgreSQL 18.6** in WASM, plus `@electric-sql/pglite-pgvector` 0.0.17)
| Check | Result |
|---|---|
| Cold start in memory | 1.2–1.3 s |
| 1,000 × 768-d insert (batches of 500) / exact cosine kNN top 10 | 1.0 s / **5–7 ms** |
| 17,500 × 768-d insert / exact kNN | 18 s / **70–90 ms** |
| HNSW build at 17.5k / HNSW kNN | **50 s** (single-threaded WASM) / 4–5 ms (approximate: top-1 differed from exact on random vectors) |
| `dumpDataDir('gzip')` at 17.5k × 768 (57 MB) → `PGlite.create({loadDataDir})` | **reload 1.3–1.7 s**, exact kNN 90 ms |
| `uuidv7()` native, `pg.listen()` + `pg_notify`, triggers, jsonb `->>` filters | all work |
| Drizzle 0.45.4 `drizzle-orm/pglite`: `vector()` column, HNSW index, `cosineDistance`, jsonb, `.returning()` | works |
| PGlite → trigger `pg_notify` → in-process bus → SSE `ReadableStream` → `fetch` reader | 3 events in 82 ms |
| `pglite-socket` (PGlite as a TCP server) with postgres.js 4.1.1 / `pg` 8.23 | plain param queries ok; a Drizzle vector query failed with `26000 unnamed prepared statement does not exist`; LISTEN over the socket got nothing. **Don't use it.** |

**Windows gotchas:** none in PGlite itself. An unclosed `PGlite` keeps Node alive, so always call `await db.close()` (one script hung on this). pgvector is no longer bundled in `@electric-sql/pglite/vector`; it is now the separate `@electric-sql/pglite-pgvector` package.

## 1. Aiven for PostgreSQL
- **Plans.** Free ($0, 1 GB RAM, 1 GB disk, max_connections 20) and Developer ($5, 8 GB, **15** connections): **you can't choose cloud or region** (Aiven's own free example runs in `do-nyc`), and these plans have no pooling or integrations. **Hobbyist (from $12/mo, 1 GB RAM, 8 GB, 25 connections)** and Startup-4 (from $75/mo, 100 connections) let you pick a region. With $50 of credit, **Hobbyist in a Finnish region for 3 days costs ~$1–2**. Startup-4 for 3 days is ~$8, if 25 connections pinches. Six connections are reserved (superuser + monitoring), so size the pool as `max_connections − 6`.
- **Regions:** `upcloud-fi-hel` (UpCloud Helsinki; there may be more than one fi-hel zone) and `google-europe-north1` (Hamina). Available clouds vary per project; check that Hobbyist is offered there in the console. **pgvector** (`CREATE EXTENSION vector;` per database) is on Aiven's extension list, which shows no per-plan restriction. **PG 18** is offered (`-c pg_version=18`), so `uuidv7()` is native and needs no extension.
- **Connection.** The console's service overview shows the **Service URI** `postgres://avnadmin:<pw>@<svc>-<proj>.<x>.aivencloud.com:<port>/defaultdb?sslmode=require` and a **CA cert** download (`ca.pem`). TLS is mandatory. `sslmode=require` encrypts but doesn't verify. To verify, keep the PEM in an env var (`PG_CA_CERT`) and pass `ssl: { ca, rejectUnauthorized: true }`, rather than a file path, because the container has no file. CLI: `avn service get <svc> --format '{service_uri}'` and `avn service user-creds-download`.
- **No pooling** on Hobbyist, which suits us: `LISTEN` needs a dedicated session connection and breaks behind PgBouncer's transaction mode anyway.

## 2. Aiven Runtime (limited availability, ask in #aiven; docs also call it "Aiven Apps")
- **Flow:** connect GitHub (org admin role) → Runtime → Deploy application → repo + branch → pick a manifest (Dockerfile/Containerfile or `compose.aiven.yaml`) → Scan → set ports, plan and integrations → Deploy. **Pushing does not redeploy.** Use **Actions → Deploy latest commit**, or the CLI/API (`avn service create -t application`, `user_config.source.{repository_url,branch,build_path,containerfile_path}`, `ports:[{name:http,port:3000,protocol:HTTP}]`). Changing env vars redeploys the same commit, and an API update **replaces the whole env var list**.
- **PG link:** an `application_service_credential` integration with `environment_variable_key: DATABASE_URL` injects the URI. Aiven notes that for `pg` you append `uselibpqcompat=true` to the URL. Use a Compose file only if Runtime should create the PG service too (`image: postgres` maps to Aiven PG, and the version is ignored); we create PG ourselves and integrate it.
- **Constraints:** stateless; builds only from a Dockerfile (an `image:` alone won't run); no pre-deploy or release command is documented, so **migrations run at container start** (`node migrate.js && node build`, idempotent, under a `pg_advisory_lock`); secrets go in as `kind: secret` env vars. The docs don't cover ingress idle timeouts, HTTPS or custom domains; ask the mentors (§ open questions).

## 3. Driver + ORM (SvelteKit 2, `adapter-node`)
- **Adapter:** `@sveltejs/adapter-node@^5` (5.5.8). **Not 6.x**, which peers on Kit 3 (same trap as adapter-vercel 7, D0).
- **Driver: `postgres` (postgres.js) 4.1.1**, the major release of 29 Oct. It has built-in `sql.listen(channel, fn)` on its own auto-reconnecting connection, tagged templates, ESM only, and Node ≥ 18. v4 changes that bite: the server infers parameter types (cast dates with `::timestamptz`), `sql.array()` is gone, `PGSSLMODE` is now read, and `sslrootcert` in the URL now works. The alternative, `pg` 8.23, needs `pg-listen` or hand-rolled reconnect for LISTEN. Its `sslmode=require` means verify-full unless `uselibpqcompat` is set, which is a classic Aiven trap.
- **ORM: `drizzle-orm` 0.45.4 + `drizzle-kit` 0.31.11** (1.0 is still RC, so skip it). It supports `vector('embedding',{dimensions})`, `.using('hnsw', col.op('vector_cosine_ops'))`, `cosineDistance`, `jsonb().$type<T>()`, and `uuid().default(sql\`uuidv7()\`)`. Drivers: `drizzle-orm/postgres-js` (real) and `drizzle-orm/pglite` (fixture), with **the same schema file and the same query code**. drizzle-kit doesn't create extensions, so the first migration is custom (`drizzle-kit generate --custom`: `CREATE EXTENSION IF NOT EXISTS vector;`). Apply migrations with `migrate()` from `drizzle-orm/postgres-js/migrator` and `drizzle-orm/pglite/migrator` at startup.
- **Ops as JSONB:** `payload jsonb`, typed via `$type<OpPayload>()` and validated with zod before insert. Filter with `->>`. Add a GIN index only if we query inside payloads (we mostly don't).

## 4. Live updates: LISTEN/NOTIFY → SSE
- **Pattern (spiked):** an `AFTER INSERT` trigger on `ops` runs `pg_notify('ops', json_build_object('seq',seq,'kitchen',kitchen_id,'type',type)::text)`. **One** `sql.listen('ops')` per Node process feeds an in-memory `Set` of subscribers. `src/routes/api/stream/+server.ts` `GET` returns `new Response(ReadableStream, {headers: {'content-type':'text/event-stream','cache-control':'no-cache','x-accel-buffering':'no'}})`, writes `id: <seq>` per event, sends a `: ping` every 15 s, and removes the subscriber in `cancel()`.
- **Payload limit:** 8,000 bytes per NOTIFY by default. Send **only the cursor and a summary**; the client (or the SSE handler) fetches full rows with `WHERE seq > $cursor`. Notifications go out only at commit, so they never show uncommitted ops.
- **No gaps:** NOTIFY is fire-and-forget. On connect or reconnect, the stream first replays `select * from ops where seq > Last-Event-ID order by seq limit 500`, then goes live. Since replay by cursor *is* polling, **the fallback is simply polling `/api/ops?after=<seq>` every 1 s** (`ENABLE_LISTEN=false`). This is the PGlite-free fallback too.
- adapter-node: Node's `requestTimeout` covers receiving the request, not a streaming response, so long SSE is fine. `SHUTDOWN_TIMEOUT` (30 s) cuts streams on redeploy, and the client's `EventSource` reconnects with `Last-Event-ID`. `vite dev` streams fine too.
- uuidv7 is ordered but not dense or gap-free across sessions, so the cursor is a **`seq bigserial`** and `id` stays the public uuidv7.

## 5. Schema sketch (Drizzle; types in `core/`, tables in `src/lib/server/db/schema.ts`)
```
kitchens  id text pk · name · principal jsonb {name, role} · mandate jsonb {weights{price,co2,origin,organic}, hard{allergens[],tempClasses[]}, limits{perOrder,perLine,weekly}, tiers}
          · created_at
products  gtin text pk · name · category · vendor · origin · temp_class · units jsonb (pallet/case/piece, lot size)
          · co2_kg_per_kg real · reliability real · enriched jsonb {field:{value,method,source,confidence,runId}}
          · search tsvector (generated, 'simple') · embedding vector(1024)   -- Qwen3-Embedding-0.6B per archive/prep/foundations/modal.md
orders    id uuid pk default uuidv7() · kitchen_id fk · status (draft|proposed|approved|placed) · delivery_date · total_eur · created_at
order_lines id uuid pk · order_id fk · gtin fk · qty · unit · unit_price · price_fixed_at · substitute_for gtin null · reason text
approvals id uuid pk · order_id fk · line_ids uuid[] · tier (act|propose|signoff) · decided_by · decision · note · ts
anomalies id uuid pk · kitchen_id fk · kind (covers|oos|fridge|recall|cutoff) · status (open|resolved) · data jsonb · ts
events    id uuid pk · kitchen_id · kind (booking|recall|photo|swarm) · data jsonb · ts       -- inputs from the world
ops       seq bigserial pk · id uuid unique default uuidv7() · ts timestamptz default now() · actor text (chef:x|agent:x|swarm:x|system)
          · kitchen_id · intent text · type text · payload jsonb · used uuid[] · generated uuid[] · derived_from uuid[]
          -- append-only: REVOKE UPDATE, DELETE; or a BEFORE UPDATE/DELETE trigger that raises
```
**Indexes:** `ops (kitchen_id, seq)`, `ops (type, seq)`, GIN on `ops.derived_from` (for provenance walks); `order_lines (order_id)`; `orders (kitchen_id, status)`; `anomalies (kitchen_id) where status='open'`; `approvals (order_id)`; `products (category)`, GIN `products.search`; **HNSW `products.embedding vector_cosine_ops` on Aiven only**, built once after the batch load (17.5k rows build in seconds on real PG). In the fixture, skip the HNSW index: exact scan takes 90 ms.

## 6. Fixture adapter (PGlite)
`DB_DRIVER=pglite|postgres`. `pglite` = in-process `PGlite.create({ extensions:{vector}, loadDataDir })` from a **prebuilt snapshot** `data/fixture/db.tar.gz`, built by `pnpm gen:db` (migrate, then load the catalogue + `catalog.jsonl` enrichment + seed kitchens, then `dumpDataDir`). That's a 1.5 s boot instead of an 18 s load. Tests use `new PGlite()` + migrations + a tiny seed (each test file gets a fresh DB in ~1.3 s; share one per file). LISTEN in the fixture uses `pg.listen()` behind the same `OpsBus` port. One process holds the DB, so lanes each get their own instance (fine). Gitignore the snapshot because it holds Valio data.

## Decisions for ARCHITECTURE
1. **Storage port = Postgres via Drizzle**, with one schema and two drivers: `postgres-js` (Aiven) and `pglite` (fixture, tests, lanes). Replaces Dexie for domain data (D3 already says this). No `pglite-socket`.
2. **Versions:** `drizzle-orm@0.45.4`, `drizzle-kit@0.31.11`, `postgres@^4.1.1`, `@electric-sql/pglite@0.5.16`, `@electric-sql/pglite-pgvector@0.0.17`, `@sveltejs/adapter-node@^5.5.8`.
3. **Aiven:** a Hobbyist PG 18 service in `upcloud-fi-hel` (or `google-europe-north1`), with `vector` enabled and the CA pinned via the `PG_CA_CERT` env var. Runtime is linked via the `application_service_credential` integration → `DATABASE_URL`.
4. **Op log:** `ops` with `seq bigserial` as the cursor and `id uuidv7` as the identity; append-only enforced in the DB; `applyOps` writes ops and their state change in **one transaction**.
5. **Live:** NOTIFY carries `{seq, kitchen, type}` only; SSE at `/api/stream` with replay from `Last-Event-ID`; polling `/api/ops?after=` is the documented fallback. One LISTEN connection per process. Pool: `max: 10` on Hobbyist (25 − 6 reserved − LISTEN − Modal writers − psql).
6. **Migrations at startup** under an advisory lock (Runtime has no release phase). Embedding dimension fixed at **1024** and checked in a contract test.
7. **Modal writers** (enrichment shards, swarm) use `DATABASE_URL` with `max: 1–2` per container, or post to our API. **At 20 containers that exceeds Hobbyist's 25 connections**, so either swarm events go through `/api/swarm/events` (modal.md already does this) or we upgrade to Startup-4 during the batch.

## Open questions
- Is Runtime enabled on our project, and in which regions? Must app and PG share a cloud? Ingress idle timeout for SSE, HTTPS and the default domain (ask the #aiven mentors).
- Is Hobbyist actually offered in `upcloud-fi-hel` / `google-europe-north1` for our project, at what price? Do the $50 credits cover Runtime, or does limited-availability credit come separately?
- Does Runtime append `uselibpqcompat=true` / `sslmode` to the injected URI? (It matters only for `pg`; postgres.js handles `sslmode=require` fine.)
- Swarm at 5,000 agents (10×): is ~250 ops/s of inserts + NOTIFY fine on a 1-CPU Hobbyist? Spike it once the service exists; Startup-4 is the escape hatch.
- Should we also use Aiven Valkey or Kafka for "best use"? Not before the freeze: one service done deeply (Postgres + NOTIFY + Runtime; retrieval is lexical, no pgvector) fits their "one service can be just as impressive". Kafka via Debezium from the op log is the pitch's "next" (PITCH).
