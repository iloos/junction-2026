# STATUS

_The lead rewrites this at each checkpoint. It is the "now": what works, what's next, what bites._

**Updated:** Sat 14 Nov ~02:00 (lead session).
**State:** concept and foundations complete; scaffold merged on main (SvelteKit 2.70, adapter-node 5.5.8, Dockerfile); **no app code yet**. Next is the contracts commit, then lanes.
**Works end to end:** nothing yet. **Deployed URL:** none yet.

**Read these, in order:**
1. [DECISIONS.md](DECISIONS.md): D1 (Valio), D3 (one container on Aiven, Aiven Postgres), D4 (big scope on the real stack, built in rings 0→3).
2. [concept/CONCEPT.md](concept/CONCEPT.md), [concept/PRODUCT.md](concept/PRODUCT.md) (Ring 0 = 8 stories), [concept/SCORECARD.md](concept/SCORECARD.md).
3. [foundations/](foundations/README.md): ux, gemini, mcp, modal, models, data, valio-data (+ valio-profile.json).
4. [research/](research/): horeca, horeca-profiles, menu-spike, agent-harness, mcpcon; [review/](review/): REVIEW-GPT-6, MULTI-CHALLENGE-STRATEGY-GPT-6.

**Next steps (schedule from the round-2 review; checkpoints, not activity targets)**
1. **Contracts commit (lead) implementing D6**, aligned with `evals/` and `fixtures/seeds/` field names. **Sleep prerequisite:** contracts compile, the PGlite fixture boots, `DATABASE_URL` connects (first migration creates `vector`), a public container URL exists (Aiven Runtime if accessible now, otherwise the Verda VM per D3), and lane briefs name owned paths.
2. **Lanes** via `scripts/lane-setup.ps1`: core-db · agent · kitchen · ops · jobs, all pinned to the same contracts SHA + seed hash; overnight guardrails in ORCHESTRATION.md (no contract edits or merges while the lead sleeps).
3. **~07:00–10:00:** integrate core-db → agent → kitchen; deploy a full fixture journey (quote → edit → approval → commit → retry → reload); swap in live lookups and the Gemini fit decision; run the 8 Ring 0 checks, the 5 evals and concurrency tests on real Postgres; tag; record 60 s of demo. 10–11: Operations + Ring 1, or invoke D4 if Ring 0 fails.
4. **Hero preflight:** hand-check a Stock (not Terminal) alternative for ham and casserole, or a make-in-house recipe; else present an honest partial rescue ([PITCH.md](PITCH.md)).

**Open on the user's side:** Aiven: use the existing free `pg-1dfeeeed` (PG 18.7, developer-1, do-fra; `vector` 0.8.7 available, so `CREATE EXTENSION vector` goes in the first migration) → copy its URI into `.env` as `DATABASE_URL` (+ `PG_CA_CERT`); creating a Hobbyist service is a billing action the user does by hand if ever needed; ask #aiven for Runtime; #nvidia for the Verda Nemotron key + an NVIDIA Build key; ask about S-Pankki data and the AfterQuery harness; Valio mentor questions (PRODUCT.md §6, horeca-profiles.md); time today's Christmas order in the real webshop as a baseline.

**S-Pankki:** dataset cloned to `data/s-pankki/` (gitignored); brief and fields in [foundations/s-pankki.md](foundations/s-pankki.md); balances exist, so "safe to spend" can be grounded.

**Key facts (from the probes):** the Valio API ignores date and customer and is static (our simulator owns time and cut-offs); 18% of products are undeliverable; data has a `substitutions` field (250 rules); **no product images** (Cloudinary only for a document workflow); net weight 56% (89% with name parsing); no rate limiting seen (we use ≤4 concurrent, ≤200 ids, cache-through in `data/valio/cache/`). Gemini Decisions API works (`gemini-decision-1`, v1beta, 120 questions in ~0.56 s); key is `GEMINI_STUDIO_API_KEY`. Gemma on Featherless works (`gemma-4-E4B-it`). Nemotron has no endpoint yet. Slush is Wed 18–Thu 19 Nov (event hook). `GMAPS_API` is in `.env` (Google Maps; later, for app polish or validation).

**Venues (done):** 3,560 real Helsinki/Espoo/Vantaa venues from OSM (ODbL), 8 profiles, 15 with structured menus (574 dishes); Exa found menu/banquet pages for ~19/29; Google Places skipped (no menus, restrictive terms). Demo picks: Scandic Kallio (chain Christmas lunch menu), Factory Elimäenkatu (weekly lunch), Don Corleone. Real names + invented volumes: anonymise in video. `data/venues/` is gitignored; [research/venues.md](research/venues.md).

**In flight:**
- Venue dataset agent (OSM + Exa + Context.dev → `data/venues/`, `scripts/venues/`, `docs/research/venues.md`; uncommitted). When it lands: commit the scripts, the OSM file with ODbL attribution and venues.md; keep scraped menus out of git.
- **Merged (9df92c2):** `scripts/lane-setup.{ps1,sh}` (worktree + copies .env, data/valio, data/venues; port 5171–5179), `evals/` (format + s1–s5 covering all 8 Ring 0 stories), `fixtures/seeds/` (k-hotel / k-lounas / k-central, Christmas buffet for 140 at 691 g/guest, calendar factors). Align field names in the contracts: line states `acted | held{tier} | rejected | committed | unorderable` and the README's reason codes. Also new: [research/supply-chain.md](research/supply-chain.md) (Promise status incl. `limited`/`below_lot`, Reservation with expiry, usage-capped fair share at cut-off, 5 simulator events).
- Peer session **junc26-8d** (second brain, own worktree; was branch `contracts-support`): `scripts/lane-setup`, `evals/` format + first 5 Ring 0 scenarios, `fixtures/seeds/` (3 demo kitchen profiles, Christmas buffet for 140, calendar factors incl. Slush). It messages the lead with a sha on handoff, then reviews the contracts commit against PRODUCT.md Ring 0. The lead writes ARCHITECTURE.md, `src/lib/core/**`, db schema, ports, tool registry and deps; 8d doesn't touch those.
- Contracts must include `workspaceId` + `actor` on every record and op (seam for the later roadmap in PLAN.md).
- From live checks (8d): salmon 462150 and trout 462016 have `allowedLotSize` 10 kg (catch weight), so 11.5 kg rounds to 20 kg, and 9 kg left after contention is **below one lot → unorderable** (explicit scenario S3). Ham 462490 lot step 7 kg. Nearly all Christmas casseroles are out; the real substitute is lanttulaatikko 6×400 g `462157` (Terminal, 999999 = unknown → held, never counted as cover). Herring-type products need gross / net / drained weight and a price basis (per unit vs per comparison unit). All go into the contracts.

**Platform submissions (created Fri night; no new ones can be created now, all editable until Sun 10:00):**
- Real drafts named `Mandate`: Valio Aimo (primary; 8 tech challenges ticked), Context.dev real-time web, Exa butler, AfterQuery break-the-agent, S-Pankki trainer.
- Placeholders named `PLACEHOLDER (Mandate)`: Cala, MariaDB, Tieto. They only keep a pivot open.
- Before Sun 10:00: set the real ones to **Final** (drafts are not reviewed); leave unused ones as drafts. One submission per challenge per project name. Drop "data stays in Finland" from the descriptions.

**Traps:**
- Lead owns the main checkout; other sessions must not switch branches there (junc26-a8 did once).
- `adapter-node@6` needs Kit 3: stay on ^5.5.8.
- Before going public: scrub the Valio API key and redeem codes from `docs/event/challenges/`, squash history, trim hallway quotes in `docs/research/mcpcon.md` (still uncommitted), check redistribution rights of Valio data (never committed).
- Whole team at peer review Sun 10:30; record a rough video Sat 22:00; solo, so the shift table in PLAN.md is out of date.
- Free NVIDIA API is ~40 req/min per key; Context.dev 10 req/min.
