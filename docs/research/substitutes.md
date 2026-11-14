# Substitutes: how to find and judge them

**Sources:** code read 14 Nov ([substitutes.ts](../../src/lib/core/services/substitutes.ts), [catalog pg.ts:146](../../src/lib/server/adapters/catalog/pg.ts#L146)), [valio-data.md](../foundations/valio-data.md), D6, the Valio brief ("proposes substitutions **through recipe logic rather than a simple SKU swap**"), [valio-baseline](valio-baseline.md) (the webshop shows "similar products" with no reason). (judgement) marks design opinion.

## Today
- **Candidates (recall):**
  - Valio's `substitutions` rules: 250 rules on 1.1% of products.
  - The event seed's hand-checked candidates.
  - For dishes the seed doesn't know, same category code + temperature class + unit. That last list is **ordered by product id and cut to 12**, so in a 400-product category it is arbitrary. That's why the seed has to hand-pick.
- **Judgement (precision):** hard constraints and the shared validator in code; D6 weighted score; Gemini Decisions recipe fit (0–4) for the top survivors.
- **Unused:** `products.embedding vector(768)` exists in the schema; nothing fills it.

## The problem has three parts; each wants a different tool (judgement)
| Part | Question | Best tool | Not |
|---|---|---|---|
| **1. Understand the need** | What job does this item do in this dish? ("centrepiece cured pork, served cold and sliced"; "baked swede side, lactose-free") | A small typed **role** on the dish line: `{role, baseIngredient, form, processing, serving, dietRequired}`, from the seed for curated dishes or an LLM extraction (suggestion) for new ones | Free text in a prompt |
| **2. Find candidates** | Which of 17.5k products could do that job? | **Hybrid retrieval:** Valio rules ∪ lexical match on normalised Finnish names (compounds: *lanttu·laatikko*) ∪ **embedding search** over a product card, filtered by hard facts (temperature class, unit, not blocked, allergen exclusions) | An LLM scanning the catalogue; product-id order |
| **3. Judge and explain** | Is it a good swap *for this kitchen*, and what changes? | Code for constraints and the attribute diff; **Gemini fit on the top ~8** with a rubric; the reason line built from the diff | A model deciding allergens or authority |

## Substitution kinds, good → better → best (Valio's "good-better-best")
1. **Same product, other pack** (700 g out → 6 × 400 g). Most common and safest. Find by name normalisation and the same brand/base product; size with lots.
2. **Same item, other brand** (same base ingredient, form and processing).
3. **Other form** (whole ham → sliced cooked ham; raw → ready): changes labour and yield. Say so.
4. **Functional swap in the dish** (trout for salmon in graavilohi): needs the role.
5. **Dish-level change** (make in house; change the menu item; split partial + other): already modelled as rescue / make-in-house.

Rank and present in this order. A kind-3/4 swap always shows what changes (labour, taste, allergens, price basis).

## A light knowledge base, not an ontology project (judgement)
- **Product profile (batch, once):** for each food product, a Gemini Flash-class extraction from name + ingredients + category hints:

  ```
  {baseIngredient, form (whole / sliced / minced / puree…),
   processing (raw / cured / smoked / cooked / frozen-ready),
   dietTags, typicalUse}
  ```

  Each field carries `estimated` provenance. 17.5k products is a natural Modal or batch job (D7 extension), and it fills the embedding card too.
  - **Allergens and origin come only from source data, never from this profile** (D6: estimates stay suggestions).
- **Role taxonomy:** about 30 roles (centrepiece meat, cured fish, starch side, casserole side, sauce base, dairy liquid, baking fat…). It is assigned to dish lines, and mapped to accepted `baseIngredient × form` pairs in a small hand-checked table for the demo dishes (the seed already holds this knowledge as candidate lists: promote it to roles).
- **Learning from people:** a chef's decline or approval of a swap is stored as kitchen-scoped evidence with an expiry (story 25). It informs ranking; it never grants permission.

## Why not "just prompt the LLM" or "just embeddings"
- **Prompting alone** can't see 17.5k products. It needs a candidate set, and it is unreliable on the facts that matter (pack size, lots, allergens). Use it for the judgement it is good at: culinary fit and explaining trade-offs, on a short list, with a rubric.
- **Embeddings alone** find "similar text", not "does the same job". Lanttulaatikko sits near porkkanalaatikko, which is good, but also near "lanttu raw 10 kg", which needs cooking. Filters and the role fix that.
- **An ontology alone** is a weekend sink. Use a thin typed profile plus roles, and let retrieval and the model fill the long tail.

## Measuring it (ties to [sibling-repos](sibling-repos.md) #8)
- **Recall@k of candidate generation:** for 20–40 out-of-stock lines, list the acceptable substitutes by hand. Compare id order (today) vs hybrid retrieval at k = 12.
- **Fit precision:** minimal pairs (same product with one disqualifier flipped: allergen, form, temperature). Three arms: rules / model / model + policy. Report suitability, violations, abstains, latency and cost.

## Partners (D7)
- **Gemini:** embeddings for the product card, fit judgement on the short list, and the batch product profile (Flash-class).
- **Aiven:** pgvector in our Aiven Postgres makes hybrid retrieval a real "meaningful use" (their 40%).
- **Modal (+ Gemma):** the 17.5k-product profile and embedding batch, which is the D7 "convenient extension".
- **Exa / Context.dev:** fill missing ingredients or allergens from manufacturer pages, as suggestions with sources.
- **Not MariaDB:** its challenge is Wikipedia-only (vector RAG or system-versioned tables over Wikipedia), a separate product (D3, D7).

## Order of work (judgement)
1. **Pack-swap finder** (kind 1): name normalisation + same base product. Cheap, deterministic, high value.
2. **Product cards + Gemini embeddings** into the existing column. Hybrid query: lexical ∪ vector ∪ rules, then fact filters, replacing id-order truncation.
3. **Reason line from the attribute diff** on every candidate (SURFACES slice 8).
4. **Roles** on the demo dishes, then the batch product profile (Modal) for the long tail.
5. Labelled recall and fit set before claiming "recipe-aware" (PITCH: pilot until then).
