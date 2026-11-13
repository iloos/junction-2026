"""Read-only profile of the S-Pankki dataset (data/s-pankki/, gitignored, never committed).

Prints aggregates only (no rows, no customer ids), for docs/foundations/s-pankki.md "Profile".
  python -I scripts/probe/spankki_profile.py [data_dir]
Reads with utf-8-sig (the CSVs start with a BOM). Needs pandas.
"""
import json, sys, warnings
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[2]
D = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "data" / "s-pankki"
warnings.filterwarnings("ignore", category=RuntimeWarning)  # std/mean of single-row groups


def pct(a, b):
    return round(100 * a / b, 1) if b else 0.0


def main():
    tx = pd.read_csv(
        D / "tx_junction_transactions.csv",
        encoding="utf-8-sig",
        usecols=["customer_id", "bank_account_id", "tx_date", "category", "tx_amount_eur",
                 "balance_after_eur", "transaction_type", "merchant_id", "mcc_code"],
        dtype={"customer_id": "category", "bank_account_id": "category", "category": "category",
               "transaction_type": "category", "merchant_id": "category", "mcc_code": "string"},
        parse_dates=["tx_date"],
    )
    cust = pd.read_csv(D / "tx_customers_junction.csv", encoding="utf-8-sig", dtype={"customer_postal_code": "string"})
    link = pd.read_csv(D / "mtg_tx_customer_link_and_final_mtg_infio.csv", encoding="utf-8-sig")
    mtg = pd.read_csv(D / "mtg_negotiation_history.csv", encoding="utf-8-sig")

    out = {}
    n = len(tx)
    out["transactions"] = {
        "rows": n,
        "customers": int(tx.customer_id.nunique()),
        "accounts": int(tx.bank_account_id.nunique()),
        "dateMin": str(tx.tx_date.min().date()),
        "dateMax": str(tx.tx_date.max().date()),
        "months": int(tx.tx_date.dt.to_period("M").nunique()),
        "inflowShare": pct((tx.tx_amount_eur > 0).sum(), n),
        "merchantFill": pct(tx.merchant_id.notna().sum(), n),
        "mccFill": pct(tx.mcc_code.notna().sum(), n),
        "nullBalance": int(tx.balance_after_eur.isna().sum()),
    }
    per_c = tx.groupby("customer_id", observed=True).size()
    out["transactions"]["txPerCustomer"] = {q: int(per_c.quantile(v)) for q, v in (("p10", .1), ("p50", .5), ("p90", .9))}
    acc_per_c = tx.groupby("customer_id", observed=True).bank_account_id.nunique()
    out["transactions"]["accountsPerCustomer"] = acc_per_c.value_counts().sort_index().to_dict()

    cat = tx.groupby("category", observed=True).tx_amount_eur.agg(["size", "sum", "median"]).sort_values("size", ascending=False)
    out["categories"] = [
        {"category": str(k), "rows": int(r["size"]), "share": pct(r["size"], n), "sumEur": round(float(r["sum"])), "medianEur": round(float(r["median"]), 2)}
        for k, r in cat.iterrows()
    ]
    tt = tx.transaction_type.value_counts()
    out["transactionTypes"] = [{"type": str(k), "rows": int(v), "share": pct(v, n)} for k, v in tt.items()]
    out["typeByCategory"] = {
        str(c): sorted({str(t) for t in g.transaction_type.dropna().unique()})
        for c, g in tx[["category", "transaction_type"]].drop_duplicates().groupby("category", observed=True)
    }

    # Monthly totals per customer (outflow/inflow), to size "safe to spend".
    tx["month"] = tx.tx_date.dt.to_period("M")
    m = tx.groupby(["customer_id", "month"], observed=True).tx_amount_eur.agg(
        outflow=lambda s: -s[s < 0].sum(), inflow=lambda s: s[s > 0].sum())
    out["monthlyPerCustomer"] = {
        k: {q: round(float(m[k].quantile(v))) for q, v in (("p10", .1), ("p50", .5), ("p90", .9))}
        for k in ("outflow", "inflow")
    }
    bal = tx.sort_values("tx_date").groupby("customer_id", observed=True).balance_after_eur.last()
    out["lastBalance"] = {q: round(float(bal.quantile(v))) for q, v in (("p10", .1), ("p50", .5), ("p90", .9))}
    out["lastBalance"]["negativeShare"] = pct((bal < 0).sum(), len(bal))

    # Recurring outflows: same customer + same key (merchant, else transaction_type+category),
    # in >= 3 distinct months, median gap 25-35 days, amount coefficient of variation <= 0.15.
    o = tx[tx.tx_amount_eur < 0].copy()
    o["key"] = o.merchant_id.astype("string").fillna(o.transaction_type.astype("string") + "|" + o.category.astype("string"))
    o = o.sort_values("tx_date")
    g = o.groupby(["customer_id", "key"], observed=True)
    stats = g.agg(n=("tx_amount_eur", "size"), months=("month", "nunique"), mean=("tx_amount_eur", "mean"),
                  std=("tx_amount_eur", "std"), cat=("category", "first"), ttype=("transaction_type", "first"))
    gaps = g.tx_date.apply(lambda s: s.diff().dt.days.median())
    stats["gap"] = gaps
    stats["cv"] = (stats["std"].fillna(0) / stats["mean"].abs()).fillna(0)
    rec = stats[(stats.months >= 3) & stats.gap.between(25, 35) & (stats.cv <= 0.15)]
    rec_c = rec.reset_index().customer_id.nunique()
    out["recurring"] = {
        "rule": ">=3 months, median gap 25-35 d, amount CV <= 0.15, keyed by merchant or type+category",
        "series": int(len(rec)),
        "customersWithAny": int(rec_c),
        "customersShare": pct(rec_c, out["transactions"]["customers"]),
        "perCustomerP50": int(rec.reset_index().groupby("customer_id", observed=True).size().median()) if len(rec) else 0,
        "byCategory": rec.groupby("cat", observed=True).size().sort_values(ascending=False).head(12).astype(int).to_dict(),
        "byType": rec.groupby("ttype", observed=True).size().sort_values(ascending=False).head(12).astype(int).to_dict(),
        "monthlyAmountP50ByCategory": rec.groupby("cat", observed=True)["mean"].median().abs().round(2).sort_values(ascending=False).head(12).to_dict(),
    }

    # Cadence of the payments that make up "regular essentials".
    u = tx[tx.category == "Utilities"]
    u_pm = u.groupby(["customer_id", "month"], observed=True).size()
    u_cv = u.groupby("customer_id", observed=True).tx_amount_eur.agg(lambda s: s.std() / abs(s.mean()))
    sal = tx[tx.category == "Salary"]
    out["cadence"] = {
        "utilitiesPerCustomerMonthP50": float(u_pm.median()),
        "utilitiesMerchantFill": pct(u.merchant_id.notna().sum(), len(u)),
        "utilitiesAmountCvP50": round(float(u_cv.median()), 2),
        "salaryPerCustomerMonthP50": float(sal.groupby(["customer_id", "month"], observed=True).size().median()),
        "salaryDayOfMonth": {q: int(sal.tx_date.dt.day.quantile(v)) for q, v in (("p10", .1), ("p50", .5), ("p90", .9))},
        "housingDayOfMonth": {q: int(tx[tx.category == "Housing"].tx_date.dt.day.quantile(v)) for q, v in (("p10", .1), ("p50", .5), ("p90", .9))},
    }

    out["customers"] = {
        "rows": len(cust),
        "age": {q: int(cust.customer_age.quantile(v)) for q, v in (("min", 0), ("p10", .1), ("p50", .5), ("p90", .9), ("max", 1))},
        "postalPrefix2Top": cust.customer_postal_code.str[:2].value_counts().head(8).to_dict(),
        "inTransactions": int(cust.customer_id.isin(tx.customer_id.unique()).sum()),
    }
    out["mortgage"] = {
        "applications": int(link.mortgage_customer_id.nunique()),
        "linkedToTxCustomers": int(link.customer_id.isin(tx.customer_id.unique()).sum()),
        "finalDecision": link.final_decision.value_counts().to_dict(),
        "rejectionReasons": link.rejection_reason.value_counts().head(8).to_dict(),
        "events": len(mtg),
        "eventTypes": mtg.event_type.value_counts().to_dict(),
    }
    print(json.dumps(out, ensure_ascii=False, indent=1, default=str))


if __name__ == "__main__":
    main()
