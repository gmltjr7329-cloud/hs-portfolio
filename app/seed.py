"""데모용 샘플 데이터. DB가 비어 있을 때 한 번만 들어간다."""
from __future__ import annotations

import logging
from datetime import date, timedelta

from sqlalchemy.exc import IntegrityError

from .extensions import db
from .models import Debt, FixedExpense, OtherAsset, Salary, Setting, Stock, TaxItem, Trade

logger = logging.getLogger(__name__)


def _month_day(today: date, months_back: int, day: int) -> date:
    year, month = today.year, today.month - months_back
    while month <= 0:
        month += 12
        year -= 1
    return date(year, month, min(day, 28))


def seed_if_empty(today: date) -> bool:
    """Setting(id=1) 생성을 잠금처럼 사용해서 여러 프로세스가 동시에 실행해도 한 번만 넣는다."""
    if db.session.get(Setting, 1) is not None:
        return False
    try:
        db.session.add(Setting(id=1, usd_krw=1400))
        db.session.flush()
    except IntegrityError:
        db.session.rollback()
        return False

    db.session.add_all([
        Stock(name="애플", ticker="AAPL", category="주식(해외)", currency="USD", buy_price=180, current_price=210, qty=10),
        Stock(name="엔비디아", ticker="NVDA", category="주식(해외)", currency="USD", buy_price=110, current_price=130, qty=8),
        Stock(name="삼성전자", ticker=None, category="주식(국내)", currency="KRW", buy_price=72000, current_price=78000, qty=20),
        Stock(name="TIGER 미국S&P500", ticker=None, category="ETF/펀드", currency="KRW", buy_price=18000, current_price=21000, qty=30),

        OtherAsset(name="지갑", category="현금", amount=300_000),
        OtherAsset(name="입출금 통장", category="현금", amount=2_500_000),
        OtherAsset(name="정기예금", category="예금", amount=10_000_000, note="만기 1년"),
        OtherAsset(name="청년 적금", category="적금", amount=3_600_000, note="월 30만 원"),

        Debt(name="학자금 대출", category="대출", amount=5_000_000),
        Debt(name="이번 달 카드값", category="신용카드", amount=450_000),

        TaxItem(name="국민연금", amount=144_000),
        TaxItem(name="건강보험", amount=113_400),
        TaxItem(name="소득세", amount=85_000),

        FixedExpense(name="월세", category="주거", amount=450_000),
        FixedExpense(name="통신비", category="통신", amount=65_000),
        FixedExpense(name="OTT 구독", category="구독", amount=17_000),

        Salary(date=_month_day(today, 0, 10), amount=3_200_000, source="본업"),
        Salary(date=_month_day(today, 0, 25), amount=450_000, source="부업"),
        Salary(date=_month_day(today, 1, 10), amount=3_200_000, source="본업"),
        Salary(date=_month_day(today, 1, 25), amount=300_000, source="부업"),
        Salary(date=_month_day(today, 2, 10), amount=3_100_000, source="본업"),

        Trade(date=today - timedelta(days=40), asset_name="애플", type="매수", price=180, qty=10, note="장기 보유"),
        Trade(date=today - timedelta(days=20), asset_name="TIGER 미국S&P500", type="매수", price=18000, qty=30),
    ])
    db.session.commit()
    logger.info("샘플 데이터를 생성했습니다.")
    return True
