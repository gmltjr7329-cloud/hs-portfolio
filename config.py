"""HS Portfolio 설정.

환경변수(.env)로 값을 덮어쓸 수 있다. 민감한 값(API 키, DB 주소)은 코드에 두지 않는다.
"""
from __future__ import annotations

import logging
import os
import secrets
from pathlib import Path

from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent
load_dotenv(BASE_DIR / ".env")

_log = logging.getLogger(__name__)


def _int_env(name: str, default: int) -> int:
    raw = os.getenv(name, "").strip()
    if not raw:
        return default
    try:
        return int(raw)
    except ValueError:
        _log.warning("환경변수 %s 값이 정수가 아니어서 기본값 %s을 사용합니다.", name, default)
        return default


def _bool_env(name: str, default: bool) -> bool:
    raw = os.getenv(name, "").strip().lower()
    if not raw:
        return default
    return raw in ("1", "true", "yes", "on")


def _database_url() -> str:
    url = os.getenv("DATABASE_URL", "").strip()
    if not url:
        db_path = BASE_DIR / "instance" / "portfolio.db"
        return f"sqlite:///{db_path.as_posix()}"
    # Supabase/Render가 주는 postgres:// 또는 postgresql:// 주소를 설치된 드라이버(psycopg2)로 고정한다.
    # (SQLAlchemy 2.1부터 드라이버를 지정하지 않으면 psycopg v3를 찾기 때문)
    for prefix in ("postgres://", "postgresql://"):
        if url.startswith(prefix):
            url = "postgresql+psycopg2://" + url[len(prefix):]
            break
    return url


class Config:
    SECRET_KEY = os.getenv("SECRET_KEY") or secrets.token_hex(32)

    SQLALCHEMY_DATABASE_URI = _database_url()
    SQLALCHEMY_TRACK_MODIFICATIONS = False
    SQLALCHEMY_ENGINE_OPTIONS = {"pool_pre_ping": True}

    # 요청 본문 최대 크기 (JSON 폼 데이터만 받으므로 작게 제한)
    MAX_CONTENT_LENGTH = 64 * 1024

    # 해외주식 시세 (Alpha Vantage) - 키는 서버에만 존재, 브라우저로 내려가지 않음
    ALPHA_VANTAGE_API_KEY = os.getenv("ALPHA_VANTAGE_API_KEY", "").strip()
    PRICE_CACHE_SECONDS = _int_env("PRICE_CACHE_SECONDS", 300)
    PRICE_TIMEOUT_SECONDS = _int_env("PRICE_TIMEOUT_SECONDS", 8)

    # 공개 데모 보호장치
    MAX_ROWS_PER_TABLE = _int_env("MAX_ROWS_PER_TABLE", 300)
    WRITE_RATE_LIMIT_PER_MIN = _int_env("WRITE_RATE_LIMIT_PER_MIN", 60)

    TIMEZONE = os.getenv("APP_TIMEZONE", "Asia/Seoul")
    SEED_ON_EMPTY = _bool_env("SEED_ON_EMPTY", True)
    TRUST_PROXY = _bool_env("TRUST_PROXY", False)

    LOG_DIR = BASE_DIR / "logs"
    LOG_LEVEL = os.getenv("LOG_LEVEL", "INFO").upper()


class TestConfig(Config):
    TESTING = True
    SQLALCHEMY_DATABASE_URI = "sqlite:///:memory:"
    SEED_ON_EMPTY = False
    WRITE_RATE_LIMIT_PER_MIN = 100_000
    ALPHA_VANTAGE_API_KEY = "test-key"
