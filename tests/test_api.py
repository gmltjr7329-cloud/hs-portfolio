"""API 테스트: pytest"""
from datetime import date
from unittest.mock import patch

import pytest

from app import create_app
from app.extensions import db
from app.seed import seed_if_empty
from app.services.price_service import PriceServiceError
from config import TestConfig

H = {"X-Requested-With": "XMLHttpRequest"}


@pytest.fixture()
def client():
    app = create_app(TestConfig)
    with app.app_context():
        yield app.test_client()
        db.session.remove()
        db.drop_all()


def state(client):
    r = client.get("/api/state")
    assert r.status_code == 200
    return r.get_json()["state"]


def test_index_page_and_security_headers(client):
    r = client.get("/")
    assert r.status_code == 200
    assert "HS Portfolio" in r.get_data(as_text=True)
    assert "default-src 'self'" in r.headers["Content-Security-Policy"]
    assert r.headers["X-Content-Type-Options"] == "nosniff"


def test_empty_state(client):
    s = state(client)
    assert s["summary"]["net_worth"] == 0
    assert s["settings"] == {"usd_krw": 1400}
    assert "goal" not in s["summary"]


def test_write_requires_header(client):
    r = client.post("/api/assets", json={"name": "지갑", "category": "현금", "amount": 1000})
    assert r.status_code == 403


def test_create_and_delete_asset_updates_summary(client):
    r = client.post("/api/assets", json={"name": "지갑", "category": "현금", "amount": 300000}, headers=H)
    assert r.status_code == 201
    s = r.get_json()["state"]
    assert s["summary"]["cash_total"] == 300000
    item_id = s["assets"][0]["id"]

    r = client.delete(f"/api/assets/{item_id}", headers=H)
    assert r.status_code == 200
    assert r.get_json()["state"]["assets"] == []

    r = client.delete(f"/api/assets/{item_id}", headers=H)
    assert r.status_code == 404


def test_stock_value_with_exchange_rate(client):
    r = client.post("/api/stocks", json={
        "name": "애플", "ticker": "aapl", "category": "주식(해외)", "currency": "USD",
        "buy_price": 100, "qty": 2,
    }, headers=H)
    assert r.status_code == 201
    stock = r.get_json()["state"]["stocks"][0]
    assert stock["ticker"] == "AAPL"
    assert stock["current_price"] == 100
    assert stock["value_krw"] == 100 * 2 * 1400


def test_validation_errors(client):
    bad = [
        ("/api/assets", {"name": "x", "category": "없는카테고리", "amount": 1}),
        ("/api/assets", {"name": "x", "category": "현금", "amount": -5}),
        ("/api/assets", {"name": "", "category": "현금", "amount": 5}),
        ("/api/assets", {"name": "x", "category": "현금", "amount": "abc"}),
        ("/api/assets", {"name": "x", "category": "현금", "amount": 5, "hack": 1}),
        ("/api/stocks", {"name": "x", "ticker": "<script>", "category": "기타", "currency": "KRW", "buy_price": 1, "qty": 1}),
        ("/api/salaries", {"amount": 100, "date": "2026-13-40"}),
        ("/api/salaries", {"amount": 0, "date": "2026-01-10"}),
    ]
    for url, payload in bad:
        r = client.post(url, json=payload, headers=H)
        assert r.status_code == 400, (url, payload, r.get_json())
        assert r.get_json()["ok"] is False


def test_salary_monthly_sum_and_update(client):
    today = date.today()
    this_month = today.replace(day=1).isoformat()
    for amount, source in [(3_000_000, "본업"), (500_000, "부업")]:
        r = client.post("/api/salaries", json={"amount": amount, "source": source, "date": this_month}, headers=H)
        assert r.status_code == 201
    client.post("/api/taxes", json={"name": "건강보험", "amount": 100_000}, headers=H)
    client.post("/api/expenses", json={"name": "월세", "category": "주거", "amount": 400_000}, headers=H)

    s = state(client)
    sm = s["summary"]
    assert sm["salary_month"] == 3_500_000
    assert sm["net_salary"] == 3_400_000
    assert sm["available"] == 3_000_000

    # 같은 날짜면 나중에 추가한 항목(부업 50만)이 맨 위 → 100만으로 수정
    target = s["salaries"][0]
    assert target["source"] == "부업"
    r = client.put(f"/api/salaries/{target['id']}", json={"amount": 1_000_000}, headers=H)
    assert r.status_code == 200
    assert r.get_json()["state"]["summary"]["salary_month"] == 4_000_000


def test_salary_update_cannot_clear_required(client):
    r = client.post("/api/salaries", json={"amount": 100, "date": date.today().isoformat()}, headers=H)
    sid = r.get_json()["state"]["salaries"][0]["id"]
    r = client.put(f"/api/salaries/{sid}", json={"amount": None}, headers=H)
    assert r.status_code == 400


def test_settings_update(client):
    r = client.put("/api/settings", json={"usd_krw": 1350}, headers=H)
    assert r.status_code == 200
    assert r.get_json()["state"]["settings"] == {"usd_krw": 1350}
    assert client.put("/api/settings", json={"usd_krw": 0}, headers=H).status_code == 400
    # 제거된 목표 금액 필드는 거부
    assert client.put("/api/settings", json={"goal": 50_000_000}, headers=H).status_code == 400
    assert client.put("/api/settings", json={}, headers=H).status_code == 400


def test_price_refresh_success_and_failure(client):
    r = client.post("/api/stocks", json={
        "name": "애플", "ticker": "AAPL", "category": "주식(해외)", "currency": "USD", "buy_price": 100, "qty": 1,
    }, headers=H)
    sid = r.get_json()["state"]["stocks"][0]["id"]

    with patch("app.services.price_service.PriceService.get_price", return_value=123.45):
        r = client.post(f"/api/stocks/{sid}/refresh", headers=H)
    assert r.status_code == 200
    stock = r.get_json()["state"]["stocks"][0]
    assert stock["current_price"] == 123.45
    assert stock["price_updated_at"]

    with patch("app.services.price_service.PriceService.get_price", side_effect=PriceServiceError("한도")):
        r = client.post(f"/api/stocks/{sid}/refresh", headers=H)
    assert r.status_code == 502
    assert r.get_json()["error"] == "한도"


def test_unknown_resource_and_bad_json(client):
    assert client.post("/api/unknown", json={}, headers=H).status_code == 404
    r = client.post("/api/assets", data="not json", headers={**H, "Content-Type": "application/json"})
    assert r.status_code == 400


def test_seed_runs_once(client):
    today = date.today()
    assert seed_if_empty(today) is True
    assert seed_if_empty(today) is False
    s = state(client)
    assert len(s["stocks"]) == 4
    assert s["summary"]["asset_total"] > 0
