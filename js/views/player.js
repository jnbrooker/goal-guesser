import { DB, clubRank } from "../data.js";
import { summary } from "../store.js";
import { esc, clubTag, bar, goalSq, masteryDot, ordinal, sectionTitle } from "../ui.js";

export function render(el, params, arg) {
  const p = parseInt(arg, 10);
  if (!(p >= 0 && p < DB.players.length)) {
    el.innerHTML = `<div class="empty">Player not found.</div>`;
    return;
  }
  const rows = DB.byPlayer[p];
  const max = Math.max(...rows.map((r) => r.g));
  const clubs = [...new Set(rows.map((r) => r.c))];
  const sum = summary(rows);
  const best = rows.reduce((a, b) => (b.g > a.g ? b : a));

  el.innerHTML = `
    <div class="pagehead">
      <h1>${esc(DB.players[p])}</h1>
      <span class="sub">${DB.careerGoals[p]} Premier League goals · ${rows.length} scoring season${rows.length === 1 ? "" : "s"} ·
        ${clubs.length} club${clubs.length === 1 ? "" : "s"}</span>
    </div>
    <div class="grid2">
      <div>
        ${sectionTitle("Season by season")}
        <div class="card tablewrap">
          <table class="dg">
            <tr><th>Season</th><th>Club</th><th class="num">Goals</th><th></th><th>At club</th><th>M</th></tr>
            ${rows.map((r) => `<tr>
              <td><a href="#/browse?season=${r.s}">${DB.seasons[r.s]}</a></td>
              <td>${clubTag(r.c)}</td>
              <td class="num">${goalSq(r.g)}</td>
              <td class="barcell">${bar(r.g, max, "green")}</td>
              <td class="muted">${ordinal(clubRank(r))}</td>
              <td>${masteryDot(r)}</td></tr>`).join("")}
          </table>
          <div class="chips">
            <a class="chip" href="#/flashcards?player=${p}&min=1">Flashcards</a>
            <a class="chip" href="#/learn?player=${p}&min=1">Learn</a>
            <span class="chip" style="cursor:default">${sum.mastered}/${sum.total} mastered</span>
          </div>
        </div>
      </div>
      <div>
        ${sectionTitle("By club")}
        <div class="card">
          <table class="dg">
            <tr><th>Club</th><th class="num">Seasons</th><th class="num">Goals</th></tr>
            ${clubs.map((c) => {
              const cr = rows.filter((r) => r.c === c);
              return `<tr><td>${clubTag(c)}</td><td class="num">${cr.length}</td>
                <td class="num">${cr.reduce((t, r) => t + r.g, 0)}</td></tr>`;
            }).join("")}
          </table>
          <div class="card-body small muted" style="padding-top:8px">
            Best season: <b>${best.g}</b> for ${esc(DB.clubs[best.c])} in ${DB.seasons[best.s]}.
            Seasons without a league goal aren't listed.
          </div>
        </div>
      </div>
    </div>`;
}
