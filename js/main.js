import { DB, loadData } from "./data.js";
import { $, $$, esc } from "./ui.js";
import * as home from "./views/home.js";
import * as browse from "./views/browse.js";
import * as player from "./views/player.js";
import * as flashcards from "./views/flashcards.js";
import * as learn from "./views/learn.js";
import * as test from "./views/test.js";
import * as list from "./views/list.js";
import * as higherLower from "./views/higherlower.js";
import * as misc from "./views/misc.js";

const ROUTES = {
  "": home, browse, player, flashcards, learn, test, list, "higher-lower": higherLower, misc,
};

let cleanup = null;

function route() {
  const hash = location.hash.replace(/^#\/?/, "");
  const [path, query = ""] = hash.split("?");
  const [name, arg] = path.split("/");
  const view = ROUTES[name] || home;
  if (cleanup) cleanup();
  cleanup = null;
  $$(".mainmenu a").forEach((a) => a.classList.toggle("active", a.dataset.nav === name));
  const main = $("#main");
  main.innerHTML = "";
  window.scrollTo(0, 0);
  cleanup = view.render(main, new URLSearchParams(query), arg) || null;
}

function subnav() {
  const first = DB.seasons[0], last = DB.seasons[DB.seasons.length - 1];
  $("#subnav").innerHTML = `
    <span><b>${first} – ${last}</b> Premier League</span>
    <span><b>${DB.players.length.toLocaleString()}</b> scorers</span>
    <span><b>${DB.rows.length.toLocaleString()}</b> player-seasons</span>
    <span class="right"><a href="#/browse">Season tables ▾</a></span>`;
}

function setupSearch() {
  const input = $("#search"), box = $("#searchresults");
  let sel = -1;
  const close = () => { box.classList.add("hidden"); sel = -1; };
  input.addEventListener("input", () => {
    const q = input.value.trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
    if (q.length < 2) return close();
    const hits = [];
    for (let p = 0; p < DB.players.length && hits.length < 40; p++) {
      if (DB.foldedNames[p].includes(q)) hits.push(p);
    }
    hits.sort((a, b) => DB.careerGoals[b] - DB.careerGoals[a]);
    box.innerHTML = hits.slice(0, 12).map((p) => {
      const rows = DB.byPlayer[p];
      const span = `${DB.seasons[rows[0].s].slice(0, 4)}–${DB.seasons[rows[rows.length - 1].s].slice(0, 4)}`;
      return `<a href="#/player/${p}">${esc(DB.players[p])}<small>${DB.careerGoals[p]} goals · ${span}</small></a>`;
    }).join("") || `<div class="empty small">No players found</div>`;
    box.classList.remove("hidden");
    sel = -1;
  });
  input.addEventListener("keydown", (e) => {
    const links = $$("a", box);
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      sel = Math.max(0, Math.min(links.length - 1, sel + (e.key === "ArrowDown" ? 1 : -1)));
      links.forEach((a, i) => a.classList.toggle("sel", i === sel));
    } else if (e.key === "Enter" && links.length) {
      location.hash = links[Math.max(sel, 0)].getAttribute("href");
      input.value = "";
      close();
      input.blur();
    } else if (e.key === "Escape") close();
  });
  box.addEventListener("click", () => { input.value = ""; close(); });
  document.addEventListener("click", (e) => { if (!e.target.closest(".navsearch")) close(); });
}

function setupTheme() {
  $("#themetoggle").addEventListener("click", () => {
    const root = document.documentElement;
    const dark = root.dataset.theme
      ? root.dataset.theme === "dark"
      : matchMedia("(prefers-color-scheme: dark)").matches;
    root.dataset.theme = dark ? "light" : "dark";
    try { localStorage.setItem("gg-theme", root.dataset.theme); } catch {}
  });
  if (!document.documentElement.dataset.theme && matchMedia("(prefers-color-scheme: dark)").matches) {
    document.documentElement.dataset.theme = "dark";
  }
}

setupTheme();
loadData().then(() => {
  subnav();
  setupSearch();
  addEventListener("hashchange", safeRoute);
  safeRoute();
}).catch((err) => {
  $("#main").innerHTML = `<div class="empty">Couldn't load data/goals.json — ${esc(err.message)}.<br>
    If you opened index.html directly, serve the folder instead (e.g. <code>python3 -m http.server</code>).</div>`;
});

function safeRoute() {
  try {
    route();
  } catch (err) {
    console.error(err);
    $("#main").innerHTML = `<div class="empty">Something went wrong: ${esc(err.message)}</div>`;
  }
}
