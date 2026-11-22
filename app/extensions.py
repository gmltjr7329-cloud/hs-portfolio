"""Flask 확장 객체. 순환 import를 막기 위해 앱과 분리해 둔다."""
from flask_sqlalchemy import SQLAlchemy

db = SQLAlchemy()
