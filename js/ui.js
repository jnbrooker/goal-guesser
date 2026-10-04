// Shared rendering helpers.

import { DB, clubColour, clubsIn, filterRows, latestSeason, goalLog, POSITIONS, fold } from "./data.js";
import { box, prefs, summary } from "./store.js";

export const $ = (sel, el = document) => el.querySelector(sel);
export const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];

export const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

export function shuffle(a) {
  const arr = [...a];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export const pick = (a) => a[Math.floor(Math.random() * a.length)];

export const sectionTitle = (t) => `<div class="section-title"><span>${esc(t)}</span></div>`;

export const clubTag = (c, dim = false) =>
  `<span class="club${dim ? " dim" : ""}"><i style="background:${clubColour(c)}"></i>${esc(DB.clubs[c])}</span>`;

export const playerLink = (p) => `<a href="#/player/${p}">${esc(DB.players[p])}</a>`;

export function goalSq(g, hidden = false) {
  const c = g >= 25 ? 5 : g >= 18 ? 4 : g >= 12 ? 3 : g >= 7 ? 2 : g >= 3 ? 1 : 0;
  return `<span class="sq c${c}${hidden ? " hide" : ""}" data-g="${g}">${hidden ? "?" : g}</span>`;
}

export const bar = (v, max, cls = "") =>
  `<div class="bar ${cls}"><i style="width:${Math.max(1, (v / max) * 100)}%"></i><b>${v}</b></div>`;

export const masteryDot = (r) => {
  const b = box(r);
  const label = b === 0 ? "Not studied" : b < 3 ? "Learning" : "Mastered";
  return `<span class="mastery b${b}" title="${label}"></span>`;
};

export const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** "1st", "2nd", … */
export function ordinal(n) {
  const s = ["th", "st", "nd", "rd"], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

// ---------------------------------------------------------------------------
// Deck filter: which player-seasons a study mode draws from.
// Saved per mode; URL params (?from=&to=&club=&min=&player=) override it.

export function defaultFilter(min = 5) {
  const s = latestSeason();
  return { from: s, to: s, club: -1, min, player: -1 };
}

export function loadFilter(mode, params, min) {
  const f = { ...defaultFilter(min), ...prefs.get("filter-" + mode, {}) };
  for (const k of ["from", "to", "club", "min", "player"]) {
    if (params.has(k)) f[k] = parseInt(params.get(k), 10);
  }
  if (params.has("season")) f.from = f.to = parseInt(params.get("season"), 10);
  if (params.has("from") || params.has("season") || params.has("club")) {
    if (!params.has("player")) f.player = -1;
  }
  const last = latestSeason();
  f.from = clamp(f.from, 0, last);
  f.to = clamp(f.to, f.from, last);
  return f;
}

const clamp = (v, lo, hi) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : hi);

const MINS = [1, 2, 3, 5, 8, 10, 15, 20];

/**
 * Render deck filter controls into `el`. Calls onChange(filter, rows) on load
 * and on every change. `extra` is HTML appended inside the controls bar.
 */
export function filterPanel(el, mode, filter, onChange, extra = "") {
  const seasonOpts = (sel) =>
    DB.seasons.map((s, i) => `<option value="${i}"${i === sel ? " selected" : ""}>${s}</option>`).join("");

  function render() {
    const clubs = clubsIn(filter.from, filter.to);
    if (filter.club >= 0 && !clubs.includes(filter.club)) filter.club = -1;
    const rows = filterRows(filter);
    const sum = summary(rows);
    el.innerHTML = `
      <div class="controls">
        ${filter.player >= 0 ? `
          <div class="ctl"><span class="lbl">Player</span>
            <span class="count"><b>${esc(DB.players[filter.player])}</b>
            <a href="#" data-clear-player class="small muted">(clear)</a></span></div>` : `
          <div class="ctl"><label for="f-from">From</label><select id="f-from">${seasonOpts(filter.from)}</select></div>
          <div class="ctl"><label for="f-to">To</label><select id="f-to">${seasonOpts(filter.to)}</select></div>
          <div class="ctl"><label for="f-club">Club</label><select id="f-club">
            <option value="-1">All clubs</option>
            ${clubs.map((c) => `<option value="${c}"${c === filter.club ? " selected" : ""}>${esc(DB.clubs[c])}</option>`).join("")}
          </select></div>`}
        <div class="ctl"><label for="f-min">Min goals</label><select id="f-min">
          ${MINS.map((m) => `<option value="${m}"${m === filter.min ? " selected" : ""}>${m}+</option>`).join("")}
        </select></div>
        <div class="ctl"><span class="lbl">Deck</span><span class="count"><b>${rows.length}</b> cards ·
          <span class="muted">${sum.mastered} mastered</span></span></div>
        ${extra}
      </div>`;
    const sel = (id) => $("#" + id, el);
    const bind = (id, key) =>
      sel(id)?.addEventListener("change", (e) => {
        filter[key] = parseInt(e.target.value, 10);
        if (key === "from" && filter.to < filter.from) filter.to = filter.from;
        if (key === "to" && filter.from > filter.to) filter.from = filter.to;
        commit();
      });
    bind("f-from", "from");
    bind("f-to", "to");
    bind("f-club", "club");
    bind("f-min", "min");
    $("[data-clear-player]", el)?.addEventListener("click", (e) => {
      e.preventDefault();
      filter.player = -1;
      commit();
    });
    onChange(filter, rows);
  }

  function commit() {
    prefs.set("filter-" + mode, { ...filter, player: -1 });
    render();
  }

  render();
  return { refresh: render };
}

/** Number input answer check: exact, or within one goal. */
export function grade(guess, actual) {
  if (guess === actual) return "ok";
  if (Math.abs(guess - actual) === 1) return "close";
  return "bad";
}

/** Distinct plausible wrong goal counts near the answer. */
export function goalOptions(g, n = 4) {
  const opts = new Set([g]);
  const spread = Math.max(3, Math.round(g * 0.35));
  let guard = 0;
  while (opts.size < n && guard++ < 200) {
    const d = Math.floor(Math.random() * (spread * 2 + 1)) - spread;
    const v = g + d;
    if (v >= 1) opts.add(v);
  }
  return shuffle([...opts]);
}

/** Describe a row as "for Arsenal in 2003/04". */
export const rowContext = (r) => `${clubTag(r.c)} <span class="muted">·</span> ${DB.seasons[r.s]}`;

/** "Forward · England" */
export function playerMeta(p) {
  return [POSITIONS[DB.pos[p]], DB.nat[p]].filter(Boolean).map(esc).join(" · ");
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const shortDate = (iso) => `${+iso.slice(8, 10)} ${MONTHS[+iso.slice(5, 7) - 1]}`;
const minuteLabel = (m) => (m.endsWith("p") ? `${m.slice(0, -1)}′ <span class="pen">pen</span>` : `${m}′`);

/** One-line summary of a row's goals, e.g. for answer feedback. */
export async function goalHighlights(r) {
  return logHighlights(await goalLog(r));
}

/** Memorable hooks: braces, hat-tricks, penalties, favourite opponent. */
function logHighlights(log) {
  const multi = log.filter((m) => m.n >= 2);
  const hats = log.filter((m) => m.n >= 3).length;
  const pens = log.reduce((t, m) => t + (m.minutes ? m.minutes.filter((x) => x.endsWith("p")).length : 0), 0);
  const byOpp = new Map();
  for (const m of log) byOpp.set(m.opp, (byOpp.get(m.opp) || 0) + m.n);
  const [favOpp, favN] = [...byOpp].sort((a, b) => b[1] - a[1])[0] || [];
  const parts = [`Scored in <b>${log.length}</b> match${log.length === 1 ? "" : "es"}`];
  if (hats) parts.push(`<b>${hats}</b> hat-trick${hats === 1 ? "" : "s"}`);
  if (multi.length - hats) parts.push(`<b>${multi.length - hats}</b> brace${multi.length - hats === 1 ? "" : "s"}`);
  if (pens) parts.push(`<b>${pens}</b> penalt${pens === 1 ? "y" : "ies"}`);
  if (favN >= 2) parts.push(`most vs ${esc(DB.clubs[favOpp])} (<b>${favN}</b>)`);
  return parts.join(" · ");
}

/** Fill `el` with a row's match-by-match goal log. */
export async function renderGoalLog(el, r) {
  el.innerHTML = `<div class="muted small" style="padding:6px">Loading goals…</div>`;
  let log;
  try {
    log = await goalLog(r);
  } catch (err) {
    el.innerHTML = `<div class="muted small" style="padding:6px">Couldn't load match details (${esc(err.message)}).
      <a href="#" data-retry>Try again</a></div>`;
    el.querySelector("[data-retry]").onclick = (e) => {
      e.preventDefault();
      renderGoalLog(el, r);
    };
    return;
  }
  const hasMinutes = log.some((m) => m.minutes);
  el.innerHTML = `
    <div class="loghead">${logHighlights(log)}</div>
    <table class="dg goallog">
      <tr><th>Date</th><th>Opponent</th><th>Result</th><th>Goals</th>${hasMinutes ? "<th>Minutes</th>" : ""}</tr>
      ${log.map((m) => `<tr>
        <td class="muted">${shortDate(m.date)}</td>
        <td>${clubTag(m.opp, true)} <span class="muted small">(${m.home ? "H" : "A"})</span></td>
        <td><span class="res ${m.result}">${m.result}</span> ${m.scored}–${m.conceded}</td>
        <td>⚽${m.n > 1 ? `<b>×${m.n}</b>` : ""}</td>
        ${hasMinutes ? `<td class="small mins">${m.minutes.map(minuteLabel).join(", ")}</td>` : ""}</tr>`).join("")}
    </table>
    ${hasMinutes ? "" : `<div class="muted small" style="padding:4px 6px">Goal minutes aren't available from 2020/21 onwards.</div>`}`;
}

/**
 * Accepted answers for a name-them quiz: full name, surname, last two words
 * ("van Persie"), first + last. Peerage titles count too, so "Robert
 * Jenkinson, 2nd Earl of Liverpool" also accepts "Liverpool" and "Lord Liverpool".
 */
export function nameKeys(name) {
  const [main, ...titles] = name.split(", ");
  const f = fold(main).replace(/ the (younger|elder)$/, "");
  const parts = f.split(" ");
  const keys = new Set([fold(main), f, f.replace(/ /g, "")]);
  if (parts.length > 1) {
    keys.add(parts[parts.length - 1]);
    keys.add(parts.slice(-2).join(" "));
    keys.add(parts.slice(1).join(" "));
    keys.add(parts[0] + " " + parts[parts.length - 1]);
  }
  for (const t of titles) {
    const title = fold(t.replace(/^\d+(st|nd|rd|th) /, "")); // "earl of liverpool"
    const m = title.match(/^(duke|marquess|earl|viscount|baron|lord) (?:of )?(.+)$/);
    if (!m) continue;
    const place = m[2];
    keys.add(title);
    keys.add(place);
    keys.add(place.split(" ")[0]); // "newcastle upon tyne" -> "newcastle"
    keys.add("lord " + place);
  }
  keys.delete("");
  return keys;
}
