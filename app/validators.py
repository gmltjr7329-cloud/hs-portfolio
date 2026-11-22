"""입력값 검증.

모든 쓰기 요청은 여기의 스키마를 통과해야 DB에 저장된다.
타입·길이·범위·선택지를 서버에서 다시 확인하므로 화면을 우회한 요청도 막는다.
"""
from __future__ import annotations

import math
import re
from datetime import date, timedelta

STOCK_CATEGORIES = ["주식(국내)", "주식(해외)", "ETF/펀드", "기타"]
CURRENCIES = ["KRW", "USD"]
TRADE_TYPES = ["매수", "매도", "입금", "출금"]
ASSET_CATEGORIES = ["현금", "예금", "적금", "부동산", "자동차", "기타 자산"]
DEBT_CATEGORIES = ["신용카드", "대출", "마이너스통장", "기타 부채"]
EXPENSE_CATEGORIES = ["주거", "교통", "통신", "구독", "보험", "식비", "기타"]

MAX_AMOUNT = 1e13      # 10조 원
MAX_PRICE = 1e10
MAX_QTY = 1e9

_CONTROL_CHARS = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")


class ValidationError(Exception):
    def __init__(self, message: str, field: str | None = None):
        super().__init__(message)
        self.message = message
        self.field = field


def _clean_str(value, label: str, rule: dict):
    if value is None:
        value = ""
    if not isinstance(value, str):
        raise ValidationError(f"{label} 형식이 올바르지 않습니다.")
    value = _CONTROL_CHARS.sub("", value).strip()
    if rule.get("upper"):
        value = value.upper()
    if not value:
        return None
    max_len = rule.get("max", 200)
    if len(value) > max_len:
        raise ValidationError(f"{label}은(는) {max_len}자 이하로 입력해 주세요.")
    choices = rule.get("choices")
    if choices and value not in choices:
        raise ValidationError(f"{label} 값이 허용된 항목이 아닙니다.")
    pattern = rule.get("pattern")
    if pattern and not re.fullmatch(pattern, value):
        raise ValidationError(rule.get("pattern_msg", f"{label} 형식이 올바르지 않습니다."))
    return value


def _clean_num(value, label: str, rule: dict):
    if value is None or (isinstance(value, str) and not value.strip()):
        return None
    if isinstance(value, bool):
        raise ValidationError(f"{label}은(는) 숫자로 입력해 주세요.")
    try:
        number = float(value)
    except (TypeError, ValueError):
        raise ValidationError(f"{label}은(는) 숫자로 입력해 주세요.")
    if not math.isfinite(number):
        raise ValidationError(f"{label}은(는) 숫자로 입력해 주세요.")
    min_v = rule.get("min", 0)
    max_v = rule.get("max", MAX_AMOUNT)
    exclusive = rule.get("exclusive_min", False)
    if (exclusive and number <= min_v) or (not exclusive and number < min_v):
        raise ValidationError(f"{label}은(는) {'0보다 커야' if exclusive and min_v == 0 else f'{min_v:g} 이상이어야'} 합니다.")
    if number > max_v:
        raise ValidationError(f"{label} 값이 너무 큽니다.")
    return number


def _clean_date(value, label: str, rule: dict):
    if value is None or (isinstance(value, str) and not value.strip()):
        return None
    if not isinstance(value, str):
        raise ValidationError(f"{label} 형식이 올바르지 않습니다.")
    try:
        parsed = date.fromisoformat(value.strip()[:10])
    except ValueError:
        raise ValidationError(f"{label}은(는) YYYY-MM-DD 형식이어야 합니다.")
    if parsed < date(2000, 1, 1) or parsed > date.today() + timedelta(days=366):
        raise ValidationError(f"{label} 범위가 올바르지 않습니다.")
    return parsed


_CLEANERS = {"str": _clean_str, "num": _clean_num, "date": _clean_date}


def validate(payload, schema: dict, partial: bool = False) -> dict:
    """payload(dict)를 schema에 맞춰 정제한다.

    partial=True(수정 요청)면 payload에 들어온 필드만 검사·반환한다.
    """
    if not isinstance(payload, dict):
        raise ValidationError("요청 형식이 올바르지 않습니다.")
    unknown = set(payload) - set(schema)
    if unknown:
        raise ValidationError("허용되지 않은 항목이 포함되어 있습니다.")

    result = {}
    for field, rule in schema.items():
        if partial and field not in payload:
            continue
        label = rule.get("label", field)
        try:
            value = _CLEANERS[rule["type"]](payload.get(field), label, rule)
        except ValidationError as exc:
            exc.field = field
            raise
        if value is None:
            if rule.get("required"):
                raise ValidationError(f"{label}을(를) 입력해 주세요.", field)
            if "default" in rule:
                value = rule["default"]
        result[field] = value
    return result


_TICKER = {"type": "str", "label": "티커", "max": 12, "upper": True,
           "pattern": r"[A-Z0-9][A-Z0-9.\-]{0,11}",
           "pattern_msg": "티커는 영문 대문자·숫자·점(.)·하이픈(-)만 사용할 수 있습니다."}
_NOTE = {"type": "str", "label": "메모", "max": 200}

SCHEMAS: dict[str, dict] = {
    "stocks": {
        "name": {"type": "str", "label": "종목명", "max": 60, "required": True},
        "ticker": _TICKER,
        "category": {"type": "str", "label": "카테고리", "choices": STOCK_CATEGORIES, "required": True},
        "currency": {"type": "str", "label": "통화", "choices": CURRENCIES, "required": True},
        "buy_price": {"type": "num", "label": "매입가", "max": MAX_PRICE, "exclusive_min": True, "required": True},
        "current_price": {"type": "num", "label": "현재가", "max": MAX_PRICE, "exclusive_min": True},
        "qty": {"type": "num", "label": "수량", "max": MAX_QTY, "exclusive_min": True, "required": True},
    },
    "trades": {
        "date": {"type": "date", "label": "날짜", "required": True},
        "asset_name": {"type": "str", "label": "자산명", "max": 60, "required": True},
        "type": {"type": "str", "label": "거래 유형", "choices": TRADE_TYPES, "required": True},
        "price": {"type": "num", "label": "단가", "max": MAX_PRICE, "exclusive_min": True, "required": True},
        "qty": {"type": "num", "label": "수량", "max": MAX_QTY, "exclusive_min": True, "required": True},
        "note": _NOTE,
    },
    "assets": {
        "name": {"type": "str", "label": "이름", "max": 60, "required": True},
        "category": {"type": "str", "label": "카테고리", "choices": ASSET_CATEGORIES, "required": True},
        "amount": {"type": "num", "label": "금액", "required": True},
        "note": _NOTE,
    },
    "debts": {
        "name": {"type": "str", "label": "부채명", "max": 60, "required": True},
        "category": {"type": "str", "label": "카테고리", "choices": DEBT_CATEGORIES, "required": True},
        "amount": {"type": "num", "label": "금액", "required": True},
        "note": _NOTE,
    },
    "salaries": {
        "date": {"type": "date", "label": "날짜", "required": True},
        "amount": {"type": "num", "label": "금액", "exclusive_min": True, "required": True},
        "source": {"type": "str", "label": "출처", "max": 40},
        "note": _NOTE,
    },
    "taxes": {
        "name": {"type": "str", "label": "항목명", "max": 40, "required": True},
        "amount": {"type": "num", "label": "금액", "required": True},
    },
    "expenses": {
        "name": {"type": "str", "label": "지출명", "max": 60, "required": True},
        "category": {"type": "str", "label": "카테고리", "choices": EXPENSE_CATEGORIES, "required": True},
        "amount": {"type": "num", "label": "금액", "required": True},
        "note": _NOTE,
    },
}

SETTINGS_SCHEMA = {
    "usd_krw": {"type": "num", "label": "환율", "exclusive_min": True, "max": 100_000},
}

META = {
    "stock_categories": STOCK_CATEGORIES,
    "currencies": CURRENCIES,
    "trade_types": TRADE_TYPES,
    "asset_categories": ASSET_CATEGORIES,
    "debt_categories": DEBT_CATEGORIES,
    "expense_categories": EXPENSE_CATEGORIES,
}
