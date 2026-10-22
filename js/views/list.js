// Sporcle-style list quiz: name every scorer in the list before the clock
// runs out. Slots show goals (and optionally club) as clues.

import { DB, filterRows } from "../data.js";
import { record, prefs } from "../store.js";
import { $, esc, clubTag, filterPanel, loadFilter, goalSq, nameKeys } from "../ui.js";
import { nameQuiz } from "../namequiz.js";

export function render(el, params) {
  const filter = loadFilter("list", params, 8);
  let showClubs = prefs.get("list-clubs", true);
  let stop = null;

  el.innerHTML = `
    <div class="pagehead"><h1>Name Them</h1><span class="sub">Type a player's surname or full name — correct answers fill in automatically.</span></div>
    <div id="l-filter"></div>
    <div id="l-body"></div>`;

  const extra = () => `<label class="ctl check"><input type="checkbox" id="l-clubs" ${showClubs ? "checked" : ""}> Show clubs as clues</label>`;

  filterPanel($("#l-filter", el), "list", filter, (f, rows) => {
    $("#l-clubs", el).onchange = (e) => { showClubs = e.target.checked; prefs.set("list-clubs", showClubs); setup(rows); };
    setup(rows);
  }, extra());

  function title() {
    if (filter.player >= 0) return `${esc(DB.players[filter.player])}'s seasons`;
    const span = filter.from === filter.to ? DB.seasons[filter.from] : `${DB.seasons[filter.from]}–${DB.seasons[filter.to]}`;
    const who = filter.club >= 0 ? esc(DB.clubs[filter.club]) : "Premier League";
    return `${span} ${who} scorers with ${filter.min}+ goals`;
  }

  function setup(rows) {
    stop?.();
    const multiSeason = filter.from !== filter.to || filter.player >= 0;
    const slots = [...rows].sort((a, b) => b.g - a.g || a.c - b.c).map((r) => ({
      r,
      answer: r.p,
      name: esc(DB.players[r.p]),
      keys: nameKeys(DB.players[r.p]),
      label: `${r.g} goals${showClubs ? `, ${DB.clubs[r.c]}` : ""}${multiSeason ? `, ${DB.seasons[r.s]}` : ""}`,
      left: () => goalSq(r.g),
      right: (over) => `${showClubs || over ? clubTag(r.c, true) : ""}${multiSeason ? `<span class="small muted">${DB.seasons[r.s]}</span>` : ""}`,
    }));
    stop = nameQuiz($("#l-body", el), {
      title: title(), noun: "player", groups: [{ slots }], minGuess: 2,
      seconds: Math.min(20 * 60, Math.max(60, slots.length * 12)),
      blocked: slots.length > 300 ? `${slots.length} answers is a lot — narrow the filter (max 300).` : "",
      onEnd: (results) => results.forEach(({ slot, ok }) => record(slot.r, ok)),
    });
  }

  return () => stop?.();
}
