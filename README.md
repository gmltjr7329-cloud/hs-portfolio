# HS Portfolio

개인 자산(주식·현금·예적금·부채·급여)을 한 화면에서 관리하는 웹 애플리케이션입니다.
**Flask 백엔드 + REST API + JavaScript 프론트엔드**로 구성했고, 모든 데이터는 서버 DB에 저장됩니다.

> 포트폴리오용 데모라 로그인 없이 바로 열립니다.
> 데모 화면에서 추가·수정·삭제한 내용은 서버 DB에 저장되므로, **다른 컴퓨터나 브라우저로 접속해도 같은 데이터가 보입니다.**

---

## 주요 기능

| 메뉴 | 기능 |
|---|---|
| 나의 총 자산 | 순자산·총 자산·총 부채·이번 달 가용 금액, 자산 비중 도넛 차트, 항목별 요약 |
| 자산 관리 | 급여 관리(같은 달 여러 번 입금 시 자동 합산), 월별 급여 기록·수정·삭제, 지난달 대비 증감률, 세금 공제 항목, 고정 지출, 현금, 예금·적금, 기타 자산, 부채 |
| 내 주식 내역 | 보유 종목, 환율 반영 원화 평가액·수익률, 해외주식 실시간 시세 업데이트, 달러 환율 설정 |
| 거래 내역 | 매수·매도·입금·출금 기록 |

---

## 기술 스택

- **Backend**: Python, Flask 3, Flask-SQLAlchemy (SQLite 기본 / PostgreSQL 지원)
- **Frontend**: Jinja2 템플릿, Vanilla JavaScript (빌드 도구 없음), CSS
- **외부 API**: Alpha Vantage (해외주식 시세)
- **Test**: pytest

---

## 구조

```
브라우저 (static/js/app.js)
   │  fetch /api/...  (JSON)
   ▼
Flask (app/routes/api.py)
   ├─ 입력 검증      app/validators.py
   ├─ 요약 계산      app/services/summary_service.py
   ├─ 시세 조회      app/services/price_service.py ──▶ Alpha Vantage
   └─ DB 저장        app/models.py ──▶ SQLite / PostgreSQL
```

```
hs_portfolio/
├── run.py                  # 실행 진입점
├── config.py               # 설정 (환경변수)
├── requirements.txt
├── .env.example
├── app/
│   ├── __init__.py         # 앱 팩토리, 로깅, 에러 처리
│   ├── extensions.py       # SQLAlchemy
│   ├── models.py           # 테이블 정의
│   ├── validators.py       # 입력 검증 스키마
│   ├── security.py         # 요청 제한, 보안 헤더
│   ├── seed.py             # 데모 샘플 데이터
│   ├── routes/
│   │   ├── main.py         # 화면 라우트
│   │   └── api.py          # REST API
│   ├── services/
│   │   ├── price_service.py
│   │   └── summary_service.py
│   ├── templates/          # base / index / error
│   └── static/             # css, js, favicon
└── tests/test_api.py
```

---

## 실행 방법 (Mac 기준)

```bash
cd hs_portfolio
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

cp .env.example .env        # ALPHA_VANTAGE_API_KEY 입력 (없어도 실행됨, 시세 업데이트만 비활성)
python run.py
```

브라우저에서 http://127.0.0.1:5000 접속. 처음 실행하면 샘플 데이터가 자동으로 들어갑니다.

테스트:

```bash
python -m pytest -q
```

---

## API

모든 응답은 `{"ok": true, "state": {...}}` 형식이며, 쓰기 요청 후 최신 화면 데이터를 함께 돌려줍니다.

| Method | Path | 설명 |
|---|---|---|
| GET | `/api/state` | 화면 전체 데이터 + 요약 계산 결과 |
| POST | `/api/{resource}` | 추가 (`stocks`, `trades`, `assets`, `debts`, `salaries`, `taxes`, `expenses`) |
| PUT | `/api/{resource}/{id}` | 수정 |
| DELETE | `/api/{resource}/{id}` | 삭제 |
| POST | `/api/stocks/{id}/refresh` | 해외주식 시세 갱신 (서버가 대신 조회) |
| PUT | `/api/settings` | 환율 변경 |
| GET | `/api/health` | 상태 확인 |

---

## DB 테이블

`stocks`, `trades`, `other_assets`(현금·예금·적금·기타), `debts`, `salaries`, `tax_items`, `fixed_expenses`, `settings`

---

## 보안·안정성

- **API 키 보호**: 시세 API 키는 서버 환경변수에만 있고 브라우저로 내려가지 않음
- **입력 검증**: 서버에서 타입·길이·범위·선택지를 다시 검사, 허용되지 않은 필드는 거부
- **SQL Injection 방지**: ORM(SQLAlchemy)으로만 DB 접근
- **XSS 방지**: 화면에 사용자 입력을 넣을 때 `innerHTML`을 쓰지 않고 `textContent`만 사용, CSP 헤더 적용
- **공개 데모 보호**: 쓰기 요청에 출처 확인 헤더 필수, IP당 분당 쓰기 횟수 제한, 테이블당 저장 개수 제한
- **시세 API 절약**: 같은 티커는 5분간 캐시, 여러 종목은 간격을 두고 순차 조회
- **로깅**: 콘솔 + `logs/app.log` (자동 순환)

---

## 배포 (Render + Supabase)

- **서버**: Render 무료 웹 서비스. 설정은 `render.yaml`에 있습니다.
- **DB**: Supabase PostgreSQL. Render 서버는 재시작하면 내부 파일이 초기화되므로, 데이터는 외부 DB에 저장합니다.
- **연결 주소**: Render는 IPv6로 외부에 접속할 수 없어서, Supabase의 Direct connection 주소 대신 **Session pooler** 주소(포트 5432)를 사용합니다.
- **환경변수**: `DATABASE_URL`, `ALPHA_VANTAGE_API_KEY`는 Render 대시보드에서만 입력합니다. 저장소에는 올리지 않습니다.
- **실행 명령**: `gunicorn run:app --workers 1 --threads 4 --bind 0.0.0.0:$PORT`
- 무료 서버는 15분 동안 접속이 없으면 잠들고, 다음 첫 접속 때 깨어나는 데 1분 정도 걸립니다.
