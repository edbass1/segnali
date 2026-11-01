#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Archivio SoccerStats per il sito statico.

SoccerStats non manda gli header CORS, quindi il browser su GitHub Pages non
può leggerlo. Questo script scarica le tabelle utili (tempi dei gol, over del
campionato e del secondo tempo) e le salva in data/soccerstats/*.json.
Lo stesso file viene eseguito da GitHub Actions: chi usa il sito non deve
configurare nulla.

Uso:
  python3 scanner/soccerstats.py                 # indice + campionati in TARGETS
  python3 scanner/soccerstats.py --leagues italy,england
  python3 scanner/soccerstats.py --index-only
"""
import argparse, datetime, json, os, re, subprocess, tempfile, time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "data", "soccerstats")
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
BASE = "https://www.soccerstats.com/"

# Campionati nazionali (codice SoccerStats). Le coppe non ci sono: il sito
# usa solo il campionato. I codici assenti nell'indice vengono saltati.
TARGETS = [
    "italy", "italy2", "england", "england2", "england3", "england4",
    "spain", "spain2", "germany", "germany2", "germany3", "france", "france2",
    "netherlands", "netherlands2", "portugal", "portugal2", "turkey", "turkey2",
    "belgium", "belgium2", "greece", "scotland", "austria", "switzerland",
    "denmark", "poland", "brazil", "brazil2", "argentina", "mexico", "japan",
    "norway", "sweden", "croatia", "czechrepublic", "romania", "ukraine",
    "hungary", "australia", "usa", "chile", "colombia", "china", "southkorea",
    "serbia", "bulgaria", "cyprus", "israel", "finland", "ireland",
    "saudiarabia", "russia",
]

CUP_RE = re.compile(
    r"\b(cup|copa|coppa|coupe|pokal|champions|europa|conference|libertadores|"
    r"sudamericana|world cup|nations league|qualif|euro|friendly|amichevol)\b", re.I)


def get(url, tries=3):
    """curl, non urllib: SoccerStats (Cloudflare) risponde 403 alla libreria standard."""
    err = None
    for i in range(tries):
        path = None
        try:
            fd, path = tempfile.mkstemp(prefix="ss-")
            os.close(fd)
            p = subprocess.run(
                ["curl", "-sS", "-L", "--compressed", "--max-time", "40",
                 "-A", UA, "-H", "Accept: text/html,application/xhtml+xml",
                 "-H", "Accept-Language: en-US,en;q=0.9",
                 "-o", path, "-w", "%{http_code}", url],
                capture_output=True, text=True, timeout=50)
            code = (p.stdout or "").strip()
            if p.returncode != 0 or code != "200":
                raise RuntimeError(f"HTTP {code or p.returncode} {p.stderr.strip()[:160]}")
            with open(path, encoding="utf-8", errors="replace") as f:
                data = f.read()
            if len(data) < 1000:
                raise RuntimeError("risposta troppo corta")
            time.sleep(0.35)
            return data
        except Exception as e:
            err = e
            time.sleep(1.5 * (i + 1))
        finally:
            if path and os.path.exists(path):
                os.remove(path)
    raise err


def clean(html):
    html = re.sub(r"<[^>]+>", " ", html)
    html = html.replace("&nbsp;", " ").replace("&amp;", "&").replace("&#39;", "'")
    return re.sub(r"\s+", " ", html).strip()


def cells(tr):
    out = []
    for td in re.findall(r"<t[dh][^>]*>[\s\S]*?</t[dh]>", tr, re.I):
        frac = re.search(r"title=['\"](\d+)\s*/\s*(\d+)['\"]", td, re.I)
        out.append({"t": clean(td), "k": int(frac.group(1)) if frac else None, "n": int(frac.group(2)) if frac else None})
    return out


def rows_of(table_html):
    return [cells(tr) for tr in re.findall(r"<tr[\s\S]*?</tr>", table_html, re.I)]


def pair(text):
    m = re.match(r"(\d+)\s*-\s*(\d+)$", text or "")
    return [int(m.group(1)), int(m.group(2))] if m else None


def pct(cell):
    if cell.get("n"):
        return round(100 * cell["k"] / cell["n"], 1)
    m = re.match(r"(\d+(?:\.\d+)?)\s*%$", cell.get("t") or "")
    return float(m.group(1)) if m else None


def num(text):
    m = re.search(r"-?\d+(?:\.\d+)?", text or "")
    return float(m.group(0)) if m else None


def good_label(label):
    return bool(re.match(r"^[A-Z]{2,3}\s*[-–]\s*\S", label or ""))


def parse_index(html):
    found = {}
    titles = {}
    for m in re.finditer(r"title=['\"]([^'\"]+)['\"][^>]*>\s*<a[^>]*href=['\"](?:https?:)?(?://www\.soccerstats\.com/)?latest\.asp\?league=([a-z0-9]+)['\"]", html, re.I):
        titles[m.group(2).lower()] = clean(m.group(1))
    for m in re.finditer(r"href=['\"](?:https?:)?(?://www\.soccerstats\.com/)?latest\.asp\?league=([a-z0-9]+)['\"][^>]*>([^<]*)", html, re.I):
        code, label = m.group(1).lower(), clean(m.group(2))
        country, name = "", ""
        if good_label(label):
            mm = re.match(r"^([A-Z]{2,3})\s*[-–]\s*(.+)$", label)
            country, name = mm.group(1), mm.group(2).strip()
        prev = found.get(code)
        if prev and good_label(prev.get("label")) and not good_label(label):
            continue
        if not good_label(label):
            label = ""
            country_name = titles.get(code) or (prev or {}).get("countryName") or ""
        else:
            country_name = titles.get(code) or ""
        if prev and not name:
            country = prev.get("country") or country
            name = prev.get("name") or name
            label = prev.get("label") or label
        found[code] = {
            "code": code,
            "label": label,
            "country": country,
            "countryName": country_name,
            "name": name,
            "cup": bool(CUP_RE.search(label + " " + code)) or code in {
                "cleague", "cleaguew", "uefa", "uefaconference", "copalibertadores",
                "copasudamericana", "clubworldcup", "euro", "euroqual", "worldcup",
                "nationsleague", "fifaqual", "cup"},
        }
    return sorted(found.values(), key=lambda x: (x.get("country") or x.get("countryName") or "", x.get("name") or "", x["code"]))


def slice_table_after(html, start):
    i = html.lower().find("<table", start)
    if i < 0:
        return ""
    j = html.lower().find("</table>", i)
    return html[i:j + 8] if j > 0 else html[i:i + 20000]


def page_league_name(html):
    """Dal title: 'Italy - Serie A - Goal time statistics' -> (Italy, Serie A)."""
    m = re.search(r"<title>\s*([^<]+?)\s*</title>", html, re.I)
    if not m:
        return "", ""
    parts = [p.strip() for p in re.split(r"\s+-\s+", clean(m.group(1))) if p.strip()]
    parts = [p for p in parts if not re.search(r"goal time|statistic|soccerstats|half-time|over", p, re.I)]
    if len(parts) >= 2:
        return parts[0], parts[1]
    if len(parts) == 1:
        return "", parts[0]
    return "", ""


def parse_timing(html):
    """Gol segnati-subiti per fascia da 15 minuti. overall / home / away."""
    out = {"overall": {}, "home": {}, "away": {}}
    for m in re.finditer(r"<tr[^>]*>[\s\S]{0,2500}?<b>\s*0-15\s*</b>[\s\S]{0,2500}?<b>\s*76-90\s*</b>[\s\S]*?</tr>", html, re.I):
        pre = clean(html[max(0, m.start() - 700):m.start()]).lower()
        if "opening" in pre:
            continue
        tail = pre[-180:]
        kind = "overall"
        if "away" in tail:
            kind = "away"
        elif "home" in tail:
            kind = "home"
        end = html.lower().find("</table>", m.end())
        if end < 0:
            continue
        table = html[m.end():end]
        for row in rows_of(table):
            if len(row) < 8:
                continue
            name = row[0]["t"]
            if not name or name.lower() in ("overall", "home", "away", "teams", "gp"):
                continue
            if not re.match(r"^\d+$", row[1]["t"]):
                continue
            pairs = [pair(c["t"]) for c in row]
            pairs = [p for p in pairs if p]
            if len(pairs) < 6:
                continue
            avgs = [num(c["t"]) for c in row if "min" in (c["t"] or "")]
            out[kind][name] = {
                "gp": int(row[1]["t"]),
                "b": pairs[:6],          # 0-15, 16-30, 31-45, 46-60, 61-75, 76-90 [segnati, subiti]
                "h1": pairs[6] if len(pairs) > 6 else None,
                "h2": pairs[7] if len(pairs) > 7 else None,
                "avgS": avgs[0] if avgs else None,
                "avgC": avgs[1] if len(avgs) > 1 else None,
            }
    return out


def classify_ou(title):
    t = title.lower()
    if "last 8" in t or "last8" in t:
        return None
    if "second" in t:
        period = "h2"
    elif "half" in t:
        period = "h1"
    else:
        period = "full"
    if "at home" in t or "(at home" in t:
        venue = "home"
    elif "away" in t:
        venue = "away"
    else:
        venue = "overall"
    return period + ":" + venue


def parse_ou(html):
    """Percentuali over di campionato (partite, non gol). Chiavi full/h1/h2 × overall/home/away."""
    out = {}
    for m in re.finditer(r"<h[23][^>]*>([\s\S]*?)</h[23]>", html, re.I):
        title = clean(m.group(1))
        if "match total goals" not in title.lower():
            continue
        key = classify_ou(title)
        if not key:
            continue
        table = slice_table_after(html, m.end())
        teams = {}
        for row in rows_of(table):
            if len(row) < 6:
                continue
            name = row[0]["t"]
            if not name or not re.match(r"^\d+$", row[1]["t"] if len(row) > 1 else ""):
                continue
            vals = [pct(c) for c in row[3:]]
            if not any(v is not None for v in vals[:4]):
                continue
            teams[name] = {
                "gp": int(row[1]["t"]),
                "avg": num(row[2]["t"]),
                "o05": vals[0] if len(vals) > 0 else None,
                "o15": vals[1] if len(vals) > 1 else None,
                "o25": vals[2] if len(vals) > 2 else None,
                "o35": vals[3] if len(vals) > 3 else None,
                "bts": vals[6] if len(vals) > 6 else None,
                "cs": vals[7] if len(vals) > 7 else None,
                "fts": vals[8] if len(vals) > 8 else None,
            }
        if teams:
            out[key] = teams
    return out


def league_box(html):
    text = clean(html)
    def grab(pat):
        m = re.search(pat, text, re.I)
        return float(m.group(1)) if m else None
    played = re.search(r"(\d+)\s+matches played", text, re.I)
    return {
        "matches": int(played.group(1)) if played else None,
        "homeWin": grab(r"Home wins:\s*(\d+(?:\.\d+)?)%"),
        "draw": grab(r"Draws:\s*(\d+(?:\.\d+)?)%"),
        "awayWin": grab(r"Away wins:\s*(\d+(?:\.\d+)?)%"),
        "over15": grab(r"Over 1\.5 goals:\s*(\d+(?:\.\d+)?)%"),
        "over25": grab(r"Over 2\.5 goals:\s*(\d+(?:\.\d+)?)%"),
        "over35": grab(r"Over 3\.5 goals:\s*(\d+(?:\.\d+)?)%"),
    }


def save(path, obj):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, separators=(",", ":"))
    os.replace(tmp, path)


def scrape_league(code, meta):
    timing_html = get(BASE + "timing.asp?league=" + code)
    country_name, league_name = page_league_name(timing_html)
    timing = parse_timing(timing_html)
    ou = parse_ou(get(BASE + "table.asp?league=%s&tid=c" % code))
    ht = parse_ou(get(BASE + "halftime.asp?league=" + code))
    for k, v in ht.items():
        if k.startswith("h2"):
            ou[k] = v
    try:
        box = league_box(get(BASE + "trends.asp?league=" + code))
    except Exception:
        box = {}
    if league_name and not re.search(r"goal time|statistic", league_name, re.I):
        # non sovrascrivere un nome già buono («Premier League») con un pezzo del title
        if not meta.get("name") or re.search(r"goal time|statistic", meta.get("name") or "", re.I):
            meta["name"] = league_name
        if country_name and not re.match(r"^[A-Z]{2,3}$", country_name):
            meta["countryName"] = country_name
        if not meta.get("label"):
            meta["label"] = ((country_name or meta.get("country") or "") + " - " + meta["name"]).strip(" -")
    n_teams = len(timing.get("overall") or {})
    return {
        "code": code,
        "label": meta.get("label") or league_name or code,
        "name": meta.get("name") or league_name or "",
        "country": meta.get("country") or "",
        "countryName": meta.get("countryName") or country_name or "",
        "updated": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "teams": n_teams,
        "timing": timing,
        "ou": ou,
        "box": box,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--leagues", help="codici separati da virgola (default: elenco interno)")
    ap.add_argument("--index-only", action="store_true")
    a = ap.parse_args()
    print("indice…", flush=True)
    index = parse_index(get(BASE + "leagues.asp"))
    save(os.path.join(OUT, "index.json"), {"updated": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), "leagues": index})
    print(f"indice: {len(index)} campionati", flush=True)
    if a.index_only:
        return
    known = {x["code"]: x for x in index}
    codes = [c.strip().lower() for c in a.leagues.split(",")] if a.leagues else list(TARGETS)
    ok = err = 0
    for code in codes:
        meta = known.get(code)
        if not meta:
            print(f"  salto {code}: non è nell'indice", flush=True)
            continue
        if meta.get("cup"):
            print(f"  salto {code}: coppa/internazionale", flush=True)
            continue
        try:
            doc = scrape_league(code, meta)
            save(os.path.join(OUT, code + ".json"), doc)
            ok += 1
            print(f"  {code}: {doc['teams']} squadre, tabelle OU {sorted(doc['ou'])}", flush=True)
        except Exception as e:
            err += 1
            print(f"  ERRORE {code}: {type(e).__name__}: {e}", flush=True)
    save(os.path.join(OUT, "index.json"), {"updated": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), "leagues": sorted(known.values(), key=lambda x: (x.get("country") or x.get("countryName") or "", x.get("name") or "", x["code"]))})
    print(f"fatto: {ok} ok, {err} errori", flush=True)
    if ok == 0:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
