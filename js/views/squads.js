// Misc > Champion Squads: name every player in a title-winning squad, with
// position, country and season stats as clues.
//
// Premier League squads (any club, any season) come from our own match data;
// other leagues, the Champions League and the US leagues come from Wikipedia
// club-season pages (data/champion_squads.json).

import { DB } from "../data.js";
import { prefs } from "../store.js";
import { $, $$, esc, nameKeys } from "../ui.js";
import { nameQuiz } from "../namequiz.js";
import { fold } from "../data.js";

// Position groups and badges per sport ("" = unknown position).
const POSITIONS = {
  football: { groups: [["G", "Goalkeepers"], ["D", "Defenders"], ["M", "Midfielders"], ["F", "Forwards"]], short: { G: "GK", D: "DF", M: "MF", F: "FW" } },
  nba: { groups: [["G", "Guards"], ["F", "Forwards"], ["C", "Centers"]], short: { G: "G", F: "F", C: "C" } },
  mlb: { groups: [["P", "Pitchers"], ["H", "Position players"]], short: { P: "P" } },
  nhl: { groups: [["G", "Goaltenders"], ["D", "Defencemen"], ["F", "Forwards"], ["S", "Skaters"]], short: { G: "G", D: "D", F: "F" } },
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
    squads: comp.squads.map((sq, i) => ({ key: `${i}`, season: sq.season, team: sq.team, note: sq.note, players: sq.players })).reverse(),
  }));
  return [plComp, ...rest].filter((c) => c.squads.length);
}

const rank = (order, pos) => (order.includes(pos) ? order.indexOf(pos) : order.length);
const byUse = (a, b) => b.apps - a.apps || (b.goals ?? 0) - (a.goals ?? 0);
const top = (players, pos, n, key = byUse) => players.filter((p) => p.pos === pos).sort(key).slice(0, n);
const benchTitle = { football: "Bench", nba: "Bench", nhl: "Rest of the roster", mlb: "Bench & bullpen" };

/**
 * The squad's "first team" for display: a football XI in formation, the NBA's
 * starting five, the NHL's top line, MLB's everyday lineup and main pitchers.
 * Returns [{ title, players (hard-mode order), rows? (display, top to bottom), variant? }].
 */
function startingLineup(players, sport) {
  if (sport === "football") {
    // Squads from a final: the actual starting XI.
    let xi = players.filter((p) => p.stat === "started the final");
    if (xi.length !== 11) {
      const gk = top(players, "G", 1);
      const def = top(players, "D", 4);
      const rest = players.filter((p) => p.pos === "M" || p.pos === "F").sort(byUse);
      const mf = rest.slice(0, 10 - def.length);
      // Always at least one forward up front.
      if (!mf.some((p) => p.pos === "F")) {
        const fw = rest.find((p) => p.pos === "F");
        if (fw) mf[mf.length - 1] = fw;
      }
      xi = [...gk, ...def, ...mf];
    }
    const line = (pos) => xi.filter((p) => p.pos === pos);
    if (xi.length !== 11 || line("G").length !== 1) return [];
    const shape = [line("D").length, line("M").length, line("F").length].filter(Boolean).join("-");
    return [{
      title: `Most-used XI (${shape})`, variant: "",
      players: [...line("G"), ...line("D"), ...line("M"), ...line("F")],
      rows: [line("F"), line("M"), line("D"), line("G")].filter((r) => r.length),
    }];
  }
  if (sport === "nba") {
    const hasStarts = players.some((p) => p.starts != null);
    const five = [...players].sort((a, b) => (hasStarts ? (b.starts ?? 0) - (a.starts ?? 0) : 0) || b.apps - a.apps).slice(0, 5)
      .sort((a, b) => rank(["G", "F", "C"], a.pos) - rank(["G", "F", "C"], b.pos));
    return five.length === 5 ? [{ title: hasStarts ? "Starting five (most starts)" : "Most-used five", variant: "court", players: five, rows: [five] }] : [];
  }
  if (sport === "nhl") {
    // Skaters by goals (the recognisable top line); goalie by games.
    const byGoals = (a, b) => (b.goals ?? 0) - (a.goals ?? 0) || b.apps - a.apps;
    const g = top(players, "G", 1), d = top(players, "D", 2, byGoals), f = top(players, "F", 3, byGoals);
    if (g.length + d.length + f.length < 6) return [];
    return [{ title: "Top line (top scorers, No. 1 goalie)", variant: "rink", players: [...g, ...d, ...f], rows: [f, d, g] }];
  }
  if (sport === "mlb") {
    return [
      { title: "Everyday lineup (most games)", players: top(players, "H", 9) },
      { title: "Most-used pitchers", players: top(players, "P", 5) },
    ].filter((g) => g.players.length);
  }
  return [];
}

function statLine(p, sport) {
  if (sport === "football" && p.stat) return p.stat; // line-up from a final
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
  let stop = null;

  el.innerHTML = `<div class="pagehead"><h1>Champion Squads</h1>
      <span class="sub"><a href="#/misc">Misc</a> › Name every player in a title-winning squad.</span></div>
    <div id="sq-setup"></div><div id="sq-body"></div><div id="sq-note" class="small muted" style="margin-top:12px"></div>`;
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
      build();
    }));
    $("#sq-random", el).onclick = () => {
      squadKey = comp.squads[Math.floor(Math.random() * comp.squads.length)].key;
      club = null;
      setup();
      build();
    };
  }

  function build() {
    stop?.();
    const cur = current();
    const players = cur.players.filter((p) => p.apps >= minApps);
    // First names count too ("Gilberto", "Kolo") when nobody else in the squad shares them.
    const firsts = new Map();
    for (const p of players) {
      const f = fold(p.name).split(" ")[0];
      firsts.set(f, (firsts.get(f) || 0) + 1);
    }
    const pos = POSITIONS[comp.sport];
    const slotFor = (p) => {
      const keys = nameKeys(p.name);
      const f = fold(p.name).split(" ")[0];
      if (f.length >= 3 && firsts.get(f) === 1) keys.add(f);
      const badge = pos.short[p.pos];
      return {
        answer: p.name, name: esc(p.name), keys,
        label: [show.pos && badge, show.nat && p.nat, show.stats && statLine(p, comp.sport)].filter(Boolean).join(", "),
        left: () => [
          show.pos && badge ? `<span class="badge">${badge}</span>` : "",
          show.nat && p.nat ? `<span>${esc(p.nat)}</span>` : "",
          show.stats ? `<span class="muted">${esc(statLine(p, comp.sport))}</span>` : "",
        ].join(""),
      };
    };
    const lineup = startingLineup(players, comp.sport);
    const used = new Set(lineup.flatMap((g) => g.players));
    const order = pos.groups.map(([g]) => g);
    const bench = players.filter((p) => !used.has(p))
      .sort((a, b) => rank(order, a.pos) - rank(order, b.pos) || b.apps - a.apps);
    const slotOf = new Map(players.map((p) => [p, slotFor(p)]));
    const groups = [
      ...lineup.map((g) => ({
        title: g.title, layout: g.rows ? "pitch" : "cards", variant: g.variant,
        rows: g.rows?.map((row) => row.map((p) => slotOf.get(p))),
        slots: g.players.map((p) => slotOf.get(p)),
      })),
      { title: lineup.length ? benchTitle[comp.sport] : "Squad", layout: "cards", slots: bench.map((p) => slotOf.get(p)) },
    ].filter((g) => g.slots.length);

    $("#sq-note", el).textContent = comp.id === "pl"
      ? "Premier League appearances and goals only. Nationality comes from the match data up to 2019/20, then Wikidata."
      : cur.sq.note || `From Wikipedia's ${cur.sq.season} ${cur.sq.team} season page; league stats where available.`;
    stop = nameQuiz($("#sq-body", el), {
      title: `${esc(cur.title)}${cur.champion ? " 🏆" : ""}`, noun: "player", groups,
      seconds: Math.min(20 * 60, Math.max(120, players.length * 12)),
    });
  }

  return () => stop?.();
}

