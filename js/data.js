// Loads data/goals.json and builds the lookups every view uses.
//
// A "row" is one player's league goals for one club in one season:
//   { id, p: playerIdx, s: seasonIdx, c: clubIdx, g: goals }

export const DB = {
  seasons: [], clubs: [], players: [], pos: [], nat: [], rows: [],
  bySeason: [], byPlayer: [], careerGoals: [],
};

export async function loadData() {
  // "no-cache" revalidates with the server, so a new deploy is picked up straight away.
  const res = await fetch("data/goals.json", { cache: "no-cache" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const d = await res.json();
  DB.version = d.version;
  DB.seasons = d.seasons;
  DB.clubs = d.clubs;
  DB.players = d.players;
  DB.pos = d.pos;
  DB.nat = d.nat;
  DB.rows = d.rows.map(([p, s, c, g], id) => ({ id, p, s, c, g }));
  DB.bySeason = d.seasons.map(() => []);
  DB.byPlayer = d.players.map(() => []);
  DB.careerGoals = d.players.map(() => 0);
  for (const r of DB.rows) {
    DB.bySeason[r.s].push(r);
    DB.byPlayer[r.p].push(r);
    DB.careerGoals[r.p] += r.g;
  }
  for (const list of DB.bySeason) list.sort((a, b) => b.g - a.g || name(a).localeCompare(name(b)));
  for (const list of DB.byPlayer) list.sort((a, b) => a.s - b.s || b.g - a.g);
  DB.foldedNames = DB.players.map(fold);
}

// Match-by-match detail lives in a bigger file, fetched once on first use.
// The version in the URL stops a stale cached copy being used; a failed load
// is forgotten so the next request tries again.
let details = null;
export function loadDetails() {
  details ??= fetchDetails().catch((err) => {
    details = null;
    throw err;
  });
  return details;
}

async function fetchDetails() {
  const res = await fetch(`data/matches.json?v=${DB.version}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const d = await res.json();
  if (d.version !== DB.version) throw new Error("match data is out of date — reload the page");
  return d;
}

/**
 * The matches a row's goals came in, oldest first:
 * { date, home, opp, scored, conceded, result: "W"|"D"|"L", n, minutes: ["28", "45+2p"] | null }
 * Minutes are only known up to 2019/20.
 */
export async function goalLog(r) {
  const d = await loadDetails();
  return d.goals[r.id].map(([mi, mins]) => {
    const [, date, h, a, hs, as] = d.matches[mi];
    const home = h === r.c;
    const scored = home ? hs : as, conceded = home ? as : hs;
    const minutes = typeof mins === "string" ? mins.split(",") : null;
    return {
      date, home, opp: home ? a : h, scored, conceded,
      result: scored > conceded ? "W" : scored < conceded ? "L" : "D",
      n: minutes ? minutes.length : mins, minutes,
    };
  });
}

export const POSITIONS = { G: "Goalkeeper", D: "Defender", M: "Midfielder", F: "Forward" };

export const name = (r) => DB.players[r.p];
export const season = (r) => DB.seasons[r.s];
export const club = (r) => DB.clubs[r.c];
export const latestSeason = () => DB.seasons.length - 1;

/** Clubs that have at least one scorer in seasons [from, to]. */
export function clubsIn(from, to) {
  const set = new Set();
  for (let s = from; s <= to; s++) for (const r of DB.bySeason[s]) set.add(r.c);
  return [...set].sort((a, b) => DB.clubs[a].localeCompare(DB.clubs[b]));
}

/** Rows matching a deck filter: {from, to, club (-1 = any), min, player (-1 = any)}. */
export function filterRows(f) {
  if (f.player >= 0) return DB.byPlayer[f.player].filter((r) => r.g >= f.min);
  const out = [];
  for (let s = f.from; s <= f.to; s++) {
    for (const r of DB.bySeason[s]) {
      if (r.g >= f.min && (f.club < 0 || r.c === f.club)) out.push(r);
    }
  }
  return out;
}

/** Total goals a player scored in a season across all clubs. */
export function seasonTotal(p, s) {
  return DB.byPlayer[p].reduce((t, r) => t + (r.s === s ? r.g : 0), 0);
}

/** 1-based rank of a row within its club's scorers that season. */
export function clubRank(row) {
  return DB.bySeason[row.s].filter((r) => r.c === row.c && r.g > row.g).length + 1;
}

export function fold(s) {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/ø/g, "o").replace(/[^a-z' -]/g, "").replace(/['-]/g, " ").replace(/\s+/g, " ").trim();
}

const CLUB_COLOURS = {
  "AFC Bournemouth": "#d71920", "Arsenal": "#ef0107", "Aston Villa": "#670e36",
  "Barnsley": "#e1251b", "Birmingham City": "#0000ff", "Blackburn Rovers": "#009ee0",
  "Blackpool": "#f68712", "Bolton Wanderers": "#263c7e", "Bradford City": "#8b0d32",
  "Brentford": "#e30613", "Brighton and Hove Albion": "#0057b8", "Burnley": "#6c1d45",
  "Cardiff City": "#0070b5", "Charlton Athletic": "#d4021d", "Chelsea": "#034694",
  "Coventry City": "#59cbe8", "Crystal Palace": "#1b458f", "Derby County": "#111111",
  "Everton": "#003399", "Fulham": "#cccccc", "Huddersfield Town": "#0e63ad",
  "Hull City": "#f5a12d", "Ipswich Town": "#3a64a3", "Leeds United": "#ffcd00",
  "Leicester City": "#003090", "Liverpool": "#c8102e", "Luton Town": "#f78f1e",
  "Manchester City": "#6cabdd", "Manchester United": "#da291c", "Middlesbrough": "#e11b22",
  "Newcastle United": "#241f20", "Norwich City": "#00a650", "Nottingham Forest": "#dd0000",
  "Oldham Athletic": "#004a99", "Portsmouth": "#001489", "Queens Park Rangers": "#1d5ba4",
  "Reading": "#004494", "Sheffield United": "#ee2737", "Sheffield Wednesday": "#4466a8",
  "Southampton": "#d71920", "Stoke City": "#e03a3e", "Sunderland": "#eb172b",
  "Swansea City": "#efefef", "Swindon Town": "#d0002b", "Tottenham Hotspur": "#132257",
  "Watford": "#fbee23", "West Bromwich Albion": "#122f67", "West Ham United": "#7a263a",
  "Wigan Athletic": "#1d59af", "Wimbledon": "#1a3c8b", "Wolverhampton Wanderers": "#fdb913",
};
export const clubColour = (c) => CLUB_COLOURS[DB.clubs[c]] || "#888";
