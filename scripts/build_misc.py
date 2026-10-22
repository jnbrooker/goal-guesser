"""Build data/misc.json: winners-by-year lists for the Misc quizzes.

Source: the "List of ..." tables on English Wikipedia, fetched through the
MediaWiki API and cached in .cache/wiki/. Delete a cached page to refetch it.

Usage: python3 scripts/build_misc.py
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
OUT = ROOT / "data" / "misc.json"
UA = "GoalGuesser/0.1 (personal quiz app; https://github.com/jnbrooker/goal-guesser)"


def page(title):
    """Wikipedia page HTML, cached. Line breaks become " / " so shared awards can be split."""
    CACHE.mkdir(parents=True, exist_ok=True)
    path = CACHE / (title.replace(" ", "_") + ".html")
    if not path.exists():
        url = "https://en.wikipedia.org/w/api.php?" + urllib.parse.urlencode(
            {"action": "parse", "page": title, "prop": "text", "format": "json", "formatversion": 2, "redirects": 1})
        for attempt in range(5):
            try:
                with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": UA})) as res:
                    path.write_text(json.load(res)["parse"]["text"])
                break
            except urllib.error.HTTPError as e:
                if e.code != 429 or attempt == 4:
                    raise
                time.sleep(15)
        time.sleep(3)
    return path.read_text()


def tables(title):
    """[(heading, DataFrame)] for every wikitable on the page."""
    soup = bs4.BeautifulSoup(page(title), "html.parser")
    for br in soup.find_all("br"):
        br.replace_with(" / ")
    for sup in soup.find_all("sup"):
        sup.decompose()  # footnote markers
    for cell in soup.find_all(["td", "th"]):
        for attr in ("colspan", "rowspan"):  # some pages have typos like colspan="3”"
            if cell.has_attr(attr):
                digits = re.sub(r"\D", "", cell[attr])
                cell[attr] = digits or "1"
    out = []
    for t in soup.select("table.wikitable"):
        h = t.find_previous(["h2", "h3", "h4"])
        df = pd.read_html(io.StringIO(str(t)))[0]
        if isinstance(df.columns, pd.MultiIndex):
            df.columns = [c[0] for c in df.columns]
        out.append((h.get_text(" ", strip=True) if h else "", df))
    return out


def table(title, heading=None, col=None):
    """The largest table whose heading contains `heading` and which has a column starting with `col`."""
    found = [
        df for h, df in tables(title)
        if (not heading or heading.lower() in h.lower())
        and (not col or any(str(c).startswith(col) for c in df.columns))
    ]
    if not found:
        raise SystemExit(f"{title}: no table matching {heading!r}/{col!r}")
    return max(found, key=len)


def column(df, prefix):
    return next(c for c in df.columns if str(c).startswith(prefix))


def clean(s):
    """Strip counts "(14)", symbols and footnotes from a name."""
    s = str(s)
    s = re.sub(r"\[.*?\]", "", s)
    s = re.sub(r"\(.*?\)", "", s)
    s = re.sub(r"[*†‡^§#¤‖¶+~]", "", s)
    return re.sub(r"\s+", " ", s).strip(" ,/")


def names(cell):
    """A cell may hold joint winners separated by line breaks."""
    if pd.isna(cell):
        return []
    out = [clean(x) for x in str(cell).split(" / ")]
    return [x for x in out if x and x not in ("—", "–", "-", "nan") and not x.lower().startswith(("not awarded", "no award", "none"))]


def rows(df, label_col, value_col, clue_col=None, label=lambda v: str(v)):
    items = []
    for _, r in df.iterrows():
        lab = re.sub(r"[*^†‡§#¤]|\[.*?\]", "", str(r[label_col])).strip()
        if not re.match(r"^\d{4}", lab):
            continue
        clue = clean(r[clue_col]) if clue_col and not pd.isna(r[clue_col]) else ""
        vals = names(r[value_col])
        clues = [clean(x) for x in str(r[clue_col]).split(" / ")] if clue_col and len(vals) > 1 else [clue] * len(vals)
        for v, c in zip(vals, clues + [clue] * len(vals)):
            items.append([v, label(lab), c] if clue_col else [v, label(lab)])
    return items


def season(label):
    """"1999–2000" -> "1999–00"; "1955–56" stays."""
    m = re.match(r"^(\d{4})[–-](\d{2,4})", label)
    return f"{m[1]}–{m[2][-2:]}" if m else label[:4]


# --- football ------------------------------------------------------------------
def football_champions(title, heading=None, col="Season", since=None, winners="Champions"):
    df = table(title, heading, col)
    if since:
        start = df.index[df[col].astype(str).str.startswith(since)][0]
        df = df.loc[start:]
    win = column(df, winners)
    items = []
    for _, r in df.iterrows():
        lab, w = str(r[col]), names(r[win])
        if not re.match(r"^\d{4}", lab) or not w or w[0].lower().startswith(("no ", "not ", "cancel", "abandon", "suspend", "title")):
            continue
        items.append([w[0], season(lab)])
    return items


def ucl():
    return football_champions("List of European Cup and UEFA Champions League finals", "List of finals", winners="Winners")


# --- US sports ---------------------------------------------------------------------
def super_bowl():
    df = table("List of Super Bowl champions", "Results", "Game")
    items = []
    for _, r in df.iterrows():
        team = re.sub(r"(?<=s)[AaNn]$", "", clean(r["Winning team"]))
        m = re.search(r"\b(\d{4})\b", str(r["Date (season)"]))
        game = clean(str(r["Game"]).split(" / ")[0])
        if m and team and not game.lower().startswith(("lxi", "tbd")):
            items.append([team, f"{m[1]} · {game}"])
    return items


def nba_champions():
    df = table("List of NBA champions", "Champions", "Year")
    items = []
    for _, r in df.iterrows():
        m = re.match(r"(\d+)\s*[–-]\s*(\d+)", str(r["Result"]))
        if not m:
            continue
        west = int(m[1]) > int(m[2])
        items.append([clean(r["Western champion" if west else "Eastern champion"]), str(r["Year"])[:4]])
    return items


def world_series():
    df = table("List of World Series champions", None, "Year")
    items = []
    for _, r in df.iterrows():
        team = clean(r["Winning team"])
        if re.match(r"^\d{4}$", str(r["Year"])) and team and not team.lower().startswith(("not played", "none", "canceled", "cancelled")):
            items.append([team, str(r["Year"])])
    return items


def stanley_cup():
    df = table("List of Stanley Cup champions", "NHL champions", "Year")
    items = []
    for _, r in df.iterrows():
        team = clean(r["Winning team"])
        if re.match(r"^\d{4}", str(r["Year"])) and team and not team.lower().startswith(("not awarded", "no ", "series")):
            items.append([team, str(r["Year"])[:4]])
    return items


# --- awards --------------------------------------------------------------------------
def nfl_mvp():
    df = table("National Football League Most Valuable Player", "winners", "Year")
    return rows(df, "Year", "AP")


def nba_mvp():
    df = table("NBA Most Valuable Player", None, "Season")
    return rows(df, "Season", "Player", "Team", label=season)


def mlb_mvp(league):
    df = table("Major League Baseball Most Valuable Player Award", None, "Year")
    if league == "AL":
        return rows(df, "Year", "American League winner", "Team")
    return rows(df, "Year", "National League winner", "Team.1")


def hart():
    df = table("Hart Memorial Trophy", None, "Season")
    return rows(df, "Season", "Player", "Team", label=season)


def award_by_heading(title, heading, person_col):
    return rows(table(title, heading, "Year"), "Year", person_col, "Team")


def award(title, heading=None):
    """Winners of an award, from every winners table on the page (some split by era)."""
    items = []
    for h, df in tables(title):
        if heading and heading.lower() not in h.lower():
            continue
        if re.search(r"multiple|team|by |record|nominee|finalist", h, re.I):
            continue
        year = next((c for c in df.columns if str(c) in ("Season", "Year")), None)
        person = next((c for c in df.columns if str(c) in ("Player", "Winner", "Recipient")), None)
        if year is None or person is None:
            continue
        team = "Team" if "Team" in df.columns else None
        items += rows(df, year, person, team, label=season if str(year) == "Season" else str)
    if not items:
        raise SystemExit(f"{title}: no winners table")
    return sorted(items, key=lambda it: it[1])


CATEGORIES = [
    {
        "id": "football", "title": "Football Champions", "kind": "club",
        "sub": "European Cup / Champions League winners and the top five leagues' champions",
        "sets": [
            ("ucl", "Champions League", "🏆", "European Cup & Champions League winners", ucl),
            ("eng", "England", "🏴󠁧󠁢󠁥󠁮󠁧󠁿", "English top-flight champions (Football League First Division / Premier League)",
             lambda: football_champions("List of English football champions", "by season")),
            ("esp", "Spain", "🇪🇸", "La Liga champions",
             lambda: football_champions("List of Spanish football champions", None, winners="Winners")),
            ("ita", "Italy", "🇮🇹", "Serie A champions (single-table era, from 1929–30)",
             lambda: football_champions("List of Italian football champions", None, since="1929", winners="Winners")),
            ("ger", "Germany", "🇩🇪", "Bundesliga champions (from 1963–64)",
             lambda: football_champions("List of German football champions", None, since="1963", winners="Champions")),
            ("fra", "France", "🇫🇷", "French top-flight champions (professional era, from 1932–33)",
             lambda: football_champions("List of French football champions", None, since="1932", winners="Winners")),
        ],
    },
    {
        "id": "us-champions", "title": "US Sports Champions", "kind": "team",
        "sub": "Super Bowl, NBA Finals, World Series and Stanley Cup winners",
        "sets": [
            ("nfl", "NFL", "🏈", "Super Bowl winners", super_bowl),
            ("nba", "NBA", "🏀", "NBA champions", nba_champions),
            ("mlb", "MLB", "⚾", "World Series winners", world_series),
            ("nhl", "NHL", "🏒", "Stanley Cup winners (NHL era, from 1927)", stanley_cup),
        ],
    },
    {
        "id": "us-mvps", "title": "US Sports MVPs", "kind": "person",
        "sub": "Regular-season MVPs in the big four American leagues",
        "sets": [
            ("nfl-mvp", "NFL MVP", "🏈", "AP NFL Most Valuable Player", nfl_mvp),
            ("nba-mvp", "NBA MVP", "🏀", "NBA Most Valuable Player", nba_mvp),
            ("al-mvp", "AL MVP", "⚾", "American League MVP", lambda: mlb_mvp("AL")),
            ("nl-mvp", "NL MVP", "⚾", "National League MVP", lambda: mlb_mvp("NL")),
            ("hart", "NHL Hart Trophy", "🏒", "Hart Memorial Trophy (NHL MVP)", hart),
        ],
    },
    {
        "id": "nfl-awards", "title": "NFL Awards", "kind": "person",
        "sub": "MVP, Super Bowl MVP, player of the year, rookie and comeback awards (AP)",
        "sets": [
            ("mvp", "MVP", "🏈", "AP NFL Most Valuable Player", nfl_mvp),
            ("sb-mvp", "Super Bowl MVP", "🏆", "Super Bowl Most Valuable Player",
             lambda: award("Super Bowl Most Valuable Player Award")),
            ("opoy", "Offensive POY", "🏈", "AP Offensive Player of the Year",
             lambda: award("AP NFL Offensive Player of the Year Award")),
            ("dpoy", "Defensive POY", "🛡️", "AP Defensive Player of the Year",
             lambda: award("AP NFL Defensive Player of the Year Award")),
            ("oroy", "Offensive ROY", "🌱", "AP Offensive Rookie of the Year",
             lambda: award("AP NFL Offensive Rookie of the Year Award", "Offensive")),
            ("droy", "Defensive ROY", "🌱", "AP Defensive Rookie of the Year",
             lambda: award("AP NFL Offensive Rookie of the Year Award", "Defensive")),
            ("comeback", "Comeback POY", "🔁", "AP Comeback Player of the Year",
             lambda: award("AP NFL Comeback Player of the Year Award")),
        ],
    },
    {
        "id": "nba-awards", "title": "NBA Awards", "kind": "person",
        "sub": "MVP, Finals MVP, Defensive Player, Rookie, Sixth Man and Most Improved",
        "sets": [
            ("mvp", "MVP", "🏀", "NBA Most Valuable Player", nba_mvp),
            ("finals-mvp", "Finals MVP", "🏆", "Bill Russell NBA Finals MVP",
             lambda: award("Bill Russell NBA Finals Most Valuable Player Award")),
            ("dpoy", "Defensive POY", "🛡️", "NBA Defensive Player of the Year",
             lambda: award("NBA Defensive Player of the Year Award")),
            ("roy", "Rookie of the Year", "🌱", "NBA Rookie of the Year",
             lambda: award("NBA Rookie of the Year Award")),
            ("sixth", "Sixth Man", "6️⃣", "NBA Sixth Man of the Year",
             lambda: award("NBA Sixth Man of the Year Award")),
            ("mip", "Most Improved", "📈", "NBA Most Improved Player",
             lambda: award("NBA Most Improved Player Award")),
        ],
    },
    {
        "id": "nhl-awards", "title": "NHL Awards", "kind": "person",
        "sub": "Hart, Conn Smythe, Calder, Vezina, Norris, Art Ross, Rocket Richard, Selke and Ted Lindsay",
        "sets": [
            ("hart", "Hart (MVP)", "🏒", "Hart Memorial Trophy — MVP", hart),
            ("conn-smythe", "Conn Smythe", "🏆", "Conn Smythe Trophy — playoff MVP",
             lambda: award("Conn Smythe Trophy")),
            ("calder", "Calder (rookie)", "🌱", "Calder Memorial Trophy — rookie of the year",
             lambda: award("Calder Memorial Trophy")),
            ("vezina", "Vezina (goalie)", "🥅", "Vezina Trophy — best goaltender",
             lambda: award("Vezina Trophy")),
            ("norris", "Norris (defence)", "🛡️", "James Norris Memorial Trophy — best defenceman",
             lambda: award("James Norris Memorial Trophy")),
            ("art-ross", "Art Ross (points)", "📊", "Art Ross Trophy — most points",
             lambda: award("Art Ross Trophy")),
            ("richard", "Rocket Richard (goals)", "🚨", "Maurice \"Rocket\" Richard Trophy — most goals",
             lambda: award('Maurice "Rocket" Richard Trophy')),
            ("selke", "Selke (defensive fwd)", "🧱", "Frank J. Selke Trophy — best defensive forward",
             lambda: award("Frank J. Selke Trophy")),
            ("lindsay", "Ted Lindsay", "🤝", "Ted Lindsay Award — MVP voted by the players",
             lambda: award("Ted Lindsay Award")),
        ],
    },
    {
        "id": "mlb-awards", "title": "MLB Awards", "kind": "person",
        "sub": "MVPs, World Series MVP, Cy Young and Rookie of the Year",
        "sets": [
            ("al-mvp", "AL MVP", "⚾", "American League MVP", lambda: mlb_mvp("AL")),
            ("nl-mvp", "NL MVP", "⚾", "National League MVP", lambda: mlb_mvp("NL")),
            ("ws-mvp", "World Series MVP", "🏆", "World Series Most Valuable Player",
             lambda: award("World Series Most Valuable Player Award")),
            ("cy-al", "Cy Young (AL)", "⚾", "American League Cy Young Award (from 1967)",
             lambda: award_by_heading("Cy Young Award", "American League", "Pitcher")),
            ("cy-nl", "Cy Young (NL)", "⚾", "National League Cy Young Award (from 1967)",
             lambda: award_by_heading("Cy Young Award", "National League", "Pitcher")),
            ("cy-mlb", "Cy Young (1956–66)", "⚾", "Cy Young Award when there was one for all of MLB",
             lambda: award_by_heading("Cy Young Award", "combined", "Pitcher")),
            ("roy-al", "Rookie of the Year (AL)", "🌱", "American League Rookie of the Year (from 1949)",
             lambda: award_by_heading("Major League Baseball Rookie of the Year Award", "American League", "Player")),
            ("roy-nl", "Rookie of the Year (NL)", "🌱", "National League Rookie of the Year (from 1949)",
             lambda: award_by_heading("Major League Baseball Rookie of the Year Award", "National League", "Player")),
            ("roy-mlb", "Rookie of the Year (1947–48)", "🌱", "Rookie of the Year when there was one for all of MLB",
             lambda: award_by_heading("Major League Baseball Rookie of the Year Award", "combined", "Player")),
        ],
    },
]


# One club, one name: older or alternative names map to the one people know.
SAME_CLUB = {
    "The Wednesday": "Sheffield Wednesday", "Madrid FC": "Real Madrid",
    "Atlético Aviación": "Atlético Madrid", "Internazionale": "Inter Milan",
    "Ambrosiana-Inter": "Inter Milan", "Chicago Black Hawks": "Chicago Blackhawks",
}
# Rows that are notes rather than winners (wars, lockouts, unofficial titles).
NOT_A_WINNER = re.compile(r"suspended|cancel|lockout|not held|Campionato Alta Italia", re.I)


# Seasons with no official champion despite a name in the table.
NO_CHAMPION = {("Juventus", "2004–05")}  # title revoked (Calciopoli), never reassigned


def tidy(items):
    out, seen = [], set()
    for it in items:
        if (it[0], it[1]) in NO_CHAMPION:
            continue
        it[0] = SAME_CLUB.get(it[0], it[0])
        if NOT_A_WINNER.search(it[0]) or (it[0], it[1]) in seen:
            continue
        seen.add((it[0], it[1]))
        out.append(it)
    return out


def main():
    out = []
    for cat in CATEGORIES:
        sets = []
        for sid, label, emoji, title, fn in cat["sets"]:
            items = tidy(fn())
            print(f"{label:28} {len(items):4} entries  {items[0][1]} … {items[-1][1]}")
            sets.append({"id": sid, "label": label, "emoji": emoji, "title": title, "items": items})
        out.append({**{k: v for k, v in cat.items() if k != "sets"}, "sets": sets})
    OUT.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")))


if __name__ == "__main__":
    main()
