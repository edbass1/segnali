#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Archivio completo giornaliero FotMob: aggiorna risultati, intervallo e storico per data."""
import datetime, json, os, re, time, urllib.request, urllib.error
from zoneinfo import ZoneInfo

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "live", "data")
ARCHIVE = os.path.join(DATA, "archive")
INDEX = os.path.join(ARCHIVE, "index.json")
TODAY = os.path.join(DATA, "today.json")
FM = "https://www.fotmob.com/api/data"
ROME = ZoneInfo("Europe/Rome")
UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/124 Safari/537.36"

def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=25) as r:
        return json.load(r)

def load(path, default):
    try:
        with open(path, encoding="utf-8") as f: return json.load(f)
    except Exception: return default

def save(path, obj):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, separators=(",", ":"))
    os.replace(tmp, path)

def parse_score(value):
    if isinstance(value, dict):
        for k in ("scoreStr", "score", "display"):
            if k in value:
                found = parse_score(value[k])
                if found: return found
        return None
    if isinstance(value, (list, tuple)) and len(value) >= 2:
        try: return int(value[0]), int(value[1])
        except Exception: return None
    if value is None: return None
    m = re.search(r"(\d+)\s*[-:]\s*(\d+)", str(value))
    return (int(m.group(1)), int(m.group(2))) if m else None

def score_text(sc):
    return f"{sc[0]}-{sc[1]}" if sc is not None else None

def recursive_score(obj, keys):
    if isinstance(obj, dict):
        for k, v in obj.items():
            if k.lower().replace("_", "").replace("-", "") in keys:
                sc = parse_score(v)
                if sc is not None: return sc
        for v in obj.values():
            sc = recursive_score(v, keys)
            if sc is not None: return sc
    elif isinstance(obj, list):
        for v in obj:
            sc = recursive_score(v, keys)
            if sc is not None: return sc
    return None

def halftime_score(md):
    # Prima usa eventuali campi espliciti dell'API.
    keys = {"halftimescore", "htscore", "scorehalftime", "firsthalftime", "firsthalfscore"}
    sc = recursive_score(md, keys)
    if sc is not None: return sc
    # Fallback: ricostruisce il punteggio dai gol registrati entro il 45' (incluso recupero).
    facts = (md.get("content") or {}).get("matchFacts") or {}
    events = facts.get("events") or []
    h = a = 0
    found_goal = False
    for ev in events:
        if not isinstance(ev, dict): continue
        minute = ev.get("time", ev.get("minute"))
        try: minute = int(re.match(r"\d+", str(minute)).group(0))
        except Exception: continue
        if minute > 45: continue
        typ = " ".join(str(ev.get(k, "")) for k in ("type", "eventType", "event", "description")).lower()
        is_goal = bool(ev.get("isGoal")) or "goal" in typ or "goal" in str(ev.get("type", "")).lower()
        if not is_goal: continue
        found_goal = True
        # FotMob events commonly use isHome; own goals are still credited to the other side.
        home = bool(ev.get("isHome", ev.get("home", False)))
        own = bool(ev.get("ownGoal")) or "own goal" in typ
        if own: home = not home
        if home: h += 1
        else: a += 1
    return (h, a) if found_goal else None

def match_status(m):
    st = m.get("status") or {}
    if st.get("cancelled") or st.get("awarded"): return "annullata"
    if st.get("finished"): return "terminata"
    if st.get("started"): return "in_corso"
    return "programmata"

def fixture_to_entry(m, league, old=None):
    st = m.get("status") or {}
    mid = str(m.get("id") or m.get("matchId") or "")
    sc = parse_score(st) or parse_score(m.get("scoreStr")) or parse_score(m.get("status"))
    try:
        dt = datetime.datetime.fromisoformat(str(st.get("utcTime") or m.get("utcTime")).replace("Z", "+00:00")).astimezone(ROME)
        kickoff = dt.strftime("%H:%M")
        utc = dt.isoformat()
        day = dt.strftime("%Y-%m-%d")
    except Exception:
        kickoff, utc, day = "—", None, None
    status = match_status(m)
    finished = status == "terminata"
    old = old or {}
    ht = old.get("ht_score")
    return {
        "matchId": mid, "kickoff": kickoff, "kickoff_utc": utc,
        "league": league.get("name") or (m.get("tournament") or {}).get("name") or "Campionato non disponibile",
        "country": league.get("ccode") or league.get("country") or "",
        "home": (m.get("home") or {}).get("name") or m.get("homeTeam", {}).get("name") or "Casa",
        "away": (m.get("away") or {}).get("name") or m.get("awayTeam", {}).get("name") or "Ospite",
        "url": f"https://www.fotmob.com/match/{mid}", "status": status,
        "score": score_text(sc), "final": score_text(sc) if finished else None,
        "ht_score": ht, "ht_checked": bool(old.get("ht_checked", False)), "types": old.get("types") or [], "info": old.get("info") or {},
        "started": bool(st.get("started")), "finished": finished
    }

def calc_stats(matches):
    finished = [m for m in matches if m.get("finished") and m.get("score")]
    categories = {}
    category_names = {"storico": "Storico senza 0-0", "xg": "xG", "segna": "Segna sempre", "subisce": "Subisce sempre", "mai00": "Mai 0-0"}
    for category, name in category_names.items():
        sample = [m for m in finished if category in (m.get("types") or [])]
        wins = sum(1 for m in sample if sum(parse_score(m.get("final") or m.get("score")) or (0, 0)) > 0)
        losses = len(sample) - wins
        categories[category] = {"label": name, "total": len(sample), "wins": wins, "losses": losses,
                                "strike_rate": round(100 * wins / len(sample), 1) if sample else None,
                                "failed_matches": [{"matchId": m.get("matchId"), "home": m.get("home"), "away": m.get("away"),
                                                   "score": m.get("final") or m.get("score")}
                                                  for m in sample if sum(parse_score(m.get("final") or m.get("score")) or (0, 0)) == 0]}
    over = sum(1 for m in finished if (parse_score(m["score"]) or (0,0))[0] + (parse_score(m["score"]) or (0,0))[1] > 0)
    ht_known = [m for m in matches if m.get("ht_score")]
    ht_over = sum(1 for m in ht_known if sum(parse_score(m["ht_score"]) or (0,0)) > 0)
    return {
        "matches_total": len(matches), "finished": len(finished),
        "categories": categories,
        "over05_final": over, "zero_zero_final": len(finished)-over,
        "over05_final_rate": round(100*over/len(finished), 1) if finished else None,
        "halftime_known": len(ht_known), "over05_first_half": ht_over,
        "zero_zero_first_half": len(ht_known)-ht_over,
        "over05_first_half_rate": round(100*ht_over/len(ht_known), 1) if ht_known else None,
        "live": sum(1 for m in matches if m.get("status") == "in_corso"),
        "scheduled": sum(1 for m in matches if m.get("status") == "programmata")
    }

def main():
    now = datetime.datetime.now(ROME)
    day = now.strftime("%Y-%m-%d")
    day_api = now.strftime("%Y%m%d")
    os.makedirs(ARCHIVE, exist_ok=True)
    path = os.path.join(ARCHIVE, day + ".json")
    old_doc = load(path, {})
    old_by_id = {str(m.get("matchId")): m for m in old_doc.get("matches", [])}
    today_doc = load(TODAY, {})
    today_by_id = {str(m.get("matchId")): m for m in today_doc.get("matches", [])}
    data = get(f"{FM}/matches?date={day_api}&timezone=Europe%2FRome")
    fixtures = []
    for league in data.get("leagues") or []:
        for m in league.get("matches") or []:
            mid = str(m.get("id") or m.get("matchId"))
            entry = fixture_to_entry(m, league, old_by_id.get(mid))
            signal = today_by_id.get(mid, {})
            if signal.get("types"):
                entry["types"] = signal.get("types") or []
                entry["info"] = signal.get("info") or {}
                entry["reasons"] = signal.get("reasons") or {}
            fixtures.append(entry)
    # Mantieni le partite già archiviate anche se la fonte non le ripropone più a giornata conclusa.
    present = {m["matchId"] for m in fixtures}
    for old in old_doc.get("matches", []):
        if str(old.get("matchId")) not in present:
            if not old.get("types") and str(old.get("matchId")) in today_by_id:
                sig = today_by_id[str(old.get("matchId"))]
                old["types"], old["info"], old["reasons"] = sig.get("types", []), sig.get("info", {}), sig.get("reasons", {})
            fixtures.append(old)
    fixtures.sort(key=lambda m: (m.get("kickoff_utc") or "", m.get("league") or "", m.get("home") or ""))
    # Per ogni partita conclusa, recupera l'intervallo una volta sola. Se non è disponibile,
    # ritenta alle scansioni successive senza trasformare il dato mancante in 0-0.
    for m in fixtures:
        if not m.get("finished") or m.get("ht_checked") or not m.get("matchId"): continue
        try:
            md = get(f"{FM}/matchDetails?matchId={m['matchId']}")
            ht = halftime_score(md)
            m["ht_score"] = score_text(ht) if ht is not None else None
            m["ht_checked"] = True
            time.sleep(0.12)
        except Exception as e:
            print(f"Intervallo non disponibile per {m['home']} - {m['away']}: {e}", flush=True)
    stats = calc_stats(fixtures)
    doc = {"date": day, "generated_at": now.strftime("%Y-%m-%d %H:%M"), "stats": stats, "matches": fixtures}
    save(path, doc)
    # Recupera anche ieri se manca: evita che il cambio di data faccia sparire la giornata precedente.
    yesterday = (now.date() - datetime.timedelta(days=1)).strftime("%Y-%m-%d")
    yesterday_path = os.path.join(ARCHIVE, yesterday + ".json")
    if not os.path.exists(yesterday_path):
        try:
            yd = datetime.datetime.strptime(yesterday, "%Y-%m-%d").replace(tzinfo=ROME)
            ydata = get(f"{FM}/matches?date={yd.strftime('%Y%m%d')}&timezone=Europe%2FRome")
            yfixtures = []
            for league in ydata.get("leagues") or []:
                for match in league.get("matches") or []:
                    yfixtures.append(fixture_to_entry(match, league))
            for match in yfixtures:
                if not match.get("finished") or not match.get("matchId"): continue
                try:
                    md = get(f"{FM}/matchDetails?matchId={match['matchId']}")
                    ht = halftime_score(md)
                    match["ht_score"] = score_text(ht) if ht is not None else None
                    match["ht_checked"] = True
                    time.sleep(0.12)
                except Exception as e:
                    print(f"Intervallo storico non disponibile per {match['home']} - {match['away']}: {e}", flush=True)
            yfixtures.sort(key=lambda m: (m.get("kickoff_utc") or "", m.get("league") or "", m.get("home") or ""))
            ydoc = {"date": yesterday, "generated_at": now.strftime("%Y-%m-%d %H:%M"), "stats": calc_stats(yfixtures), "matches": yfixtures}
            save(yesterday_path, ydoc)
            print(f"Archivio recuperato {yesterday}: {len(yfixtures)} partite", flush=True)
        except Exception as e:
            print(f"Non è stato possibile recuperare automaticamente lo storico del {yesterday}: {e}", flush=True)
    # Indice di tutte le giornate archiviate, dalla più recente.
    days = sorted([f[:-5] for f in os.listdir(ARCHIVE) if re.fullmatch(r"\d{4}-\d{2}-\d{2}\.json", f)], reverse=True)
    save(INDEX, {"updated_at": now.strftime("%Y-%m-%d %H:%M"), "dates": days})
    print(f"Archivio {day}: {len(fixtures)} partite; concluse {stats['finished']}; Over 0,5 finale {stats['over05_final_rate']}; intervallo disponibile {stats['halftime_known']}; Over 0,5 1T {stats['over05_first_half_rate']}", flush=True)

if __name__ == "__main__":
    main()
