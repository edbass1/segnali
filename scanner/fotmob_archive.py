#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Minuti dei gol e xG di campionato, salvati nel repo.

FotMob a volte non manda gli header CORS sulla singola partita, e il browser
resta senza i minuti. Questo script li scarica (senza CORS, da GitHub Actions)
e scrive data/fotmob/<id>.json. Alle corse successive scarica solo le partite
nuove. Il file è incrementale: non rifà il campionato da zero.
"""
import argparse, datetime, json, os, time, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "data", "fotmob")
API = "https://www.fotmob.com/api/data/"
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"

# Campionati nazionali maschili. Stessi id usati dallo scanner.
LEAGUES = [55, 86, 47, 48, 108, 109, 53, 110, 54, 146, 87, 140, 57, 61, 71,
           40, 135, 64, 38, 69, 46, 196, 268, 112, 230, 223, 59, 67, 130]


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


def one(lid):
    path = os.path.join(OUT, str(lid) + ".json")
    prev = load(path) or {"matches": {}}
    d = get(API + "leagues?id=" + str(lid))
    det = d.get("details") or {}
    if det.get("type") != "league":
        print(f"  {lid}: non è un campionato, salto", flush=True)
        return
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
    print(f"  {lid} {det.get('name')}: {len(matches)} finite, {len(todo)} da leggere", flush=True)
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


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--leagues", help="id FotMob separati da virgola")
    a = ap.parse_args()
    ids = [int(x) for x in a.leagues.split(",")] if a.leagues else LEAGUES
    for lid in ids:
        try:
            one(lid)
        except Exception as e:
            print(f"  ERRORE {lid}: {type(e).__name__}: {e}", flush=True)


if __name__ == "__main__":
    main()
