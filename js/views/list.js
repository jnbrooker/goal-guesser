// Sporcle-style list quiz: type the names of every scorer in the list before
// the clock runs out. Slots show goals (and optionally club) as clues.

import { DB, fold, filterRows } from "../data.js";
import { record, prefs } from "../store.js";
import { $, $$, esc, clubTag, filterPanel, loadFilter, goalSq, plural, nameKeys } from "../ui.js";

export function render(el, params) {
  const filter = loadFilter("list", params, 8);
  let showClubs = prefs.get("list-clubs", true);
  let slots = [], timer = null, remaining = 0, state = "ready";

  el.innerHTML = `
    <div class="pagehead"><h1>Name Them</h1><span class="sub">Type a player's surname or full name — correct answers fill in automatically.</span></div>
    <div id="l-filter"></div>
    <div id="l-body"></div>`;

  const extra = () => `<label class="ctl check"><input type="checkbox" id="l-clubs" ${showClubs ? "checked" : ""}> Show clubs as clues</label>`;

  filterPanel($("#l-filter", el), "list", filter, (f, rows) => {
    $("#l-clubs", el).onchange = (e) => { showClubs = e.target.checked; prefs.set("list-clubs", showClubs); setup(rows); };
    setup(rows);
  }, extra());

  function setup(rows) {
    stop();
    state = "ready";
    slots = [...rows].sort((a, b) => b.g - a.g || a.c - b.c).map((r) => ({ r, found: false, keys: nameKeys(DB.players[r.p]) }));
    remaining = Math.min(20 * 60, Math.max(60, slots.length * 12));
    draw();
  }

  function title() {
    if (filter.player >= 0) return `${esc(DB.players[filter.player])}'s seasons`;
    const span = filter.from === filter.to ? DB.seasons[filter.from] : `${DB.seasons[filter.from]}–${DB.seasons[filter.to]}`;
    const who = filter.club >= 0 ? esc(DB.clubs[filter.club]) : "Premier League";
    return `${span} ${who} scorers with ${filter.min}+ goals`;
  }

  function draw() {
    const body = $("#l-body", el);
    if (!slots.length) {
      body.innerHTML = `<div class="empty">No players match — lower the minimum goals or widen the seasons.</div>`;
      return;
    }
    const tooMany = slots.length > 300;
    body.innerHTML = `
      <div class="quizbar">
        <b style="font-size:14px">${title()}</b>
        ${state === "ready"
          ? `<button class="btn" id="l-start" ${tooMany ? "disabled" : ""}>Start quiz</button>
             ${tooMany ? `<span class="muted">${slots.length} answers is a lot — narrow the filter (max 300).</span>` : ""}`
          : `<input id="l-input" type="text" placeholder="Enter player…" autocomplete="off" autocapitalize="off" spellcheck="false" ${state === "over" ? "disabled" : ""}>`}
        <span style="margin-left:auto" class="score" id="l-score">${found()}/${slots.length}</span>
        <span class="timer" id="l-timer">${fmt(remaining)}</span>
        ${state === "playing" ? `<button class="btn ghost" id="l-giveup">Give up</button>` : ""}
        ${state === "over" ? `<button class="btn" id="l-retry">Play again</button>` : ""}
      </div>
      ${state === "over" ? resultLine() : ""}
      <div class="slots">
        ${slots.map((s, i) => `<div class="slot ${s.found ? "found" : state === "over" ? "missed" : ""}" data-i="${i}">
          ${goalSq(s.r.g)}
          <span class="nm">${s.found || state === "over" ? esc(DB.players[s.r.p]) : ""}</span>
          ${showClubs || state === "over" ? clubTag(s.r.c, true) : ""}
          ${filter.from !== filter.to || filter.player >= 0 ? `<span class="small muted">${DB.seasons[s.r.s]}</span>` : ""}
        </div>`).join("")}
      </div>`;

    $("#l-start", body)?.addEventListener("click", begin);
    $("#l-giveup", body)?.addEventListener("click", end);
    $("#l-retry", body)?.addEventListener("click", () => setup(filterRows(filter)));
    const input = $("#l-input", body);
    if (input && state === "playing") {
      input.focus();
      input.addEventListener("input", () => check(input));
    }
  }

  function found() {
    return slots.filter((s) => s.found).length;
  }

  function resultLine() {
    const n = found();
    return `<div class="feedback ${n === slots.length ? "ok" : "bad"}" style="margin-top:10px">
      You named <b>${n}</b> of ${plural(slots.length, "answer")} (${Math.round((n / slots.length) * 100)}%).
      Missed players are shown in red.</div>`;
  }

  function begin() {
    state = "playing";
    draw();
    timer = setInterval(() => {
      remaining--;
      const t = $("#l-timer", el);
      if (t) t.textContent = fmt(remaining);
      if (remaining <= 0) end();
    }, 1000);
  }

  function check(input) {
    const guess = fold(input.value);
    if (guess.length < 2) return;
    let hit = false;
    slots.forEach((s, i) => {
      if (!s.found && s.keys.has(guess)) {
        s.found = true;
        hit = true;
        record(s.r, true);
        const div = $(`.slot[data-i="${i}"]`, el);
        div.classList.add("found");
        $(".nm", div).textContent = DB.players[s.r.p];
      }
    });
    if (hit) {
      input.value = "";
      $("#l-score", el).textContent = `${found()}/${slots.length}`;
      if (found() === slots.length) end();
    }
  }

  function end() {
    stop();
    state = "over";
    for (const s of slots) if (!s.found) record(s.r, false);
    draw();
  }

  function stop() {
    if (timer) clearInterval(timer);
    timer = null;
  }

  return stop;
}

const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.max(0, s) % 60).padStart(2, "0")}`;
