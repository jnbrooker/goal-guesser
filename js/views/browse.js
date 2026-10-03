import { DB, latestSeason, clubsIn, fold, POSITIONS } from "../data.js";
import { prefs } from "../store.js";
import { $, $$, esc, clubTag, playerLink, goalSq, bar, masteryDot, sectionTitle } from "../ui.js";

export function render(el, params) {
  let s = params.has("season") ? +params.get("season") : prefs.get("browse-season", latestSeason());
  if (!(s >= 0 && s <= latestSeason())) s = latestSeason();
  let club = params.has("club") ? +params.get("club") : -1;
  let cover = prefs.get("browse-cover", false);
  let sort = "goals";
  let q = "";

  function draw() {
    prefs.set("browse-season", s);
    const clubs = clubsIn(s, s);
    if (!clubs.includes(club)) club = -1;
    let rows = DB.bySeason[s].filter((r) => club < 0 || r.c === club);
    if (q) rows = rows.filter((r) => DB.foldedNames[r.p].includes(q));
    if (sort === "name") rows = [...rows].sort((a, b) => DB.players[a.p].split(" ").pop().localeCompare(DB.players[b.p].split(" ").pop()));
    if (sort === "pos") rows = [...rows].sort((a, b) => "GDMF".indexOf(DB.pos[a.p]) - "GDMF".indexOf(DB.pos[b.p]) || b.g - a.g);
    if (sort === "club") rows = [...rows].sort((a, b) => DB.clubs[a.c].localeCompare(DB.clubs[b.c]) || b.g - a.g);
    const max = rows.reduce((m, r) => Math.max(m, r.g), 1);
    const total = DB.bySeason[s].reduce((t, r) => t + r.g, 0);
    const filtered = club >= 0 ? `&club=${club}` : "";

    el.innerHTML = `
      <div class="pagehead">
        <h1>${DB.seasons[s]} ${club >= 0 ? esc(DB.clubs[club]) : "Premier League"} scorers</h1>
        <span class="sub">${rows.length} scorers · ${total.toLocaleString()} goals in the season (excl. own goals)</span>
      </div>
      <div class="controls">
        <div class="ctl"><span class="lbl">Season</span>
          <div class="btnrow">
            <button class="btn ghost" data-step="-1" ${s === 0 ? "disabled" : ""}>‹</button>
            <select id="b-season">${DB.seasons.map((n, i) => `<option value="${i}"${i === s ? " selected" : ""}>${n}</option>`).join("")}</select>
            <button class="btn ghost" data-step="1" ${s === latestSeason() ? "disabled" : ""}>›</button>
          </div></div>
        <div class="ctl"><label for="b-club">Club</label><select id="b-club">
          <option value="-1">All clubs</option>
          ${clubs.map((c) => `<option value="${c}"${c === club ? " selected" : ""}>${esc(DB.clubs[c])}</option>`).join("")}
        </select></div>
        <div class="ctl"><label for="b-q">Filter</label><input id="b-q" type="search" placeholder="Player name" value="${esc(q)}"></div>
        <label class="ctl check"><input type="checkbox" id="b-cover" ${cover ? "checked" : ""}> Cover goals (click to reveal)</label>
        <div class="ctl" style="margin-left:auto"><span class="lbl">Study this</span>
          <div class="btnrow">
            <a class="chip" href="#/flashcards?season=${s}${filtered}&min=1">Flashcards</a>
            <a class="chip" href="#/learn?season=${s}${filtered}&min=1">Learn</a>
            <a class="chip live" href="#/list?season=${s}${filtered}&min=${club >= 0 ? 1 : 8}">Name them</a>
          </div></div>
      </div>
      ${club < 0 && !q ? clubSummary(s) : ""}
      <div class="card tablewrap">
        <table class="dg">
          <tr>
            <th>#</th>
            <th class="sortable" data-sort="name">Player</th>
            <th class="sortable" data-sort="pos" title="Position">Pos</th>
            <th class="sortable" data-sort="club">Club</th>
            <th class="sortable num" data-sort="goals">Goals</th>
            <th></th>
            <th title="Your mastery">M</th>
          </tr>
          ${rows.map((r, i) => `<tr>
            <td class="rank">${i + 1}</td>
            <td class="name">${playerLink(r.p)}</td>
            <td class="muted" title="${POSITIONS[DB.pos[r.p]] || ""}">${DB.pos[r.p]}</td>
            <td>${clubTag(r.c, true)}</td>
            <td class="num">${goalSq(r.g, cover)}</td>
            <td class="barcell">${cover ? "" : bar(r.g, max)}</td>
            <td>${masteryDot(r)}</td></tr>`).join("") || `<tr><td colspan="7" class="empty">No scorers match.</td></tr>`}
        </table>
      </div>`;

    $("#b-season", el).onchange = (e) => { s = +e.target.value; draw(); };
    $$("[data-step]", el).forEach((b) => (b.onclick = () => { s += +b.dataset.step; draw(); }));
    $("#b-club", el).onchange = (e) => { club = +e.target.value; draw(); };
    $("#b-cover", el).onchange = (e) => { cover = e.target.checked; prefs.set("browse-cover", cover); draw(); };
    $$("[data-sort]", el).forEach((th) => (th.onclick = () => { sort = th.dataset.sort; draw(); }));
    $$("[data-club]", el).forEach((a) => (a.onclick = (e) => { e.preventDefault(); club = +a.dataset.club; draw(); }));
    const input = $("#b-q", el);
    input.oninput = () => {
      q = fold(input.value);
      draw();
      const again = $("#b-q", el);
      again.focus();
      again.setSelectionRange(again.value.length, again.value.length);
    };
    $$(".sq.hide", el).forEach((sq) => (sq.onclick = () => {
      sq.classList.remove("hide");
      sq.textContent = sq.dataset.g;
    }));
  }

  draw();
}

/** Compact grid of clubs with their top scorer — click to filter. */
function clubSummary(s) {
  const clubs = clubsIn(s, s).map((c) => {
    const rows = DB.bySeason[s].filter((r) => r.c === c);
    return { c, top: rows[0], goals: rows.reduce((t, r) => t + r.g, 0), n: rows.length };
  }).sort((a, b) => b.goals - a.goals);
  return `
    ${sectionTitle("Clubs")}
    <div class="card tablewrap" style="margin-bottom:12px">
      <table class="dg">
        <tr><th>Club</th><th class="num">Scorers</th><th class="num">Goals</th><th>Top scorer</th><th class="num">G</th></tr>
        ${clubs.map(({ c, top, goals, n }) => `<tr>
          <td><a href="#" data-club="${c}">${clubTag(c)}</a></td>
          <td class="num">${n}</td><td class="num">${goals}</td>
          <td class="name">${playerLink(top.p)}</td><td class="num">${top.g}</td></tr>`).join("")}
      </table>
    </div>
    ${sectionTitle("All scorers")}`;
}
