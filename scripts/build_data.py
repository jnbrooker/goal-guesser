"""Build data/goals.json: Premier League goals per player, per club, per season.

Sources
  1992/93-2019/20  github.com/TimHoare/Premier_League_Data (match events)
  2020/21-2025/26  github.com/vaastav/Fantasy-Premier-League (gameweek data)

Own goals are excluded; penalties are included. Only players who scored at
least one league goal for a club in a season appear.

Usage: python3 scripts/build_data.py   (downloads sources into .cache/)
"""
import csv
import json
import re
import unicodedata
import urllib.request
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / ".cache"
OUT = ROOT / "data" / "goals.json"

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
}


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

# --- 1992/93 - 2019/20 -------------------------------------------------------
matches = {r["match_id"]: r for r in read(fetch(TH + "matches.csv", "th_matches.csv"))}
club_by_id = {}
for r in matches.values():
    club_by_id[r["home_id"]] = r["home"]
    club_by_id[r["away_id"]] = r["away"]

for r in read(fetch(TH + "events.csv", "th_events.csv")):
    if r["event_type"] not in ("Goal", "Penalty Scored"):
        continue
    key = "th" + r["player_id"]
    names[key] = r["player_name"]
    goals[(key, matches[r["match_id"]]["season"], club_by_id[r["team_id"]])] += 1

th_by_fold = defaultdict(list)
for key, n in names.items():
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
    for cand in (guess, f"{first} {second}", f"{f1} {s_last}", f"{f1} {second}", f"{first} {s_last}"):
        keys = th_by_fold.get(fold(cand), [])
        if len(keys) == 1:
            return keys[0]
    return None


fpl_key = {}  # FPL code -> player key
for s in FPL_SEASONS:
    season = s.replace("-", "/")
    raw = {r["id"]: r for r in read(fetch(FPL + s + "/players_raw.csv", f"fpl_raw_{s}.csv"))}
    for r in read(fetch(FPL + s + "/gws/merged_gw.csv", f"fpl_gw_{s}.csv")):
        n = int(r["goals_scored"])
        if not n:
            continue
        p = raw[r["element"]]
        code = p["code"]
        if code not in fpl_key:
            guess = FPL_NAMES.get(code) or guess_name(p["first_name"], p["second_name"], p["web_name"])
            key = th_match(p["first_name"], p["second_name"], guess) or "fpl" + code
            names.setdefault(key, guess)
            fpl_key[code] = key
        goals[(fpl_key[code], season, FPL_CLUBS.get(r["team"], r["team"]))] += n

# --- write ---------------------------------------------------------------------
seasons = sorted({k[1] for k in goals})
clubs = sorted({k[2] for k in goals})
keys = sorted({k[0] for k in goals}, key=lambda k: (fold(names[k]).split()[-1:], fold(names[k])))
si, ci, pi = ({v: i for i, v in enumerate(x)} for x in (seasons, clubs, keys))
rows = sorted(
    ([pi[p], si[s], ci[c], n] for (p, s, c), n in goals.items()),
    key=lambda r: (r[1], -r[3], r[0]),
)
OUT.parent.mkdir(exist_ok=True)
OUT.write_text(json.dumps(
    {"seasons": seasons, "clubs": clubs, "players": [RENAME.get(names[k], names[k]) for k in keys], "rows": rows},
    ensure_ascii=False, separators=(",", ":"),
))
print(f"{len(rows)} rows, {len(keys)} players, {len(seasons)} seasons -> {OUT.relative_to(ROOT)}")
