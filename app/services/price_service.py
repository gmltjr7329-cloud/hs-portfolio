"""해외주식 시세 조회 (Alpha Vantage).

- API 키는 서버 환경변수에만 있고 브라우저로 내려가지 않는다.
- 같은 티커는 일정 시간 캐시해서 무료 플랜 호출 한도를 아낀다.
"""
from __future__ import annotations

import logging
import threading
import time

import requests

logger = logging.getLogger(__name__)


class PriceServiceError(Exception):
    """사용자에게 그대로 보여줘도 되는 메시지를 담는다."""


class PriceService:
    URL = "https://www.alphavantage.co/query"

    def __init__(self, api_key: str, cache_seconds: int = 300, timeout: int = 8):
        self.api_key = api_key
        self.cache_seconds = max(0, cache_seconds)
        self.timeout = max(1, timeout)
        self._cache: dict[str, tuple[float, float]] = {}
        self._lock = threading.Lock()
        self._session = requests.Session()

    def _cached(self, ticker: str) -> float | None:
        with self._lock:
            hit = self._cache.get(ticker)
        if hit and time.monotonic() - hit[1] < self.cache_seconds:
            return hit[0]
        return None

    def get_price(self, ticker: str) -> float:
        if not self.api_key:
            raise PriceServiceError("서버에 주가 API 키가 설정되지 않았습니다.")

        cached = self._cached(ticker)
        if cached is not None:
            return cached

        try:
            resp = self._session.get(
                self.URL,
                params={"function": "GLOBAL_QUOTE", "symbol": ticker, "apikey": self.api_key},
                timeout=self.timeout,
            )
            resp.raise_for_status()
            data = resp.json()
        except requests.Timeout:
            logger.warning("시세 조회 시간 초과: %s", ticker)
            raise PriceServiceError("주가 서버 응답이 지연되고 있습니다. 잠시 후 다시 시도해 주세요.")
        except (requests.RequestException, ValueError) as exc:
            logger.warning("시세 조회 실패: %s (%s)", ticker, type(exc).__name__)
            raise PriceServiceError("주가 서버에 연결하지 못했습니다.")

        if not isinstance(data, dict):
            raise PriceServiceError("주가 서버 응답 형식이 올바르지 않습니다.")

        quote = data.get("Global Quote") or {}
        try:
            price = float(quote.get("05. price"))
        except (TypeError, ValueError):
            price = 0.0

        if price > 0:
            with self._lock:
                self._cache[ticker] = (price, time.monotonic())
            return price

        if data.get("Note") or data.get("Information"):
            logger.info("시세 API 제한 응답: %s", ticker)
            raise PriceServiceError("주가 API 호출 한도에 도달했습니다. 1분 뒤 다시 시도해 주세요.")
        raise PriceServiceError(f"{ticker} 시세를 찾지 못했습니다. 티커를 확인해 주세요.")
