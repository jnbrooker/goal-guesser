// Quizlet-style "Test": a whole paper of mixed questions, marked at the end.

import { DB, clubsIn, seasonTotal } from "../data.js";
import { record, prefs } from "../store.js";
import { $, $$, esc, clubTag, filterPanel, loadFilter, goalOptions, grade, shuffle, pick } from "../ui.js";

const TYPES = {
  written: "Written",
  choice: "Multiple choice",
  truefalse: "True / false",
  more: "Who scored more",
  club: "Which club",
};

export function render(el, params) {
  const filter = loadFilter("test", params, 5);
  const cfg = { n: 20, types: Object.keys(TYPES), ...prefs.get("test-cfg", {}) };
  let pool = [], questions = [];

  el.innerHTML = `
    <div class="studywrap">
      <div class="pagehead"><h1>Test</h1><span class="sub">Answer everything, then submit to get marked. Typed answers within one goal earn half a mark.</span></div>
      <div id="t-filter"></div>
      <div id="t-body"></div>
    </div>`;

  const extra = () => `
    <div class="ctl"><label for="t-n">Questions</label><select id="t-n">
      ${[10, 20, 30, 50].map((n) => `<option value="${n}"${n === cfg.n ? " selected" : ""}>${n}</option>`).join("")}
    </select></div>
    <div class="ctl"><span class="lbl">Question types</span><div class="btnrow">
      ${Object.entries(TYPES).map(([k, v]) => `<span class="chip${cfg.types.includes(k) ? " on" : ""}" data-type="${k}">${v}</span>`).join("")}
    </div></div>
    <div class="ctl"><span class="lbl">&nbsp;</span><button class="btn" id="t-new">New test</button></div>`;

  filterPanel($("#t-filter", el), "test", filter, (f, rows) => {
    pool = rows;
    $("#t-n", el).onchange = (e) => { cfg.n = +e.target.value; save(); };
    $$("[data-type]", el).forEach((c) => (c.onclick = () => {
      const k = c.dataset.type;
      if (cfg.types.includes(k)) { if (cfg.types.length > 1) cfg.types = cfg.types.filter((t) => t !== k); }
      else cfg.types.push(k);
      $$("[data-type]", el).forEach((x) => x.classList.toggle("on", cfg.types.includes(x.dataset.type)));
      save();
    }));
    $("#t-new", el).onclick = newTest;
    newTest();
  }, extra());

  function save() { prefs.set("test-cfg", cfg); }

  function newTest() {
    const body = $("#t-body", el);
    if (pool.length < 4) {
      body.innerHTML = `<div class="empty">Need at least 4 cards in the deck to build a test — widen the filter.</div>`;
      return;
    }
    const rows = shuffle(pool);
    questions = [];
    for (let i = 0; questions.length < Math.min(cfg.n, pool.length) && i < rows.length * 3; i++) {
      const q = makeQuestion(pick(cfg.types), rows[i % rows.length], pool);
      if (q && !questions.some((x) => x.text === q.text)) questions.push(q);
    }
    body.innerHTML = `
      <form id="t-form">
        ${questions.map((q, i) => `
          <div class="testq" data-q="${i}">
            <div class="qn"><span>${i + 1}. ${TYPES[q.type].toUpperCase()}</span><span data-mark></span></div>
            <div class="qbody">
              <div class="qtext">${q.text}</div>
              ${q.options
                ? `<div class="options">${q.options.map((o, k) => `<button type="button" class="opt" data-k="${k}">${o.label}</button>`).join("")}</div>`
                : `<input type="number" min="0" inputmode="numeric" placeholder="Goals" data-input>`}
              <div class="correction" data-corr></div>
            </div>
          </div>`).join("")}
        <div class="btnrow"><button class="btn lg">Submit test</button>
          <span class="muted small" id="t-unanswered"></span></div>
      </form>
      <div id="t-result"></div>`;
    $$(".testq", body).forEach((qel) => {
      const q = questions[+qel.dataset.q];
      $$(".opt", qel).forEach((b) => (b.onclick = () => {
        if (q.marked) return;
        q.picked = +b.dataset.k;
        $$(".opt", qel).forEach((x) => x.classList.toggle("picked", x === b));
      }));
    });
    $("#t-form", body).onsubmit = (e) => { e.preventDefault(); mark(); };
  }

  function mark() {
    const body = $("#t-body", el);
    let score = 0, blank = 0;
    $$(".testq", body).forEach((qel) => {
      const q = questions[+qel.dataset.q];
      let pts = 0, ok;
      if (q.options) {
        if (q.picked === undefined) blank++;
        ok = q.picked === q.answer;
        pts = ok ? 1 : 0;
        $$(".opt", qel).forEach((b, k) => {
          b.disabled = true;
          if (k === q.answer) b.classList.add("right");
          else if (k === q.picked) b.classList.add("wrong");
        });
      } else {
        const input = $("[data-input]", qel);
        input.disabled = true;
        if (input.value === "") blank++;
        const res = input.value === "" ? "bad" : grade(parseInt(input.value, 10), q.row.g);
        ok = res === "ok";
        pts = ok ? 1 : res === "close" ? 0.5 : 0;
        if (!ok) $("[data-corr]", qel).innerHTML = `Answer: <b>${q.row.g}</b>${res === "close" ? " — half a mark for being within one" : ""}`;
      }
      if (!ok && q.explain) $("[data-corr]", qel).innerHTML = q.explain;
      q.marked = true;
      for (const r of q.rows) record(r, ok);
      score += pts;
      qel.classList.add(ok ? "ok" : "bad");
      $("[data-mark]", qel).textContent = pts === 1 ? "✓ 1" : pts ? "½" : "✗ 0";
    });
    const pct = Math.round((score / questions.length) * 100);
    $("button.btn.lg", body).disabled = true;
    const res = $("#t-result", el);
    res.innerHTML = `
      <div class="qcard" style="text-align:center;margin-top:12px">
        <div class="qlabel">Your score${blank ? ` · ${blank} left blank` : ""}</div>
        <div class="result-big">${score} / ${questions.length}</div>
        <p>${pct}% — ${pct >= 90 ? "Golden Boot form." : pct >= 70 ? "Solid. A few to tidy up." : pct >= 40 ? "Getting there — try Learn mode on this deck." : "Tough paper! Learn mode will help."}</p>
        <div class="btnrow" style="justify-content:center"><button class="btn lg" id="t-again">New test</button></div>
      </div>`;
    $("#t-again", el).onclick = () => { newTest(); scrollTo(0, 0); };
    res.scrollIntoView({ behavior: "smooth", block: "center" });
  }
}

const who = (r) => `<b>${esc(DB.players[r.p])}</b>`;
const ctx = (r) => `${clubTag(r.c)} in <b>${DB.seasons[r.s]}</b>`;

function makeQuestion(type, r, pool) {
  if (type === "written") {
    return { type, row: r, rows: [r], text: `How many league goals did ${who(r)} score for ${ctx(r)}?` };
  }
  if (type === "choice") {
    const opts = goalOptions(r.g);
    return {
      type, rows: [r], text: `How many league goals did ${who(r)} score for ${ctx(r)}?`,
      options: opts.map((g) => ({ label: String(g) })), answer: opts.indexOf(r.g),
    };
  }
  if (type === "truefalse") {
    const truth = Math.random() < 0.5;
    const shown = truth ? r.g : Math.max(1, r.g + pick([-3, -2, -1, 1, 2, 3, 4]));
    if (!truth && shown === r.g) return null;
    return {
      type, rows: [r], text: `${who(r)} scored <b>${shown}</b> league goals for ${ctx(r)}.`,
      options: [{ label: "True" }, { label: "False" }], answer: truth ? 0 : 1,
      explain: `It was <b>${r.g}</b>.`,
    };
  }
  if (type === "more") {
    // Prefer an opponent from the same season so it feels like a real comparison.
    const same = pool.filter((x) => x.s === r.s && x.p !== r.p && x.g !== r.g);
    const others = same.length ? same : pool.filter((x) => x.p !== r.p && x.g !== r.g);
    if (!others.length) return null;
    const o = pick(others);
    const pair = shuffle([r, o]);
    const label = (x) => `${esc(DB.players[x.p])} <span class="muted small">(${esc(DB.clubs[x.c])}, ${DB.seasons[x.s]})</span>`;
    return {
      type, rows: pair, text: `Who scored more league goals?`,
      options: pair.map((x) => ({ label: label(x) })), answer: pair[0].g > pair[1].g ? 0 : 1,
      explain: pair.map((x) => `${esc(DB.players[x.p])}: <b>${x.g}</b>`).join(" · "),
    };
  }
  if (type === "club") {
    if (seasonTotal(r.p, r.s) !== r.g) return null; // played for two clubs that season
    const rivals = shuffle(clubsIn(r.s, r.s).filter((c) => c !== r.c)).slice(0, 3);
    const opts = shuffle([r.c, ...rivals]);
    return {
      type, rows: [r], text: `${who(r)} scored <b>${r.g}</b> league goals in <b>${DB.seasons[r.s]}</b>. For which club?`,
      options: opts.map((c) => ({ label: clubTag(c) })), answer: opts.indexOf(r.c),
    };
  }
  return null;
}
