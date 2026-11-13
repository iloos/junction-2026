# S-Pankki: data and brief (Ring 3, "Personal")

Sources: the printed brief (PDF in `Misc/`, gitignored) and the public dataset repo [hackjunction/Junction-2026-S-pankki](https://github.com/hackjunction/Junction-2026-S-pankki). Data is cloned into `data/s-pankki/` (gitignored; the transactions file is ~346 MB via Git LFS). No licence or terms are stated in the repo, so never commit the data and credit the source.

## The brief in short
A mobile-first AI financial coach that lets people talk with their own money: "Where did my money go? What kind of spender am I? What can I safely spend this week? How could I save more?" Spending in three baskets: **regular essentials, unexpected necessities, everyday spending**. Let users explore their own data freely instead of fixed charts; enrich with open data and benchmarks. Criteria (from the platform): financial literacy, originality of AI integration, clarity of the mobile UX, feasibility, potential to integrate into S-mobiili (20% each).

## Data (4 CSVs, UTF-8 with BOM: read with `utf-8-sig`)
| File | Size | Fields |
|---|---|---|
| `tx_junction_transactions.csv` | ~346 MB (LFS) | customer_id, bank_account_id, tx_date, tx_timestamp, category, tx_amount_eur (negative = outflow), balance_after_eur, transaction_type (purchase, housing payment…), merchant_id (blank for transfers), mcc_code |
| `tx_customers_junction.csv` | ~100 KB | customer_id, customer_postal_code (text; leading zeros), customer_age |
| `mtg_negotiation_history.csv` | ~640 KB | 16 fields: mortgage_customer_id, timestamp, event_type (expense_recorded → collateral_added → collateral_valuation …), property, loan, equity, collateral, decision, rejection_reason, expense, note |
| `mtg_tx_customer_link_and_final_mtg_infio.csv` | ~20 KB | mortgage ↔ customer id link and final outcome |

**Good news versus the GPT review's worry:** balances exist (`balance_after_eur`), so a "safe to spend this week" number can be grounded in real balance and recurring outflows, not guessed.

## Fit with our system (Ring 3)
Shared: deterministic totals, the "why" drawer with source ids (transaction ids instead of product ids), scenarios, the op log, design components, DuckDB-style exploration. Distinct: its own mobile route and data model (`BudgetScenario`, baskets), no purchasing, no approvals. Feasibility check before building: profile the transactions (row count, customers, date range, category vocabulary, how recurring payments look) with a script; the 346 MB file loads fine into DuckDB or PGlite.

## Open questions
- Terms of use for the data (ask S-Pankki's mentors).
- Whether a mortgage angle (the mortgage event data) is wanted or just context.
