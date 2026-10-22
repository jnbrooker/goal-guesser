"""Build data/champion_squads.json: title-winning squads from Wikipedia club-season pages.

Covers La Liga, Serie A, Bundesliga, Ligue 1 and Champions League winners
(from 1990) and NBA, MLB and NHL champions (from 1980). Premier League squads
come from our own match data instead (data/squads.json, via build_data.py).

For each champion in data/misc.json it finds the "<season> <club> season"
page with Wikipedia search, then reads the squad-statistics tables. Seasons
whose page has no usable table are skipped and listed at the end.

Usage: python3 scripts/build_squads.py   (slow first run: pages are cached in .cache/wiki/)
"""
import io
import json
import re
import time
import urllib.parse
import urllib.request
import warnings
from pathlib import Path

import bs4
import pandas as pd

warnings.filterwarnings("ignore")

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / ".cache" / "wiki"
SEARCH_CACHE = ROOT / ".cache" / "wiki_search.json"
OUT = ROOT / "data" / "champion_squads.json"
UA = "GoalGuesser/0.1 (personal quiz app; https://github.com/jnbrooker/goal-guesser)"

FOOTBALL_SINCE, US_SINCE = 1990, 1980


def api(params):
    url = "https://en.wikipedia.org/w/api.php?" + urllib.parse.urlencode({**params, "format": "json", "formatversion": 2})
    for attempt in range(6):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": UA})) as res:
                return json.load(res)
        except urllib.error.HTTPError as e:
            if e.code != 429 or attempt == 5:
                raise
            time.sleep(20)
        finally:
            time.sleep(1.2)


searches = json.loads(SEARCH_CACHE.read_text()) if SEARCH_CACHE.exists() else {}


def find_page(season, club):
    """Title of the "<season> <club> season" article, or None."""
    q = f"{season} {club} season"
    if q not in searches:
        res = api({"action": "query", "list": "search", "srsearch": f'intitle:"{season}" {club} season', "srlimit": 8})
        searches[q] = [r["title"] for r in res["query"]["search"]]
        SEARCH_CACHE.write_text(json.dumps(searches, ensure_ascii=False))
    words = [w for w in re.findall(r"\w+", club.lower()) if len(w) > 2]
    for title in searches[q]:
        t = title.lower()
        if re.search(r"femenino|women|femminile|frauen|féminin|castilla|juvenil|youth|primavera| b season|reserves|under-\d", t):
            continue
        if t.startswith(season.lower() + " ") and t.endswith(" season") and any(w in t for w in words):
            return title
    return None


def page_html(title):
    CACHE.mkdir(parents=True, exist_ok=True)
    path = CACHE / (title.replace(" ", "_").replace("/", "_") + ".html")
    if not path.exists():
        d = api({"action": "parse", "page": title, "prop": "text", "redirects": 1})
        if "error" in d:
            return ""
        path.write_text(d["parse"]["text"])
    return path.read_text()


def tables(html):
    """[(heading, DataFrame)] keeping two-row headers (e.g. Total → Apps, Goals)."""
    soup = bs4.BeautifulSoup(html, "html.parser")
    for sup in soup.find_all("sup"):
        sup.decompose()
    for flag in soup.select("span.flagicon"):
        img, a = flag.find("img"), flag.find("a")
        flag.replace_with(" " + ((a and a.get("title")) or (img and img.get("alt")) or "") + " ")
    for cell in soup.find_all(["td", "th"]):
        for attr in ("colspan", "rowspan"):
            if cell.has_attr(attr):
                cell[attr] = re.sub(r"\D", "", cell[attr]) or "1"
    out = []
    for t in soup.select("table.wikitable"):
        h = t.find_previous(["h2", "h3", "h4"])
        try:
            df = pd.read_html(io.StringIO(str(t)))[0]
        except ValueError:
            continue
        out.append((h.get_text(" ", strip=True) if h else "", df))
    return out


def text(v):
    s = "" if pd.isna(v) else str(v)
    s = re.sub(r"\[.*?\]|[*†‡^§#¤]", "", s)
    return re.sub(r"\s+", " ", s).strip()


def col(df, *names, level=None):
    """First column with a header part starting with one of `names`."""
    for c in df.columns:
        parts = [str(x) for x in (c if isinstance(c, tuple) else (c,))]
        if level is not None:
            parts = [parts[min(level, len(parts) - 1)]]
        if any(p.lower().startswith(n.lower()) for p in parts for n in names):
            return c
    return None


POS = {"GK": "G", "G": "G",
       "DF": "D", "D": "D", "CB": "D", "LB": "D", "RB": "D", "SW": "D", "WB": "D", "LWB": "D", "RWB": "D",
       "MF": "M", "M": "M", "CM": "M", "DM": "M", "AM": "M", "LM": "M", "RM": "M", "CDM": "M", "CAM": "M",
       "FW": "F", "F": "F", "ST": "F", "CF": "F", "LW": "F", "RW": "F", "SS": "F", "WF": "F"}


def position(v):
    first = re.split(r"[\s/,]+", text(v).upper())[0] if text(v) else ""
    return POS.get(first, "")


def nation(v):
    """"Spain ESP" -> "Spain" (flag link title plus the three-letter code)."""
    return re.sub(r"\s+[A-Z]{3}$", "", text(v)).strip()


def apps_value(s):
    """"30+4" or "30 (4)" -> (34 apps, 30 starts); "34" -> (34, None)."""
    nums = [int(x) for x in re.findall(r"\d+", s)]
    if not nums:
        return 0, None
    if len(nums) >= 2 and re.search(r"\+|\(", s):
        return nums[0] + nums[1], nums[0]
    return nums[0], None


# --- football ----------------------------------------------------------------------
LEAGUE_COLS = {"esp": ("La Liga",), "ita": ("Serie A",), "ger": ("Bundesliga",), "fra": ("Ligue 1", "Division 1"),
               "ucl": ("Champions League", "UEFA Champions League", "European Cup")}


def football_squad(html, comp):
    best = None
    for h, df in tables(html):
        if not isinstance(df.columns, pd.MultiIndex):
            continue
        player = col(df, "Player", "Name")
        comp_cols = [c for c in df.columns if any(str(x).startswith(n) for x in c for n in LEAGUE_COLS[comp])]
        # Ignore position-group rows ("Goalkeepers" would match "goal").
        has = lambda c, *ks: any(str(x).lower().startswith(ks) for x in c
                                 if not re.match(r"(goalkeepers|defenders|midfielders|forwards|players)", str(x), re.I))
        apps_c = next((c for c in comp_cols if has(c, "app")), None)
        goals_c = next((c for c in comp_cols if has(c, "goal", "gls")), None)
        starts_c = next((c for c in comp_cols if has(c, "sts", "gs", "start")), None)
        if player is None or apps_c is None or goals_c is None:
            continue
        pos_c, nat_c = col(df, "Pos"), col(df, "Nat")
        players = []
        for _, r in df.iterrows():
            name = text(r[player])
            if not name or name.lower().startswith(("players", "player", "total", "own goal")) or len(name) > 40:
                continue
            a, st = apps_value(text(r[apps_c]))
            if a == 0:
                continue
            if starts_c is not None and st is None:
                st = int(num(r[starts_c])) or None
            # Goalkeepers' columns sometimes show goals conceded as negatives.
            g = re.match(r"^\s*(\d+)", text(r[goals_c]))
            players.append({
                "name": name, "pos": position(r[pos_c]) if pos_c is not None else "",
                "nat": nation(r[nat_c]) if nat_c is not None else "",
                "apps": a, "starts": st, "goals": int(g[1]) if g else 0,
            })
        if len(players) >= 11 and (best is None or len(players) > len(best)):
            best = players
    return best


# --- US sports ---------------------------------------------------------------------
def stat_table(html, required, heading_hint=None):
    """Largest table with all `required` columns (optionally under a heading)."""
    found = []
    for h, df in tables(html):
        if isinstance(df.columns, pd.MultiIndex):
            df.columns = [c[-1] for c in df.columns]
        names = [str(c) for c in df.columns]
        if all(any(n == req for n in names) for req in required):
            if heading_hint and not re.search(heading_hint, h, re.I):
                continue
            found.append(df)
    return max(found, key=len) if found else None


def num(v):
    m = re.search(r"-?\d+(\.\d+)?", text(v))
    return float(m[0]) if m else 0.0


def clean_player(v):
    n = text(v)
    n = re.sub(r"\((?:[^)]*)\)", "", n).strip()
    return "" if n.lower() in ("", "totals", "total", "team totals", "team") else n


def nba_positions(html):
    """Player -> G/F/C from the season's roster box (a non-wikitable "toccolours" table)."""
    soup = bs4.BeautifulSoup(html, "html.parser")
    out = {}
    for box in soup.select("table.toccolours"):
        if "roster" not in box.get_text(" ", strip=True)[:120].lower():
            continue
        for tr in box.find_all("tr"):
            cells = [c.get_text(" ", strip=True) for c in tr.find_all("td")]
            if len(cells) >= 3 and re.match(r"^[GFC](/[GFC])?$", cells[0]):
                out[clean_player(re.sub(r"\((TW|C|DP|FA|S|IN|OUT)\)", "", cells[2]))] = cells[0][0]
    return out


def nba_squad(html):
    df = stat_table(html, ["Player", "GP"], r"regular season|player stat|statistics")
    if df is None:
        return None
    ppg = col(df, "PPG", "PTS")
    pos = nba_positions(html)
    out = []
    for _, r in df.iterrows():
        name = clean_player(r["Player"])
        if name:
            out.append({"name": name, "pos": pos.get(name, ""), "nat": "", "apps": int(num(r["GP"])),
                        "starts": int(num(r["GS"])) if "GS" in df.columns else None,
                        "stat": f"{num(r[ppg]):.1f} ppg" if ppg is not None else ""})
    return out


def nhl_squad(html):
    out = []
    sk = stat_table(html, ["Player", "GP", "G", "A", "Pts"])
    if sk is not None:
        for _, r in sk.iterrows():
            name = clean_player(r["Player"])
            if name:
                out.append({"name": name, "pos": "S", "nat": "", "apps": int(num(r["GP"])), "starts": None,
                            "goals": int(num(r["G"])), "stat": f"{int(num(r['G']))} G · {int(num(r['A']))} A"})
    gk = stat_table(html, ["Player", "GP", "GAA"])
    if gk is not None:
        for _, r in gk.iterrows():
            name = clean_player(r["Player"])
            if name and not any(p["name"] == name for p in out):
                out.append({"name": name, "pos": "G", "nat": "", "apps": int(num(r["GP"])), "starts": None,
                            "stat": f"{num(r['GAA']):.2f} GAA"})
    return out or None


def mlb_squad(html):
    out = []
    bat = stat_table(html, ["Player", "G", "AB", "HR"])
    if bat is not None:
        for _, r in bat.iterrows():
            name = clean_player(r["Player"])
            if name:
                avg = col(bat, "AVG", "BA")
                ba = f" · {num(r[avg]):.3f}".replace(" 0.", " .") + " AVG" if avg is not None else ""
                out.append({"name": name, "pos": "H", "nat": "", "apps": int(num(r["G"])), "starts": None,
                            "stat": f"{int(num(r['HR']))} HR{ba}"})
    pit = stat_table(html, ["Player", "W", "L", "ERA"])
    if pit is not None:
        for _, r in pit.iterrows():
            name = clean_player(r["Player"])
            if name and not any(p["name"] == name for p in out):
                g = int(num(r["G"])) if "G" in pit.columns else 0
                out.append({"name": name, "pos": "P", "nat": "", "apps": g, "starts": None,
                            "stat": f"{int(num(r['W']))}–{int(num(r['L']))} · {num(r['ERA']):.2f} ERA"})
    return out or None


# --- champions to fetch --------------------------------------------------------------
def full_season(label):
    """"1999–00" -> "1999–2000" (Wikipedia's form); "2023–24" unchanged."""
    m = re.match(r"^(\d{4})–(\d{2})$", label)
    if m and m[2] == "00":
        return f"{m[1]}–{int(m[1]) + 1}"
    return label


def us_season(sport, label):
    year = int(label[:4])
    if sport == "mlb":
        return str(year)
    return f"{year - 1}–{str(year)[2:]}" if str(year)[2:] != "00" else f"{year - 1}–{year}"


COMPS = [
    ("esp", "La Liga", "football"), ("ita", "Serie A", "football"), ("ger", "Bundesliga", "football"),
    ("fra", "Ligue 1", "football"), ("ucl", "Champions League", "football"),
    ("nba", "NBA", "nba"), ("mlb", "MLB", "mlb"), ("nhl", "NHL", "nhl"),
]


NAT_CACHE = ROOT / ".cache" / "wikidata_nationality_us.json"
OCCUPATION = {"nba": "Q3665646", "mlb": "Q10871364", "nhl": "Q11774891"}  # basketball/baseball/ice hockey player


def lookup_nationalities(sport, names):
    """Country (for sport, else citizenship) from Wikidata, by exact English name."""
    cache = json.loads(NAT_CACHE.read_text()) if NAT_CACHE.exists() else {}
    todo = sorted({n for n in names if f"{sport}|{n}" not in cache})
    for i in range(0, len(todo), 80):
        batch = todo[i:i + 80]
        values = " ".join(json.dumps(n, ensure_ascii=False) + "@en" for n in batch)
        query = f"""SELECT ?name ?countryLabel WHERE {{
          VALUES ?name {{ {values} }}
          ?p rdfs:label ?name ; wdt:P106 wd:{OCCUPATION[sport]} .
          OPTIONAL {{ ?p wdt:P1532 ?sport }} OPTIONAL {{ ?p wdt:P27 ?cit }}
          BIND(COALESCE(?sport, ?cit) AS ?country)
          SERVICE wikibase:label {{ bd:serviceParam wikibase:language "en". }}
        }}"""
        url = "https://query.wikidata.org/sparql?" + urllib.parse.urlencode({"query": query, "format": "json"})
        with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": UA})) as res:
            found = {}
            for b in json.load(res)["results"]["bindings"]:
                if "countryLabel" in b:
                    found.setdefault(b["name"]["value"], set()).add(b["countryLabel"]["value"])
        for n in batch:
            c = found.get(n, set())
            cache[f"{sport}|{n}"] = next(iter(c)) if len(c) == 1 else ""
        NAT_CACHE.write_text(json.dumps(cache, ensure_ascii=False))
        time.sleep(1)
    fix = {"United States of America": "United States", "Kingdom of the Netherlands": "Netherlands",
           "Kingdom of Denmark": "Denmark", "People's Republic of China": "China"}
    return {n: fix.get(cache[f"{sport}|{n}"], cache[f"{sport}|{n}"]) for n in names}


def main():
    misc = {s["id"]: s for c in json.load(open(ROOT / "data" / "misc.json")) for s in c["sets"]}
    out, missing = {}, []
    for cid, label, sport in COMPS:
        squads = []
        for team, season_label, *_ in misc[cid]["items"]:
            year = int(season_label[:4])
            if (sport == "football" and year < FOOTBALL_SINCE) or (sport != "football" and year < US_SINCE):
                continue
            season = full_season(season_label) if sport == "football" else us_season(sport, season_label)
            title = find_page(season, team)
            html = page_html(title) if title else ""
            parse = {"football": lambda h: football_squad(h, cid), "nba": nba_squad, "mlb": mlb_squad, "nhl": nhl_squad}[sport]
            players = parse(html) if html else None
            if not players or len(players) < 8:
                missing.append(f"{label} {season} {team}" + ("" if title else " (no page)"))
                continue
            order = {"football": "GDMF", "nba": "GFC", "mlb": "PH", "nhl": "GS"}[sport]
            players.sort(key=lambda p: (order.find(p["pos"]) if p["pos"] in order and p["pos"] else 9, -p["apps"]))
            squads.append({"season": season_label, "team": team, "source": title, "players": players})
            print(f"{label:16} {season:10} {team:28} {len(players):3} players")
        if sport != "football":
            nat = lookup_nationalities(sport, [p["name"] for sq in squads for p in sq["players"]])
            for sq in squads:
                for p in sq["players"]:
                    p["nat"] = nat.get(p["name"], "")
        out[cid] = {"label": label, "sport": sport, "squads": squads}
    OUT.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")))
    print(f"\n{sum(len(v['squads']) for v in out.values())} squads written; {len(missing)} skipped:")
    for m in missing:
        print("  -", m)


if __name__ == "__main__":
    main()
