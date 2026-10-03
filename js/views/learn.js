// Quizlet-style "Learn": each card is asked as multiple choice until answered
// correctly, then must be typed exactly. Missed cards come back later in the round.

import { DB } from "../data.js";
import { record, pickForStudy, prefs } from "../store.js";
import { $, $$, esc, clubTag, filterPanel, loadFilter, goalOptions, grade, shuffle, goalHighlights, playerMeta } from "../ui.js";

const ROUND = 7;

export function render(el, params) {
  const filter = loadFilter("learn", params, 5);
  let size = prefs.get("learn-size", 20);
  let items = [], queue = [], current = null, answered = false, roundNo = 0;

  el.innerHTML = `
    <div class="studywrap">
      <div class="pagehead"><h1>Learn</h1><span class="sub">Get each one right as multiple choice, then type it from memory.</span></div>
      <div id="ln-filter"></div>
      <div id="ln-body"></div>
    </div>`;

  const sizeCtl = () => `
    <div class="ctl"><label for="ln-size">Session</label><select id="ln-size">
      ${[10, 20, 40, 80].map((n) => `<option value="${n}"${n === size ? " selected" : ""}>${n} cards</option>`).join("")}
    </select></div>`;

  let pool = [];
  const panel = filterPanel($("#ln-filter", el), "learn", filter, (f, rows) => {
    pool = rows;
    const s = $("#ln-size", el);
    s.onchange = () => { size = +s.value; prefs.set("learn-size", size); if (!items.length) intro(); };
    if (!items.length) intro();
  }, sizeCtl());

  function intro() {
    $("#ln-body", el).innerHTML = pool.length
      ? `<div class="qcard"><div class="qlabel">Ready</div>
          <div class="qtext">${Math.min(size, pool.length)} cards from a deck of ${pool.length}.
          Unseen and shaky cards are picked first.</div>
          <div class="btnrow" style="margin-top:14px"><button class="btn lg" data-go>Start</button></div></div>`
      : `<div class="empty">No cards match — widen the filter.</div>`;
    $("[data-go]", el)?.addEventListener("click", start);
  }

  function start() {
    if (!pool.length) return;
    items = pickForStudy(pool, size).map((r) => ({ r, stage: 0, misses: 0 }));
    queue = [];
    roundNo = 0;
    nextRound();
  }

  function nextRound() {
    const left = items.filter((it) => it.stage < 2);
    if (!left.length) return finish();
    roundNo++;
    queue = shuffle(left).slice(0, ROUND);
    ask();
  }

  function ask() {
    if (!queue.length) return roundSummary();
    current = queue[0];
    answered = false;
    const r = current.r;
    const done = items.reduce((t, it) => t + it.stage, 0);
    const typed = current.stage === 1;
    $("#ln-body", el).innerHTML = `
      <div class="progressmeta"><span>Round ${roundNo}</span><span>${items.filter((it) => it.stage === 2).length} / ${items.length} learned</span></div>
      <div class="progressbar"><i style="width:${(done / (items.length * 2)) * 100}%"></i></div>
      <div class="qcard">
        <div class="qlabel">${typed ? "Type the answer" : "Multiple choice"}</div>
        <div class="meta" style="margin-bottom:4px">${playerMeta(r.p)}</div>
        <div class="qtext">How many Premier League goals did <b>${esc(DB.players[r.p])}</b> score for ${clubTag(r.c)} in <b>${DB.seasons[r.s]}</b>?</div>
        ${typed
          ? `<form class="answerrow" id="ln-form"><input id="ln-input" type="number" min="0" inputmode="numeric" placeholder="Goals" autocomplete="off">
             <button class="btn">Answer</button></form>
             <div class="small muted" style="margin-top:6px"><a href="#" id="ln-idk">Don't know</a></div>`
          : `<div class="options">${goalOptions(r.g).map((g, k) =>
              `<button class="opt" data-g="${g}"><span class="k">${k + 1}</span>${g}</button>`).join("")}</div>`}
        <div id="ln-fb"></div>
      </div>`;
    if (typed) {
      const input = $("#ln-input", el);
      input.focus();
      $("#ln-form", el).onsubmit = (e) => {
        e.preventDefault();
        if (input.value === "") return;
        submit(parseInt(input.value, 10));
      };
      $("#ln-idk", el).onclick = (e) => { e.preventDefault(); submit(null); };
    } else {
      $$(".opt", el).forEach((b) => (b.onclick = () => submit(+b.dataset.g, b)));
    }
  }

  function submit(guess, btn) {
    if (answered) return;
    answered = true;
    const r = current.r;
    const result = guess === null ? "bad" : grade(guess, r.g);
    const ok = result === "ok";
    record(r, ok);
    if (btn) {
      $$(".opt", el).forEach((b) => {
        b.disabled = true;
        if (+b.dataset.g === r.g) b.classList.add("right");
      });
      if (!ok) btn.classList.add("wrong");
    } else {
      $("#ln-input", el).disabled = true;
    }
    queue.shift();
    if (ok) current.stage++;
    else {
      current.misses++;
      if (current.stage === 1 && result === "bad") current.stage = 0;
      queue.push(current); // ask again before the round ends
    }
    const fb = $("#ln-fb", el);
    const msg = ok ? "Correct!"
      : result === "close" ? `So close — it was <b>${r.g}</b>.`
      : `The answer is <b>${r.g}</b>.`;
    fb.innerHTML = `<div class="feedback ${result}">${msg}
      ${ok ? "" : `<span class="muted"> You'll see this again.</span>`}
      <div class="small" id="ln-hl" style="margin-top:4px"></div></div>
      <div class="btnrow" style="margin-top:10px"><button class="btn" id="ln-next">Continue <span class="kbd" style="color:#fff">↵</span></button></div>`;
    $("#ln-next", el).onclick = ask;
    goalHighlights(r).then((h) => { const box = $("#ln-hl", el); if (box) box.innerHTML = h; }).catch(() => {});
    // Correct answers move on by themselves after a moment.
    const item = current;
    if (ok) setTimeout(() => { if (answered && current === item && el.isConnected) ask(); }, 900);
  }

  function roundSummary() {
    const learned = items.filter((it) => it.stage === 2).length;
    current = null;
    $("#ln-body", el).innerHTML = `
      <div class="qcard">
        <div class="qlabel">Round ${roundNo} done</div>
        <div class="qtext">${learned} of ${items.length} learned. Keep going!</div>
        <div class="btnrow" style="margin-top:14px"><button class="btn lg" id="ln-cont">Next round</button></div>
      </div>`;
    $("#ln-cont", el).onclick = nextRound;
  }

  function finish() {
    const hardest = [...items].sort((a, b) => b.misses - a.misses).filter((it) => it.misses).slice(0, 8);
    $("#ln-body", el).innerHTML = `
      <div class="qcard" style="text-align:center">
        <div class="qlabel">Session complete</div>
        <div class="result-big">${items.length} learned</div>
        <p>in ${roundNo} round${roundNo === 1 ? "" : "s"}.</p>
        ${hardest.length ? `<table class="dg" style="text-align:left;margin:10px 0">
          <tr><th>Trickiest</th><th>Club</th><th>Season</th><th class="num">Goals</th><th class="num">Misses</th></tr>
          ${hardest.map(({ r, misses }) => `<tr><td>${esc(DB.players[r.p])}</td><td>${clubTag(r.c, true)}</td>
            <td>${DB.seasons[r.s]}</td><td class="num"><b>${r.g}</b></td><td class="num">${misses}</td></tr>`).join("")}
        </table>` : ""}
        <div class="btnrow" style="justify-content:center"><button class="btn lg" id="ln-again">New session</button></div>
      </div>`;
    $("#ln-again", el).onclick = () => { panel.refresh(); start(); };
  }

  function onKey(e) {
    if (e.key === "Enter") {
      // The Enter that submits a typed answer reaches here before the form
      // handler runs, so `answered` is still false for that keypress.
      const next = $("#ln-next, #ln-cont", el);
      if (next && (answered || !current)) { e.preventDefault(); next.click(); }
      return;
    }
    if (!current || answered || current.stage !== 0 || e.target.matches("input, select")) return;
    const btn = $$(".opt", el)[+e.key - 1];
    if (btn) btn.click();
  }
  document.addEventListener("keydown", onKey);
  return () => { current = null; document.removeEventListener("keydown", onKey); };
}
