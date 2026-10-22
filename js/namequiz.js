// Shared Sporcle-style "name them all" engine used by Name Them, the Misc
// lists and Champion Squads.
//
// Normal mode: type freely; a correct answer fills every slot it belongs to.
// Hard mode: one slot at a time — pick a slot (or take the highlighted one),
// type a guess and press Enter. Each slot gets one guess: right fills just
// that slot, wrong locks it as a miss. Enter on an empty box skips ahead.

import { $, $$, esc, plural, sectionTitle } from "./ui.js";
import { fold } from "./data.js";
import { prefs } from "./store.js";

/**
 * @param {HTMLElement} el  container to render into
 * @param {object} cfg
 *   title     quiz bar title (HTML)
 *   noun      "player", "leader", … for the result line
 *   groups    [{ title?, slots: [{ answer, name, keys, label?, left?(over), right?(over) }] }]
 *             answer: id shared by slots with the same answer; name: display HTML;
 *             keys: Set of accepted folded spellings; label: plain-text clue for hard mode
 *   seconds   time limit
 *   minGuess  shortest guess checked in normal mode (default 3)
 *   blocked   text explaining why the quiz can't start (too many answers…)
 *   onEnd(results)  results: [{ slot, ok }] for every slot
 * @returns {() => void} stop function (clears the timer)
 */
export function nameQuiz(el, cfg) {
  const slots = cfg.groups.flatMap((g) => g.slots);
  const minGuess = cfg.minGuess ?? 3;
  let hard = prefs.get("hard-mode", false);
  let state = "ready", remaining = cfg.seconds, timer = null, active = 0;
  // Per-slot outcome: undefined (pending), "ok", "bad"; plus the wrong guess in hard mode.
  let status = [], guesses = [];

  const answers = () => new Set(slots.map((s) => s.answer));
  const correct = () => (hard
    ? status.filter((x) => x === "ok").length
    : new Set(slots.filter((_, i) => status[i] === "ok").map((s) => s.answer)).size);
  const total = () => (hard ? slots.length : answers().size);

  function draw() {
    if (!slots.length) {
      el.innerHTML = `<div class="empty">Nothing to name with these settings.</div>`;
      return;
    }
    const over = state === "over";
    let idx = 0;
    el.innerHTML = `
      <div class="quizbar">
        <b style="font-size:14px">${cfg.title}</b>
        ${state === "playing"
          ? `<input id="nq-input" type="text" autocomplete="off" autocapitalize="off" spellcheck="false"
               placeholder="${hard ? esc(prompt()) : "Enter an answer…"}" enterkeyhint="${hard ? "go" : "done"}">
             ${hard ? `<button class="btn ghost" id="nq-skip">Skip</button>` : ""}`
          : `<button class="btn" id="nq-start" ${cfg.blocked ? "disabled" : ""}>${over ? "Play again" : "Start quiz"}</button>
             <label class="ctl check" title="One slot at a time, one guess per slot"><input type="checkbox" id="nq-hard" ${hard ? "checked" : ""}> Hard mode</label>
             ${cfg.blocked ? `<span class="muted">${esc(cfg.blocked)}</span>` : ""}`}
        <span style="margin-left:auto" class="score" id="nq-score">${correct()}/${total()}</span>
        <span class="timer" id="nq-timer">${fmt(remaining)}</span>
        ${state === "playing" ? `<button class="btn ghost" id="nq-giveup">Give up</button>` : ""}
      </div>
      ${over ? resultLine() : ""}
      ${state === "ready" && hard ? `<div class="small muted" style="margin:8px 0">Hard mode: answer one slot at a time — click a slot to jump to it. One guess each; press Enter on an empty box to skip.</div>` : ""}
      ${cfg.groups.map((g) => `
        ${g.title ? sectionTitle(g.title) : ""}
        <div class="slots">${g.slots.map((s) => slotHtml(s, idx++, over)).join("")}</div>`).join("")}`;

    $("#nq-start", el)?.addEventListener("click", begin);
    $("#nq-giveup", el)?.addEventListener("click", end);
    $("#nq-hard", el)?.addEventListener("change", (e) => {
      hard = e.target.checked;
      prefs.set("hard-mode", hard);
      reset();
    });
    const input = $("#nq-input", el);
    if (input) {
      input.focus();
      if (hard) {
        input.addEventListener("keydown", (e) => {
          if (e.key === "Enter") { e.preventDefault(); submitHard(input.value); }
        });
        $("#nq-skip", el).addEventListener("click", () => submitHard(""));
        $$(".slot", el).forEach((d) => d.addEventListener("click", () => {
          const i = +d.dataset.i;
          if (status[i] === undefined) { active = i; refreshHard(); }
        }));
        $(`.slot[data-i="${active}"]`, el)?.scrollIntoView({ block: "nearest" });
      } else {
        input.addEventListener("input", () => checkEasy(input));
      }
    }
  }

  function slotHtml(s, i, over) {
    const st = status[i];
    const cls = st === "ok" ? "found" : st === "bad" || over ? "missed" : "";
    const isActive = hard && state === "playing" && i === active;
    const shown = st === "ok" || over;
    return `<div class="slot ${cls}${isActive ? " active" : ""}${hard && state === "playing" && st === undefined ? " pickable" : ""}" data-i="${i}">
      ${s.left ? s.left(over) : ""}
      <span class="nm">${shown ? s.name : st === "bad" ? "✗" : ""}${over && guesses[i] ? ` <span class="guess">(${esc(guesses[i])})</span>` : ""}</span>
      ${s.right ? s.right(over) : ""}
    </div>`;
  }

  function prompt() {
    const s = slots[active];
    return s ? `Guess for ${s.label || `#${active + 1}`}…` : "";
  }

  function resultLine() {
    const n = correct(), t = total();
    return `<div class="feedback ${n === t ? "ok" : "bad"}" style="margin-top:10px">
      You got <b>${n}</b> of ${plural(t, hard ? "slot" : cfg.noun)} (${Math.round((n / t) * 100)}%)${hard ? " in hard mode" : ""}.
      Misses are in red${hard ? ", with your guess in brackets" : ""}.</div>`;
  }

  function reset() {
    stop();
    state = "ready";
    remaining = cfg.seconds;
    status = [];
    guesses = [];
    active = 0;
    draw();
  }

  function begin() {
    if (state === "over") reset();
    state = "playing";
    draw();
    timer = setInterval(() => {
      remaining--;
      const t = $("#nq-timer", el);
      if (t) t.textContent = fmt(remaining);
      if (remaining <= 0) end();
    }, 1000);
  }

  function checkEasy(input) {
    const guess = fold(input.value);
    if (guess.length < minGuess) return;
    const hits = new Set(slots.filter((s, i) => status[i] === undefined && s.keys.has(guess)).map((s) => s.answer));
    if (!hits.size) return;
    input.value = "";
    slots.forEach((s, i) => {
      if (status[i] !== undefined || !hits.has(s.answer)) return;
      status[i] = "ok";
      const div = $(`.slot[data-i="${i}"]`, el);
      div.classList.add("found");
      $(".nm", div).innerHTML = s.name;
    });
    $("#nq-score", el).textContent = `${correct()}/${total()}`;
    if (correct() === total()) end();
  }

  function submitHard(value) {
    const s = slots[active];
    if (!s) return;
    const guess = fold(value);
    if (guess) {
      status[active] = s.keys.has(guess) ? "ok" : "bad";
      if (status[active] === "bad") guesses[active] = value.trim();
    }
    // Next pending slot after this one, wrapping round to skipped ones.
    const order = [...slots.keys()].map((k) => (active + 1 + k) % slots.length);
    const next = order.find((i) => status[i] === undefined);
    if (next === undefined) return end();
    active = next;
    refreshHard();
  }

  function refreshHard() {
    draw();
  }

  function end() {
    stop();
    state = "over";
    cfg.onEnd?.(slots.map((slot, i) => ({ slot, ok: status[i] === "ok" })));
    draw();
  }

  function stop() {
    if (timer) clearInterval(timer);
    timer = null;
  }

  draw();
  return stop;
}

const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.max(0, s) % 60).padStart(2, "0")}`;
