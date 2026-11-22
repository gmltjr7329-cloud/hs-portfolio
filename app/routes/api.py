"""REST API 라우트 (JSON).

화면은 이 API만 호출한다. 모든 쓰기 요청은 서버 DB에 저장되므로
다른 기기·다른 브라우저에서 접속해도 같은 데이터가 보인다.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from functools import wraps
from zoneinfo import ZoneInfo

from flask import Blueprint, current_app, jsonify, request
from sqlalchemy.exc import SQLAlchemyError

from ..extensions import db
from ..models import Debt, FixedExpense, OtherAsset, Salary, Setting, Stock, TaxItem, Trade
from ..services.price_service import PriceServiceError
from ..services.summary_service import build_summary, stock_values
from ..validators import META, SCHEMAS, SETTINGS_SCHEMA, ValidationError, validate

logger = logging.getLogger(__name__)
bp = Blueprint("api", __name__, url_prefix="/api")

RESOURCES = {
    "stocks": Stock,
    "trades": Trade,
    "assets": OtherAsset,
    "debts": Debt,
    "salaries": Salary,
    "taxes": TaxItem,
    "expenses": FixedExpense,
}


class ApiError(Exception):
    def __init__(self, message: str, status: int = 400, field: str | None = None):
        super().__init__(message)
        self.message, self.status, self.field = message, status, field


# ---------------------------------------------------------------- 공통 유틸

def today_local():
    return datetime.now(ZoneInfo(current_app.config["TIMEZONE"])).date()


def get_setting() -> Setting:
    setting = db.session.get(Setting, 1)
    if setting is None:
        setting = Setting(id=1)
        db.session.add(setting)
        db.session.commit()
    return setting


def build_state() -> dict:
    """화면에 필요한 모든 데이터를 한 번에 만든다 (요청 1회로 화면 전체 갱신)."""
    setting = get_setting().to_dict()
    rate = setting["usd_krw"]

    stocks = []
    for s in Stock.query.order_by(Stock.id).all():
        d = s.to_dict()
        d.update(stock_values(d, rate))
        stocks.append(d)

    trades = [t.to_dict() for t in Trade.query.order_by(Trade.date.desc(), Trade.id.desc()).all()]
    assets = [a.to_dict() for a in OtherAsset.query.order_by(OtherAsset.id).all()]
    debts = [d.to_dict() for d in Debt.query.order_by(Debt.id).all()]
    salaries = [s.to_dict() for s in Salary.query.order_by(Salary.date.desc(), Salary.id.desc()).all()]
    taxes = [t.to_dict() for t in TaxItem.query.order_by(TaxItem.id).all()]
    expenses = [e.to_dict() for e in FixedExpense.query.order_by(FixedExpense.id).all()]

    summary = build_summary(
        stocks=stocks, assets=assets, debts=debts, salaries=salaries,
        taxes=taxes, expenses=expenses, setting=setting, today=today_local(),
    )
    return {
        "stocks": stocks, "trades": trades, "assets": assets, "debts": debts,
        "salaries": salaries, "taxes": taxes, "expenses": expenses,
        "settings": setting, "summary": summary, "meta": META,
        "today": today_local().isoformat(),
    }


def ok(**extra):
    return jsonify({"ok": True, "state": build_state(), **extra})


def json_body() -> dict:
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        raise ApiError("JSON 형식의 요청이 필요합니다.")
    return data


def write_guard(view):
    """쓰기 요청 보호: 출처 확인 헤더 + IP당 분당 횟수 제한."""
    @wraps(view)
    def wrapper(*args, **kwargs):
        if request.headers.get("X-Requested-With") != "XMLHttpRequest":
            raise ApiError("허용되지 않은 요청입니다.", 403)
        limiter = current_app.extensions["rate_limiter"]
        if not limiter.allow(request.remote_addr or "unknown"):
            raise ApiError("요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.", 429)
        return view(*args, **kwargs)
    return wrapper


def get_model(resource: str):
    model = RESOURCES.get(resource)
    if model is None:
        raise ApiError("존재하지 않는 항목입니다.", 404)
    return model


def get_item(model, item_id: int):
    item = db.session.get(model, item_id)
    if item is None:
        raise ApiError("해당 데이터를 찾을 수 없습니다. 다른 기기에서 이미 삭제되었을 수 있습니다.", 404)
    return item


# ---------------------------------------------------------------- 에러 처리

@bp.errorhandler(ApiError)
def handle_api_error(exc: ApiError):
    return jsonify({"ok": False, "error": exc.message, "field": exc.field}), exc.status


@bp.errorhandler(ValidationError)
def handle_validation_error(exc: ValidationError):
    return jsonify({"ok": False, "error": exc.message, "field": exc.field}), 400


@bp.errorhandler(SQLAlchemyError)
def handle_db_error(exc: SQLAlchemyError):
    db.session.rollback()
    logger.exception("DB 오류")
    return jsonify({"ok": False, "error": "데이터 저장 중 오류가 발생했습니다."}), 500


# ---------------------------------------------------------------- 엔드포인트

@bp.get("/health")
def health():
    return jsonify({"ok": True})


@bp.get("/state")
def state():
    return jsonify({"ok": True, "state": build_state()})


@bp.post("/<resource>")
@write_guard
def create(resource: str):
    model = get_model(resource)
    data = validate(json_body(), SCHEMAS[resource])

    if model.query.count() >= current_app.config["MAX_ROWS_PER_TABLE"]:
        raise ApiError("데모 데이터 저장 한도에 도달했습니다. 기존 항목을 삭제한 뒤 추가해 주세요.", 409)

    if model is Stock and data.get("current_price") is None:
        data["current_price"] = data["buy_price"]

    db.session.add(model(**data))
    db.session.commit()
    logger.info("생성: %s", resource)
    return ok(), 201


@bp.put("/<resource>/<int:item_id>")
@write_guard
def update(resource: str, item_id: int):
    model = get_model(resource)
    data = validate(json_body(), SCHEMAS[resource], partial=True)
    item = get_item(model, item_id)

    for key, value in data.items():
        if value is None and not model.__table__.columns[key].nullable:
            raise ApiError("필수 항목은 비울 수 없습니다.", 400, key)
        setattr(item, key, value)
    db.session.commit()
    logger.info("수정: %s #%s", resource, item_id)
    return ok()


@bp.delete("/<resource>/<int:item_id>")
@write_guard
def delete(resource: str, item_id: int):
    model = get_model(resource)
    item = get_item(model, item_id)
    db.session.delete(item)
    db.session.commit()
    logger.info("삭제: %s #%s", resource, item_id)
    return ok()


@bp.post("/stocks/<int:item_id>/refresh")
@write_guard
def refresh_price(item_id: int):
    stock = get_item(Stock, item_id)
    if not stock.ticker:
        raise ApiError("티커가 없는 종목은 실시간 시세를 조회할 수 없습니다.")

    try:
        price = current_app.extensions["price_service"].get_price(stock.ticker)
    except PriceServiceError as exc:
        raise ApiError(str(exc), 502)

    stock.current_price = price
    stock.price_updated_at = datetime.now(timezone.utc)
    db.session.commit()
    return ok(price=price)


@bp.put("/settings")
@write_guard
def update_settings():
    data = validate(json_body(), SETTINGS_SCHEMA, partial=True)
    if not data:
        raise ApiError("변경할 값이 없습니다.")
    setting = get_setting()
    for key, value in data.items():
        if value is None:
            raise ApiError("값을 입력해 주세요.", 400, key)
        setattr(setting, key, value)
    db.session.commit()
    return ok()
