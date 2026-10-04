// Misc: non-football quizzes. Currently World Leaders — a Sporcle-style
// "name them all" quiz over one or more countries' heads of government/state.

import { prefs } from "../store.js";
import { $, $$, esc, sectionTitle, nameKeys, plural } from "../ui.js";
import { fold } from "../data.js";

const CATEGORIES = [
  ["#/misc/leaders", "World Leaders", "Prime ministers, presidents and chancellors — pick the countries, then name them all"],
];

const SINCE = [0, 1800, 1900, 1945, 1979, 2000];

// Nicknames and short forms people commonly type.
const ALIASES = {
  "Franklin D. Roosevelt": ["fdr"], "John F. Kennedy": ["jfk"], "Lyndon B. Johnson": ["lbj"],
  "Theodore Roosevelt": ["teddy roosevelt"], "Bill Clinton": ["clinton"],
  "George W. Bush": ["dubya", "bush"], "George H. W. Bush": ["bush"],
  "Luiz Inácio Lula da Silva": ["lula"], "Valéry Giscard d'Estaing": ["giscard"],
  "Benjamin Netanyahu": ["bibi"], "William Ewart Gladstone": ["gladstone"],
};

let leaders = null;
function loadLeaders() {
  leaders ??= fetch("data/leaders.json", { cache: "no-cache" })
    .then((res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    })
    .catch((err) => {
      leaders = null;
      throw err;
    });
  return leaders;
}

export function render(el, params, arg) {
  if (arg === "leaders") return leadersQuiz(el);
  el.innerHTML = `
    <div class="studywrap">
      <div class="pagehead"><h1>Misc</h1><span class="sub">Quizzes beyond the Premier League.</span></div>
      ${sectionTitle("Categories")}
      <div class="card modelist">
        ${CATEGORIES.map(([href, t, d]) => `<a href="${href}"><b>${t}</b><span>${d}</span></a>`).join("")}
      </div>
    </div>`;
}

/** "Robert Jenkinson, 2nd Earl of Liverpool" -> name + muted title. */
function displayName(name) {
  const [main, ...titles] = name.split(", ");
  const title = titles.join(", ").replace(/^\d+(st|nd|rd|th) /, "");
  return esc(main) + (title ? ` <span class="muted small">(${esc(title)})</span>` : "");
}

const years = (s, e) => (!e ? `${s}–now` : e === s ? s : `${s}–${e}`);

function leadersQuiz(el) {
  let chosen = new Set(prefs.get("leaders-countries", ["uk", "us"]));
  let since = prefs.get("leaders-since", 0);
  let showYears = prefs.get("leaders-years", true);
  let data = [], slots = [], people = new Map(), state = "ready", remaining = 0, timer = null;

  el.innerHTML = `<div class="pagehead"><h1>World Leaders</h1>
      <span class="sub"><a href="#/misc">Misc</a> › Name every leader of the countries you pick. Surnames are fine.</span></div>
    <div id="wl-setup"></div><div id="wl-body"><div class="empty">Loading…</div></div>`;

  loadLeaders().then((d) => {
    data = d;
    setupPanel();
    build();
  }).catch((err) => {
    $("#wl-body", el).innerHTML = `<div class="empty">Couldn't load leaders (${esc(err.message)}).</div>`;
  });

  function setupPanel() {
    $("#wl-setup", el).innerHTML = `
      <div class="controls">
        <div class="ctl" style="flex-basis:100%"><span class="lbl">Countries</span>
          <div class="btnrow" style="gap:4px">
            ${data.map((c) => `<span class="chip country${chosen.has(c.id) ? " on" : ""}" data-c="${c.id}"
              title="${esc(c.office)}">${c.flag} ${esc(c.country)}</span>`).join("")}
          </div></div>
        <div class="ctl"><label for="wl-since">Since</label><select id="wl-since">
          ${SINCE.map((y) => `<option value="${y}"${y === since ? " selected" : ""}>${y ? y : "All time"}</option>`).join("")}
        </select></div>
        <label class="ctl check"><input type="checkbox" id="wl-years" ${showYears ? "checked" : ""}> Show years as clues</label>
        <div class="ctl"><span class="lbl">&nbsp;</span><div class="btnrow">
          <span class="chip" data-preset="uk,us">UK + US</span>
          <span class="chip" data-preset="all">All</span>
          <span class="chip" data-preset="">Clear</span></div></div>
      </div>`;
    $$("[data-c]", el).forEach((chip) => (chip.onclick = () => {
      chosen.has(chip.dataset.c) ? chosen.delete(chip.dataset.c) : chosen.add(chip.dataset.c);
      changed();
    }));
    $$("[data-preset]", el).forEach((chip) => (chip.onclick = () => {
      const v = chip.dataset.preset;
      chosen = new Set(v === "all" ? data.map((c) => c.id) : v ? v.split(",") : []);
      changed();
    }));
    $("#wl-since", el).onchange = (e) => { since = +e.target.value; changed(); };
    $("#wl-years", el).onchange = (e) => { showYears = e.target.checked; prefs.set("leaders-years", showYears); draw(); };
  }

  function changed() {
    prefs.set("leaders-countries", [...chosen]);
    prefs.set("leaders-since", since);
    setupPanel();
    build();
  }

  function build() {
    stop();
    state = "ready";
    slots = [];
    people = new Map();
    for (const c of data) {
      if (!chosen.has(c.id)) continue;
      for (const [name, s, e] of c.terms) {
        if (+(e || 9999) < since) continue;
        // One person = one answer, even with several terms (Cleveland, Trump, Wilson…).
        const key = c.id + "|" + name;
        if (!people.has(key)) {
          const keys = nameKeys(name);
          for (const a of ALIASES[name] || []) keys.add(a);
          people.set(key, { name, keys, found: false });
        }
        slots.push({ country: c, person: people.get(key), s, e });
      }
    }
    remaining = Math.min(30 * 60, Math.max(90, people.size * 15));
    draw();
  }

  const foundCount = () => [...people.values()].filter((p) => p.found).length;

  function draw() {
    const body = $("#wl-body", el);
    if (!slots.length) {
      body.innerHTML = `<div class="empty">Pick at least one country above.</div>`;
      return;
    }
    const groups = data.filter((c) => slots.some((s) => s.country === c));
    body.innerHTML = `
      <div class="quizbar">
        <b style="font-size:14px">${groups.length === 1 ? `${groups[0].flag} ${esc(groups[0].country)} — ${esc(groups[0].office)}s` : `${groups.length} countries`}${since ? ` since ${since}` : ""}</b>
        ${state === "ready"
          ? `<button class="btn" id="wl-start">Start quiz</button>`
          : `<input id="wl-input" type="text" placeholder="Enter a name…" autocomplete="off" autocapitalize="off" spellcheck="false" ${state === "over" ? "disabled" : ""}>`}
        <span style="margin-left:auto" class="score" id="wl-score">${foundCount()}/${people.size}</span>
        <span class="timer" id="wl-timer">${fmt(remaining)}</span>
        ${state === "playing" ? `<button class="btn ghost" id="wl-giveup">Give up</button>` : ""}
        ${state === "over" ? `<button class="btn" id="wl-retry">Play again</button>` : ""}
      </div>
      ${state === "over" ? `<div class="feedback ${foundCount() === people.size ? "ok" : "bad"}" style="margin-top:10px">
        You named <b>${foundCount()}</b> of ${plural(people.size, "leader")} (${Math.round((foundCount() / people.size) * 100)}%). Missed names are in red.</div>` : ""}
      ${groups.map((c) => `
        ${sectionTitle(`${c.flag} ${c.country} · ${c.office}`)}
        <div class="slots">
          ${slots.filter((s) => s.country === c).map((s) => {
            const i = slots.indexOf(s);
            const shown = s.person.found || state === "over";
            return `<div class="slot ${s.person.found ? "found" : state === "over" ? "missed" : ""}" data-i="${i}">
              ${showYears || state === "over" ? `<span class="small muted" style="min-width:74px">${years(s.s, s.e)}</span>` : ""}
              <span class="nm">${shown ? displayName(s.person.name) : ""}</span></div>`;
          }).join("")}
        </div>`).join("")}`;

    $("#wl-start", body)?.addEventListener("click", begin);
    $("#wl-giveup", body)?.addEventListener("click", end);
    $("#wl-retry", body)?.addEventListener("click", build);
    const input = $("#wl-input", body);
    if (input && state === "playing") {
      input.focus();
      input.addEventListener("input", () => check(input));
    }
  }

  function begin() {
    state = "playing";
    draw();
    timer = setInterval(() => {
      remaining--;
      const t = $("#wl-timer", el);
      if (t) t.textContent = fmt(remaining);
      if (remaining <= 0) end();
    }, 1000);
  }

  function check(input) {
    const guess = fold(input.value);
    if (guess.length < 3) return;
    let hit = false;
    for (const p of people.values()) {
      if (!p.found && p.keys.has(guess)) {
        p.found = true;
        hit = true;
      }
    }
    if (!hit) return;
    input.value = "";
    slots.forEach((s, i) => {
      if (!s.person.found) return;
      const div = $(`.slot[data-i="${i}"]`, el);
      if (div.classList.contains("found")) return;
      div.classList.add("found");
      $(".nm", div).innerHTML = displayName(s.person.name);
    });
    $("#wl-score", el).textContent = `${foundCount()}/${people.size}`;
    if (foundCount() === people.size) end();
  }

  function end() {
    stop();
    state = "over";
    draw();
  }

  function stop() {
    if (timer) clearInterval(timer);
    timer = null;
  }

  return stop;
}

const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.max(0, s) % 60).padStart(2, "0")}`;
