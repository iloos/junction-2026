# GROWTH: from three demo kitchens to Finland

_Lead-owned design note (round-4 reviews, Sat 14 Nov). A contract to write now and build when real onboarding starts. Nothing here is claimed as built._

## Entities (one meaning each)
| Entity | What it is | Source of truth | Today |
|---|---|---|---|
| **Venue** | A public place observed in a source (OSM id, website, menu URL) | external ids + observed date | `data/venues/` (3,560 Helsinki/Espoo/Vantaa, 15 with menus); not customers |
| **Organization** | Chain or owner (hotel group, municipality catering) | onboarding | none |
| **KitchenSite** | An operating kitchen at a location: menus, covers, delivery calendar | onboarding + kitchen | `Kitchen` (seed, conflates site + policy) |
| **BuyerAccount** | Who buys from Valio for a site; carries the supplier agreement | Valio | none (one configured customer) |
| **SupplierAgreement** | Prices, delivery days, cut-offs, contract SKUs per buyer | Valio | static mock |
| **Mandate** | The kitchen's policy: caps, never-delegate, origin/allergen/tender rules, weights; versioned | kitchen (chef/admin) | `Kitchen.mandate` |
| **Membership / Grant** | Principal × resource × permissions (`read`, `plan`, `order`, `approve`, `agent:run`, `ops:inspect`, `admin`) with expiry and revocation | admin | keys → actor kind (global) |
| **DataReadiness** | Per site and capability: located → menu verified → recipe mapping reviewed → delivery configured → mandate verified → shadow-ready → act-enabled | operator review | none |

External identity mappings (OSM id, chain menu URL, Valio customer number) attach to these; a changed source record never creates a new customer.

## Rules that keep growth safe
1. **Authority comes from grants, never from data.** A venue on a map, a menu, a web page or a document can raise readiness or suggest facts; it can never grant purchasing authority or change a mandate.
2. **Offers are buyer-specific.** `OfferContext {buyerAccountId, deliverySiteId, requestedDate, supplierContractId}` is derived server-side from membership; caches key on it; availability, supplier acceptance, delivery and receiving are separate states.
3. **Estimates stay suggestions** (D6). Enrichment (web, Modal, LLM) produces field-level suggestions with evidence; a reviewed, authorized command publishes them into a new catalogue version; approved orders are never rewritten.
4. **Two denominators, always visible.** "X observed venues, Y connected kitchens", per region and segment, with freshness. Discovery coverage and operational readiness are separate views; neither implies the other.
5. **Runs are for simulation.** `simulationRunId` is separate from operational budget/accounting identity; a demo reset can't erase pilot spend.
6. **Scale by narrowing the command unit**, not by splitting services: per-plan/per-kitchen-week transactions and paginated read models when measured load needs them (today: one workspace lock, instrumented).

## Stages and gates
| Stage | Gate to advance |
|---|---|
| Hackathon (now) | One authority across UI/MCP/REST; hostile-input and retry checks; three representative kitchens behave differently under the same disruption; discovery view labelled as discovery |
| 4-week hotel shadow pilot | Real menu/stock onboarding, delivery + mandate configured, shadow vs act distinction, measured edits/time/override reasons (PRODUCT.md §5 targets) |
| 3–5 site pilot | Explicit buyer/site identities, versioned policies and documents, per-plan transactions, receiving/short-delivery loop, data-steward review queue |
| Regions → Finland | Readiness admission per site, buyer-specific agreements, isolated quotas, cross-instance run/config consistency, Finnish/Swedish search aliases, remote delivery calendars, operator queue with ownership/SLA |

## Seams already in the code
`workspaceId` + `runId` + server-derived `actor` on every record and op; scoped tools with one gate; versioned approvals bound to terms; op log with provenance; ports for catalog, web and jobs; `api_keys` table (hashed, scoped) ready for per-resource grants.
