"""앱 팩토리."""
from __future__ import annotations

import logging
import sys
from datetime import datetime
from logging.handlers import RotatingFileHandler
from pathlib import Path
from zoneinfo import ZoneInfo

from flask import Flask, jsonify, render_template, request
from werkzeug.exceptions import HTTPException

from config import Config

from .extensions import db
from .security import RateLimiter, apply_security_headers
from .services.price_service import PriceService

APP_VERSION = "1.0.0"


def _setup_logging(app: Flask) -> None:
    fmt = logging.Formatter("%(asctime)s [%(levelname)s] %(name)s: %(message)s")
    root = logging.getLogger()
    root.setLevel(app.config["LOG_LEVEL"])
    for h in list(root.handlers):
        if getattr(h, "_hs_handler", False):
            root.removeHandler(h)

    console = logging.StreamHandler(sys.stdout)
    console.setFormatter(fmt)
    console._hs_handler = True
    root.addHandler(console)

    if app.config.get("TESTING"):
        return
    try:
        log_dir = Path(app.config["LOG_DIR"])
        log_dir.mkdir(parents=True, exist_ok=True)
        file_handler = RotatingFileHandler(log_dir / "app.log", maxBytes=1_000_000, backupCount=3, encoding="utf-8")
        file_handler.setFormatter(fmt)
        file_handler._hs_handler = True
        root.addHandler(file_handler)
    except OSError:
        # 읽기 전용 파일시스템인 호스팅 환경에서는 콘솔 로그만 사용
        logging.getLogger(__name__).warning("로그 파일을 만들 수 없어 콘솔 로그만 사용합니다.")


def create_app(config_class=Config) -> Flask:
    app = Flask(__name__)
    app.config.from_object(config_class)
    app.json.ensure_ascii = False

    _setup_logging(app)
    logger = logging.getLogger(__name__)

    if app.config["TRUST_PROXY"]:
        from werkzeug.middleware.proxy_fix import ProxyFix
        app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1)

    if app.config["SQLALCHEMY_DATABASE_URI"].startswith("sqlite:///") and not app.config.get("TESTING"):
        Path(app.config["SQLALCHEMY_DATABASE_URI"].replace("sqlite:///", "")).parent.mkdir(parents=True, exist_ok=True)

    db.init_app(app)
    app.extensions["rate_limiter"] = RateLimiter(app.config["WRITE_RATE_LIMIT_PER_MIN"])
    app.extensions["price_service"] = PriceService(
        app.config["ALPHA_VANTAGE_API_KEY"],
        cache_seconds=app.config["PRICE_CACHE_SECONDS"],
        timeout=app.config["PRICE_TIMEOUT_SECONDS"],
    )

    from .routes.api import bp as api_bp
    from .routes.main import bp as main_bp
    app.register_blueprint(main_bp)
    app.register_blueprint(api_bp)

    with app.app_context():
        from . import models  # noqa: F401  (테이블 등록)
        db.create_all()
        if app.config["SEED_ON_EMPTY"]:
            from .seed import seed_if_empty
            today = datetime.now(ZoneInfo(app.config["TIMEZONE"])).date()
            seed_if_empty(today)

    if not app.config["ALPHA_VANTAGE_API_KEY"]:
        logger.warning("ALPHA_VANTAGE_API_KEY가 없어 실시간 시세 조회가 비활성화됩니다.")

    @app.context_processor
    def inject_version():
        return {"app_version": APP_VERSION}

    app.after_request(apply_security_headers)

    @app.errorhandler(HTTPException)
    def handle_http_error(exc: HTTPException):
        if request.path.startswith("/api/"):
            messages = {404: "요청한 주소를 찾을 수 없습니다.", 405: "허용되지 않은 요청 방식입니다.",
                        413: "요청 데이터가 너무 큽니다."}
            return jsonify({"ok": False, "error": messages.get(exc.code, exc.description)}), exc.code
        return render_template("error.html", code=exc.code, message=exc.name), exc.code

    @app.errorhandler(Exception)
    def handle_unexpected(exc: Exception):
        db.session.rollback()
        logger.exception("처리되지 않은 오류")
        if request.path.startswith("/api/"):
            return jsonify({"ok": False, "error": "서버 오류가 발생했습니다."}), 500
        return render_template("error.html", code=500, message="서버 오류가 발생했습니다."), 500

    @app.teardown_appcontext
    def remove_session(exc=None):
        db.session.remove()

    logger.info("HS Portfolio 시작 (DB: %s)", app.config["SQLALCHEMY_DATABASE_URI"].split("://")[0])
    return app
