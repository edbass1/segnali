#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Minuti dei gol e xG di campionato, salvati nel repo.

FotMob a volte non manda gli header CORS sulla singola partita, e il browser
resta senza i minuti. Questo script li scarica (senza CORS, da GitHub Actions)
e scrive data/fotmob/<id>.json. Alle corse successive scarica solo le partite
nuove. Il file è incrementale: non rifà il campionato da zero.
"""
import argparse, datetime, json, os, re, time, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "data", "fotmob")
API = "https://www.fotmob.com/api/data/"
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"

# Sempre inclusi, anche se oggi non giocano. 147 = Serie C (tre gironi).
SEEDS = [147, 55, 86, 47, 48, 108, 109, 53, 110, 54, 146, 87, 140, 57, 61, 71,
         40, 135, 64, 38, 69, 46, 196, 268, 112, 230, 223, 59, 67, 130, 208, 126]
EXCLUDE = re.compile(
    r"\b(u-?1[5-9]|u-?2[0-3]|under ?\d\d|youth|primavera|reserve|reserves|women|woman|"
    r"femenil|femenina|feminine|frauen|wsl|nwsl|futsal|beach|esports|amateur|"
    r"premier league 2|friendl\w*|cup|cupa|copa|coppa|coupe|pokal|ta[cç]a|trophy|shield|baller|"
    r"super ?cup|supercopa|supercoppa|play-?offs?)\b", re.I)


def get(url):
    err = None
    for i in range(3):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
            with urllib.request.urlopen(req, timeout=30) as r:
                data = json.load(r)
            time.sleep(0.15)
            return data
        except Exception as e:
            err = e
            time.sleep(1.2 * (i + 1))
    raise err


def parse_score(st):
    s = str((st or {}).get("scoreStr") or "")
    parts = s.replace(" ", "").split("-")
    try:
        return int(parts[0]), int(parts[1])
    except Exception:
        return None


def xg_of(md):
    per = (((md.get("content") or {}).get("stats") or {}).get("Periods") or {})
    for key in ("All",):
        P = per.get(key) or {}
        for gr in P.get("stats") or []:
            for s in gr.get("stats") or []:
                if s.get("key") == "expected_goals" and isinstance(s.get("stats"), list) and s["stats"][0] is not None:
                    try:
                        return [float(s["stats"][0]), float(s["stats"][1])]
                    except Exception:
                        return None
    return None


def detail(mid, hg, ag):
    md = get(API + "matchDetails?matchId=" + str(mid))
    evs = ((((md.get("content") or {}).get("matchFacts") or {}).get("events") or {}).get("events") or [])
    goals = [[int(e.get("time") or 0), int(e.get("overloadTime") or 0), 1 if e.get("isHome") else 0]
             for e in evs if e.get("type") == "Goal"]
    gh = sum(1 for g in goals if g[2])
    ok = gh == hg and (len(goals) - gh) == ag
    return {"ok": ok, "goals": goals if ok else [], "xg": xg_of(md)}


def load(path):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return None


def save(path, obj):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, separators=(",", ":"))
    os.replace(tmp, path)


def league_ok(det):
    if not det or det.get("type") != "league":
        return False
    if (det.get("gender") or "male") != "male":
        return False
    if (det.get("country") or "").upper() in ("INT", ""):
        return False
    if EXCLUDE.search(det.get("name") or ""):
        return False
    return True


def discover(days):
    """Id campionato visti nelle ultime giornate. FotMob li elenca tutti, minori compresi."""
    found = set()
    today = datetime.datetime.now(datetime.timezone.utc).date()
    for i in range(days):
        day = (today - datetime.timedelta(days=i)).strftime("%Y%m%d")
        try:
            j = get(API + "matches?date=%s&timezone=Europe%%2FRome" % day)
        except Exception as e:
            print(f"  giorno {day}: {type(e).__name__}", flush=True)
            continue
        n = 0
        for L in j.get("leagues") or []:
            pid = L.get("primaryId") or L.get("id")
            if pid:
                found.add(int(pid))
                n += 1
        print(f"  giorno {day}: {n} competizioni", flush=True)
    return found


def one(lid, max_new=10**9):
    path = os.path.join(OUT, str(lid) + ".json")
    prev = load(path) or {"matches": {}}
    d = get(API + "leagues?id=" + str(lid))
    det = d.get("details") or {}
    if not league_ok(det):
        print(f"  {lid}: salto ({det.get('name') or det.get('type') or 'non valido'})", flush=True)
        return 0
    xg = []
    for blk in d.get("table") or []:
        data = (blk or {}).get("data") or {}
        tables = []
        if isinstance(data.get("table"), dict):
            tables.append(data["table"])
        for sub in data.get("tables") or []:
            if isinstance(sub.get("table"), dict):
                tables.append(sub["table"])
        for tb in tables:
            for r in tb.get("xg") or []:
                if r and r.get("played") and r.get("xg") is not None:
                    xg.append({"id": str(r.get("id")), "name": r.get("name") or "", "played": r.get("played"),
                               "xg": r.get("xg"), "xga": r.get("xgConceded")})
    old = prev.get("matches") or {}
    matches = {}
    todo = []
    for m in (d.get("fixtures") or {}).get("allMatches") or []:
        st = m.get("status") or {}
        if not st.get("finished") or st.get("cancelled") or st.get("awarded"):
            continue
        sc = parse_score(st)
        if not sc:
            continue
        mid = str(m["id"])
        rec = {"t": int(datetime.datetime.fromisoformat(st["utcTime"].replace("Z", "+00:00")).timestamp() * 1000),
               "h": str(m["home"]["id"]), "a": str(m["away"]["id"]),
               "hn": m["home"].get("name") or "", "an": m["away"].get("name") or "",
               "hg": sc[0], "ag": sc[1]}
        prev_m = old.get(mid)
        if prev_m and prev_m.get("ok") and prev_m.get("hg") == sc[0] and prev_m.get("ag") == sc[1]:
            rec.update({"ok": True, "goals": prev_m.get("goals") or [], "xg": prev_m.get("xg")})
        else:
            todo.append((mid, sc, rec))
        matches[mid] = rec
    if max_new <= 0:
        print(f"  {lid} {det.get('name')}: {len(todo)} in coda, budget finito", flush=True)
        return 0
    todo = todo[:max_new]
    print(f"  {lid} {det.get('name')}: {len(matches)} finite, leggo {len(todo)}", flush=True)
    for i, (mid, sc, rec) in enumerate(todo):
        try:
            extra = detail(mid, sc[0], sc[1])
            rec.update(extra)
        except Exception as e:
            rec.update({"ok": False, "goals": [], "xg": None})
            print(f"    {mid}: {type(e).__name__}", flush=True)
        if (i + 1) % 25 == 0:
            blob = dict(leagueId=int(lid), name=det.get("name"), country=det.get("country"),
                        season=det.get("selectedSeason"), updated=datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
                        xg=xg, matches=matches)
            save(path, blob)
    out = {"leagueId": int(lid), "name": det.get("name"), "country": det.get("country"),
           "season": det.get("selectedSeason"), "updated": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
           "xg": xg, "matches": matches}
    save(path, out)
    ok = sum(1 for m in matches.values() if m.get("ok"))
    print(f"  {lid}: minuti ok {ok}/{len(matches)}", flush=True)
    return len(todo)


def peek(lid):
    """Quante partite finite non hanno ancora i minuti. None se il campionato non va tenuto."""
    d = get(API + "leagues?id=" + str(lid))
    det = d.get("details") or {}
    if not league_ok(det):
        return None
    old = (load(os.path.join(OUT, str(lid) + ".json")) or {}).get("matches") or {}
    total = missing = 0
    for m in (d.get("fixtures") or {}).get("allMatches") or []:
        st = m.get("status") or {}
        if not st.get("finished") or st.get("cancelled") or st.get("awarded"):
            continue
        if not parse_score(st):
            continue
        total += 1
        prev = old.get(str(m["id"]))
        sc = parse_score(st)
        if not (prev and prev.get("ok") and prev.get("hg") == sc[0] and prev.get("ag") == sc[1]):
            missing += 1
    return {"id": int(lid), "name": det.get("name"), "missing": missing, "total": total}


def write_index():
    os.makedirs(OUT, exist_ok=True)
    rows = []
    for fn in sorted(os.listdir(OUT)):
        if not fn.endswith(".json") or fn == "index.json":
            continue
        d = load(os.path.join(OUT, fn)) or {}
        ms = d.get("matches") or {}
        ok = sum(1 for m in ms.values() if m.get("ok"))
        xg = sum(1 for m in ms.values() if m.get("xg"))
        rows.append({"id": d.get("leagueId"), "name": d.get("name"), "country": d.get("country"),
                     "season": d.get("season"), "matches": len(ms), "withMinutes": ok, "withXg": xg,
                     "updated": d.get("updated")})
    rows.sort(key=lambda r: (r.get("country") or "", r.get("name") or ""))
    stamp = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    save(os.path.join(OUT, "index.json"), {"updated": stamp, "leagues": rows})
    teams = {}
    for row in rows:
        doc = load(os.path.join(OUT, str(row["id"]) + ".json")) or {}
        for m in (doc.get("matches") or {}).values():
            for tid, name in ((m.get("h"), m.get("hn")), (m.get("a"), m.get("an"))):
                if not tid or not name:
                    continue
                teams[str(tid)] = {"id": str(tid), "name": name, "leagueId": str(row["id"]),
                                   "league": row.get("name") or "", "country": row.get("country") or ""}
    save(os.path.join(OUT, "teams.json"), {"updated": stamp, "teams": sorted(teams.values(), key=lambda t: (t["country"], t["league"], t["name"]))})
    print(f"indice: {len(rows)} campionati, {len(teams)} squadre", flush=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--leagues", help="id FotMob separati da virgola (niente scoperta)")
    ap.add_argument("--discover-days", type=int, default=10, help="giorni di calendari da cui prendere i campionati")
    ap.add_argument("--budget", type=int, default=800, help="partite nuove massime in questa corsa")
    ap.add_argument("--per-league", type=int, default=450, help="partite nuove massime per un campionato")
    a = ap.parse_args()
    if a.leagues:
        ids = [int(x) for x in a.leagues.split(",") if x.strip()]
    else:
        print("scopro i campionati delle ultime giornate…", flush=True)
        found = set(SEEDS)
        try:
            found |= discover(a.discover_days)
        except Exception as e:
            print(f"scoperta parziale: {type(e).__name__}: {e}", flush=True)
        print(f"candidati: {len(found)}", flush=True)
        jobs = []
        for lid in found:
            try:
                info = peek(lid)
            except Exception as e:
                print(f"  anteprima {lid}: {type(e).__name__}", flush=True)
                continue
            if not info or info["missing"] <= 0:
                continue
            jobs.append(info)
        # Prima i campionati mai scaricati (es. Austria), poi gli aggiornamenti delle partite nuove.
        jobs.sort(key=lambda j: (0 if not os.path.exists(os.path.join(OUT, str(j["id"]) + ".json")) else 1, j["missing"], j["id"]))
        ids = [j["id"] for j in jobs]
        print("da aggiornare:", ", ".join(f"{j['id']} {j['name']} ({j['missing']})" for j in jobs[:18]), flush=True)
    budget = a.budget
    for lid in ids:
        if budget <= 0:
            print("budget esaurito", flush=True)
            break
        try:
            used = one(lid, max_new=min(a.per_league, budget)) or 0
            budget -= used
        except Exception as e:
            print(f"  ERRORE {lid}: {type(e).__name__}: {e}", flush=True)
    write_index()


if __name__ == "__main__":
    main()
