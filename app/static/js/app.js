/**
 * HS Portfolio - 프론트엔드
 *
 * - 모든 데이터는 Flask API(/api/*)에서 받아오고, 수정 결과도 서버 DB에 저장한다.
 * - 사용자 입력은 innerHTML을 쓰지 않고 textContent로만 화면에 넣는다 (XSS 방지).
 */
(() => {
  "use strict";

  const API = "/api";
  const TABS = [
    ["dashboard", "나의 총 자산"],
    ["manage", "자산 관리"],
    ["stocks", "내 주식 내역"],
    ["trades", "거래 내역"],
  ];
  const PALETTE = ["#111111", "#4a4a48", "#7d7d79", "#a8a8a3", "#cfcfca", "#e6e6e2"];
  const SVG_NS = "http://www.w3.org/2000/svg";

  const app = {
    state: null,
    tab: "dashboard",
    busy: false,
    stockError: "",
    refreshing: false,
    refreshLabel: "",
    modalRender: null,
  };

  const $view = document.getElementById("view");
  const $tabs = document.getElementById("tabs");
  const $modalRoot = document.getElementById("modal-root");
  const $toastRoot = document.getElementById("toast-root");
  const $lastSync = document.getElementById("last-sync");

  // ------------------------------------------------------------------ DOM helper

  function h(tag, attrs, ...children) {
    const el = document.createElement(tag);
    if (attrs) {
      for (const [key, value] of Object.entries(attrs)) {
        if (value === null || value === undefined || value === false) continue;
        if (key === "class") el.className = value;
        else if (key === "text") el.textContent = value;
        else if (key.startsWith("on") && typeof value === "function") el.addEventListener(key.slice(2), value);
        else if (key === "value") el.value = value;
        else el.setAttribute(key, value === true ? "" : String(value));
      }
    }
    append(el, children);
    return el;
  }

  function append(el, children) {
    for (const child of children.flat(Infinity)) {
      if (child === null || child === undefined || child === false) continue;
      el.appendChild(child instanceof Node ? child : document.createTextNode(String(child)));
    }
  }

  // ------------------------------------------------------------------ format

  const krwFmt = new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 0 });
  const usdFmt = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const qtyFmt = new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 4 });

  function money(value, currency = "KRW") {
    const n = Number(value) || 0;
    const sign = n < 0 ? "-" : "";
    const abs = Math.abs(n);
    return currency === "USD" ? `${sign}$${usdFmt.format(abs)}` : `${sign}₩${krwFmt.format(Math.round(abs))}`;
  }
  function signedMoney(value) {
    const n = Number(value) || 0;
    if (Math.round(n) === 0) return money(0);
    return (n > 0 ? "+" : "-") + money(Math.abs(n));
  }
  function pct(value, digits = 1) {
    return `${(Number(value) || 0).toFixed(digits)}%`;
  }
  function arrowPct(value) {
    const n = Number(value) || 0;
    return `${n >= 0 ? "▲" : "▼"} ${Math.abs(n).toFixed(2)}%`;
  }
  function tone(value) {
    return (Number(value) || 0) >= 0 ? "up" : "down";
  }
  function timeText(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    return d.toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
  }
  function monthLabel(key) {
    const [y, m] = key.split("-");
    return `${y}년 ${Number(m)}월`;
  }

  // ------------------------------------------------------------------ API

  async function api(path, { method = "GET", body } = {}) {
    const options = { method, headers: { Accept: "application/json" } };
    if (method !== "GET") options.headers["X-Requested-With"] = "XMLHttpRequest";
    if (body !== undefined) {
      options.headers["Content-Type"] = "application/json";
      options.body = JSON.stringify(body);
    }

    let res;
    try {
      res = await fetch(API + path, options);
    } catch {
      throw new Error("서버에 연결하지 못했습니다. 네트워크를 확인해 주세요.");
    }
    let data = null;
    try {
      data = await res.json();
    } catch {
      data = null;
    }
    if (!res.ok || !data || data.ok === false) {
      throw new Error((data && data.error) || `요청을 처리하지 못했습니다. (${res.status})`);
    }
    return data;
  }

  /** 쓰기 요청 공통 처리. 성공 시 최신 상태로 화면 전체를 다시 그린다. */
  async function mutate(path, method, body, successMsg) {
    if (app.busy) return false;
    app.busy = true;
    try {
      const data = await api(path, { method, body });
      applyState(data.state);
      if (successMsg) toast(successMsg);
      return data;
    } catch (err) {
      toast(err.message, true);
      return false;
    } finally {
      app.busy = false;
    }
  }

  function applyState(state) {
    app.state = state;
    $lastSync.textContent = `동기화 ${new Date().toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })}`;
    render();
    if (app.modalRender) app.modalRender();
  }

  async function load() {
    try {
      const data = await api("/state");
      applyState(data.state);
    } catch (err) {
      $view.replaceChildren(
        h("div", { class: "error-state" },
          h("p", { text: err.message }),
          h("button", { class: "btn btn--dark", type: "button", onclick: load }, "다시 시도"))
      );
    }
  }

  // ------------------------------------------------------------------ toast

  function toast(message, isError = false) {
    const el = h("div", { class: `toast${isError ? " toast--error" : ""}`, role: isError ? "alert" : "status", text: message });
    $toastRoot.appendChild(el);
    setTimeout(() => el.remove(), isError ? 4200 : 2400);
  }

  // ------------------------------------------------------------------ modal

  function onModalKey(e) {
    if (e.key === "Escape") closeModal();
  }

  function openModal(build, { wide = false } = {}) {
    closeModal();
    const box = h("div", { class: `modal${wide ? " modal--wide" : ""}`, role: "dialog", "aria-modal": "true" });
    const backdrop = h("div", {
      class: "modal-backdrop",
      onmousedown: (e) => { if (e.target === backdrop) closeModal(); },
    }, box);

    app.modalRender = () => {
      const focusedName = document.activeElement && document.activeElement.name;
      box.replaceChildren(build());
      if (focusedName) {
        const again = box.querySelector(`[name="${CSS.escape(focusedName)}"]`);
        if (again) again.focus();
      }
    };
    app.modalRender();
    $modalRoot.replaceChildren(backdrop);
    document.addEventListener("keydown", onModalKey);
    const first = box.querySelector("input, select");
    if (first) first.focus();
  }

  function closeModal() {
    app.modalRender = null;
    $modalRoot.replaceChildren();
    document.removeEventListener("keydown", onModalKey);
  }

  function modalHead(title, desc) {
    return [
      h("div", { class: "modal__head" },
        h("h3", { class: "modal__title", text: title }),
        h("button", { class: "icon-btn", type: "button", "aria-label": "닫기", onclick: closeModal }, "×")),
      desc ? h("p", { class: "modal__desc", text: desc }) : null,
    ];
  }

  /**
   * 입력 필드 정의로 폼을 만든다.
   * field: { name, label, type: text|number|date|select, options, placeholder, value, required, full }
   */
  function buildFields(fields, cols = 2) {
    return h("div", { class: `form-grid${cols === 3 ? " form-grid--3" : ""}` },
      fields.map((f) => {
        const id = `f-${f.name}-${Math.random().toString(36).slice(2, 7)}`;
        let control;
        if (f.type === "select") {
          control = h("select", { class: "select", id, name: f.name },
            f.options.map((opt) => {
              const [val, label] = Array.isArray(opt) ? opt : [opt, opt];
              return h("option", { value: String(val), selected: String(val) === String(f.value ?? "") }, label);
            }));
        } else {
          control = h("input", {
            class: "input", id, name: f.name, type: f.type || "text",
            placeholder: f.placeholder || "", value: f.value ?? "",
            inputmode: f.type === "number" ? "decimal" : null,
            step: f.type === "number" ? "any" : null,
            min: f.type === "number" ? "0" : null,
            maxlength: f.type === "text" || !f.type ? String(f.max || 60) : null,
            autocomplete: "off",
          });
        }
        return h("div", { class: `field${f.full ? " field--full" : ""}` },
          h("label", { for: id, text: f.label + (f.required ? "" : " (선택)") }), control);
      }));
  }

  function readForm(form, fields) {
    const values = {};
    for (const f of fields) {
      const el = form.elements.namedItem(f.name);
      if (!el) continue;
      const raw = el.value.trim();
      if (f.required && !raw) {
        el.setAttribute("aria-invalid", "true");
        el.focus();
        throw new Error(`${f.label}을(를) 입력해 주세요.`);
      }
      el.removeAttribute("aria-invalid");
      if (f.type === "number") {
        if (raw === "") { values[f.name] = null; continue; }
        const n = Number(raw.replace(/,/g, ""));
        if (!Number.isFinite(n) || n < 0) {
          el.setAttribute("aria-invalid", "true");
          el.focus();
          throw new Error(`${f.label}은(는) 0 이상의 숫자로 입력해 주세요.`);
        }
        values[f.name] = n;
      } else {
        values[f.name] = raw === "" ? null : raw;
      }
    }
    return values;
  }

  /** 단순 추가용 모달 */
  function formModal({ title, desc, fields, submitLabel = "추가", danger = false, transform, onSubmit }) {
    openModal(() => {
      const form = h("form", { novalidate: true });
      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        let values;
        try {
          values = readForm(form, fields);
        } catch (err) {
          toast(err.message, true);
          return;
        }
        if (transform) values = transform(values);
        const ok = await onSubmit(values);
        if (ok) closeModal();
      });
      append(form, [
        buildFields(fields),
        h("div", { class: "modal__foot" },
          h("button", { class: `btn ${danger ? "btn--danger" : "btn--dark"}`, type: "submit" }, submitLabel),
          h("button", { class: "btn btn--line", type: "button", onclick: closeModal }, "취소")),
      ]);
      return h("div", null, modalHead(title, desc), form);
    });
  }

  function confirmDelete(path, label) {
    if (!window.confirm(`'${label}' 항목을 삭제할까요?\n다른 기기에서도 함께 삭제됩니다.`)) return;
    mutate(path, "DELETE", undefined, "삭제했습니다.");
  }

  // ------------------------------------------------------------------ 공통 UI 조각

  function card(title, value, ...body) {
    return h("section", { class: "card" },
      h("div", { class: "card__head" },
        h("h3", { class: "card__title", text: title }),
        value ? value : null),
      body);
  }

  function valueText(text, cls = "") {
    return h("span", { class: `card__value num ${cls}`, text });
  }

  function listRow(title, sub, right, rightCls = "") {
    return h("div", { class: "list-row" },
      h("div", { class: "list-row__main" },
        h("div", { class: "list-row__title", text: title }),
        sub ? h("div", { class: "list-row__sub", text: sub }) : null),
      h("div", { class: `list-row__right num ${rightCls}` }, right));
  }

  function sectionHead(title, count, ...buttons) {
    return h("div", { class: "section-head" },
      h("h2", null, title, count !== null && count !== undefined ? h("span", { class: "count", text: `(${count})` }) : null),
      h("div", { class: "actions" }, buttons));
  }

  function button(label, onclick, variant = "dark", extra = {}) {
    return h("button", { class: `btn btn--${variant}`, type: "button", onclick, ...extra }, label);
  }

  function donut(items) {
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("viewBox", "0 0 200 200");
    svg.setAttribute("class", "donut");
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", "자산 비중 도넛 차트");

    const total = items.reduce((s, i) => s + i.value, 0);
    const r = 72;
    const c = 2 * Math.PI * r;

    const base = document.createElementNS(SVG_NS, "circle");
    base.setAttribute("cx", "100"); base.setAttribute("cy", "100"); base.setAttribute("r", String(r));
    base.setAttribute("fill", "none"); base.setAttribute("stroke", "#f3f3f0"); base.setAttribute("stroke-width", "26");
    svg.appendChild(base);

    let offset = 0;
    if (total > 0) {
      items.forEach((item, i) => {
        const len = (item.value / total) * c;
        const seg = document.createElementNS(SVG_NS, "circle");
        seg.setAttribute("cx", "100"); seg.setAttribute("cy", "100"); seg.setAttribute("r", String(r));
        seg.setAttribute("fill", "none");
        seg.setAttribute("stroke", PALETTE[i % PALETTE.length]);
        seg.setAttribute("stroke-width", "26");
        seg.setAttribute("stroke-dasharray", `${len} ${c - len}`);
        seg.setAttribute("stroke-dashoffset", String(-offset));
        seg.setAttribute("transform", "rotate(-90 100 100)");
        svg.appendChild(seg);
        offset += len;
      });
    }

    const t1 = document.createElementNS(SVG_NS, "text");
    t1.setAttribute("x", "100"); t1.setAttribute("y", "96"); t1.setAttribute("text-anchor", "middle");
    t1.setAttribute("font-size", "12"); t1.setAttribute("fill", "#8a8a86");
    t1.textContent = "총 자산";
    const t2 = document.createElementNS(SVG_NS, "text");
    t2.setAttribute("x", "100"); t2.setAttribute("y", "116"); t2.setAttribute("text-anchor", "middle");
    t2.setAttribute("font-size", "16"); t2.setAttribute("font-weight", "700"); t2.setAttribute("fill", "#111111");
    t2.textContent = total >= 1e8 ? `${(total / 1e8).toFixed(2)}억` : `${krwFmt.format(Math.round(total / 1e4))}만`;
    svg.append(t1, t2);
    return svg;
  }

  // ------------------------------------------------------------------ 탭: 나의 총 자산

  function renderDashboard() {
    const { summary: sm, stocks, assets, debts } = app.state;
    const cash = assets.filter((a) => a.category === "현금");
    const savings = assets.filter((a) => a.category === "예금" || a.category === "적금");
    const etc = assets.filter((a) => !["현금", "예금", "적금"].includes(a.category));

    const hero = h("section", { class: "hero" },
      h("div", { class: "hero__label", text: "MY NET WORTH · 순자산" }),
      h("div", { class: "hero__value num", text: money(sm.net_worth) }),
      h("div", { class: "hero__stats" },
        heroStat("총 자산", money(sm.asset_total)),
        heroStat("총 부채", money(-sm.debt_total)),
        heroStat("주식 평가손익", `${signedMoney(sm.pnl)} (${arrowPct(sm.pnl_pct)})`),
        heroStat("이번 달 가용 금액", money(sm.available))));

    const allocation = card("자산 비중", null,
      sm.allocation.length === 0
        ? h("div", { class: "empty", text: "자산을 추가하면 비중이 표시됩니다." })
        : h("div", { class: "donut-wrap" },
          donut(sm.allocation),
          h("div", { class: "legend" }, sm.allocation.map((a, i) => {
            const dot = h("span", { class: "dot" });
            dot.style.background = PALETTE[i % PALETTE.length];
            return h("div", { class: "legend__row" },
              h("span", { class: "legend__name" }, dot, a.name),
              h("span", { class: "num muted", text: pct(a.pct) }));
          }))));

    const stockCard = card("📈 주식·ETF", valueText(money(sm.stock_total)),
      stocks.length === 0
        ? h("div", { class: "empty", text: "보유 주식 없음" })
        : stocks.map((s) => listRow(
          s.name, `${s.ticker || s.category} · ${qtyFmt.format(s.qty)}주`,
          [h("div", { text: money(s.value_krw) }), h("div", { class: `small ${tone(s.pnl_pct)}`, text: arrowPct(s.pnl_pct) })])));

    const simpleList = (items, emptyText, showCategory, negative = false) =>
      items.length === 0
        ? h("div", { class: "empty", text: emptyText })
        : items.map((a) => listRow(a.name, showCategory ? a.category : a.note, money(negative ? -a.amount : a.amount), negative ? "down" : ""));

    const salaryCard = card(`💵 급여 요약 (${monthLabel(sm.month)})`, valueText(money(sm.available), tone(sm.available)),
      h("div", { class: "kv" }, h("span", { class: "muted", text: "이번 달 총 급여" }), h("span", { class: "num", text: money(sm.salary_month) })),
      h("div", { class: "kv" }, h("span", { class: "muted", text: "총 공제액" }), h("span", { class: "num down", text: money(-sm.tax_total) })),
      h("div", { class: "kv" }, h("span", { class: "muted", text: "실수령액" }), h("span", { class: "num", text: money(sm.net_salary) })),
      h("div", { class: "kv" }, h("span", { class: "muted", text: "고정 지출" }), h("span", { class: "num warn", text: money(-sm.expense_total) })),
      h("div", { class: "kv kv--total" }, h("span", { text: "가용 금액" }), h("span", { class: `num ${tone(sm.available)}`, text: money(sm.available) })));

    return h("div", null,
      hero,
      h("div", { class: "grid" },
        allocation,
        stockCard,
        card("💵 현금", valueText(money(sm.cash_total)), simpleList(cash, "현금 내역 없음", false)),
        card("🏦 예금·적금", valueText(money(sm.savings_total)), simpleList(savings, "예금·적금 내역 없음", true)),
        etc.length ? card("📦 기타 자산", valueText(money(sm.etc_total)), simpleList(etc, "", true)) : null,
        card("💳 부채", valueText(money(-sm.debt_total), "down"), simpleList(debts, "부채 없음", true, true)),
        salaryCard));
  }

  function heroStat(label, value) {
    return h("div", null,
      h("div", { class: "hero__stat-label", text: label }),
      h("div", { class: "hero__stat-value num", text: value }));
  }

  // ------------------------------------------------------------------ 탭: 자산 관리

  function renderManage() {
    const { summary: sm, assets, debts, expenses, taxes, meta } = app.state;

    // 급여 관리 카드
    const quickForm = h("form", { class: "inline-form", novalidate: true });
    const quickFields = [
      { name: "amount", label: "금액 (원)", type: "number", required: true, placeholder: "입금된 급여" },
      { name: "source", label: "출처", placeholder: "예: 본업, 부업, 사업", max: 40 },
    ];
    quickForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      let values;
      try { values = readForm(quickForm, quickFields); } catch (err) { toast(err.message, true); return; }
      if (!(values.amount > 0)) { toast("금액은 0보다 커야 합니다.", true); return; }
      const ok = await mutate("/salaries", "POST", { ...values, date: app.state.today }, "급여를 추가했습니다.");
      if (ok) quickForm.reset();
    });
    append(quickForm, [
      quickFields.map((f) => h("div", { class: "field" },
        h("label", { text: f.label + (f.required ? "" : " (선택)") }),
        h("input", {
          class: "input", name: f.name, type: f.type || "text", placeholder: f.placeholder,
          inputmode: f.type === "number" ? "decimal" : null, step: f.type === "number" ? "any" : null,
          min: f.type === "number" ? "0" : null, maxlength: f.max ? String(f.max) : null, autocomplete: "off",
        }))),
      h("button", { class: "btn btn--dark", type: "submit" }, "오늘 날짜로 추가"),
    ]);

    let growthLine = null;
    if (sm.salary_growth !== null) {
      growthLine = h("p", { class: "small muted" },
        "지난달 대비 ",
        h("span", { class: `num ${tone(sm.salary_growth)}`, text: `${sm.salary_growth >= 0 ? "+" : ""}${sm.salary_growth.toFixed(1)}%` }),
        ` (지난달 ${money(sm.salary_prev)})`);
    }

    const salaryCard = h("section", { class: "card" },
      h("div", { class: "card__head" },
        h("h3", { class: "card__title", text: "💵 급여 관리" }),
        h("div", { class: "actions" },
          button("📅 급여 기록", openSalaryRecords, "soft"),
          button("⚙️ 세금 항목 관리", openTaxModal, "soft"))),
      h("p", { class: "card__desc", text: "급여가 들어올 때마다 추가하면 이번 달 금액에 합산되고, 날짜별로 기록됩니다." }),
      h("div", { class: "tiles" },
        tile("이번 달 총 급여", money(sm.salary_month)),
        tile("총 공제액", money(-sm.tax_total), "down"),
        tile("실수령액", money(sm.net_salary)),
        tile("고정 지출", money(-sm.expense_total), "warn"),
        tile("가용 금액", money(sm.available), tone(sm.available))),
      growthLine,
      taxes.length ? h("div", { class: "subbox" },
        h("div", { class: "subbox__title", text: "공제 항목" }),
        taxes.map((t) => h("div", { class: "kv" }, h("span", { text: t.name }), h("span", { class: "num down", text: money(-t.amount) })))) : null,
      h("div", { class: "subbox" }, quickForm));

    // 항목 리스트 공통
    const itemList = (items, emptyText, resource, { negative = false, valueCls = "", tagCls = "" } = {}) =>
      items.length === 0
        ? h("div", { class: "empty-box", text: emptyText })
        : items.map((it) => h("div", { class: "item" },
          h("div", { class: "item__main" },
            h("div", { class: "item__title" }, it.name, h("span", { class: `tag ${tagCls}`, text: it.category })),
            it.note ? h("div", { class: "item__sub", text: it.note }) : null),
          h("div", { class: "item__value" }, h("strong", { class: `num ${valueCls}`, text: money(negative ? -it.amount : it.amount) })),
          h("div", { class: "item__actions" },
            button("삭제", () => confirmDelete(`/${resource}/${it.id}`, it.name), "danger"))));

    const assetForm = (category, title) => formModal({
      title,
      desc: `카테고리: ${category}`,
      fields: [
        { name: "name", label: "이름", required: true, full: true,
          placeholder: category === "현금" ? "예: 지갑, 입출금 통장" : category === "적금" ? "예: 청년 적금" : "예: 정기예금" },
        { name: "amount", label: "금액 (원)", type: "number", required: true },
        { name: "note", label: "메모", max: 200 },
      ],
      transform: (v) => ({ ...v, category }),
      onSubmit: (v) => mutate("/assets", "POST", v, "추가했습니다."),
    });

    const etcCategories = meta.asset_categories.filter((c) => !["현금", "예금", "적금"].includes(c));

    const cash = assets.filter((a) => a.category === "현금");
    const savings = assets.filter((a) => a.category === "예금" || a.category === "적금");
    const etc = assets.filter((a) => etcCategories.includes(a.category));

    return h("div", null,
      salaryCard,

      sectionHead("🔄 고정 지출", expenses.length,
        button("+ 지출 추가", () => formModal({
          title: "고정 지출 추가",
          desc: "매달 나가는 금액을 입력하면 가용 금액에서 차감됩니다.",
          fields: [
            { name: "name", label: "지출명", required: true, placeholder: "예: 월세, 구독료" },
            { name: "category", label: "카테고리", type: "select", options: meta.expense_categories, value: meta.expense_categories[0], required: true },
            { name: "amount", label: "금액 (원/월)", type: "number", required: true },
            { name: "note", label: "메모", max: 200 },
          ],
          onSubmit: (v) => mutate("/expenses", "POST", v, "추가했습니다."),
        }))),
      itemList(expenses, "월세, 구독료, 보험료 등을 추가해 주세요.", "expenses", { negative: true, valueCls: "warn" }),

      sectionHead("💵 현금", cash.length, button("+ 현금 추가", () => assetForm("현금", "💵 현금 추가"))),
      itemList(cash, "보유 현금을 추가해 주세요.", "assets"),

      sectionHead("🏦 예금·적금", savings.length,
        button("+ 예금 추가", () => assetForm("예금", "🏦 예금 추가")),
        button("+ 적금 추가", () => assetForm("적금", "🏦 적금 추가"))),
      itemList(savings, "예금·적금 내역을 추가해 주세요.", "assets"),

      sectionHead("📦 기타 자산", etc.length,
        button("+ 기타 추가", () => formModal({
          title: "📦 기타 자산 추가",
          fields: [
            { name: "name", label: "이름", required: true, placeholder: "예: 자동차" },
            { name: "category", label: "카테고리", type: "select", options: etcCategories, value: etcCategories[0], required: true },
            { name: "amount", label: "금액 (원)", type: "number", required: true },
            { name: "note", label: "메모", max: 200 },
          ],
          onSubmit: (v) => mutate("/assets", "POST", v, "추가했습니다."),
        }))),
      itemList(etc, "부동산, 자동차 등 기타 자산을 추가해 주세요.", "assets"),

      sectionHead("💳 부채", debts.length,
        button("+ 부채 추가", () => formModal({
          title: "💳 부채 추가",
          fields: [
            { name: "name", label: "부채명", required: true, placeholder: "예: 학자금 대출" },
            { name: "category", label: "카테고리", type: "select", options: meta.debt_categories, value: meta.debt_categories[1] || meta.debt_categories[0], required: true },
            { name: "amount", label: "금액 (원)", type: "number", required: true },
            { name: "note", label: "메모", max: 200 },
          ],
          onSubmit: (v) => mutate("/debts", "POST", v, "추가했습니다."),
        }))),
      itemList(debts, "대출, 카드값 등을 추가해 주세요.", "debts", { negative: true, valueCls: "down", tagCls: "tag--down" }));
  }

  function tile(label, value, cls = "") {
    return h("div", { class: "tile" },
      h("div", { class: "tile__label", text: label }),
      h("div", { class: `tile__value num ${cls}`, text: value }));
  }

  // ---- 급여 기록 모달 (월별 기록 확인·추가·수정·삭제)

  function openSalaryRecords() {
    const now = new Date(`${app.state.today}T00:00:00`);
    const ui = {
      adding: false,
      editingId: null,
      year: now.getFullYear(),
      month: now.getMonth() + 1,
      day: now.getDate(),
      draft: {},
    };

    openModal(() => {
      const { salaries, summary } = app.state;

      const addBtn = button(ui.adding ? "닫기" : "+ 추가하기", () => { ui.adding = !ui.adding; app.modalRender(); }, ui.adding ? "line" : "dark");
      const head = h("div", { class: "modal__head" },
        h("h3", { class: "modal__title", text: "📅 급여 기록" }),
        h("div", { class: "actions" }, addBtn,
          h("button", { class: "icon-btn", type: "button", "aria-label": "닫기", onclick: closeModal }, "×")));

      const nodes = [head, h("p", { class: "modal__desc", text: "월별 급여를 확인하고, 과거 급여도 연·월·일을 골라 기록할 수 있습니다." })];

      if (ui.adding) nodes.push(salaryAddForm(ui));

      // 월별 그룹
      const byMonth = new Map();
      for (const s of salaries) {
        const key = s.date.slice(0, 7);
        if (!byMonth.has(key)) byMonth.set(key, []);
        byMonth.get(key).push(s);
      }
      const totals = new Map(summary.salary_monthly.map((m) => [m.month, m.total]));
      const months = [...byMonth.keys()].sort().reverse();

      if (months.length === 0) {
        nodes.push(h("div", { class: "empty-box", text: "급여 기록이 없습니다." }));
      }

      months.forEach((key) => {
        const total = totals.get(key) || 0;
        // 바로 이전 달(달력 기준) 기록이 있을 때만 증감률 표시
        const prevTotal = totals.get(prevMonthKey(key)) || 0;
        const growth = prevTotal > 0 ? ((total - prevTotal) / prevTotal) * 100 : null;
        nodes.push(h("div", { class: "month-group" },
          h("div", { class: "month-group__head" },
            h("strong", { text: monthLabel(key) }),
            h("span", null,
              growth !== null ? h("span", { class: `small num ${tone(growth)}`, text: `${growth >= 0 ? "+" : ""}${growth.toFixed(1)}%  ` }) : null,
              h("strong", { class: "num", text: money(total) }))),
          byMonth.get(key).map((item) => (ui.editingId === item.id ? salaryEditRow(item, ui) : salaryRow(item, ui)))));
      });

      nodes.push(h("div", { class: "modal__foot" }, button("닫기", closeModal, "line")));
      return h("div", null, nodes);
    }, { wide: true });
  }

  function prevMonthKey(key) {
    let [y, m] = key.split("-").map(Number);
    m -= 1;
    if (m === 0) { m = 12; y -= 1; }
    return `${y}-${String(m).padStart(2, "0")}`;
  }

  function daysInMonth(y, m) {
    return new Date(y, m, 0).getDate();
  }

  function salaryAddForm(ui) {
    const thisYear = new Date(`${app.state.today}T00:00:00`).getFullYear();
    const years = [];
    for (let y = thisYear - 5; y <= thisYear; y += 1) years.push(y);
    const maxDay = daysInMonth(ui.year, ui.month);
    if (ui.day > maxDay) ui.day = maxDay;

    const selectNum = (name, list, value, suffix) => {
      const el = h("select", { class: "select", name },
        list.map((v) => h("option", { value: String(v), selected: v === value }, `${v}${suffix}`)));
      el.addEventListener("change", () => { ui[name] = Number(el.value); app.modalRender(); });
      return el;
    };
    const range = (n) => Array.from({ length: n }, (_, i) => i + 1);
    // 연·월·일을 바꾸면 화면을 다시 그리므로, 입력 중인 값은 ui.draft에 보관해 유지한다.
    const draftInput = (attrs) => h("input", {
      class: "input", autocomplete: "off", ...attrs,
      value: ui.draft[attrs.name] || "",
      oninput: (e) => { ui.draft[attrs.name] = e.target.value; },
    });

    const form = h("form", { class: "subbox", novalidate: true });
    const fields = [
      { name: "amount", label: "금액 (원)", type: "number", required: true },
      { name: "source", label: "출처" },
      { name: "note", label: "메모" },
    ];
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      let values;
      try { values = readForm(form, fields); } catch (err) { toast(err.message, true); return; }
      if (!(values.amount > 0)) { toast("금액은 0보다 커야 합니다.", true); return; }
      const date = `${ui.year}-${String(ui.month).padStart(2, "0")}-${String(ui.day).padStart(2, "0")}`;
      const ok = await mutate("/salaries", "POST", { ...values, date }, "급여 기록을 추가했습니다.");
      if (ok) { ui.adding = false; ui.draft = {}; app.modalRender(); }
    });

    append(form, [
      h("div", { class: "subbox__title", text: "급여 추가" }),
      h("div", { class: "form-grid form-grid--3" },
        h("div", { class: "field" }, h("label", { text: "연도" }), selectNum("year", years, ui.year, "년")),
        h("div", { class: "field" }, h("label", { text: "월" }), selectNum("month", range(12), ui.month, "월")),
        h("div", { class: "field" }, h("label", { text: "일" }), selectNum("day", range(maxDay), ui.day, "일"))),
      h("div", { class: "form-grid" },
        h("div", { class: "field field--full" }, h("label", { text: "금액 (원)" }),
          draftInput({ name: "amount", type: "number", inputmode: "decimal", step: "any", min: "0", placeholder: "급여 금액" })),
        h("div", { class: "field" }, h("label", { text: "출처 (선택)" }),
          draftInput({ name: "source", maxlength: "40", placeholder: "예: 본업, 부업" })),
        h("div", { class: "field" }, h("label", { text: "메모 (선택)" }),
          draftInput({ name: "note", maxlength: "200" }))),
      h("div", { class: "modal__foot" }, h("button", { class: "btn btn--dark", type: "submit" }, "저장")),
    ]);
    return form;
  }

  function salaryRow(item, ui) {
    const meta = [item.date, item.source, item.note].filter(Boolean).join(" · ");
    return h("div", { class: "record" },
      h("div", null,
        h("div", { class: "num", text: money(item.amount) }),
        h("div", { class: "small muted", text: meta })),
      h("div", { class: "item__actions" },
        button("수정", () => { ui.editingId = item.id; app.modalRender(); }, "soft"),
        button("삭제", () => confirmDelete(`/salaries/${item.id}`, `${item.date} ${money(item.amount)}`), "danger")));
  }

  function salaryEditRow(item, ui) {
    const fields = [
      { name: "amount", label: "금액 (원)", type: "number", required: true, value: item.amount },
      { name: "date", label: "날짜", type: "date", required: true, value: item.date },
      { name: "source", label: "출처", value: item.source || "", max: 40 },
      { name: "note", label: "메모", value: item.note || "", max: 200 },
    ];
    const form = h("form", { class: "record record--editing", novalidate: true });
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      let values;
      try { values = readForm(form, fields); } catch (err) { toast(err.message, true); return; }
      if (!(values.amount > 0)) { toast("금액은 0보다 커야 합니다.", true); return; }
      const ok = await mutate(`/salaries/${item.id}`, "PUT", values, "수정했습니다.");
      if (ok) { ui.editingId = null; app.modalRender(); }
    });
    append(form, [
      buildFields(fields),
      h("div", { class: "modal__foot" },
        h("button", { class: "btn btn--dark", type: "submit" }, "저장"),
        button("취소", () => { ui.editingId = null; app.modalRender(); }, "line")),
    ]);
    return form;
  }

  // ---- 세금 항목 모달

  function openTaxModal() {
    openModal(() => {
      const { taxes, summary } = app.state;
      const fields = [
        { name: "name", label: "항목명", required: true, placeholder: "예: 건강보험, 국민연금, 소득세", max: 40 },
        { name: "amount", label: "금액 (원/월)", type: "number", required: true },
      ];
      const form = h("form", { class: "subbox", novalidate: true });
      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        let values;
        try { values = readForm(form, fields); } catch (err) { toast(err.message, true); return; }
        const ok = await mutate("/taxes", "POST", values, "공제 항목을 추가했습니다.");
        if (ok) form.reset();
      });
      append(form, [
        h("div", { class: "subbox__title", text: "+ 항목 추가" }),
        buildFields(fields),
        h("div", { class: "modal__foot" }, h("button", { class: "btn btn--dark", type: "submit" }, "추가")),
      ]);

      return h("div", null,
        modalHead("⚙️ 세금 항목 관리", "건강보험, 국민연금 등 매달 공제되는 항목을 관리합니다."),
        taxes.length === 0
          ? h("div", { class: "empty-box", text: "등록된 공제 항목이 없습니다." })
          : h("div", null,
            taxes.map((t) => h("div", { class: "record" },
              h("span", { text: t.name }),
              h("span", { class: "item__actions" },
                h("span", { class: "num down", text: money(-t.amount) }),
                button("삭제", () => confirmDelete(`/taxes/${t.id}`, t.name), "danger")))),
            h("div", { class: "kv kv--total" }, h("span", { text: "합계" }), h("span", { class: "num down", text: money(-summary.tax_total) }))),
        form,
        h("div", { class: "modal__foot" }, button("완료", closeModal, "line")));
    });
  }

  // ------------------------------------------------------------------ 탭: 내 주식 내역

  function renderStocks() {
    const { stocks, meta } = app.state;
    const hasTicker = stocks.some((s) => s.ticker);

    const refreshBtn = button(app.refreshing ? app.refreshLabel : "🔄 시세 업데이트", refreshAll, "line",
      { disabled: app.refreshing || !hasTicker });

    return h("div", null,
      sectionHead("내 주식 내역", stocks.length,
        refreshBtn,
        button("+ 주식 추가", () => formModal({
          title: "주식 추가",
          desc: "해외주식은 티커(예: AAPL)를 입력하면 실시간 시세를 불러올 수 있습니다.",
          fields: [
            { name: "name", label: "종목명", required: true, placeholder: "예: 애플" },
            { name: "ticker", label: "티커", placeholder: "예: AAPL", max: 12 },
            { name: "category", label: "카테고리", type: "select", options: meta.stock_categories, value: "주식(해외)", required: true },
            { name: "currency", label: "통화", type: "select", options: [["USD", "USD (달러)"], ["KRW", "KRW (원)"]], value: "USD", required: true },
            { name: "buy_price", label: "매입가 (1주)", type: "number", required: true },
            { name: "current_price", label: "현재가", type: "number", placeholder: "비우면 매입가로 설정" },
            { name: "qty", label: "수량", type: "number", required: true, full: true },
          ],
          onSubmit: (v) => mutate("/stocks", "POST", v, "주식을 추가했습니다."),
        }))),
      app.stockError ? h("div", { class: "alert alert--error", role: "alert", text: app.stockError }) : null,
      stocks.length === 0
        ? h("div", { class: "empty-box", text: "보유 주식을 추가해 주세요." })
        : stocks.map((s) => h("div", { class: "item" },
          h("div", { class: "item__main" },
            h("div", { class: "item__title" },
              s.name,
              h("span", { class: "tag", text: s.category }),
              s.ticker ? h("span", { class: "tag", text: s.ticker }) : null,
              s.price_updated_at ? h("span", { class: "tag tag--up", text: `시세 ${timeText(s.price_updated_at)}` }) : null),
            h("div", { class: "item__sub num", text: `보유 ${qtyFmt.format(s.qty)}주 · 매입가 ${money(s.buy_price, s.currency)} · 현재가 ${money(s.current_price, s.currency)}` })),
          h("div", { class: "item__value" },
            h("strong", { class: "num", text: money(s.value_krw) }),
            h("div", { class: `small num ${tone(s.pnl_krw)}`, text: `${arrowPct(s.pnl_pct)} (${signedMoney(s.pnl_krw)})` })),
          h("div", { class: "item__actions" },
            s.ticker ? button("🔄", () => refreshOne(s), "soft", { "aria-label": `${s.name} 시세 업데이트`, disabled: app.refreshing }) : null,
            button("삭제", () => confirmDelete(`/stocks/${s.id}`, s.name), "danger")))),
      exchangeRateCard());
  }

  async function refreshOne(stock) {
    app.stockError = "";
    const res = await refreshRequest(stock);
    if (res.ok) toast(`${stock.name} 시세를 업데이트했습니다.`);
    render();
  }

  async function refreshRequest(stock) {
    try {
      const data = await api(`/stocks/${stock.id}/refresh`, { method: "POST" });
      app.state = data.state;
      return { ok: true };
    } catch (err) {
      app.stockError = `⚠️ ${stock.name}: ${err.message}`;
      return { ok: false, message: err.message };
    }
  }

  /** 무료 API 호출 한도를 고려해 한 종목씩 간격을 두고 조회한다. */
  async function refreshAll() {
    if (app.refreshing) return;
    const targets = app.state.stocks.filter((s) => s.ticker);
    if (targets.length === 0) return;

    app.refreshing = true;
    app.stockError = "";
    let success = 0;
    for (let i = 0; i < targets.length; i += 1) {
      app.refreshLabel = `업데이트 중 (${i + 1}/${targets.length})`;
      render();
      const res = await refreshRequest(targets[i]);
      if (res.ok) success += 1;
      else if (res.message && res.message.includes("한도")) break;
      if (i < targets.length - 1) await new Promise((r) => setTimeout(r, 1200));
    }
    app.refreshing = false;
    app.refreshLabel = "";
    render();
    if (success > 0) toast(`${success}개 종목 시세를 업데이트했습니다.`);
  }

  // ------------------------------------------------------------------ 탭: 거래 내역

  function renderTrades() {
    const { trades, meta, today } = app.state;
    return h("div", null,
      sectionHead("거래 내역", trades.length,
        button("+ 거래 추가", () => formModal({
          title: "거래 내역 추가",
          fields: [
            { name: "date", label: "날짜", type: "date", required: true, value: today },
            { name: "type", label: "거래 유형", type: "select", options: meta.trade_types, value: meta.trade_types[0], required: true },
            { name: "asset_name", label: "자산명", required: true, placeholder: "예: 애플", full: true },
            { name: "price", label: "단가", type: "number", required: true },
            { name: "qty", label: "수량", type: "number", required: true },
            { name: "note", label: "메모", max: 200, full: true },
          ],
          onSubmit: (v) => mutate("/trades", "POST", v, "거래를 기록했습니다."),
        }))),
      trades.length === 0
        ? h("div", { class: "empty-box", text: "아직 거래 내역이 없습니다." })
        : trades.map((t) => {
          const positive = t.type === "매수" || t.type === "입금";
          return h("div", { class: "item" },
            h("div", { class: "item__main" },
              h("div", { class: "item__title" }, t.asset_name, h("span", { class: `tag ${positive ? "tag--up" : "tag--down"}`, text: t.type })),
              h("div", { class: "item__sub num", text: [t.date, `${qtyFmt.format(t.qty)}주 × ${krwFmt.format(t.price)}`, t.note].filter(Boolean).join(" · ") })),
            h("div", { class: "item__value" }, h("strong", { class: "num", text: krwFmt.format(Math.round(t.price * t.qty)) })),
            h("div", { class: "item__actions" },
              button("삭제", () => confirmDelete(`/trades/${t.id}`, `${t.date} ${t.asset_name}`), "danger")));
        }));
  }

  // ------------------------------------------------------------------ 환율 설정 (내 주식 내역 하단)

  function exchangeRateCard() {
    const { settings } = app.state;
    const form = h("form", { class: "inline-form", novalidate: true });
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const input = form.elements.namedItem("usd_krw");
      const n = Number(String(input.value).replace(/,/g, "").trim());
      if (!Number.isFinite(n) || n <= 0) {
        input.setAttribute("aria-invalid", "true");
        toast("환율은 0보다 큰 숫자로 입력해 주세요.", true);
        return;
      }
      input.removeAttribute("aria-invalid");
      const ok = await mutate("/settings", "PUT", { usd_krw: n }, "환율을 변경했습니다.");
      if (ok) form.reset();
    });
    append(form, [
      h("div", { class: "field" },
        h("label", { text: `환율 (현재 ${krwFmt.format(settings.usd_krw)}원/달러)` }),
        h("input", { class: "input", name: "usd_krw", type: "number", inputmode: "decimal", step: "any", min: "0", placeholder: String(settings.usd_krw), autocomplete: "off" })),
      h("button", { class: "btn btn--dark", type: "submit" }, "저장"),
    ]);
    return h("section", { class: "card card--spaced" },
      h("div", { class: "card__head" }, h("h3", { class: "card__title", text: "💱 환율 (USD → KRW)" })),
      h("p", { class: "card__desc", text: "달러로 매입한 주식을 원화로 환산할 때 사용합니다." }),
      form);
  }

  // ------------------------------------------------------------------ render

  const RENDERERS = {
    dashboard: renderDashboard,
    manage: renderManage,
    stocks: renderStocks,
    trades: renderTrades,
  };

  function renderTabs() {
    $tabs.replaceChildren(...TABS.map(([key, label]) =>
      h("button", {
        class: "tab", type: "button", role: "tab",
        "aria-selected": key === app.tab ? "true" : "false",
        onclick: () => {
          if (app.tab === key) return;
          app.tab = key;
          try { localStorage.setItem("hs_tab", key); } catch { /* 저장 불가 환경 무시 */ }
          render();
          window.scrollTo({ top: 0 });
        },
      }, label)));
  }

  function render() {
    renderTabs();
    if (!app.state) return;
    try {
      $view.replaceChildren(RENDERERS[app.tab]());
    } catch (err) {
      console.error(err);
      $view.replaceChildren(h("div", { class: "error-state", text: "화면을 그리는 중 오류가 발생했습니다. 새로고침해 주세요." }));
    }
  }

  try {
    const saved = localStorage.getItem("hs_tab");
    if (saved && RENDERERS[saved]) app.tab = saved;
  } catch { /* 무시 */ }

  renderTabs();
  load();
})();
