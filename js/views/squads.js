// Misc > Champion Squads: name every player in a title-winning squad, with
// position, country and season stats as clues.
//
// Premier League squads (any club, any season) come from our own match data;
// other leagues, the Champions League and the US leagues come from Wikipedia
// club-season pages (data/champion_squads.json).

import { DB } from "../data.js";
import { prefs } from "../store.js";
import { $, $$, esc, sectionTitle, nameKeys, plural } from "../ui.js";
import { fold } from "../data.js";

// Position groups and badges per sport ("" = unknown position).
const POSITIONS = {
  football: { groups: [["G", "Goalkeepers"], ["D", "Defenders"], ["M", "Midfielders"], ["F", "Forwards"]], short: { G: "GK", D: "DF", M: "MF", F: "FW" } },
  nba: { groups: [["G", "Guards"], ["F", "Forwards"], ["C", "Centers"]], short: { G: "G", F: "F", C: "C" } },
  mlb: { groups: [["P", "Pitchers"], ["H", "Position players"]], short: { P: "P" } },
  nhl: { groups: [["G", "Goaltenders"], ["S", "Skaters"]], short: { G: "G" } },
};
const groupOf = (p, sport) => (POSITIONS[sport].groups.some(([g]) => g === p.pos) ? p.pos : "");

let cache = null;
function load() {
  const get = (url, optional) => fetch(url, { cache: "no-cache" }).then((res) => {
    if (res.ok) return res.json();
    if (optional && res.status === 404) return {};
    throw new Error(`${url}: HTTP ${res.status}`);
  });
  cache ??= Promise.all([get("data/squads.json"), get("data/champion_squads.json", true)]).then(([pl, others]) => competitions(pl, others)).catch((err) => {
    cache = null;
    throw err;
  });
  return cache;
}

/** Normalise both sources to [{id, label, sport, squads: [{key, season, team, players}]}]. */
function competitions(pl, others) {
  const plComp = {
    id: "pl", label: "Premier League", sport: "football", anyClub: true,
    squads: DB.seasons.map((season, s) => ({ key: `${s}`, season, team: DB.clubs[pl.champions[s]], s, c: pl.champions[s] })).reverse(),
    // Any club's squad, built on demand.
    squadFor(s, c) {
      const rows = pl.squads[`${s}.${c}`] || [];
      return rows.map(([p, pos, apps, starts, goals]) => ({
        name: pl.players[p], pos, nat: pl.nat[p], apps, starts: starts >= 0 ? starts : null, goals,
      }));
    },
    clubsIn(s) {
      return Object.keys(pl.squads).filter((k) => k.startsWith(s + ".")).map((k) => +k.split(".")[1])
        .sort((a, b) => DB.clubs[a].localeCompare(DB.clubs[b]));
    },
  };
  const rest = Object.entries(others).map(([id, comp]) => ({
    id, label: comp.label, sport: comp.sport,
    squads: comp.squads.map((sq, i) => ({ key: `${i}`, season: sq.season, team: sq.team, players: sq.players })).reverse(),
  }));
  return [plComp, ...rest].filter((c) => c.squads.length);
}

function statLine(p, sport) {
  if (sport === "football") {
    const starts = p.starts != null && p.starts !== p.apps ? ` (${p.starts} st)` : "";
    return `${p.apps} apps${starts} · ${p.goals ?? 0} gls`;
  }
  return [p.apps ? `${p.apps} GP` : "", p.stat || ""].filter(Boolean).join(" · ");
}

export function render(el) {
  el.innerHTML = `<div class="empty">Loading squads…</div>`;
  let stop = null;
  load().then((comps) => { stop = quiz(el, comps); }).catch((err) => {
    el.innerHTML = `<div class="empty">Couldn't load squads (${esc(err.message)}). <a href="#/misc/squads">Try again</a></div>`;
  });
  return () => stop?.();
}

function quiz(el, comps) {
  let comp = comps.find((c) => c.id === prefs.get("squads-comp", "pl")) || comps[0];
  let squadKey = comp.squads[0].key;
  let club = null; // Premier League only: a club other than the champion
  let minApps = prefs.get("squads-minapps", 1);
  const show = { pos: true, nat: true, stats: true, ...prefs.get("squads-show", {}) };
  let slots = [], answers = new Map(), state = "ready", remaining = 0, timer = null;

  el.innerHTML = `<div class="pagehead"><h1>Champion Squads</h1>
      <span class="sub"><a href="#/misc">Misc</a> › Name every player in a title-winning squad.</span></div>
    <div id="sq-setup"></div><div id="sq-body"></div>`;
  setup();
  build();

  function current() {
    const sq = comp.squads.find((x) => x.key === squadKey) || comp.squads[0];
    if (comp.anyClub) {
      const c = club ?? sq.c;
      return { title: `${sq.season} ${DB.clubs[c]}`, champion: c === sq.c, players: comp.squadFor(sq.s, c), sq };
    }
    return { title: `${sq.season} ${sq.team}`, champion: true, players: sq.players, sq };
  }

  function setup() {
    const sq = current().sq;
    $("#sq-setup", el).innerHTML = `
      <div class="controls">
        <div class="ctl" style="flex-basis:100%"><span class="lbl">Competition</span>
          <div class="btnrow" style="gap:4px">
            ${comps.map((c) => `<span class="chip${c === comp ? " on" : ""}" data-comp="${c.id}">${esc(c.label)}
              <span class="muted">(${c.squads.length})</span></span>`).join("")}
          </div></div>
        <div class="ctl"><label for="sq-season">${comp.anyClub ? "Season (champion)" : "Champion"}</label>
          <select id="sq-season">${comp.squads.map((x) => `<option value="${x.key}"${x.key === squadKey ? " selected" : ""}>
            ${esc(x.season)} · ${esc(x.team)}</option>`).join("")}</select></div>
        ${comp.anyClub ? `<div class="ctl"><label for="sq-club">Club</label><select id="sq-club">
          ${comp.clubsIn(sq.s).map((c) => `<option value="${c}"${c === (club ?? sq.c) ? " selected" : ""}>
            ${esc(DB.clubs[c])}${c === sq.c ? " (champions)" : ""}</option>`).join("")}</select></div>` : ""}
        <div class="ctl"><label for="sq-min">Min apps</label><select id="sq-min">
          ${[1, 5, 10, 20].map((n) => `<option value="${n}"${n === minApps ? " selected" : ""}>${n}+</option>`).join("")}
        </select></div>
        <div class="ctl"><span class="lbl">Clues</span><div class="btnrow">
          ${[["pos", "Position"], ["nat", "Country"], ["stats", "Stats"]].map(([k, l]) =>
            `<label class="ctl check"><input type="checkbox" data-show="${k}" ${show[k] ? "checked" : ""}> ${l}</label>`).join("")}
        </div></div>
        <div class="ctl"><span class="lbl">&nbsp;</span><button class="btn ghost" id="sq-random">🎲 Random squad</button></div>
      </div>`;
    $$("[data-comp]", el).forEach((chip) => (chip.onclick = () => {
      comp = comps.find((c) => c.id === chip.dataset.comp);
      prefs.set("squads-comp", comp.id);
      squadKey = comp.squads[0].key;
      club = null;
      setup();
      build();
    }));
    $("#sq-season", el).onchange = (e) => { squadKey = e.target.value; club = null; setup(); build(); };
    const clubSel = $("#sq-club", el);
    if (clubSel) clubSel.onchange = (e) => { club = +e.target.value; build(); };
    $("#sq-min", el).onchange = (e) => { minApps = +e.target.value; prefs.set("squads-minapps", minApps); build(); };
    $$("[data-show]", el).forEach((cb) => (cb.onchange = () => {
      show[cb.dataset.show] = cb.checked;
      prefs.set("squads-show", show);
      draw();
    }));
    $("#sq-random", el).onclick = () => {
      squadKey = comp.squads[Math.floor(Math.random() * comp.squads.length)].key;
      club = null;
      setup();
      build();
    };
  }

  function build() {
    stop();
    state = "ready";
    const players = current().players.filter((p) => p.apps >= minApps);
    answers = new Map();
    // First names count too ("Gilberto", "Kolo") when nobody else in the squad shares them.
    const firsts = new Map();
    for (const p of players) {
      const f = fold(p.name).split(" ")[0];
      firsts.set(f, (firsts.get(f) || 0) + 1);
    }
    slots = players.map((p) => {
      if (!answers.has(p.name)) {
        const keys = nameKeys(p.name);
        const f = fold(p.name).split(" ")[0];
        if (f.length >= 3 && firsts.get(f) === 1) keys.add(f);
        answers.set(p.name, { name: p.name, keys, found: false });
      }
      return { p, answer: answers.get(p.name) };
    });
    remaining = Math.min(20 * 60, Math.max(120, answers.size * 12));
    draw();
  }

  function foundCount() {
    return [...answers.values()].filter((a) => a.found).length;
  }

  function slotHtml(s, i) {
    const p = s.p;
    const shown = s.answer.found || state === "over";
    const clue = [
      show.pos && POSITIONS[comp.sport].short[p.pos] ? `<span class="badge" style="background:var(--green-dark);color:#fff">${POSITIONS[comp.sport].short[p.pos]}</span>` : "",
      show.nat && p.nat ? `<span class="small" style="min-width:90px">${esc(p.nat)}</span>` : "",
      show.stats ? `<span class="small muted" style="min-width:110px">${esc(statLine(p, comp.sport))}</span>` : "",
    ].join("");
    return `<div class="slot ${s.answer.found ? "found" : state === "over" ? "missed" : ""}" data-i="${i}">
      ${clue}<span class="nm">${shown ? esc(p.name) : ""}</span></div>`;
  }

  function draw() {
    const body = $("#sq-body", el);
    const cur = current();
    if (!slots.length) {
      body.innerHTML = `<div class="empty">No players in this squad with ${minApps}+ appearances.</div>`;
      return;
    }
    const total = answers.size;
    const groups = [...POSITIONS[comp.sport].groups, ["", "Squad"]].filter(([g]) => slots.some((s) => groupOf(s.p, comp.sport) === g));
    body.innerHTML = `
      <div class="quizbar">
        <b style="font-size:14px">${esc(cur.title)}${cur.champion ? " 🏆" : ""}</b>
        ${state === "ready"
          ? `<button class="btn" id="sq-start">Start quiz</button>`
          : `<input id="sq-input" type="text" placeholder="Enter a player…" autocomplete="off" autocapitalize="off" spellcheck="false" ${state === "over" ? "disabled" : ""}>`}
        <span style="margin-left:auto" class="score" id="sq-score">${foundCount()}/${total}</span>
        <span class="timer" id="sq-timer">${fmt(remaining)}</span>
        ${state === "playing" ? `<button class="btn ghost" id="sq-giveup">Give up</button>` : ""}
        ${state === "over" ? `<button class="btn" id="sq-retry">Play again</button>` : ""}
      </div>
      ${state === "over" ? `<div class="feedback ${foundCount() === total ? "ok" : "bad"}" style="margin-top:10px">
        You named <b>${foundCount()}</b> of ${plural(total, "player")} (${Math.round((foundCount() / total) * 100)}%). Missed players are in red.</div>` : ""}
      ${groups.map(([g, label]) => `
        ${sectionTitle(label)}
        <div class="slots">
          ${slots.map((s, i) => (groupOf(s.p, comp.sport) === g ? slotHtml(s, i) : "")).join("")}
        </div>`).join("")}
      <div class="small muted" style="margin-top:12px">${comp.id === "pl"
        ? "Premier League appearances and goals only. Nationality comes from the match data up to 2019/20, then Wikidata."
        : `From Wikipedia's ${esc(cur.sq.season)} ${esc(cur.sq.team)} season page; league stats where available.`}</div>`;

    $("#sq-start", body)?.addEventListener("click", begin);
    $("#sq-giveup", body)?.addEventListener("click", end);
    $("#sq-retry", body)?.addEventListener("click", build);
    const input = $("#sq-input", body);
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
      const t = $("#sq-timer", el);
      if (t) t.textContent = fmt(remaining);
      if (remaining <= 0) end();
    }, 1000);
  }

  function check(input) {
    const guess = fold(input.value);
    if (guess.length < 3) return;
    let hit = false;
    for (const a of answers.values()) {
      if (!a.found && a.keys.has(guess)) {
        a.found = true;
        hit = true;
      }
    }
    if (!hit) return;
    input.value = "";
    slots.forEach((s, i) => {
      if (!s.answer.found) return;
      const div = $(`.slot[data-i="${i}"]`, el);
      if (div.classList.contains("found")) return;
      div.classList.add("found");
      $(".nm", div).textContent = s.p.name;
    });
    $("#sq-score", el).textContent = `${foundCount()}/${answers.size}`;
    if (foundCount() === answers.size) end();
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
