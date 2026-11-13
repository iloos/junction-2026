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

## Profile (14 Nov, `scripts/probe/spankki_profile.py`, aggregates only)
Rerun with `python -I scripts/probe/spankki_profile.py` (pandas, ~1 min, prints JSON; no rows or ids leave the machine).

**Shape.** 3,626,755 transactions, **5,100 customers with exactly one account each**, every customer present in both files. **24 full months, 1 Oct 2024 – 30 Sep 2026**. Median 700 transactions per customer (p10 473, p90 966), about 1 a day. `balance_after_eur` is never null. `merchant_id` and `mcc_code` are filled together for 78% (all purchases); transfers, salary, housing and utilities have none. Customers are aged 18–90 (median 44); the postal codes are all Helsinki region (00 50%, 02 Espoo 28%, 01 Vantaa 22%).

**Categories (15, a closed set) and how each one is paid:**
| Category | Rows | Median € | Type |
|---|---|---|---|
| Groceries | 23.9% | −64 | purchase |
| Restaurants | 20.9% | −23 | purchase |
| Transportation | 17.3% | −41 | purchase |
| Utilities | 9.4% | −50 | utilities_payment |
| Entertainment | 8.3% | −35 | purchase |
| Health | 4.2% | −54 | purchase |
| Salary | 3.4% | +3,164 | salary |
| Home & Tech | 3.2% | −111 | purchase |
| Housing | 3.1% | −1,037 | housing_payment |
| Lifestyle | 3.1% | −103 | purchase |
| Travel | 1.8% | −130 | purchase |
| Invest Deposit / Withdraw | 1.0% / <0.1% | −296 / +1,341 | investment_* |
| Other Income | 0.2% | +2,081 | other_income |
| Salary Sweep | 0.2% | −3,877 | salary_sweep (moves the salary on) |

Each category maps to exactly one transaction type, so the type adds nothing beyond the category.

**Money per customer-month.** Outflow p10 €1,558 / p50 €2,928 / p90 €5,242; inflow p10 €1,877 / p50 €3,206 / p90 €5,435. Final balance p10 €1,411, p50 €6,169, p90 €22,479; 0.7% end negative.

**Recurring payments.** The rule is ≥ 3 months, median gap 25–35 days, amount CV ≤ 0.15, keyed by merchant, else by type + category. It finds 6,809 series across 99.8% of customers, but almost all are rent or mortgage (Housing 4,860, on day 1–8 of the month, median €1,038) and investment deposits (1,459, median €296). Salary lands once a month, mostly on the 15th. **Utilities don't show as series under this rule.** Each customer gets **3 utility bills a month** with no merchant id and varying amounts (per-customer CV 0.38, €24–100). A recurring detector for the "regular essentials" basket has to split them by amount band or day of month, not by merchant. Purchases almost never recur exactly (248 series), so "everyday spending" is a distribution, not a list of bills.

**Mortgage data.** 200 applications, all linked to transaction customers; 150 approved, 50 rejected (insufficient collateral 34, income 8, equity 6, existing debt 2). 3,452 events across 12 types (customer_contact 791, expense_recorded 495, property and collateral steps, then one loan_decision each).

**What this means for "Personal".** "Safe to spend this week" is computable from data: balance − (housing + utilities + investment deposits due before the next salary on the 15th) − a buffer. The three baskets map to the data as: regular essentials = Housing + Utilities (+ Invest Deposit as a choice); everyday = Groceries, Restaurants, Transportation, Entertainment, Lifestyle; unexpected = Health, Home & Tech, Travel spikes above the customer's own monthly p90. The data is synthetic-looking (one account each, round structure), so the pitch should say "on S-Pankki's sample data".

## Open questions
- Terms of use for the data (ask S-Pankki's mentors).
- Whether a mortgage angle (the mortgage event data) is wanted or just context.
