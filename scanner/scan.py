#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Scanner segnali live (FotMob) -> Telegram + storico in live/data/.

Uso:
  python scanner/scan.py                 # scansione normale (cron)
  python scanner/scan.py --dry-run       # come sopra ma senza Telegram e senza salvare
  python scanner/scan.py --test 5802971 [--test ID2] [--send]
        forza la valutazione di una partita ignorando punteggio/minuto,
        stampa i numeri; con --send invia il messaggio marcato 🧪 TEST.
Solo libreria standard Python 3.
"""
import argparse, datetime, html, json, os, re, sys, time, urllib.parse, urllib.request, urllib.error
from zoneinfo import ZoneInfo

# ============================ CONFIG ============================
CFG = {
    "MIN_FROM": 60,              # finestra minuti (inclusa)
    "MIN_TO": 70,
    # Segnale 1 - STORICO GOL
    # 0-0 = partita finita senza gol (over 0.5 totali = almeno 1 gol di una delle due squadre)
    "HIST_STREAK_MIN": 50,       # serie minima di partite di campionato CONSECUTIVE senza 0-0 (squadra "forte")
    "HIST_STREAK_CAP": 200,      # oltre questo numero smette di contare ("200+")
    "HIST_N": 50,                # finestra per l'altra squadra: ultime N partite di campionato...
    "HIST_MAX_00": 3,            # ...con al massimo questi 0-0
    "HIST_MAX_SEASONS": 15,      # max stagioni di campionato da scaricare per squadra
    # Segnale 2 - xG prematch
    "XG_MIN_TOTAL": 2.7,
    "XG_SPLIT_MAX_MATCHES": 19,  # max partite casa/trasferta lette per lo split xG
    # Segnali 3-5: solo stagione CORRENTE di campionato
    "CUR_MIN_MATCHES": 9,        # partite minime giocate in stagione da ciascuna squadra
    "SEGNA_STRONG_PCT": 100,     # 3) SEGNA SEMPRE: una squadra ha segnato nel 100%...
    "SEGNA_OTHER_PCT": 80,       #    ...e l'altra in almeno l'80%
    "SUBISCE_PCT": 100,          # 4) SUBISCE SEMPRE: una squadra ha subito gol nel 100%
    "MAI00_STRONG_PCT": 100,     # 5) MAI 0-0: una squadra over 0.5 nel 100%...
    "MAI00_OTHER_PCT": 90,       #    ...e l'altra in almeno il 90%
    # varie
    "FORM_N": 10,                # partite per la forma recente
    "H2H_N": 8,
    "DELAY": 0.35,               # pausa tra richieste (s)
    "TEAM_TTL_H": 12,            # cache storico squadra
    "PAST_SEASON_TTL_D": 30,     # cache calendario stagioni concluse
    "CUR_SEASON_TTL_H": 3,       # cache calendario stagione corrente
    "LEAGUE_META_TTL_D": 30,
    "HEARTBEAT_MIN": 30,         # riscrive state.json almeno ogni N minuti
    "RESULT_FOLLOWUP": True,     # messaggio Telegram con esito finale
    "PENDING_GIVEUP_H": 8,
}
DEFAULT_CHAT_ID = "621551511"
EXCLUDE_NAME_RE = re.compile(
    r"\b(u-?1[5-9]|u-?2[0-3]|under ?\d\d|youth|primavera|reserve|reserves|women|woman|femenil|femenina|"
    r"feminine|f[ée]minine|frauen|damallsvenskan|wsl|nwsl|baller|futsal|beach|esports|amateur|"
    r"premier league 2|professional development|next pro|friendl\w*|cup|copa|coppa|coupe|pokal|ta[cç]a|"
    r"puchar|beker|kupa|cupa|kup|trophy|shield|super ?cup|supercopa|supercoppa|play-?offs?)\b", re.I)
RESERVE_TEAM_RE = re.compile(r"(\s(II|2|B|U-?\d\d)$|^jong\s|\breserves?\b|\bacademy\b)", re.I)
EXCLUDE_RESERVE_TEAMS = True     # esclude squadre riserve/B (es. "Brann 2", "Jong PSV")
# ================================================================

ROME = ZoneInfo("Europe/Rome")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "live", "data")
SIGNALS_F = os.path.join(DATA, "signals.json")
STATE_F = os.path.join(DATA, "state.json")
CACHE_DIR = os.path.join(ROOT, "scanner", ".cache")
CACHE_F = os.path.join(CACHE_DIR, "cache.json")
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
FM = "https://www.fotmob.com/api/data"
TYPES = ["storico", "xg", "segna", "subisce", "mai00"]
TYPE_NAMES = {"storico": "STORICO GOL (serie senza 0-0)", "xg": "xG", "segna": "SEGNA SEMPRE", "subisce": "SUBISCE SEMPRE", "mai00": "MAI 0-0"}
TYPE_ICONS = {"storico": "📚", "xg": "📈", "segna": "⚽", "subisce": "🥅", "mai00": "🚫"}
NREQ = [0]
_RUNCACHE = {}

def now_utc(): return datetime.datetime.now(datetime.timezone.utc)
def ts(): return time.time()
def rome_str(dt=None): return (dt or now_utc()).astimezone(ROME).strftime("%Y-%m-%d %H:%M")
def log(*a): print(*a, flush=True)
def esc(s): return html.escape(str(s if s is not None else ""), quote=False)

def get(url, tries=3):
    err = None
    for i in range(tries):
        try:
            NREQ[0] += 1
            req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
            with urllib.request.urlopen(req, timeout=30) as r:
                data = json.load(r)
            time.sleep(CFG["DELAY"])
            return data
        except Exception as e:
            err = e; time.sleep(2 * (i + 1))
    raise err

def load_json(p, default):
    try:
        with open(p, encoding="utf-8") as f: return json.load(f)
    except Exception: return default

def save_json(p, obj, compact=False):
    os.makedirs(os.path.dirname(p), exist_ok=True)
    tmp = p + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        if compact: json.dump(obj, f, ensure_ascii=False, separators=(",", ":"))
        else: json.dump(obj, f, ensure_ascii=False, indent=1)
    os.replace(tmp, p)

CACHE = {}
def cget(bucket, key, ttl_s):
    e = CACHE.setdefault(bucket, {}).get(str(key))
    if e and ts() - e["t"] < ttl_s: return e["v"]
    return None
def cput(bucket, key, val): CACHE.setdefault(bucket, {})[str(key)] = {"t": ts(), "v": val}

def prune_cache():
    lim = {"team": CFG["TEAM_TTL_H"] * 3600, "season": CFG["PAST_SEASON_TTL_D"] * 86400,
           "meta": CFG["LEAGUE_META_TTL_D"] * 86400, "mxg": 400 * 86400}
    for b, d in CACHE.items():
        L = lim.get(b, 86400 * 30)
        for k in [k for k, e in d.items() if ts() - e["t"] > L]: del d[k]

# ---------------------------------------------------------------- FotMob helpers
def season_year(s):
    m = re.match(r"(\d{4})", str(s or "")); return int(m.group(1)) if m else 0

def parse_score(st):
    try:
        h, a = [int(x) for x in str(st.get("scoreStr", "")).replace(" ", "").split("-")[:2]]
        return h, a
    except Exception: return None

def league_season(lid, season=None):
    """Calendario compatto di una stagione di campionato + meta. Ritorna dict o None."""
    key = f"{lid}|{season or 'cur'}"
    if key in _RUNCACHE: return _RUNCACHE[key]
    cached = cget("season", key, CFG["PAST_SEASON_TTL_D"] * 86400)
    if cached and (cached.get("past") or ts() - CACHE["season"][key]["t"] < CFG["CUR_SEASON_TTL_H"] * 3600):
        _RUNCACHE[key] = cached; return cached
    url = f"{FM}/leagues?id={lid}"
    if season: url += "&season=" + urllib.parse.quote(season)
    d = get(url)
    det = d.get("details", {})
    sel = det.get("selectedSeason") or season
    ms = []
    for m in (d.get("fixtures") or {}).get("allMatches") or []:
        st = m.get("status") or {}
        if not st.get("finished") or st.get("cancelled") or st.get("awarded"): continue
        sc = parse_score(st)
        if not sc: continue
        ms.append([st.get("utcTime", ""), int(m["id"]), int(m["home"]["id"]), m["home"]["name"],
                   int(m["away"]["id"]), m["away"]["name"], sc[0], sc[1], int(lid)])
    xg = {}
    for tbl in iter_tables(d.get("table")):
        for r in tbl.get("xg") or []:
            try: xg[str(r.get("teamId") or r.get("id"))] = [r["xg"], r["xgConceded"], r["played"]]
            except Exception: pass
    out = {"meta": {"id": int(lid), "type": det.get("type"), "name": det.get("name"), "country": det.get("country"),
                    "gender": det.get("gender"), "latest": det.get("latestSeason"), "seasons": d.get("allAvailableSeasons") or []},
           "season": sel, "past": bool(season and det.get("latestSeason") and season != det.get("latestSeason")),
           "matches": ms, "xg": xg}
    cput("season", key, out); cput("meta", lid, out["meta"])
    _RUNCACHE[key] = out
    return out

def iter_tables(t):
    for blk in t or []:
        data = blk.get("data") or {}
        if isinstance(data.get("table"), dict): yield data["table"]
        for sub in data.get("tables") or []:
            if isinstance(sub.get("table"), dict): yield sub["table"]

def league_meta(lid):
    m = cget("meta", lid, CFG["LEAGUE_META_TTL_D"] * 86400)
    if m: return m
    return league_season(lid)["meta"]

def league_ok(meta, name=""):
    """Solo campionati nazionali maschili senior."""
    if not meta or meta.get("type") != "league": return False, f"tipo {meta.get('type') if meta else '?'}"
    if (meta.get("gender") or "male") != "male": return False, "femminile"
    if (meta.get("country") or "").upper() in ("INT", ""): return False, "internazionale"
    for n in (meta.get("name") or "", name or ""):
        if EXCLUDE_NAME_RE.search(n): return False, f"escluso per nome ({n})"
    return True, ""

def team_history(tid):
    """Ultime partite di campionato (tutte le stagioni disponibili) per squadra. Lista ordinata per data."""
    c = cget("team", tid, CFG["TEAM_TTL_H"] * 3600)
    if c and c.get("v") == 2: return c
    t = get(f"{FM}/teams?id={tid}")
    name = (t.get("details") or {}).get("name")
    ts_list = (t.get("stats") or {}).get("tournamentSeasons") or []
    cands = []
    for s in ts_list:
        nm = s.get("leagueName") or s.get("name") or ""
        if EXCLUDE_NAME_RE.search(nm): continue
        try: cands.append((season_year(s.get("season")), str(s.get("season")), int(s.get("parentLeagueId")), nm))
        except Exception: pass
    cands.sort(key=lambda x: -x[0])
    pool, used, skipped = {}, [], []
    for yr, season, lid, nm in cands[: CFG["HIST_MAX_SEASONS"] + 4]:
        if len(used) >= CFG["HIST_MAX_SEASONS"]: break
        meta = cget("meta", lid, CFG["LEAGUE_META_TTL_D"] * 86400)
        if meta and not league_ok(meta)[0]: skipped.append(nm); continue
        try:
            ls = league_season(lid, season if season != (meta or {}).get("latest") else None)
        except Exception as e:
            skipped.append(f"{nm} {season} (errore)"); continue
        if not league_ok(ls["meta"])[0]: skipped.append(nm); continue
        n0 = len(pool)
        for m in ls["matches"]:
            if tid in (m[2], m[4]): pool[m[1]] = m
        used.append(f"{nm} {season}: {len(pool) - n0}")
        has00 = any(m[6] + m[7] == 0 for m in pool.values())
        if len(pool) >= CFG["HIST_N"] + 3 and (has00 or len(pool) >= CFG["HIST_STREAK_CAP"] + 3): break
    hist = sorted(pool.values(), key=lambda m: m[0])
    out = {"v": 2, "id": tid, "name": name, "matches": hist, "seasons": used, "skipped": skipped}
    cput("team", tid, out)
    return out

def hist_stats(h, tid, n):
    last = h["matches"][-n:]
    goals = sum(1 for m in last if m[6] + m[7] >= 1)
    z = sum(1 for m in last if m[6] + m[7] == 0)
    return {"n": len(last), "with_goal": goals, "zz": z}

def streak_no00(h, tid):
    """Serie attuale di partite di campionato consecutive senza 0-0 (dalla più recente all'indietro)."""
    n, last = 0, None
    for m in reversed(h["matches"]):
        if m[6] + m[7] == 0:
            last = m; break
        n += 1
        if n >= CFG["HIST_STREAK_CAP"]: break
    out = {"streak": n, "complete": last is not None, "capped": last is None and n >= CFG["HIST_STREAK_CAP"]}
    if last:
        opp = last[5] if last[2] == tid else last[3]
        d = last[0][:10]
        out["last00"] = {"date": f"{d[8:10]}/{d[5:7]}/{d[0:4]}", "opp": opp, "home": last[2] == tid}
    return out

def streak_text(x):
    if x["complete"]:
        l = x["last00"]
        return (f"{x['streak']} partite di campionato consecutive senza 0-0 "
                f"(ultimo 0-0: {l['date']} {'vs' if l['home'] else '@'} {l['opp']})")
    if x["capped"]: return f"{x['streak']}+ partite di campionato consecutive senza 0-0"
    return f"almeno {x['streak']} partite di campionato consecutive senza 0-0 (dati disponibili finiti, nessuno 0-0 trovato)"

def form(h, tid, n):
    last = h["matches"][-n:]
    res, gf, ga = [], 0, 0
    for m in last:
        home = m[2] == tid
        f, a = (m[6], m[7]) if home else (m[7], m[6])
        gf += f; ga += a
        res.append("V" if f > a else "P" if f < a else "N")
    k = len(last) or 1
    return {"n": len(last), "seq": "".join(reversed(res)), "avg_tot": round((gf + ga) / k, 2),
            "gf": round(gf / k, 2), "ga": round(ga / k, 2), "zz": sum(1 for m in last if m[6] + m[7] == 0),
            "o15": sum(1 for m in last if m[6] + m[7] >= 2)}

def match_xg(mid):
    c = cget("mxg", mid, 400 * 86400)
    if c is not None: return c
    md = get(f"{FM}/matchDetails?matchId={mid}")
    st = md_stats(md)
    v = None
    if "expected_goals" in st:
        try: v = [float(st["expected_goals"][0]), float(st["expected_goals"][1])]
        except Exception: v = None
    cput("mxg", mid, v)
    return v

def xg_expected(lid, hid, aid, cutoff="9999"):
    """xG atteso prematch dalla sola stagione corrente di campionato."""
    ls = league_season(lid)
    if not ls["xg"]: return {"ok": False, "why": "campionato senza xG su FotMob"}
    out = {"ok": True, "season": ls["season"]}
    hx, ax = ls["xg"].get(str(hid)), ls["xg"].get(str(aid))
    if not hx or not ax or not hx[2] or not ax[2]:
        return {"ok": False, "why": "xG squadra non disponibili"}
    # split casa/trasferta da matchDetails (cache per partita)
    def split(tid, home):
        ms = [m for m in ls["matches"] if (m[2] if home else m[4]) == tid and m[0][:16] < cutoff[:16]][-CFG["XG_SPLIT_MAX_MATCHES"]:]
        f = a = 0.0; n = 0
        for m in ms:
            try: v = match_xg(m[1])
            except Exception: v = None
            if not v: continue
            if home: f += v[0]; a += v[1]
            else: f += v[1]; a += v[0]
            n += 1
        return (f / n, a / n, n) if n >= 2 else None
    hs, as_ = split(hid, True), split(aid, False)
    if hs and as_:
        out["method"] = "casa/trasferta"
        h_for, h_ag, hn = hs; a_for, a_ag, an = as_
    else:
        out["method"] = "media generale"
        h_for, h_ag, hn = hx[0] / hx[2], hx[1] / hx[2], hx[2]
        a_for, a_ag, an = ax[0] / ax[2], ax[1] / ax[2], ax[2]
    out.update({"h_for": h_for, "h_ag": h_ag, "a_for": a_for, "a_ag": a_ag, "hn": hn, "an": an,
                "exp_home": (h_for + a_ag) / 2, "exp_away": (a_for + h_ag) / 2})
    out["total"] = out["exp_home"] + out["exp_away"]
    return out

def md_stats(md):
    out = {}
    try:
        for grp in md["content"]["stats"]["Periods"]["All"]["stats"]:
            for s in grp.get("stats") or []:
                k, v = s.get("key"), s.get("stats")
                if k and v and v[0] is not None and k not in out: out[k] = v
    except Exception: pass
    return out

def live_minute(st):
    lt = st.get("liveTime") or {}
    sh = str(lt.get("short") or "")
    m = re.match(r"\D*(\d+)", sh)
    if not m: return None
    return int(m.group(1))

# ---------------------------------------------------------------- evaluation
def evaluate(md, force=False):
    g, hdr = md["general"], md["header"]
    home, away = g["homeTeam"], g["awayTeam"]
    hid, aid = int(home["id"]), int(away["id"])
    lid = int(g.get("parentLeagueId") or g.get("leagueId"))
    ev = {"matchId": int(g["matchId"]), "lid": lid, "home": home["name"], "away": away["name"], "hid": hid, "aid": aid}
    meta = league_meta(lid)
    ok, why = league_ok(meta, g.get("leagueName"))
    ev["league"] = g.get("leagueName") or meta.get("name"); ev["country"] = meta.get("country") or g.get("countryCode")
    ev["league_ok"], ev["league_why"] = ok, why
    if not ok and not force: return ev
    N = CFG["HIST_N"]
    ko = (g.get("matchTimeUTCDate") or "9999")
    def cut(h):  # solo partite precedenti al calcio d'inizio (utile in --test su gare concluse)
        return dict(h, matches=[m for m in h["matches"] if m[1] != ev["matchId"] and m[0][:16] < ko[:16]])
    hh, ha = cut(team_history(hid)), cut(team_history(aid))
    ev["hist"] = {}
    for side, h, tid in (("home", hh, hid), ("away", ha, aid)):
        ev["hist"][side] = dict(hist_stats(h, tid, N), avail=len(h["matches"]), seasons=h["seasons"],
                                form=form(h, tid, CFG["FORM_N"]), **streak_no00(h, tid))
    H, A = ev["hist"]["home"], ev["hist"]["away"]
    def strong(x): return x["streak"] >= CFG["HIST_STREAK_MIN"]
    def weakok(x): return x["n"] >= N and x["zz"] <= CFG["HIST_MAX_00"]
    s1 = None
    for st, ot, X, Y in (("home", "away", H, A), ("away", "home", A, H)):
        if strong(X) and weakok(Y):
            if s1 is None or X["streak"] > ev["hist"][s1]["streak"]: s1 = st
    ev["storico"] = {"ok": bool(s1), "strong": s1}
    try: ev["xg"] = xg_expected(lid, hid, aid, ko)
    except Exception as e: ev["xg"] = {"ok": False, "why": f"errore xG: {e}"}
    ev["xg"]["signal"] = bool(ev["xg"].get("ok") and ev["xg"]["total"] >= CFG["XG_MIN_TOTAL"])
    cur_eval(ev, lid, ko)
    ev["sig"] = {"storico": ev["storico"]["ok"], "xg": ev["xg"]["signal"], "segna": ev["segna"]["ok"],
                 "subisce": ev["subisce"]["ok"], "mai00": ev["mai00"]["ok"]}
    # H2H (solo campionato)
    league_ids = {lid} | {m[8] for m in hh["matches"]} | {m[8] for m in ha["matches"]}
    h2h = []
    for m in ((md.get("content") or {}).get("h2h") or {}).get("matches") or []:
        st = m.get("status") or {}
        if not st.get("finished"): continue
        try: lgid = int(m["league"]["id"])
        except Exception: continue
        if lgid not in league_ids: continue
        sc = parse_score(st)
        if not sc: continue
        h2h.append({"date": (st.get("utcTime") or "")[:10], "home": m["home"]["name"], "away": m["away"]["name"], "h": sc[0], "a": sc[1]})
    h2h.sort(key=lambda x: x["date"], reverse=True)
    ev["h2h"] = h2h[: CFG["H2H_N"]]
    return ev

def short_season(s):
    m = re.match(r"(\d{4})/(\d{2})(\d{2})$", str(s or ""))
    return f"{m.group(1)}/{m.group(3)}" if m else str(s or "")

def cur_eval(ev, lid, cutoff):
    """Segnali 3-5: solo partite della stagione corrente del campionato della partita."""
    ls = league_season(lid)
    ev["cur_season"] = short_season(ls["season"])
    cur = {}
    for side, tid in (("home", ev["hid"]), ("away", ev["aid"])):
        ms = [m for m in ls["matches"] if tid in (m[2], m[4]) and m[1] != ev["matchId"] and m[0][:16] < cutoff[:16]]
        sc = cc = no0 = 0
        for m in ms:
            f, a = (m[6], m[7]) if m[2] == tid else (m[7], m[6])
            sc += f >= 1; cc += a >= 1; no0 += (f + a) >= 1
        cur[side] = {"n": len(ms), "scored": sc, "conceded": cc, "no00": no0}
    ev["cur"] = cur
    H, A = cur["home"], cur["away"]
    enough = H["n"] >= CFG["CUR_MIN_MATCHES"] and A["n"] >= CFG["CUR_MIN_MATCHES"]
    def ge(x, k, p): return x["n"] > 0 and x[k] * 100 >= p * x["n"]
    def pick(k, ps, po):
        for st, ot in (("home", "away"), ("away", "home")):
            if ge(cur[st], k, ps) and (po is None or ge(cur[ot], k, po)): return st
        return None
    for typ, k, ps, po in (("segna", "scored", CFG["SEGNA_STRONG_PCT"], CFG["SEGNA_OTHER_PCT"]),
                           ("subisce", "conceded", CFG["SUBISCE_PCT"], None),
                           ("mai00", "no00", CFG["MAI00_STRONG_PCT"], CFG["MAI00_OTHER_PCT"])):
        st = pick(k, ps, po) if enough else None
        if not st:  # orientamento "migliore" solo per mostrare i numeri
            best = "home" if (H[k] / max(H["n"], 1)) >= (A[k] / max(A["n"], 1)) else "away"
        ev[typ] = {"ok": bool(st), "strong": st or best, "enough": enough}

def live_snapshot(md):
    st = md_stats(md); s = md["header"]["status"]
    def pair(k):
        v = st.get(k); return v if v else None
    red = [s.get("numberOfHomeRedCards", 0) or 0, s.get("numberOfAwayRedCards", 0) or 0]
    if "red_cards" in st:
        try: red = [int(st["red_cards"][0]), int(st["red_cards"][1])]
        except Exception: pass
    return {"minute": live_minute(s), "phase": re.sub(r"[^\w+' ]", "", str((s.get("liveTime") or {}).get("short") or "")), "finished": bool(s.get("finished")), "score": s.get("scoreStr"), "xg": pair("expected_goals"),
            "poss": pair("BallPossesion"), "shots": pair("total_shots"), "sot": pair("ShotsOnTarget"),
            "big": pair("big_chance"), "box": pair("touches_opp_box"), "corners": pair("corners"), "red": red}

# ---------------------------------------------------------------- messages
def reason_text(ev, typ):
    N = CFG["HIST_N"]
    if typ == "storico":
        H, A = ev["hist"]["home"], ev["hist"]["away"]
        s = ev["storico"]["strong"] or ("home" if H["streak"] >= A["streak"] else "away")
        st, ot = (H, A) if s == "home" else (A, H)
        sl, ol = ("Casa", "Ospite") if s == "home" else ("Ospite", "Casa")
        return (f"{sl}: {streak_text(st)}; "
                f"{ol}: {ot['zz']} 0-0 nelle ultime {ot['n']} di campionato")
    if typ in ("segna", "subisce", "mai00"):
        st = ev[typ]["strong"]; ot = "away" if st == "home" else "home"
        S, O = ev["cur"][st], ev["cur"][ot]
        sl, ol = ("Casa", "Ospite") if st == "home" else ("Ospite", "Casa")
        sea = ev["cur_season"]
        def pc(x, k): return f"{round(100 * x[k] / x['n']) if x['n'] else 0}%"
        txt = ""
        if typ == "segna":
            txt = (f"{sl} ha segnato almeno 1 gol in {S['scored']}/{S['n']} partite di campionato {sea}; "
                   f"{ol} in {O['scored']}/{O['n']} ({pc(O, 'scored')})")
        elif typ == "subisce":
            txt = (f"{sl} ha subito almeno 1 gol in {S['conceded']}/{S['n']} partite di campionato {sea} "
                   f"({ol}: {O['conceded']}/{O['n']})")
        else:
            txt = (f"{sl}: over 0.5 totali (nessuno 0-0) in {S['no00']}/{S['n']} partite di campionato {sea}; "
                   f"{ol}: {O['no00']}/{O['n']} senza 0-0 ({pc(O, 'no00')})")
        txt += f" [solo campionato in corso, min. {CFG['CUR_MIN_MATCHES']} partite per squadra]"
        if not ev[typ]["enough"]: txt += f" — NON valido: meno di {CFG['CUR_MIN_MATCHES']} partite in stagione"
        return txt
    x = ev["xg"]
    if not x.get("ok"): return f"xG non disponibile ({x.get('why')})"
    return (f"xG atteso prematch {x['total']:.2f} (casa {x['exp_home']:.2f} + ospite {x['exp_away']:.2f}) "
            f"{'≥' if x['total'] >= CFG['XG_MIN_TOTAL'] else '<'} {CFG['XG_MIN_TOTAL']}")

def fmt_pair(v, suffix=""):
    return f"{v[0]}{suffix} - {v[1]}{suffix}" if v else "n.d."

def build_message(ev, live, types, test=False):
    """Un solo messaggio con tutti i tipi di segnale scattati sulla partita."""
    L = []
    if test: L.append("🧪 <b>TEST</b> (messaggio di prova, non è un segnale reale)")
    names = " + ".join(f"{TYPE_ICONS[t]} {TYPE_NAMES[t]}" for t in types)
    L.append(f"🚨 <b>{'SEGNALE' if len(types) == 1 else 'SEGNALI'}: {names}</b>")
    L.append(f"🏆 {esc(ev['league'])} ({esc(ev['country'])})")
    L.append(f"⚽ <b>{esc(ev['home'])} - {esc(ev['away'])}</b>")
    mnt = f"{live['minute']}'" if live.get("minute") is not None else ("FINITA" if live.get("finished") else (live.get("phase") or "?"))
    L.append(f"⏱ {mnt}   📊 {esc(live.get('score') or '0 - 0')}")
    for typ in types:
        L.append("")
        cond = ""
        if test: cond = " — condizione " + ("SODDISFATTA ✅" if ev["sig"].get(typ) else "NON soddisfatta ❌")
        L.append(f"🎯 <b>{TYPE_ICONS[typ]} {TYPE_NAMES[typ]}</b>{cond}")
        L.append(f"   {esc(reason_text(ev, typ))}")
        if typ == "storico":
            H, A = ev["hist"]["home"], ev["hist"]["away"]
            L.append(f"   (0-0 = nessun gol; over 0.5 totali = almeno 1 gol di una delle due squadre, minimo {CFG['HIST_STREAK_MIN']} di fila)")
            L.append(f"   Serie senza 0-0: casa {H['streak']}{'' if H['complete'] else '+'} | ospite {A['streak']}{'' if A['complete'] else '+'}")
            L.append(f"   0-0 nelle ultime {CFG['HIST_N']}: casa {H['zz']}/{H['n']} | ospite {A['zz']}/{A['n']}")
        elif typ == "xg":
            x = ev["xg"]
            if x.get("ok"):
                L.append(f"   Casa (in casa): xG fatti {x['h_for']:.2f}, subiti {x['h_ag']:.2f} ({x['hn']} gare)")
                L.append(f"   Ospite (fuori): xG fatti {x['a_for']:.2f}, subiti {x['a_ag']:.2f} ({x['an']} gare)")
                L.append(f"   Stagione {esc(x.get('season'))}, metodo: {x.get('method')}")
    H, A = ev["cur"]["home"], ev["cur"]["away"]
    L.append("")
    L.append(f"📅 <b>Stagione {esc(ev['cur_season'])}</b> (solo campionato in corso, minimo {CFG['CUR_MIN_MATCHES']} partite per squadra)")
    for lab, X in (("🏠 Casa", H), ("✈️ Ospite", A)):
        L.append(f"   {lab}: segna {X['scored']}/{X['n']} | subisce {X['conceded']}/{X['n']} | no 0-0 {X['no00']}/{X['n']}")
    L.append("")
    L.append("📡 <b>Statistiche " + ("finali" if live.get("finished") else "live") + "</b> (casa - ospite)")
    if live.get("xg"): L.append(f"   xG: {fmt_pair(live['xg'])}")
    L.append(f"   Tiri: {fmt_pair(live.get('shots'))}  |  In porta: {fmt_pair(live.get('sot'))}")
    L.append(f"   Grandi occasioni: {fmt_pair(live.get('big'))}  |  Tocchi in area: {fmt_pair(live.get('box'))}")
    L.append(f"   Possesso: {fmt_pair(live.get('poss'), '%')}  |  Angoli: {fmt_pair(live.get('corners'))}")
    L.append(f"   🟥 Rossi: {fmt_pair(live.get('red'))}")
    L.append("")
    L.append(f"📋 <b>Forma campionato</b> (ultime {CFG['FORM_N']}, più recente a sinistra)")
    for lab, side, nm in (("🏠", "home", ev["home"]), ("✈️", "away", ev["away"])):
        f = ev["hist"][side]["form"]
        L.append(f"   {lab} {esc(nm)}: {f['seq']} | media gol {f['avg_tot']} ({f['gf']}-{f['ga']}) | 0-0: {f['zz']}/{f['n']}")
    if ev.get("h2h"):
        o05 = sum(1 for m in ev["h2h"] if m["h"] + m["a"] >= 1)
        L.append("")
        L.append(f"🤝 <b>H2H</b> (campionato, info): Over 0.5 in {o05}/{len(ev['h2h'])}")
        for m in ev["h2h"][:5]:
            L.append(f"   {m['date']} {esc(m['home'])} {m['h']}-{m['a']} {esc(m['away'])}")
    L.append("")
    L.append(f'🔗 <a href="https://www.fotmob.com/match/{ev["matchId"]}">Apri su FotMob</a>')
    return "\n".join(L)

def send_telegram(text):
    tok = os.environ.get("TELEGRAM_BOT_TOKEN")
    chat = os.environ.get("TELEGRAM_CHAT_ID") or DEFAULT_CHAT_ID
    if not tok:
        log("  [telegram] TELEGRAM_BOT_TOKEN assente: messaggio non inviato"); return False
    body = urllib.parse.urlencode({"chat_id": chat, "text": text, "parse_mode": "HTML",
                                   "disable_web_page_preview": "true"}).encode()
    try:
        req = urllib.request.Request(f"https://api.telegram.org/bot{tok}/sendMessage", data=body)
        with urllib.request.urlopen(req, timeout=30) as r:
            ok = json.load(r).get("ok", False)
        log(f"  [telegram] inviato: {ok}"); return ok
    except urllib.error.HTTPError as e:
        try: msg = e.read().decode()[:300]
        except Exception: msg = ""
        log(f"  [telegram] errore HTTP {e.code} {msg}"); return False
    except Exception as e:
        log(f"  [telegram] errore {type(e).__name__}"); return False

# ---------------------------------------------------------------- live scan
def live_matches():
    today = now_utc().astimezone(ROME)
    dates = [today]
    if today.hour < 4: dates.insert(0, today - datetime.timedelta(days=1))
    out = {}
    for d in dates:
        j = get(f"{FM}/matches?date={d.strftime('%Y%m%d')}&timezone=Europe%2FRome")
        for L in j.get("leagues") or []:
            for m in L.get("matches") or []:
                m["_league"] = {"ccode": L.get("ccode"), "name": L.get("name"), "id": L.get("id"),
                                "pid": L.get("primaryId") or L.get("id")}
                out[int(m["id"])] = m
    return out

def signal_record(ev, live, typ):
    rec = {"id": f"{ev['matchId']}-{typ}", "type": typ, "time": rome_str(), "ts": int(ts()),
           "league": ev["league"], "country": ev["country"], "leagueId": ev["lid"],
           "home": ev["home"], "away": ev["away"], "matchId": ev["matchId"],
           "reason": reason_text(ev, typ), "minute": live.get("minute"), "score_at_signal": live.get("score"),
           "stats": live, "status": "pending", "final": None,
           "url": f"https://www.fotmob.com/match/{ev['matchId']}"}
    if typ == "storico":
        rec["details"] = {k: {kk: ev["hist"][k].get(kk) for kk in ("streak", "complete", "capped", "last00", "n", "zz", "avail")}
                          for k in ("home", "away")}
        rec["details"]["strong"] = ev["storico"]["strong"]
        rec["streak"] = ev["hist"][ev["storico"]["strong"]]["streak"]
        rec["streak_complete"] = ev["hist"][ev["storico"]["strong"]]["complete"]
    elif typ in ("segna", "subisce", "mai00"):
        rec["details"] = {"season": ev["cur_season"], "strong": ev[typ]["strong"], "home": ev["cur"]["home"], "away": ev["cur"]["away"]}
    else:
        x = ev["xg"]
        rec["details"] = {k: round(x[k], 3) if isinstance(x[k], float) else x[k]
                          for k in ("total", "exp_home", "exp_away", "h_for", "h_ag", "a_for", "a_ag", "method", "season")}
    return rec

def resolve_pending(signals, lm, dry):
    changed = False; done = {}
    for s in signals:
        if s.get("status") != "pending": continue
        m = lm.get(int(s["matchId"]))
        st = None
        if m: st = m.get("status") or {}
        elif ts() - s.get("ts", 0) > 2.5 * 3600:
            try: st = get(f"{FM}/matchDetails?matchId={s['matchId']}")["header"]["status"]
            except Exception: st = None
        if not st: continue
        if st.get("cancelled"):
            s["status"] = "void"; changed = True; continue
        if not st.get("finished"):
            if ts() - s.get("ts", 0) > CFG["PENDING_GIVEUP_H"] * 3600: s["status"] = "void"; changed = True
            continue
        sc = parse_score(st)
        if not sc: continue
        s["final"] = f"{sc[0]}-{sc[1]}"; s["status"] = "won" if sc[0] + sc[1] >= 1 else "lost"
        s["resolved"] = rome_str(); changed = True
        log(f"esito {s['id']}: {s['final']} {s['status']}")
        done.setdefault(s["matchId"], []).append(s)
    if CFG["RESULT_FOLLOWUP"] and not dry:
        for mid, lst in done.items():   # un solo messaggio di esito per partita
            s = lst[0]
            em = "✅ VINTO" if s["status"] == "won" else "❌ PERSO"
            tipi = " + ".join(f"{TYPE_ICONS[x['type']]} {TYPE_NAMES[x['type']]}" for x in lst)
            send_telegram(f"{em} — esito {'segnale' if len(lst) == 1 else 'segnali'} <b>{tipi}</b>\n⚽ {esc(s['home'])} - {esc(s['away'])}\n"
                          f"🏁 Finale: <b>{s['final']}</b> (segnale al {s.get('minute')}' sullo 0-0)")
    return changed

def scan(dry=False):
    state = load_json(STATE_F, {})
    signals = load_json(SIGNALS_F, [])
    state.setdefault("sent", {}); state.setdefault("checked", {})
    old_state = state_fingerprint(state)
    old_signals = json.dumps(signals, sort_keys=True)
    lm = live_matches()
    changed = resolve_pending(signals, lm, dry)
    live = [m for m in lm.values() if (m.get("status") or {}).get("started") and not m["status"].get("finished")
            and not m["status"].get("cancelled")]
    cands = []
    for mid, m in lm.items():
        st = m.get("status") or {}
        if not st.get("started") or st.get("finished") or st.get("cancelled"): continue
        if (m["home"].get("score"), m["away"].get("score")) != (0, 0): continue
        mn = live_minute(st)
        if mn is None or not (CFG["MIN_FROM"] <= mn <= CFG["MIN_TO"]): continue
        if (m["_league"]["ccode"] or "").upper() == "INT": continue
        if EXCLUDE_NAME_RE.search(m["_league"]["name"] or ""): continue
        if str(mid) in state["checked"]: continue
        if EXCLUDE_RESERVE_TEAMS and (RESERVE_TEAM_RE.search(m["home"].get("name") or "") or RESERVE_TEAM_RE.search(m["away"].get("name") or "")):
            continue
        cands.append(m)
    log(f"partite live: {len(live)}, candidate 0-0 {CFG['MIN_FROM']}-{CFG['MIN_TO']}': {len(cands)}")
    n_sig = 0
    for m in cands:
        mid = int(m["id"])
        log(f"- {m['_league']['ccode']} {m['_league']['name']}: {m['home']['name']} - {m['away']['name']} ({live_minute(m['status'])}')")
        try:
            meta = league_meta(int(m["_league"]["pid"]))
            ok, why = league_ok(meta, m["_league"]["name"])
            if not ok:
                log(f"   scartata: {why}"); state["checked"][str(mid)] = {"t": int(ts()), "r": why}; continue
            md = get(f"{FM}/matchDetails?matchId={mid}")
            ev = evaluate(md)
            if not ev["league_ok"]:
                log(f"   scartata: {ev['league_why']}"); state["checked"][str(mid)] = {"t": int(ts()), "r": ev["league_why"]}; continue
            snap = live_snapshot(md)
            if snap.get("minute") is None: snap["minute"] = live_minute(m["status"])
            if snap.get("score") and parse_score({"scoreStr": snap["score"]}) not in (None, (0, 0)):
                log("   non più 0-0"); continue
            H, A = ev["hist"]["home"], ev["hist"]["away"]
            log(f"   storico: serie senza 0-0 casa {H['streak']} / ospite {A['streak']}; 0-0 ultime {CFG['HIST_N']}: casa {H['zz']} / ospite {A['zz']} -> {ev['storico']['ok']}")
            log(f"   xG: {reason_text(ev, 'xg')} -> {ev['xg']['signal']}")
            for t in ("segna", "subisce", "mai00"): log(f"   {TYPE_NAMES[t]}: {reason_text(ev, t)} -> {ev['sig'][t]}")
            res = dict(ev["sig"])
            sent = state["sent"].setdefault(str(mid), {})
            hits = [t for t in TYPES if res.get(t) and t not in sent]
            if hits:
                log("   >>> SEGNALE " + " + ".join(TYPE_NAMES[t] for t in hits))
                if not dry: send_telegram(build_message(ev, snap, hits))
                for t in hits:
                    sent[t] = rome_str()
                    signals.append(signal_record(ev, snap, t)); n_sig += 1
            state["checked"][str(mid)] = {"t": int(ts()), "r": "valutata", "res": res}
        except Exception as e:
            log(f"   errore: {type(e).__name__}: {e}")
    # pulizia state
    for k in [k for k, v in state["checked"].items() if ts() - v.get("t", 0) > 2 * 86400]: del state["checked"][k]
    for k in [k for k in state["sent"] if not any(str(s["matchId"]) == k and s["status"] == "pending" for s in signals)
              and k not in state["checked"]]:
        del state["sent"][k]
    state["rules"] = rules_dict()
    state["live_count"] = len(live)
    state["candidates_last"] = len(cands)
    state["last_scan"] = rome_str()
    state["requests_last"] = NREQ[0]
    new_state = state_fingerprint(state)
    lw = state.get("last_write_ts", 0)
    must = new_state != old_state or json.dumps(signals, sort_keys=True) != old_signals or ts() - lw > CFG["HEARTBEAT_MIN"] * 60
    if dry:
        log(f"dry-run: niente salvataggio. segnali nuovi {n_sig}, richieste {NREQ[0]}"); return
    if must:
        state["last_write"] = rome_str(); state["last_write_ts"] = int(ts())
        save_json(STATE_F, state); save_json(SIGNALS_F, signals)
    log(f"fine: segnali nuovi {n_sig}, richieste HTTP {NREQ[0]}, state scritto: {must}")

VOLATILE = ("last_scan", "last_write", "last_write_ts", "live_count", "candidates_last", "requests_last")
def state_fingerprint(state):
    return json.dumps({k: v for k, v in state.items() if k not in VOLATILE}, sort_keys=True)

def rules_dict():
    return {"window": f"{CFG['MIN_FROM']}-{CFG['MIN_TO']}'", "hist_n": CFG["HIST_N"], "streak_min": CFG["HIST_STREAK_MIN"],
            "hist_max_00": CFG["HIST_MAX_00"], "xg_min": CFG["XG_MIN_TOTAL"], "cur_min": CFG["CUR_MIN_MATCHES"],
            "segna_strong": CFG["SEGNA_STRONG_PCT"], "segna_other": CFG["SEGNA_OTHER_PCT"], "subisce": CFG["SUBISCE_PCT"],
            "mai00_strong": CFG["MAI00_STRONG_PCT"], "mai00_other": CFG["MAI00_OTHER_PCT"]}

# ---------------------------------------------------------------- test mode
def test(mids, send=False, save=False):
    for mid in mids:
        log(f"\n================ TEST matchId {mid} ================")
        md = get(f"{FM}/matchDetails?matchId={mid}")
        ev = evaluate(md, force=True)
        snap = live_snapshot(md)
        log(f"{ev['country']} | {ev['league']} (lid {ev['lid']}) | campionato valido: {ev['league_ok']} {ev['league_why']}")
        log(f"{ev['home']} - {ev['away']}  stato: {snap['score']}  min {snap['minute']}")
        for side in ("home", "away"):
            h = ev["hist"][side]
            log(f"  {side}: disponibili {h['avail']} partite camp. | SERIE senza 0-0: {h['streak']} (completa={h['complete']}, cap={h['capped']}, ultimo 0-0={h.get('last00')}) | ultime {h['n']}: 0-0 {h['zz']}")
            log(f"        stagioni: {h['seasons']}")
            log(f"        forma: {h['form']}")
        log(f"  STORICO GOL -> {ev['storico']}  | {reason_text(ev, 'storico')}")
        x = ev["xg"]
        log(f"  xG -> {json.dumps({k: (round(v, 3) if isinstance(v, float) else v) for k, v in x.items()}, ensure_ascii=False)}")
        log(f"  H2H campionato: {len(ev['h2h'])}")
        log(f"  stagione corrente {ev['cur_season']}: casa {ev['cur']['home']} | ospite {ev['cur']['away']}")
        for t in ("segna", "subisce", "mai00"):
            log(f"  {TYPE_NAMES[t]} -> {ev['sig'][t]} | {reason_text(ev, t)}")
        types = [t for t in TYPES if not (t == "xg" and not x.get("ok"))]
        msg = build_message(ev, snap, types, test=True)
        log("\n--- messaggio (tutti i tipi, con esito condizione) ---\n" + msg)
        if send:
            send_telegram(msg); send = False   # un solo messaggio di prova
    log(f"\nrichieste HTTP: {NREQ[0]}")

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--test", action="append", help="matchId da valutare forzatamente")
    ap.add_argument("--send", action="store_true", help="in --test invia 1 messaggio Telegram 🧪 TEST")
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()
    global CACHE
    CACHE = load_json(CACHE_F, {})
    t0 = time.time()
    try:
        if a.test: test(a.test, send=a.send)
        else:
            try: scan(dry=a.dry_run)
            except Exception as e:   # errore di rete/FotMob: non far fallire il workflow, riprova al prossimo giro
                log(f"ERRORE scansione: {type(e).__name__}: {e}")
    finally:
        prune_cache(); save_json(CACHE_F, CACHE, compact=True)
        log(f"durata {time.time() - t0:.1f}s")

if __name__ == "__main__":
    main()
