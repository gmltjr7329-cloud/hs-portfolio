"""DB 모델 (테이블 정의).

금액은 Float로 저장한다. 원화 기준 최대 수조 원 범위에서 개인 자산 관리 용도로는 충분하며,
화면 출력 시 반올림한다.
"""
from __future__ import annotations

from datetime import date, datetime, timezone

from .extensions import db


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class BaseModel(db.Model):
    __abstract__ = True

    id = db.Column(db.Integer, primary_key=True)
    created_at = db.Column(db.DateTime(timezone=True), default=utcnow, nullable=False)

    def to_dict(self) -> dict:
        out = {}
        for col in self.__table__.columns:
            value = getattr(self, col.name)
            if isinstance(value, (datetime, date)):
                value = value.isoformat()
            out[col.name] = value
        return out


class Stock(BaseModel):
    """보유 주식·ETF"""
    __tablename__ = "stocks"

    name = db.Column(db.String(60), nullable=False)
    ticker = db.Column(db.String(12))
    category = db.Column(db.String(20), nullable=False)
    currency = db.Column(db.String(3), nullable=False, default="KRW")
    buy_price = db.Column(db.Float, nullable=False)
    current_price = db.Column(db.Float, nullable=False)
    qty = db.Column(db.Float, nullable=False)
    price_updated_at = db.Column(db.DateTime(timezone=True))


class Trade(BaseModel):
    """거래 내역"""
    __tablename__ = "trades"

    date = db.Column(db.Date, nullable=False, index=True)
    asset_name = db.Column(db.String(60), nullable=False)
    type = db.Column(db.String(10), nullable=False)
    price = db.Column(db.Float, nullable=False)
    qty = db.Column(db.Float, nullable=False)
    note = db.Column(db.String(200))


class OtherAsset(BaseModel):
    """현금 / 예금 / 적금 / 부동산 / 자동차 / 기타 자산"""
    __tablename__ = "other_assets"

    name = db.Column(db.String(60), nullable=False)
    category = db.Column(db.String(20), nullable=False, index=True)
    amount = db.Column(db.Float, nullable=False)
    note = db.Column(db.String(200))


class Debt(BaseModel):
    """부채"""
    __tablename__ = "debts"

    name = db.Column(db.String(60), nullable=False)
    category = db.Column(db.String(20), nullable=False)
    amount = db.Column(db.Float, nullable=False)
    note = db.Column(db.String(200))


class Salary(BaseModel):
    """급여 입금 기록 (같은 달 여러 건 → 합산)"""
    __tablename__ = "salaries"

    date = db.Column(db.Date, nullable=False, index=True)
    amount = db.Column(db.Float, nullable=False)
    source = db.Column(db.String(40))
    note = db.Column(db.String(200))


class TaxItem(BaseModel):
    """급여 공제 항목 (월 기준)"""
    __tablename__ = "tax_items"

    name = db.Column(db.String(40), nullable=False)
    amount = db.Column(db.Float, nullable=False)


class FixedExpense(BaseModel):
    """고정 지출 (월 기준)"""
    __tablename__ = "fixed_expenses"

    name = db.Column(db.String(60), nullable=False)
    category = db.Column(db.String(20), nullable=False)
    amount = db.Column(db.Float, nullable=False)
    note = db.Column(db.String(200))


class Setting(db.Model):
    """환율 설정 (단일 행, id=1)"""
    __tablename__ = "settings"

    id = db.Column(db.Integer, primary_key=True)
    # 목표 설정 기능은 제거했지만, 이미 만들어진 DB와 호환되도록 컬럼은 유지한다.
    goal = db.Column(db.Float, nullable=False, default=100_000_000)
    usd_krw = db.Column(db.Float, nullable=False, default=1400)

    def to_dict(self) -> dict:
        return {"usd_krw": self.usd_krw}
