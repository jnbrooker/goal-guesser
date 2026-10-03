// Higher or Lower: is the next player-season's tally higher or lower than this one?

import { DB } from "../data.js";
import { record, prefs } from "../store.js";
import { $, esc, clubTag, filterPanel, loadFilter, pick } from "../ui.js";

export function render(el, params) {
  const filter = loadFilter("higher-lower", params, 5);
  let pool = [], a = null, b = null, streak = 0, locked = false;
  let best = prefs.get("hl-best", 0);

  el.innerHTML = `
    <div class="studywrap">
      <div class="pagehead"><h1>Higher or Lower</h1><span class="sub">Did the second player score more or fewer league goals? <span class="kbd">↑</span> <span class="kbd">↓</span></span></div>
      <div id="hl-filter"></div>
      <div id="hl-body"></div>
    </div>`;

  filterPanel($("#hl-filter", el), "higher-lower", filter, (f, rows) => {
    pool = rows;
    streak = 0;
    a = pick(pool);
    deal();
  });

  function deal() {
    const body = $("#hl-body", el);
    if (pool.length < 2) {
      body.innerHTML = `<div class="empty">Need at least two cards — widen the filter.</div>`;
      return;
    }
    let guard = 0;
    do b = pick(pool); while ((b === a || b.g === a.g) && guard++ < 50);
    locked = false;
    draw(false);
  }

  function card(r, reveal) {
    return `
    <div class="hlcard">
      <div class="who">${esc(DB.players[r.p])}</div>
      <div class="ctx">${clubTag(r.c)}<b>${DB.seasons[r.s]}</b></div>
      <div class="goals${reveal ? "" : " unknown"}">${reveal ? r.g : "?"}</div>
      <div class="small muted">league goals</div>
    </div>`;
  }

  function draw(reveal, verdict = "") {
    $("#hl-body", el).innerHTML = `
      <div class="progressmeta" style="font-size:13px;margin-bottom:8px">
        <span>Streak <b style="color:var(--green)">${streak}</b></span><span>Best <b>${best}</b></span></div>
      <div class="hl">
        ${card(a, true)}
        <div class="hlvs">VS</div>
        ${card(b, reveal)}
      </div>
      <div class="btnrow" style="justify-content:center;margin-top:14px">
        ${reveal
          ? `${verdict}<button class="btn lg" id="hl-next">${streak ? "Next" : "Try again"}</button>`
          : `<button class="btn lg" data-guess="1">▲ Higher</button><button class="btn lg red" data-guess="-1">▼ Lower</button>`}
      </div>`;
    el.querySelectorAll("[data-guess]").forEach((btn) => (btn.onclick = () => guess(+btn.dataset.guess)));
    const next = $("#hl-next", el);
    if (next) { next.focus(); next.onclick = advance; }
  }

  function guess(dir) {
    if (locked) return;
    locked = true;
    const ok = Math.sign(b.g - a.g) === dir;
    record(b, ok);
    if (ok) {
      streak++;
      if (streak > best) { best = streak; prefs.set("hl-best", best); }
    } else {
      streak = 0;
    }
    draw(true, `<span class="feedback ${ok ? "ok" : "bad"}" style="margin:0">${ok ? "Correct!" : `Wrong — ${esc(DB.players[b.p])} scored ${b.g}.`}</span>`);
  }

  function advance() {
    if (streak) a = b;
    else a = pick(pool);
    deal();
  }

  function onKey(e) {
    if (e.target.matches("input, select")) return;
    if (!locked && e.key === "ArrowUp") { e.preventDefault(); guess(1); }
    if (!locked && e.key === "ArrowDown") { e.preventDefault(); guess(-1); }
  }
  document.addEventListener("keydown", onKey);
  return () => document.removeEventListener("keydown", onKey);
}
