import { DB, latestSeason, clubRank } from "../data.js";
import { summary } from "../store.js";
import { sectionTitle, clubTag, playerLink, bar, goalSq, esc, pick, ordinal, masteryDot } from "../ui.js";

const MODES = [
  ["#/learn", "Learn", "Adaptive rounds: multiple choice first, then type the number"],
  ["#/flashcards", "Flashcards", "Flip through player-seasons and mark what you know"],
  ["#/test", "Test", "A mixed exam — typed, multiple choice, true/false, who scored more"],
  ["#/list", "Name Them", "Sporcle-style: name every scorer in a season against the clock"],
  ["#/higher-lower", "Higher or Lower", "Did they score more or fewer? Keep the streak alive"],
  ["#/browse", "Season Tables", "Every scorer, every club, every season since 1992/93"],
  ["#/misc/leaders", "Misc: World Leaders", "Name every UK prime minister, US president and more"],
];

export function render(el) {
  const s = latestSeason();
  const latest = DB.bySeason[s];
  const top = latest.slice(0, 10);

  // Golden Boot: top scorer(s) each season, newest first.
  const boots = DB.bySeason.map((rows, i) => {
    const best = rows[0]?.g ?? 0;
    return { s: i, rows: rows.filter((r) => r.g === best) };
  }).reverse();

  const career = DB.players.map((_, p) => p).sort((a, b) => DB.careerGoals[b] - DB.careerGoals[a]).slice(0, 10);

  const overall = summary(DB.rows.filter((r) => r.g >= 5));

  el.innerHTML = `
    <div class="grid3">
      <div>
        ${sectionTitle("Latest Season")}
        <div class="card">
          <div class="card-tag red"><span class="dot"></span>Premier League</div>
          <div class="card-head"><h2>${DB.seasons[s]} Top Scorers</h2><span class="badge">${latest.length} SCORERS</span></div>
          <div class="subhead">▾ Leaderboard</div>
          <table class="dg">
            ${top.map((r, i) => `<tr>
              <td class="rank">${i + 1}</td>
              <td class="name">${playerLink(r.p)}</td>
              <td class="hide-sm">${clubTag(r.c, true)}</td>
              <td class="barcell">${bar(r.g, top[0].g)}</td></tr>`).join("")}
          </table>
          <div class="chips">
            <a class="chip" href="#/browse?season=${s}">Full table</a>
            <a class="chip" href="#/flashcards?season=${s}&min=3">Flashcards</a>
            <a class="chip" href="#/learn?season=${s}&min=5">Learn</a>
            <a class="chip live" href="#/list?season=${s}&min=8">Name them</a>
          </div>
        </div>

        <div class="card" style="margin-top:12px">
          <div class="card-tag blue"><span class="dot"></span>Every Season</div>
          <div class="card-head"><h2>Golden Boot</h2><span class="sub">Top league scorer(s)</span></div>
          <div class="tablewrap" style="max-height:420px;overflow:auto">
          <table class="dg">
            <tr><th>Season</th><th>Player</th><th class="hide-sm">Club</th><th class="num">G</th></tr>
            ${boots.map(({ s, rows }) => rows.map((r, j) => `<tr>
              <td>${j ? "" : `<a href="#/browse?season=${s}">${DB.seasons[s]}</a>`}</td>
              <td class="name">${playerLink(r.p)}</td>
              <td class="hide-sm">${clubTag(r.c, true)}</td>
              <td class="num">${goalSq(r.g)}</td></tr>`).join("")).join("")}
          </table>
          </div>
        </div>
      </div>

      <div>
        ${sectionTitle("Study Modes")}
        <div class="card modelist">
          ${MODES.map(([href, t, d]) => `<a href="${href}"><b>${t}</b><span>${d}</span></a>`).join("")}
        </div>

        <div class="card" style="margin-top:12px">
          <div class="card-tag green"><span class="dot"></span>All-Time</div>
          <div class="card-head"><h2>Career PL Goals</h2><span class="sub">${DB.seasons[0]}–${DB.seasons[s]}</span></div>
          <table class="dg">
            ${career.map((p, i) => `<tr>
              <td class="rank">${i + 1}</td>
              <td class="name">${playerLink(p)}</td>
              <td class="barcell">${bar(DB.careerGoals[p], DB.careerGoals[career[0]], "blue")}</td></tr>`).join("")}
          </table>
        </div>
      </div>

      <div>
        ${sectionTitle("Your Progress")}
        <div class="card">
          <div class="card-tag green"><span class="dot"></span>Mastery</div>
          <div class="statline">
            <span class="big">${overall.mastered}</span>
            <span>of <b>${overall.total.toLocaleString()}</b> player-seasons with 5+ goals mastered
              <br><span class="muted small">${overall.seen.toLocaleString()} studied so far</span></span>
          </div>
          <div class="subhead">▾ By season (5+ goals)</div>
          <div style="max-height:330px;overflow:auto">
          <table class="dg">
            <tr><th>Season</th><th class="num">Cards</th><th>Mastered</th></tr>
            ${DB.seasons.map((name, i) => {
              const sum = summary(DB.bySeason[i].filter((r) => r.g >= 5));
              return `<tr><td><a href="#/learn?season=${i}&min=5">${name}</a></td>
                <td class="num">${sum.total}</td>
                <td class="barcell">${bar(sum.mastered, Math.max(1, sum.total), "green")}</td></tr>`;
            }).reverse().join("")}
          </table>
          </div>
        </div>

        <div class="card" style="margin-top:12px" id="quickfire"></div>
      </div>
    </div>`;

  quickfire(el.querySelector("#quickfire"));
}

/** One random question card with a reveal — a taster of the study modes. */
function quickfire(card) {
  const pool = DB.rows.filter((r) => r.g >= 6);
  const r = pick(pool);
  const rank = clubRank(r);
  card.innerHTML = `
    <div class="card-tag red"><span class="dot"></span>Quickfire</div>
    <div class="factbox">
      <div class="q">How many league goals did <b>${esc(DB.players[r.p])}</b> score for ${clubTag(r.c)} in <b>${DB.seasons[r.s]}</b>?</div>
      <div class="a btnrow">
        <button class="btn ghost" data-reveal>Reveal</button>
        <span class="hidden" data-answer>${goalSq(r.g)} — ${ordinal(rank)} at the club that season ${masteryDot(r)}</span>
        <button class="btn ghost" data-next style="margin-left:auto">Another</button>
      </div>
    </div>`;
  card.querySelector("[data-reveal]").onclick = (e) => {
    e.target.classList.add("hidden");
    card.querySelector("[data-answer]").classList.remove("hidden");
  };
  card.querySelector("[data-next]").onclick = () => quickfire(card);
}
