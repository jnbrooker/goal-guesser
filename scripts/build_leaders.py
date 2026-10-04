"""Build data/leaders.json: heads of government/state for the Misc > World Leaders quizzes.

Source: Wikidata (query.wikidata.org), "position held" statements with start
and end qualifiers. Only humans with a start date are kept, and back-to-back
terms by the same person are merged into one.

Usage: python3 scripts/build_leaders.py
"""
import json
import time
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "leaders.json"

# id, country, office, flag, Wikidata office item, earliest start year kept
OFFICES = [
    ("uk", "United Kingdom", "Prime Minister", "🇬🇧", "Q14211", 1721),
    ("us", "United States", "President", "🇺🇸", "Q11696", 1789),
    ("ca", "Canada", "Prime Minister", "🇨🇦", "Q839078", 1867),
    ("au", "Australia", "Prime Minister", "🇦🇺", "Q319145", 1901),
    ("nz", "New Zealand", "Prime Minister", "🇳🇿", "Q1071117", 1856),
    ("ie", "Ireland", "Taoiseach", "🇮🇪", "Q191827", 1937),
    ("sco", "Scotland", "First Minister", "🏴󠁧󠁢󠁳󠁣󠁴󠁿", "Q1362216", 1999),
    ("fr", "France", "President (Fifth Republic)", "🇫🇷", "Q191954", 1959),
    ("de", "Germany", "Chancellor", "🇩🇪", "Q4970706", 1949),
    ("it", "Italy", "Prime Minister", "🇮🇹", "Q796897", 1946),
    ("es", "Spain", "Prime Minister", "🇪🇸", "Q844587", 1977),
    ("nl", "Netherlands", "Prime Minister", "🇳🇱", "Q3058109", 1945),
    ("se", "Sweden", "Prime Minister", "🇸🇪", "Q687075", 1876),
    ("no", "Norway", "Prime Minister", "🇳🇴", "Q2334076", 1905),
    ("dk", "Denmark", "Prime Minister", "🇩🇰", "Q795477", 1945),
    ("ru", "Russia", "President", "🇷🇺", "Q218295", 1991),
    ("in", "India", "Prime Minister", "🇮🇳", "Q192711", 1947),
    ("jp", "Japan", "Prime Minister", "🇯🇵", "Q274948", 1945),
    ("il", "Israel", "Prime Minister", "🇮🇱", "Q208487", 1948),
    ("za", "South Africa", "President", "🇿🇦", "Q273884", 1994),
    ("br", "Brazil", "President", "🇧🇷", "Q5176750", 1985),
]

# Acting / interim office-holders that standard lists leave out.
EXCLUDE = {
    "fr": {"Alain Poher"},
    "de": {"Walter Scheel"},
    "ru": {"Victor Chernomyrdin"},
    "za": {"Ivy Matsepe-Casaburri"},
    "in": {"Gulzarilal Nanda"},
    "jp": {"Masayoshi Ito"},
    "il": {"Yigal Allon"},
    "nz": {"Hugh Watt"},
    "sco": {"Jim Wallace, Baron Wallace of Tankerness"},
}

# Names as they're usually given in quiz lists.
RENAME = {
    "Isaac Shamir": "Yitzhak Shamir",
    "S. M. Bruce": "Stanley Bruce",
    "Richard Bedford Bennett": "R. B. Bennett",
    "John Sparrow David Thompson": "John Thompson",
    "Franklin Delano Roosevelt": "Franklin D. Roosevelt",
}

# Terms missing from (or wrong in) Wikidata: (country, name, start, end).
EXTRA = [("es", "Adolfo Suárez", "1977-06-15", "1981-02-26")]
FIX_END = {("uk", "William Pitt the Younger", "1783"): "1801-03-14"}

QUERY = """
SELECT ?person ?personLabel ?start ?end WHERE {
  ?person p:P39 ?st . ?st ps:P39 wd:%s . ?person wdt:P31 wd:Q5 .
  ?st pq:P580 ?start . OPTIONAL { ?st pq:P582 ?end }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en,mul". }
} ORDER BY ?start
"""


def sparql(q):
    url = "https://query.wikidata.org/sparql?" + urllib.parse.urlencode({"query": q, "format": "json"})
    req = urllib.request.Request(url, headers={"User-Agent": "GoalGuesser/0.1 (personal quiz app)"})
    with urllib.request.urlopen(req) as res:
        return json.load(res)["results"]["bindings"]


def terms_for(oid, office, since):
    rows = []
    for b in sparql(QUERY % office):
        start = b["start"]["value"][:10]
        if int(start[:4]) < since:
            continue
        name = b["personLabel"]["value"]
        if name in EXCLUDE.get(oid, ()):
            continue
        end = b.get("end", {}).get("value", "")[:10]
        end = FIX_END.get((oid, name, start[:4]), end)
        rows.append({"qid": b["person"]["value"].rsplit("/", 1)[1], "name": name, "start": start, "end": end})
    for c, name, start, end in EXTRA:
        if c == oid:
            rows.append({"qid": name, "name": name, "start": start, "end": end})
    rows.sort(key=lambda r: (r["start"], r["end"] or "9999"))
    # Drop exact duplicate statements, then merge consecutive terms by one person
    # (Wikidata often has one statement per ministry or election).
    merged = []
    for r in rows:
        if merged and merged[-1]["qid"] == r["qid"]:
            last = merged[-1]
            last["end"] = max(last["end"] or "9999", r["end"] or "9999").replace("9999", "")
            continue
        if any(m["qid"] == r["qid"] and m["start"] == r["start"] for m in merged):
            continue
        merged.append(r)
    return merged


def main():
    out = []
    for oid, country, office, flag, qid, since in OFFICES:
        terms = terms_for(oid, qid, since)
        unnamed = [t["name"] for t in terms if t["name"].startswith("Q") and t["name"][1:].isdigit()]
        if unnamed:
            raise SystemExit(f"{country}: no English name for {unnamed}")
        out.append({
            "id": oid, "country": country, "office": office, "flag": flag,
            "terms": [[RENAME.get(t["name"], t["name"]), t["start"][:4], t["end"][:4]] for t in terms],
        })
        print(f"{country:15} {office:15} {len(terms):3} terms, {len({t['qid'] for t in terms}):3} people")
        time.sleep(1)  # be polite to the query service
    OUT.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")))


if __name__ == "__main__":
    main()
