"""Build the app's data files.

  data/goals.json    goals per player, per club, per season (+ position, nationality)
  data/matches.json  every match, and which matches each of those goals came in
  data/squads.json   every club's squad each season (apps, starts, goals, position,
                     nationality) and the champions, for the Squads quiz

Sources
  1992/93-2019/20  github.com/TimHoare/Premier_League_Data (match events)
  2020/21-2025/26  github.com/vaastav/Fantasy-Premier-League (gameweek data)

Own goals are excluded; penalties are included. Goal minutes are only
available up to 2019/20. Only players who scored at
least one league goal for a club in a season appear.

Usage: python3 scripts/build_data.py   (downloads sources into .cache/)
"""
import csv
import hashlib
import json
import time
import urllib.parse
import re
from collections import Counter
from datetime import datetime
import unicodedata
import urllib.request
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / ".cache"
OUT = ROOT / "data" / "goals.json"
OUT_MATCHES = ROOT / "data" / "matches.json"
OUT_SQUADS = ROOT / "data" / "squads.json"

TH = "https://raw.githubusercontent.com/TimHoare/Premier_League_Data/master/data/"
FPL = "https://raw.githubusercontent.com/vaastav/Fantasy-Premier-League/master/data/"
FPL_SEASONS = ["2020-21", "2021-22", "2022-23", "2023-24", "2024-25", "2025-26"]

FPL_CLUBS = {
    "Bournemouth": "AFC Bournemouth", "Brighton": "Brighton and Hove Albion",
    "Ipswich": "Ipswich Town", "Leeds": "Leeds United", "Leicester": "Leicester City",
    "Luton": "Luton Town", "Man City": "Manchester City", "Man Utd": "Manchester United",
    "Newcastle": "Newcastle United", "Norwich": "Norwich City",
    "Nott'm Forest": "Nottingham Forest", "Sheffield Utd": "Sheffield United",
    "Spurs": "Tottenham Hotspur", "West Brom": "West Bromwich Albion",
    "West Ham": "West Ham United", "Wolves": "Wolverhampton Wanderers",
}

# FPL player code -> common name, where FPL's name fields mislead the heuristic.
FPL_NAMES = {
    "85971": "Son Heung-Min", "184754": "Hwang Hee-Chan", "451340": "Kaoru Mitoma",
    "220566": "Rodri", "102057": "Raúl Jiménez", "493250": "Amad Diallo",
    "448047": "Enzo Fernández", "463067": "Georginio Rutter", "533463": "Dango Ouattara",
    "447203": "Darwin Núñez", "226597": "Gabriel Magalhães", "499604": "Rayan",
    "560262": "Junior Kroupi", "151086": "Mario Lemina", "247670": "Taty Castellanos",
    "244716": "Cucho Hernández", "208706": "Bruno Guimarães", "194634": "Diogo Jota",
    "205533": "Eddie Nketiah", "461358": "Julián Álvarez", "213999": "Edson Álvarez",
    "96994": "Bobby De Cordova-Reid", "80954": "Rodrigo Moreno", "204814": "Ben Brereton Díaz",
}

# Final display-name tidy-ups (applied to any source).
RENAME = {
    "Solomon March": "Solly March", "Tolu": "Tolu Arokodare", "Frederico Fred": "Fred",
    "Benjamin White": "Ben White", "Benjamin Chilwell": "Ben Chilwell",
    "Santiago Ignacio Bueno": "Santiago Bueno", "João Jota Silva": "Jota Silva",
    "Rodrigo Martins Gomes": "Rodrigo Gomes", "Paquetá": "Lucas Paquetá",
    "Rúben Nascimento Vinagre": "Rúben Vinagre",
}


COUNTRY_FIXES = {
    "Cote D'Ivoire": "Ivory Coast", "The Democratic Republic of Congo": "DR Congo",
    "Democratic Republic of the Congo": "DR Congo", "The Gambia": "Gambia", "Macedonia": "North Macedonia",
    "Ireland": "Republic of Ireland", "Curacao": "Curaçao", "United Kingdom": "",
    "Kingdom of the Netherlands": "Netherlands", "People's Republic of China": "China",
}


def country(name):
    """One spelling per country across both sources."""
    name = re.sub(r" (And|Of|The) ", lambda m: " " + m[1].lower() + " ", name or "")
    return COUNTRY_FIXES.get(name, name)


def fetch(url, name):
    CACHE.mkdir(exist_ok=True)
    path = CACHE / name
    if not path.exists():
        print("downloading", url)
        urllib.request.urlretrieve(url, path)
    return path


def read(path):
    with open(path, newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def fold(s):
    s = unicodedata.normalize("NFKD", s)
    s = "".join(c for c in s if not unicodedata.combining(c)).lower()
    return re.sub(r"[^a-z ]", "", s.replace("-", " ")).strip()


goals = defaultdict(int)  # (player_key, season, club) -> goals
names = {}                # player_key -> display name
positions = defaultdict(Counter)  # player_key -> {G/D/M/F: appearances}
nations = {}              # player_key -> nationality
games = {}                # match_key -> (season, date, home, away, home_score, away_score)
log = defaultdict(lambda: defaultdict(list))  # (player_key, season, club) -> match_key -> minutes
apps = defaultdict(lambda: [0, 0])  # (player_key, season, club) -> [appearances, starts]
season_pos = defaultdict(Counter)   # (player_key, season, club) -> {position: appearances}

# --- 1992/93 - 2019/20 -------------------------------------------------------
matches = {r["match_id"]: r for r in read(fetch(TH + "matches.csv", "th_matches.csv"))}
club_by_id = {}
for r in matches.values():
    club_by_id[r["home_id"]] = r["home"]
    club_by_id[r["away_id"]] = r["away"]

for r in matches.values():
    date = datetime.strptime(r["kickoff"].split(",")[0], "%a %d %b %Y").strftime("%Y-%m-%d")
    games["th" + r["match_id"]] = (r["season"], date, r["home"], r["away"], int(r["home_score"]), int(r["away_score"]))


def minute(m):
    """"28'00" -> "28", "90 +4'00" -> "90+4"."""
    base, _, extra = m.split("'")[0].replace(" ", "").partition("+")
    return str(int(base)) + ("+" + extra if extra else "")


for r in read(fetch(TH + "events.csv", "th_events.csv")):
    if r["event_type"] not in ("Goal", "Penalty Scored"):
        continue
    key = "th" + r["player_id"]
    names[key] = r["player_name"]
    row = (key, matches[r["match_id"]]["season"], club_by_id[r["team_id"]])
    goals[row] += 1
    pen = "p" if r["event_type"] == "Penalty Scored" else ""
    log[row]["th" + r["match_id"]].append(minute(r["minute"]) + pen)

for r in read(fetch(TH + "teams.csv", "th_teams.csv")):
    key = "th" + r["player_id"]
    if r["position"] in ("G", "D", "M", "F"):
        positions[key][r["position"]] += 1
    if r["nationality"] not in ("", "NA"):
        nations[key] = country(r["nationality"])
    if r["type"] == "starting11":
        names.setdefault(key, r["player_name"])
        row = (key, matches[r["match_id"]]["season"], club_by_id[r["team_id"]])
        apps[row][0] += 1
        apps[row][1] += 1
        if r["position"] in ("G", "D", "M", "F"):
            season_pos[row][r["position"]] += 1

for r in read(fetch(TH + "events.csv", "th_events.csv")):
    if r["event_type"] == "Substitution" and r["event_desc"] == "Subbed-on":
        key = "th" + r["player_id"]
        names.setdefault(key, r["player_name"])
        apps[(key, matches[r["match_id"]]["season"], club_by_id[r["team_id"]])][0] += 1

# Match FPL players to the older data: scorers first (so a scorer's career isn't
# split by a namesake who never scored), then anyone who played.
th_scorers = {k[0] for k in goals}
th_by_fold, th_by_fold_all = defaultdict(list), defaultdict(list)
for key, n in names.items():
    th_by_fold_all[fold(n)].append(key)
    if key in th_scorers:
        th_by_fold[fold(n)].append(key)


# --- 2020/21 onwards -----------------------------------------------------------
def guess_name(first, second, web):
    """Best-effort common name from FPL's legal-name fields."""
    w = re.sub(r"^([A-Z]\.)+|\s+[A-Z]\.$|\.?Jr\.?$", "", web).strip(" .")
    f1, firsts = first.split()[0], first.split()
    if len(firsts) + len(second.split()) <= 3 and fold(w) == fold(second.split()[-1]):
        return f"{first} {second}"  # Eddie Nketiah, Bobby De Cordova-Reid
    if " " in w:
        return w if w.startswith(f1) else f"{f1} {w}"  # Luis Díaz
    if w == first:
        return first  # Richarlison
    if w in firsts:
        return " ".join(firsts[: firsts.index(w) + 1])  # Cristiano Ronaldo
    if fold(w) in fold(f"{first} {second}"):
        return f"{f1} {w}"  # Bruno Fernandes
    return w  # Jorginho


def th_match(first, second, guess):
    f1, s_last = first.split()[0], second.split()[-1]
    loose = (guess, f"{first} {second}", f"{f1} {s_last}", f"{f1} {second}", f"{first} {s_last}")
    # Partial-name guesses ("David Martín" from "David Raya Martín") are only safe
    # against scorers; against every lineup name they find namesakes (David Martin).
    strict = (guess, f"{first} {second}")
    for index, cands in ((th_by_fold, loose), (th_by_fold_all, strict)):
        for cand in cands:
            keys = index.get(fold(cand), [])
            if len(keys) == 1:
                return keys[0]
    return None


FPL_POS = {"1": "G", "2": "D", "3": "M", "4": "F"}
# Which FPL season's name fields to use: scorers keep the season of their first
# goal (as before squads existed); non-scorers use their latest season.
name_raw = {}
for s in FPL_SEASONS:
    raw = {r["id"]: r for r in read(fetch(FPL + s + "/players_raw.csv", f"fpl_raw_{s}.csv"))}
    for r in raw.values():
        if name_raw.get(r["code"], {}).get("_scored") is None:
            name_raw[r["code"]] = r
    for r in read(fetch(FPL + s + "/gws/merged_gw.csv", f"fpl_gw_{s}.csv")):
        p = raw[r["element"]]
        if int(r["goals_scored"]) and not name_raw[p["code"]].get("_scored"):
            name_raw[p["code"]] = {**p, "_scored": True}
fpl_key = {}  # FPL code -> player key
fpl_pos = defaultdict(Counter)  # FPL code -> {position: seasons}
for s in FPL_SEASONS:
    season = s.replace("-", "/")
    raw = {r["id"]: r for r in read(fetch(FPL + s + "/players_raw.csv", f"fpl_raw_{s}.csv"))}
    for p in raw.values():
        if p["element_type"] in FPL_POS:
            fpl_pos[p["code"]][FPL_POS[p["element_type"]]] += 1
    teams = {r["id"]: r["name"] for r in read(fetch(FPL + s + "/teams.csv", f"fpl_teams_{s}.csv"))}
    for r in read(fetch(FPL + s + "/gws/merged_gw.csv", f"fpl_gw_{s}.csv")):
        n = int(r["goals_scored"])
        played = int(float(r["minutes"])) > 0
        if not n and not played:
            continue
        season_raw = raw[r["element"]]
        code = season_raw["code"]
        p = name_raw[code]
        if code not in fpl_key:
            guess = FPL_NAMES.get(code) or guess_name(p["first_name"], p["second_name"], p["web_name"])
            key = th_match(p["first_name"], p["second_name"], guess) or "fpl" + code
            names.setdefault(key, guess)
            fpl_key[code] = key
        own = FPL_CLUBS.get(r["team"], r["team"])
        opp = teams[r["opponent_team"]]
        opp = FPL_CLUBS.get(opp, opp)
        home = r["was_home"] == "True"
        mk = f"fpl{s}-{r['fixture']}"
        games[mk] = (season, r["kickoff_time"][:10], own if home else opp, opp if home else own,
                     int(float(r["team_h_score"])), int(float(r["team_a_score"])))
        row = (fpl_key[code], season, own)
        if played:
            apps[row][0] += 1
            # FPL only records starts from 2022/23; earlier seasons get -1 (unknown).
            apps[row][1] = apps[row][1] + int(r["starts"]) if "starts" in r else -1
            season_pos[row][FPL_POS.get(season_raw["element_type"], "")] += 1
        if not n:
            continue
        goals[row] += n
        log[row][mk].extend([""] * n)  # FPL has no goal minutes

# Older lineup data wins for players who appear in both; FPL fills in the rest.
for code, key in fpl_key.items():
    if not positions[key]:
        positions[key] = fpl_pos[code]

# --- write ---------------------------------------------------------------------
seasons = sorted({k[1] for k in goals})
clubs = sorted({k[2] for k in goals} | {g[2] for g in games.values()} | {g[3] for g in games.values()})
keys = sorted({k[0] for k in goals}, key=lambda k: (fold(names[k]).split()[-1:], fold(names[k]), k))
si, ci, pi = ({v: i for i, v in enumerate(x)} for x in (seasons, clubs, keys))
rows = sorted(
    ([pi[p], si[s], ci[c], n] for (p, s, c), n in goals.items()),
    key=lambda r: (r[1], -r[3], r[0]),
)
# Both files carry the same version so the app never pairs a stale matches.json
# with a newer goals.json (row order must line up).
version = hashlib.sha1(json.dumps([rows, list(goals)], default=str).encode()).hexdigest()[:10]
OUT.parent.mkdir(exist_ok=True)
OUT.write_text(json.dumps({
    "version": version,
    "seasons": seasons, "clubs": clubs,
    "players": [RENAME.get(names[k], names[k]) for k in keys],
    "pos": [positions[k].most_common(1)[0][0] if positions[k] else "" for k in keys],
    "nat": [nations.get(k, "") for k in keys],
    "rows": rows,
}, ensure_ascii=False, separators=(",", ":")))

# Matches, oldest first, and per row (same order as goals.json rows) the
# matches the goals came in: [match index, "28,45+2p"] or [match index, count].
match_keys = sorted({mk for row in log.values() for mk in row}, key=lambda mk: (games[mk][1], mk))
mi = {mk: i for i, mk in enumerate(match_keys)}
row_logs = []
for p, s, c, _ in rows:
    entries = log[(keys[p], seasons[s], clubs[c])]
    row_logs.append([
        [mi[mk], ",".join(mins) if any(mins) else len(mins)]
        for mk, mins in sorted(entries.items(), key=lambda e: mi[e[0]])
    ])
OUT_MATCHES.write_text(json.dumps({
    "version": version,
    "matches": [[si[g[0]], g[1], ci[g[2]], ci[g[3]], g[4], g[5]] for g in (games[mk] for mk in match_keys)],
    "goals": row_logs,
}, separators=(",", ":")))
print(f"{len(rows)} rows, {len(keys)} players, {len(seasons)} seasons, {len(match_keys)} matches")


# --- squads ----------------------------------------------------------------------
def champions_by_season():
    """League table winner per season: points, then goal difference, then goals scored."""
    table = defaultdict(lambda: defaultdict(lambda: [0, 0, 0]))  # season -> club -> [pts, gd, gf]
    for season, _, h, a, hs, as_ in {g for g in games.values()}:
        for club, f, ag in ((h, hs, as_), (a, as_, hs)):
            t = table[season][club]
            t[0] += 3 if f > ag else 1 if f == ag else 0
            t[1] += f - ag
            t[2] += f
    return {s: max(t, key=lambda c: t[c]) for s, t in table.items()}


NAT_CACHE = CACHE / "wikidata_nationality.json"


def lookup_nationalities(player_names):
    """Football nationality from Wikidata for players the older data doesn't cover."""
    cache = json.loads(NAT_CACHE.read_text()) if NAT_CACHE.exists() else {}
    todo = [n for n in player_names if n not in cache]
    for i in range(0, len(todo), 80):
        batch = todo[i:i + 80]
        values = " ".join(json.dumps(n, ensure_ascii=False) + "@en" for n in batch)
        query = f"""SELECT ?name ?countryLabel WHERE {{
          VALUES ?name {{ {values} }}
          ?p rdfs:label ?name ; wdt:P106 wd:Q937857 .
          OPTIONAL {{ ?p wdt:P1532 ?sport }} OPTIONAL {{ ?p wdt:P27 ?cit }}
          BIND(COALESCE(?sport, ?cit) AS ?country)
          SERVICE wikibase:label {{ bd:serviceParam wikibase:language "en". }}
        }}"""
        url = "https://query.wikidata.org/sparql?" + urllib.parse.urlencode({"query": query, "format": "json"})
        req = urllib.request.Request(url, headers={"User-Agent": "GoalGuesser/0.1 (personal quiz app)"})
        with urllib.request.urlopen(req) as res:
            found = defaultdict(set)
            for b in json.load(res)["results"]["bindings"]:
                if "countryLabel" in b:
                    found[b["name"]["value"]].add(b["countryLabel"]["value"])
        for n in batch:
            # Ambiguous names (two footballers, two countries) stay blank rather than guess.
            cache[n] = next(iter(found[n])) if len(found[n]) == 1 else ""
        print(f"  nationality lookup {min(i + 80, len(todo))}/{len(todo)}")
        time.sleep(1)
    NAT_CACHE.write_text(json.dumps(cache, ensure_ascii=False))
    return cache



squad_rows = [k for k, (a, _) in apps.items() if a > 0]
sq_keys = sorted({k[0] for k in squad_rows}, key=lambda k: (fold(names[k]).split()[-1:], fold(names[k]), k))
sq_pi = {k: i for i, k in enumerate(sq_keys)}
display = [RENAME.get(names[k], names[k]) for k in sq_keys]
missing = sorted({display[i] for i, k in enumerate(sq_keys) if not nations.get(k)})
looked_up = lookup_nationalities(missing)
sq_nat = []
for i, k in enumerate(sq_keys):
    n = nations.get(k) or looked_up.get(display[i], "")
    sq_nat.append(country(n))

champs = champions_by_season()
squads = defaultdict(list)
for k in squad_rows:
    key, s, c = k
    a, st = apps[k]
    pos = (season_pos[k].most_common(1)[0][0] if season_pos[k] else "") or (positions[key].most_common(1)[0][0] if positions[key] else "")
    squads[f"{si[s]}.{ci[c]}"].append([sq_pi[key], pos, a, st, goals.get(k, 0)])
for v in squads.values():
    v.sort(key=lambda r: ("GDMF".find(r[1]) if r[1] else 9, -r[2], -r[4]))
OUT_SQUADS.write_text(json.dumps({
    "version": version,
    "players": display, "nat": sq_nat,
    "champions": [ci[champs[s]] for s in seasons],
    "squads": squads,
}, ensure_ascii=False, separators=(",", ":")))
print(f"squads: {len(squads)} club-seasons, {len(sq_keys)} players, "
      f"{sum(1 for n in sq_nat if not n)} without nationality")
