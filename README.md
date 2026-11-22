# HS Portfolio

> 개인 자산(주식·현금·예적금·부채·급여)을 한 화면에서 관리하는 웹 애플리케이션

**🔗 데모 사이트: https://hs-portfolio-2f0n.onrender.com**
(무료 서버라 한동안 접속이 없으면 잠들어 있어, 첫 접속 시 화면이 뜨기까지 1분 정도 걸릴 수 있습니다.)

- **Flask 백엔드 + REST API + JavaScript 프론트엔드**를 직접 설계·구현했습니다.
- 모든 데이터는 서버 DB(PostgreSQL)에 저장되어, **다른 컴퓨터나 휴대폰으로 접속해도 같은 데이터가 보입니다.**
- 포트폴리오용 데모라 로그인 없이 바로 사용할 수 있습니다.

---

## 화면

### 나의 총 자산
순자산, 총 자산·부채, 주식 평가손익, 이번 달 가용 금액과 자산 비중 차트를 한 화면에 보여줍니다.

![나의 총 자산](screenshots/01_dashboard.png)

### 자산 관리
급여를 입력하면 이번 달 금액에 합산되고, 공제 항목과 고정 지출을 빼서 실수령액·가용 금액을 자동으로 계산합니다.

![자산 관리](screenshots/02_manage.png)

### 내 주식 내역
해외주식은 서버가 Alpha Vantage API로 실시간 시세를 받아오고, 설정한 환율로 원화 평가액과 수익률을 계산합니다.

![내 주식 내역](screenshots/03_stocks.png)

---

## 주요 기능

| 메뉴 | 기능 |
|---|---|
| 나의 총 자산 | 순자산·총 자산·총 부채·이번 달 가용 금액, 자산 비중 도넛 차트, 항목별 요약 |
| 자산 관리 | 급여 관리(같은 달 여러 번 입금 시 자동 합산), 월별 급여 기록·수정·삭제, 지난달 대비 증감률, 공제 항목, 고정 지출, 현금, 예금·적금, 기타 자산, 부채 |
| 내 주식 내역 | 보유 종목, 환율 반영 원화 평가액·수익률, 해외주식 실시간 시세 업데이트, 달러 환율 설정 |
| 거래 내역 | 매수·매도·입금·출금 기록 |

---

## 기술 스택

| 구분 | 사용 기술 |
|---|---|
| Backend | Python, Flask 3, Flask-SQLAlchemy |
| Database | PostgreSQL (Supabase, 배포) / SQLite (로컬 개발) |
| Frontend | Jinja2 템플릿, Vanilla JavaScript, CSS (반응형) |
| 외부 API | Alpha Vantage (해외주식 시세) |
| 배포 | Render (gunicorn) + Supabase |
| Test | pytest (API 테스트 12개) |

---

## 구조

```
브라우저 (static/js/app.js)
   │  fetch /api/...  (JSON)
   ▼
Flask 서버 (Render, gunicorn)
   ├─ 입력 검증      app/validators.py
   ├─ 요약 계산      app/services/summary_service.py
   ├─ 시세 조회      app/services/price_service.py ──▶ Alpha Vantage
   └─ DB 저장        app/models.py ──▶ Supabase PostgreSQL (로컬: SQLite)
```

```
hs-portfolio/
├── run.py                  # 실행 진입점
├── config.py               # 설정 (환경변수)
├── requirements.txt
├── render.yaml             # Render 배포 설정
├── .env.example            # 환경변수 예시 (실제 .env는 저장소에 올리지 않음)
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
├── screenshots/            # README 화면 캡처
└── tests/test_api.py
```

---

## API

모든 응답은 `{"ok": true, "state": {...}}` 형식이며, 쓰기 요청 후에는 최신 화면 데이터를 함께 돌려줍니다.

| Method | Path | 설명 |
|---|---|---|
| GET | `/api/state` | 화면 전체 데이터 + 요약 계산 결과 |
| POST | `/api/{resource}` | 추가 (`stocks`, `trades`, `assets`, `debts`, `salaries`, `taxes`, `expenses`) |
| PUT | `/api/{resource}/{id}` | 수정 |
| DELETE | `/api/{resource}/{id}` | 삭제 |
| POST | `/api/stocks/{id}/refresh` | 해외주식 시세 갱신 (서버가 대신 조회) |
| PUT | `/api/settings` | 환율 변경 |
| GET | `/api/health` | 서버 상태 확인 |

**DB 테이블**: `stocks`, `trades`, `other_assets`(현금·예금·적금·기타), `debts`, `salaries`, `tax_items`, `fixed_expenses`, `settings`

---

## 보안·안정성

- **API 키 보호**: 시세 API 키는 서버 환경변수에만 두고 브라우저로 보내지 않음
- **입력 검증**: 서버에서 타입·길이·범위·선택지를 다시 검사하고, 허용되지 않은 필드는 거부
- **SQL Injection 방지**: ORM(SQLAlchemy)으로만 DB 접근
- **XSS 방지**: 사용자 입력은 `innerHTML` 대신 `textContent`로만 화면에 표시, CSP 헤더 적용
- **공개 데모 보호**: 쓰기 요청에 출처 확인 헤더 필수, IP당 분당 쓰기 횟수 제한, 테이블당 저장 개수 제한
- **시세 API 절약**: 같은 종목은 5분간 캐시, 여러 종목은 간격을 두고 순차 조회
- **샘플 데이터 중복 방지**: DB가 비어 있을 때 한 번만 넣고, 재배포해도 다시 넣지 않음
- **로깅**: 콘솔 + 파일 로그(`logs/app.log`, 자동 순환)

---

## 개발하며 해결한 문제

### 1. 배포 서버에서 DB 드라이버를 찾지 못함
- **증상**: PostgreSQL 연결 시 `No module named 'psycopg'` 오류
- **원인**: SQLAlchemy 2.1부터 주소에 드라이버를 지정하지 않으면 psycopg v3를 찾는데, 설치된 것은 psycopg2였음
- **해결**: 설정에서 DB 주소를 `postgresql+psycopg2://`로 바꿔 드라이버를 고정 (`config.py`)

### 2. Render에서 Supabase DB에 접속되지 않음
- **원인**: Supabase의 Direct connection 주소는 IPv6 전용인데, Render 무료 서버는 IPv6로 외부에 접속할 수 없음
- **해결**: IPv4를 지원하는 **Session pooler** 주소로 변경

### 3. 무료 서버 재시작 시 데이터가 사라지는 문제
- **원인**: Render 무료 서버는 재시작·재배포 때 서버 안의 파일(SQLite DB 포함)이 초기화됨
- **해결**: 데이터는 외부 DB(Supabase PostgreSQL)에 저장하고, 로컬 개발은 환경변수가 없으면 자동으로 SQLite를 쓰도록 분리

### 4. 시세 API 호출 한도
- **원인**: 무료 시세 API는 호출 횟수가 제한되어, 여러 종목을 한 번에 조회하면 한도에 걸림
- **해결**: 서버에서 같은 종목을 5분간 캐시하고, 화면에서는 종목을 1.2초 간격으로 순차 조회. 실패하면 원인을 한국어로 안내

---

## 로컬 실행 방법 (Mac 기준)

저장소를 내려받은 뒤(상단 **Code → Download ZIP** 또는 `git clone`), 프로젝트 폴더에서 실행합니다.

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

cp .env.example .env        # ALPHA_VANTAGE_API_KEY 입력 (없어도 실행됨, 시세 업데이트만 비활성)
python run.py
```

- 실행 후 브라우저에서 `127.0.0.1:5000`으로 접속합니다. 처음 실행하면 샘플 데이터가 자동으로 들어갑니다.
- `DATABASE_URL`을 비워 두면 로컬 SQLite(`instance/portfolio.db`)를 사용합니다.
- Mac에서 5000번 포트가 이미 사용 중이면(AirPlay 수신 등) `PORT=5001 python run.py`로 실행합니다.

테스트:

```bash
python -m pytest -q
```

---

## 배포 (Render + Supabase)

- **서버**: Render 무료 웹 서비스 (설정: `render.yaml`)
- **DB**: Supabase PostgreSQL (Session pooler 주소 사용)
- **환경변수**: `DATABASE_URL`, `ALPHA_VANTAGE_API_KEY`는 Render 대시보드에서만 입력하고 저장소에는 올리지 않음
- **실행 명령**: `gunicorn run:app --workers 1 --threads 4 --timeout 60 --bind 0.0.0.0:$PORT`
