"""자산 요약 계산 (순자산, 비중, 급여 요약 등).

계산을 서버에서 하므로 어떤 기기에서 보더라도 같은 결과가 나온다.
"""
from __future__ import annotations

from collections import defaultdict
from datetime import date

CASH = {"현금"}
SAVINGS = {"예금", "적금"}


def _prev_month_key(today: date) -> str:
    year, month = (today.year, today.month - 1) if today.month > 1 else (today.year - 1, 12)
    return f"{year:04d}-{month:02d}"


def stock_values(stock: dict, usd_krw: float) -> dict:
    mul = usd_krw if stock["currency"] == "USD" else 1.0
    value = stock["current_price"] * stock["qty"] * mul
    cost = stock["buy_price"] * stock["qty"] * mul
    pnl = value - cost
    pnl_pct = (pnl / cost * 100) if cost > 0 else 0.0
    return {"value_krw": value, "cost_krw": cost, "pnl_krw": pnl, "pnl_pct": pnl_pct}


def build_summary(*, stocks, assets, debts, salaries, taxes, expenses, setting, today: date) -> dict:
    rate = setting["usd_krw"]

    stock_total = sum(s["value_krw"] for s in stocks)
    stock_cost = sum(s["cost_krw"] for s in stocks)
    pnl = stock_total - stock_cost

    cash_total = sum(a["amount"] for a in assets if a["category"] in CASH)
    savings_total = sum(a["amount"] for a in assets if a["category"] in SAVINGS)
    etc_by_cat: dict[str, float] = defaultdict(float)
    for a in assets:
        if a["category"] not in CASH | SAVINGS:
            etc_by_cat[a["category"]] += a["amount"]
    etc_total = sum(etc_by_cat.values())

    asset_total = stock_total + cash_total + savings_total + etc_total
    debt_total = sum(d["amount"] for d in debts)
    net_worth = asset_total - debt_total

    parts = [("주식·ETF", stock_total), ("현금", cash_total), ("예금·적금", savings_total)]
    parts += sorted(etc_by_cat.items(), key=lambda kv: -kv[1])
    allocation = [
        {"name": name, "value": value, "pct": (value / asset_total * 100) if asset_total > 0 else 0.0}
        for name, value in parts if value > 0
    ]

    monthly: dict[str, float] = defaultdict(float)
    for s in salaries:
        monthly[s["date"][:7]] += s["amount"]
    month_key = f"{today.year:04d}-{today.month:02d}"
    salary_month = monthly.get(month_key, 0.0)
    salary_prev = monthly.get(_prev_month_key(today), 0.0)
    salary_growth = ((salary_month - salary_prev) / salary_prev * 100) if salary_prev > 0 else None

    tax_total = sum(t["amount"] for t in taxes)
    expense_total = sum(e["amount"] for e in expenses)
    net_salary = salary_month - tax_total

    return {
        "usd_krw": rate,
        "stock_total": stock_total,
        "stock_cost": stock_cost,
        "pnl": pnl,
        "pnl_pct": (pnl / stock_cost * 100) if stock_cost > 0 else 0.0,
        "cash_total": cash_total,
        "savings_total": savings_total,
        "etc_total": etc_total,
        "asset_total": asset_total,
        "debt_total": debt_total,
        "net_worth": net_worth,
        "allocation": allocation,
        "month": month_key,
        "salary_month": salary_month,
        "salary_prev": salary_prev,
        "salary_growth": salary_growth,
        "salary_monthly": [{"month": m, "total": v} for m, v in sorted(monthly.items(), reverse=True)],
        "tax_total": tax_total,
        "net_salary": net_salary,
        "expense_total": expense_total,
        "available": net_salary - expense_total,
    }
