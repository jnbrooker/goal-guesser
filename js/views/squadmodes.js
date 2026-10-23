// Extra Champion Squads modes.
//
// Learn: graduated recall. Each card shows a player's clues; you pick the name
// from four squad-mates, then have to type it. Misses come back later in the
// session. The most-used players come first, and mastered players are
// remembered per squad so later sessions move on to the fringe.
//
// Match up: a timed board of six clue cards and six shuffled names. Pair them
// all to clear the board; the next six follow until the squad is done.

import { $, $$, esc, shuffle } from "../ui.js";
import { fold } from "../data.js";
import { prefs } from "../store.js";

const SESSION = 10, ROUND = 6, BOARD = 6, PENALTY = 3;

/**
 * @param cfg { title, storeKey, clue(p) -> HTML, keys(p) -> Set of accepted spellings }
 */
export function learnSquad(el, players, cfg) {
  const storeKey = "squad-learn-" + cfg.storeKey;
  const mastered = new Set(prefs.get(storeKey, []));
  const ordered = [...players].sort((a, b) => b.apps - a.apps);
  let items = [], queue = [], current = null, answered = false, round = 0;

  intro();

  function save() {
    prefs.set(storeKey, [...mastered]);
  }

  function intro() {
    const left = ordered.filter((p) => !mastered.has(p.name));
    el.innerHTML = `
      <div class="qcard">
        <div class="qlabel">${esc(cfg.title)}</div>
        <div class="qtext">${mastered.size ? `<b>${mastered.size}</b> of ${ordered.length} players mastered.` : `${ordered.length} players to learn.`}</div>
        <p class="muted">Each card shows a player's clues. Pick the name first, then type it. Most-used players come first; misses come back until you get them.</p>
        <div class="btnrow">
          <button class="btn lg" data-go>${left.length ? `Learn ${Math.min(SESSION, left.length)} players` : "Review 10 players"}</button>
          ${mastered.size ? `<button class="btn ghost" data-reset>Reset progress</button>` : ""}
        </div>
      </div>`;
    $("[data-go]", el).onclick = start;
    const reset = $("[data-reset]", el);
    if (reset) reset.onclick = () => { mastered.clear(); save(); intro(); };
  }

  function start() {
    const left = ordered.filter((p) => !mastered.has(p.name));
    const pick = left.length ? left.slice(0, SESSION) : shuffle(ordered).slice(0, SESSION);
    items = pick.map((p) => ({ p, stage: 0, misses: 0 }));
    round = 0;
    nextRound();
  }

  function nextRound() {
    const open = items.filter((it) => it.stage < 2);
    if (!open.length) return finish();
    round++;
    queue = open.slice(0, ROUND);
    ask();
  }

  function options(p) {
    // Squad-mates in the same position make the best distractors.
    const same = shuffle(players.filter((q) => q !== p && q.pos === p.pos));
    const other = shuffle(players.filter((q) => q !== p && q.pos !== p.pos));
    return shuffle([p, ...[...same, ...other].slice(0, 3)]);
  }

  function ask() {
    if (!queue.length) return nextRound();
    current = queue[0];
    answered = false;
    const p = current.p;
    const typed = current.stage === 1;
    const done = items.reduce((t, it) => t + it.stage, 0);
    el.innerHTML = `
      <div class="progressmeta"><span>Round ${round}</span><span>${items.filter((it) => it.stage === 2).length} / ${items.length} learned</span></div>
      <div class="progressbar"><i style="width:${(done / (items.length * 2)) * 100}%"></i></div>
      <div class="qcard">
        <div class="qlabel">${typed ? "Type the player" : "Who's this?"} · ${esc(cfg.title)}</div>
        <div class="slot card" style="max-width:420px;margin:6px 0 4px;min-height:0"><div class="clues" style="font-size:13px">${cfg.clue(p)}</div></div>
        ${typed
          ? `<form class="answerrow" id="sl-form"><input id="sl-input" type="text" placeholder="Player name" autocomplete="off" autocapitalize="off" spellcheck="false">
             <button class="btn">Answer</button></form>
             <div class="small muted" style="margin-top:6px"><a href="#" id="sl-idk">Don't know</a></div>`
          : `<div class="options">${options(p).map((q, k) => `<button class="opt" data-k="${k}" data-name="${esc(q.name)}"><span class="k">${k + 1}</span>${esc(q.name)}</button>`).join("")}</div>`}
        <div id="sl-fb"></div>
      </div>`;
    if (typed) {
      const input = $("#sl-input", el);
      input.focus();
      $("#sl-form", el).onsubmit = (e) => { e.preventDefault(); if (input.value.trim()) submit(cfg.keys(p).has(fold(input.value))); };
      // Correct answers are taken as you type, like hard mode.
      input.oninput = () => { if (cfg.keys(p).has(fold(input.value))) submit(true); };
      $("#sl-idk", el).onclick = (e) => { e.preventDefault(); submit(false); };
    } else {
      $$(".opt", el).forEach((b) => (b.onclick = () => submit(b.dataset.name === p.name, b)));
    }
  }

  function submit(ok, btn) {
    if (answered) return;
    answered = true;
    const p = current.p;
    if (btn) {
      $$(".opt", el).forEach((b) => {
        b.disabled = true;
        if (b.dataset.name === p.name) b.classList.add("right");
      });
      if (!ok) btn.classList.add("wrong");
    } else {
      $("#sl-input", el).disabled = true;
    }
    queue.shift();
    if (ok) {
      current.stage++;
      if (current.stage === 2) { mastered.add(p.name); save(); }
    } else {
      current.misses++;
      current.stage = 0;
      mastered.delete(p.name);
      save();
      queue.push(current); // ask again before the round ends
    }
    $("#sl-fb", el).innerHTML = `<div class="feedback ${ok ? "ok" : "bad"}">${ok ? "Correct!" : `It's <b>${esc(p.name)}</b>.`}</div>
      <div class="btnrow" style="margin-top:10px"><button class="btn" id="sl-next">Continue ↵</button></div>`;
    $("#sl-next", el).onclick = ask;
    const item = current;
    if (ok) setTimeout(() => { if (answered && current === item && el.isConnected) ask(); }, 700);
  }

  function finish() {
    current = null;
    const hardest = items.filter((it) => it.misses).sort((a, b) => b.misses - a.misses).slice(0, 6);
    el.innerHTML = `
      <div class="qcard" style="text-align:center">
        <div class="qlabel">Session complete</div>
        <div class="result-big">${mastered.size} / ${ordered.length}</div>
        <p>players in this squad mastered.</p>
        ${hardest.length ? `<p class="muted">Trickiest: ${hardest.map((it) => esc(it.p.name)).join(", ")}</p>` : ""}
        <div class="btnrow" style="justify-content:center"><button class="btn lg" data-more>Keep going</button></div>
      </div>`;
    $("[data-more]", el).onclick = start;
  }

  function onKey(e) {
    if (e.key === "Enter" && answered && $("#sl-next", el)) { e.preventDefault(); ask(); return; }
    if (!current || answered || current.stage !== 0 || e.target.matches("input, select")) return;
    $$(".opt", el)[+e.key - 1]?.click();
  }
  document.addEventListener("keydown", onKey);
  return () => { current = null; document.removeEventListener("keydown", onKey); };
}

/**
 * @param cfg { title, storeKey, clue(p) -> HTML }
 */
export function matchUp(el, players, cfg) {
  const bestKey = "squad-match-" + cfg.storeKey;
  const ordered = [...players].sort((a, b) => b.apps - a.apps);
  // Players whose clues read the same are interchangeable on the board.
  const clueText = (p) => cfg.clue(p).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  let board = 0, mistakes = 0, started = 0, timer = null, picked = null, done = new Set();

  intro();

  function intro() {
    const best = prefs.get(bestKey, null);
    el.innerHTML = `
      <div class="qcard">
        <div class="qlabel">${esc(cfg.title)} · Match up</div>
        <div class="qtext">Pair each player with their clues — ${ordered.length} players, ${BOARD} at a time.</div>
        <p class="muted">Tap a clue card, then the name (or the other way round). Wrong pairs add ${PENALTY} seconds.${best ? ` Best time: <b>${fmt(best)}</b>.` : ""}</p>
        <button class="btn lg" data-go>Start</button>
      </div>`;
    $("[data-go]", el).onclick = start;
  }

  function start() {
    board = 0;
    mistakes = 0;
    started = Date.now();
    timer = setInterval(tick, 250);
    deal();
  }

  const elapsed = () => (Date.now() - started) / 1000 + mistakes * PENALTY;

  function tick() {
    const t = $("#mu-time", el);
    if (t) t.textContent = fmt(elapsed());
  }

  function deal() {
    const set = ordered.slice(board * BOARD, board * BOARD + BOARD);
    if (!set.length) return finish();
    done = new Set();
    picked = null;
    const names = shuffle(set.map((_, i) => i));
    const clues = shuffle(set.map((_, i) => i));
    const boards = Math.ceil(ordered.length / BOARD);
    el.innerHTML = `
      <div class="quizbar">
        <b style="font-size:14px">${esc(cfg.title)}</b>
        <span class="muted">Board ${board + 1} of ${boards}</span>
        <span style="margin-left:auto" class="muted">Mistakes <b id="mu-miss">${mistakes}</b></span>
        <span class="timer" id="mu-time">${fmt(elapsed())}</span>
      </div>
      <div class="matchboard">
        <div class="matchcol">${clues.map((i) => `<button class="slot card matchcard" data-side="clue" data-i="${i}"><div class="clues">${cfg.clue(set[i])}</div></button>`).join("")}</div>
        <div class="matchcol">${names.map((i) => `<button class="slot card matchcard namecard" data-side="name" data-i="${i}"><span class="nm">${esc(set[i].name)}</span></button>`).join("")}</div>
      </div>`;
    $$(".matchcard", el).forEach((b) => (b.onclick = () => choose(b, set)));
  }

  function choose(btn, set) {
    if (btn.classList.contains("found")) return;
    if (!picked || picked.dataset.side === btn.dataset.side) {
      picked?.classList.remove("active");
      picked = btn;
      btn.classList.add("active");
      return;
    }
    const clueBtn = btn.dataset.side === "clue" ? btn : picked;
    const nameBtn = btn.dataset.side === "name" ? btn : picked;
    const ok = clueText(set[+clueBtn.dataset.i]) === clueText(set[+nameBtn.dataset.i]);
    picked.classList.remove("active");
    picked = null;
    if (ok) {
      for (const b of [clueBtn, nameBtn]) { b.classList.add("found"); b.disabled = true; }
      done.add(+nameBtn.dataset.i);
      if (done.size === set.length) {
        board++;
        setTimeout(deal, 350);
      }
    } else {
      mistakes++;
      $("#mu-miss", el).textContent = mistakes;
      for (const b of [clueBtn, nameBtn]) {
        b.classList.add("missed");
        setTimeout(() => b.classList.remove("missed"), 450);
      }
    }
  }

  function finish() {
    clearInterval(timer);
    timer = null;
    const t = elapsed();
    const best = prefs.get(bestKey, null);
    const record = !best || t < best;
    if (record) prefs.set(bestKey, t);
    el.innerHTML = `
      <div class="qcard" style="text-align:center">
        <div class="qlabel">Squad matched</div>
        <div class="result-big">${fmt(t)}</div>
        <p>${mistakes} mistake${mistakes === 1 ? "" : "s"} (+${mistakes * PENALTY}s) · ${record ? "<b>New best!</b>" : `Best ${fmt(best)}`}</p>
        <div class="btnrow" style="justify-content:center"><button class="btn lg" data-again>Play again</button></div>
      </div>`;
    $("[data-again]", el).onclick = start;
  }

  return () => { if (timer) clearInterval(timer); };
}

const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
