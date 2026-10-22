// Misc: Sporcle-style "name them all" quizzes beyond the Premier League.
//
// Every category is a set of lists you can mix (countries, leagues, awards).
// Each list item has an answer (a person, club or team) and a clue (years).
// One answer fills every slot it appears in, so a club or person that won
// many times only needs typing once.

import { prefs } from "../store.js";
import { $, $$, esc, sectionTitle, nameKeys, plural } from "../ui.js";
import { fold } from "../data.js";
import * as squads from "./squads.js";

const SINCE = [0, 1900, 1950, 1980, 2000];

// Nicknames and short forms people commonly type.
const ALIASES = {
  // leaders
  "Franklin D. Roosevelt": ["fdr"], "John F. Kennedy": ["jfk"], "Lyndon B. Johnson": ["lbj"],
  "Theodore Roosevelt": ["teddy roosevelt"], "Bill Clinton": ["clinton"],
  "George W. Bush": ["dubya", "bush"], "George H. W. Bush": ["bush"],
  "Luiz Inácio Lula da Silva": ["lula"], "Valéry Giscard d'Estaing": ["giscard"],
  "Benjamin Netanyahu": ["bibi"], "William Ewart Gladstone": ["gladstone"],
  // clubs
  "Manchester United": ["man utd", "man united"], "Manchester City": ["man city"],
  "Tottenham Hotspur": ["spurs", "tottenham"], "Wolverhampton Wanderers": ["wolves"],
  "West Bromwich Albion": ["west brom"], "Paris Saint-Germain": ["psg", "paris sg"],
  "Inter Milan": ["inter", "internazionale"], "Milan": ["ac milan"], "Barcelona": ["barca"],
  "Atlético Madrid": ["atletico", "atleti"], "Borussia Mönchengladbach": ["gladbach"],
  "1. FC Köln": ["cologne", "koln"], "Hamburger SV": ["hamburg"], "Bayern Munich": ["bayern"],
  "TSV 1860 Munich": ["1860 munich", "1860"], "Red Star Belgrade": ["red star"],
  "Steaua București": ["steaua", "steaua bucharest"], "PSV Eindhoven": ["psv"],
  "Olympique Lillois": ["lille olympique"], "Hellas Verona": ["verona"],
  // US teams
  "Philadelphia 76ers": ["sixers"], "Washington Redskins": ["redskins"],
  // players known by one name
  "LeBron James": ["lebron"], "Shaquille O'Neal": ["shaq"], "Magic Johnson": ["magic"],
  "Kareem Abdul-Jabbar": ["kareem"], "Giannis Antetokounmpo": ["giannis"], "Ichiro Suzuki": ["ichiro"],
  "Alex Rodriguez": ["a rod", "arod"], "Iván Rodríguez": ["pudge"], "Wayne Gretzky": ["the great one"],
  "Shai Gilgeous-Alexander": ["sga", "shai"], "Lew Alcindor": ["alcindor"], "Ken Griffey Jr.": ["griffey"],
  "Cal Ripken Jr.": ["ripken"], "Ronald Acuña Jr.": ["acuna"],
};

// Words too common to identify a club on their own.
const CLUB_STOPWORDS = new Set(["united", "city", "real", "club", "town", "county", "rovers", "wanderers",
  "athletic", "albion", "sporting", "olympique", "racing", "stade", "north", "end", "the", "and", "hove",
  "de", "la", "fc", "cf", "ac", "afc", "sc", "ssc", "as", "sv", "tsv", "vfb", "vfl", "bv", "rc", "fk", "1"]);

let cache = null;
function loadAll() {
  cache ??= Promise.all(["data/leaders.json", "data/misc.json"].map((url) =>
    fetch(url, { cache: "no-cache" }).then((res) => {
      if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
      return res.json();
    }),
  )).then(([leaders, misc]) => [leadersCategory(leaders), ...misc.map(miscCategory)])
    .catch((err) => {
      cache = null;
      throw err;
    });
  return cache;
}

const years = (s, e) => (!e ? `${s}–now` : e === s ? s : `${s}–${e}`);

function leadersCategory(countries) {
  return {
    id: "leaders", title: "World Leaders", kind: "person", noun: "leader",
    sub: "Prime ministers, presidents and chancellors — pick the countries, then name them all",
    defaults: ["uk", "us"], presets: [["UK + US", ["uk", "us"]]],
    sets: countries.map((c) => ({
      id: c.id, label: c.country, emoji: c.flag, title: `${c.country} · ${c.office}`,
      items: c.terms.map(([name, s, e]) => ({ answer: name, clue: years(s, e), from: +s, to: +(e || 9999) })),
    })),
  };
}

function miscCategory(c) {
  const presets = c.id === "football" ? [["Top 5 leagues", ["eng", "esp", "ita", "ger", "fra"]]] : [];
  return {
    id: c.id, title: c.title, sub: c.sub, kind: c.kind, noun: c.kind === "person" ? "winner" : c.kind === "club" ? "club" : "team",
    defaults: [c.sets[0].id], presets,
    sets: c.sets.map((s) => ({
      id: s.id, label: s.label, emoji: s.emoji, title: s.title,
      items: s.items.map(([answer, clue, extra]) => {
        const y = parseInt(clue, 10);
        return { answer, clue, extra: extra || "", from: y, to: y };
      }),
    })),
  };
}

export function render(el, params, arg) {
  if (arg === "squads") return squads.render(el);
  let cleanup = null;
  el.innerHTML = `<div class="empty">Loading…</div>`;
  loadAll().then((cats) => {
    const cat = cats.find((c) => c.id === arg);
    if (cat) return (cleanup = quiz(el, cat));
    el.innerHTML = `
      <div class="studywrap">
        <div class="pagehead"><h1>Misc</h1><span class="sub">Name-them-all quizzes beyond the Premier League.</span></div>
        ${sectionTitle("Categories")}
        <div class="card modelist">
          <a href="#/misc/squads"><b>Champion Squads</b><span>Name every player in a title-winning squad — Premier League, Europe's top leagues, Champions League, NBA, MLB and NHL</span></a>
          ${cats.map((c) => `<a href="#/misc/${c.id}"><b>${esc(c.title)}</b><span>${esc(c.sub)}</span></a>`).join("")}
        </div>
      </div>`;
  }).catch((err) => {
    el.innerHTML = `<div class="empty">Couldn't load quizzes (${esc(err.message)}). <a href="#/misc">Try again</a></div>`;
  });
  return () => cleanup?.();
}

/** "Robert Jenkinson, 2nd Earl of Liverpool" -> name + muted title. */
function displayName(name) {
  const [main, ...titles] = name.split(", ");
  const title = titles.join(", ").replace(/^\d+(st|nd|rd|th) /, "");
  return esc(main) + (title ? ` <span class="muted small">(${esc(title)})</span>` : "");
}

/** Accepted spellings for a club or team, given every answer in the quiz. */
function teamKeys(answer, kind, wordCounts) {
  const f = fold(answer);
  const words = f.split(" ");
  const keys = new Set([f, f.replace(/ /g, "")]);
  // "Borussia Dortmund" -> "borussia dortmund"; but "Sheffield United" -> "sheffield"
  // only counts if no other club in the quiz is also just "sheffield".
  const kept = words.filter((w) => !CLUB_STOPWORDS.has(w));
  if (kept.length > 1 || (kept.length === 1 && (kind === "team" || wordCounts.get(kept[0]) === 1))) keys.add(kept.join(" "));
  if (kind === "team") {
    // US teams: the nickname alone ("patriots", "red sox") — may fill several
    // franchises that share it (Minneapolis and Los Angeles Lakers).
    keys.add(words[words.length - 1]);
    if (words.length > 2) keys.add(words.slice(-2).join(" "));
  } else {
    // Clubs: any word that identifies only this club in the quiz ("dortmund", "villa").
    for (const w of words) {
      if (w.length >= 4 && !CLUB_STOPWORDS.has(w) && wordCounts.get(w) === 1) keys.add(w);
    }
  }
  return keys;
}

function quiz(el, cat) {
  const pref = (k, d) => prefs.get(`misc-${cat.id}-${k}`, d);
  const save = (k, v) => prefs.set(`misc-${cat.id}-${k}`, v);
  let chosen = new Set(pref("sets", cat.defaults));
  let since = pref("since", 0);
  let showClues = pref("clues", true);
  let showExtra = pref("extra", false);
  const hasExtra = cat.sets.some((s) => s.items.some((it) => it.extra));
  let slots = [], answers = new Map(), state = "ready", remaining = 0, timer = null;

  el.innerHTML = `<div class="pagehead"><h1>${esc(cat.title)}</h1>
      <span class="sub"><a href="#/misc">Misc</a> › ${esc(cat.sub)}</span></div>
    <div id="mq-setup"></div><div id="mq-body"></div>`;
  setupPanel();
  build();

  function setupPanel() {
    $("#mq-setup", el).innerHTML = `
      <div class="controls">
        <div class="ctl" style="flex-basis:100%"><span class="lbl">Include</span>
          <div class="btnrow" style="gap:4px">
            ${cat.sets.map((s) => `<span class="chip${chosen.has(s.id) ? " on" : ""}" data-set="${s.id}"
              title="${esc(s.title)}">${s.emoji} ${esc(s.label)}</span>`).join("")}
          </div></div>
        <div class="ctl"><label for="mq-since">Since</label><select id="mq-since">
          ${SINCE.map((y) => `<option value="${y}"${y === since ? " selected" : ""}>${y ? y : "All time"}</option>`).join("")}
        </select></div>
        <label class="ctl check"><input type="checkbox" id="mq-clues" ${showClues ? "checked" : ""}> Show years</label>
        ${hasExtra ? `<label class="ctl check"><input type="checkbox" id="mq-extra" ${showExtra ? "checked" : ""}> Show teams</label>` : ""}
        <div class="ctl"><span class="lbl">&nbsp;</span><div class="btnrow">
          ${cat.presets.map(([label, ids]) => `<span class="chip" data-preset="${ids.join(",")}">${esc(label)}</span>`).join("")}
          <span class="chip" data-preset="all">All</span>
          <span class="chip" data-preset="">Clear</span></div></div>
      </div>`;
    $$("[data-set]", el).forEach((chip) => (chip.onclick = () => {
      chosen.has(chip.dataset.set) ? chosen.delete(chip.dataset.set) : chosen.add(chip.dataset.set);
      changed();
    }));
    $$("[data-preset]", el).forEach((chip) => (chip.onclick = () => {
      const v = chip.dataset.preset;
      chosen = new Set(v === "all" ? cat.sets.map((s) => s.id) : v ? v.split(",") : []);
      changed();
    }));
    $("#mq-since", el).onchange = (e) => { since = +e.target.value; changed(); };
    $("#mq-clues", el).onchange = (e) => { showClues = e.target.checked; save("clues", showClues); draw(); };
    const ex = $("#mq-extra", el);
    if (ex) ex.onchange = (e) => { showExtra = e.target.checked; save("extra", showExtra); draw(); };
  }

  function changed() {
    save("sets", [...chosen]);
    save("since", since);
    setupPanel();
    build();
  }

  function build() {
    stop();
    state = "ready";
    slots = [];
    answers = new Map();
    const sets = cat.sets.filter((s) => chosen.has(s.id));
    const items = sets.flatMap((s) => s.items.filter((it) => it.to >= since).map((it) => ({ set: s, it })));

    // How many distinct answers each word appears in, to find distinctive club words.
    const wordCounts = new Map();
    for (const a of new Set(items.map(({ it }) => it.answer))) {
      for (const w of new Set(fold(a).split(" "))) wordCounts.set(w, (wordCounts.get(w) || 0) + 1);
    }

    for (const { set, it } of items) {
      // One answer per list: a club in both the Bundesliga and Champions League is two answers.
      const key = set.id + "|" + it.answer;
      if (!answers.has(key)) {
        const keys = cat.kind === "person" ? nameKeys(it.answer) : teamKeys(it.answer, cat.kind, wordCounts);
        for (const a of ALIASES[it.answer] || []) keys.add(fold(a));
        answers.set(key, { name: it.answer, keys, found: false });
      }
      slots.push({ set, answer: answers.get(key), it });
    }
    remaining = Math.min(30 * 60, Math.max(90, answers.size * 15));
    draw();
  }

  function foundCount() {
    return [...answers.values()].filter((a) => a.found).length;
  }

  function draw() {
    const body = $("#mq-body", el);
    if (!slots.length) {
      body.innerHTML = `<div class="empty">Pick at least one list above${since ? " (or try an earlier “since” year)" : ""}.</div>`;
      return;
    }
    const groups = cat.sets.filter((s) => slots.some((sl) => sl.set === s));
    const total = answers.size;
    body.innerHTML = `
      <div class="quizbar">
        <b style="font-size:14px">${groups.length === 1 ? `${groups[0].emoji} ${esc(groups[0].title)}` : `${groups.length} lists`}${since ? ` since ${since}` : ""}</b>
        ${state === "ready"
          ? `<button class="btn" id="mq-start">Start quiz</button>`
          : `<input id="mq-input" type="text" placeholder="Enter an answer…" autocomplete="off" autocapitalize="off" spellcheck="false" ${state === "over" ? "disabled" : ""}>`}
        <span style="margin-left:auto" class="score" id="mq-score">${foundCount()}/${total}</span>
        <span class="timer" id="mq-timer">${fmt(remaining)}</span>
        ${state === "playing" ? `<button class="btn ghost" id="mq-giveup">Give up</button>` : ""}
        ${state === "over" ? `<button class="btn" id="mq-retry">Play again</button>` : ""}
      </div>
      ${state === "over" ? `<div class="feedback ${foundCount() === total ? "ok" : "bad"}" style="margin-top:10px">
        You named <b>${foundCount()}</b> of ${plural(total, cat.noun)} (${Math.round((foundCount() / total) * 100)}%). Missed answers are in red.</div>` : ""}
      ${groups.map((g) => `
        ${sectionTitle(`${g.emoji} ${g.title}`)}
        <div class="slots">
          ${slots.map((s, i) => s.set !== g ? "" : `
            <div class="slot ${s.answer.found ? "found" : state === "over" ? "missed" : ""}" data-i="${i}">
              ${showClues || state === "over" ? `<span class="small muted" style="min-width:74px">${esc(s.it.clue)}</span>` : ""}
              <span class="nm">${s.answer.found || state === "over" ? displayName(s.answer.name) : ""}</span>
              ${s.it.extra && (showExtra || state === "over") ? `<span class="small muted">${esc(s.it.extra)}</span>` : ""}
            </div>`).join("")}
        </div>`).join("")}`;

    $("#mq-start", body)?.addEventListener("click", begin);
    $("#mq-giveup", body)?.addEventListener("click", end);
    $("#mq-retry", body)?.addEventListener("click", build);
    const input = $("#mq-input", body);
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
      const t = $("#mq-timer", el);
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
      $(".nm", div).innerHTML = displayName(s.answer.name);
    });
    $("#mq-score", el).textContent = `${foundCount()}/${answers.size}`;
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
