"""화면(HTML) 라우트."""
from flask import Blueprint, redirect, render_template, url_for

bp = Blueprint("main", __name__)


@bp.get("/")
def index():
    return render_template("index.html")


@bp.get("/favicon.ico")
def favicon():
    return redirect(url_for("static", filename="favicon.svg"), code=301)
