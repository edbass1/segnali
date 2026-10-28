#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Scanner segnali live (FotMob) -> Telegram + storico in live/data/.

Uso:
  python scanner/scan.py                 # scansione normale (cron)
  python scanner/scan.py --dry-run       # come sopra ma senza Telegram e senza salvare
  python scanner/scan.py --daily [--date 20261027] [--out file.json]
        "Partite del giorno": partite di campionato della data (ora italiana) le cui squadre
        soddisfano GIÀ i requisiti prematch di almeno un segnale -> live/data/today.json
        (nessun Telegram, nessuna chiamata The Odds API).
  python scanner/scan.py --test 5802971 [--test ID2] [--send]
        forza la valutazione di una partita ignorando punteggio/minuto,
        stampa i numeri; con --send invia il messaggio marcato 🧪 TEST.
Solo libreria standard Python 3.
"""
import argparse, concurrent.futures, datetime, difflib, html, json, os, re, sys, threading, time, unicodedata, urllib.parse, urllib.request, urllib.error
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
    # Partite del giorno (--daily)
    "DAILY_BUDGET_MIN": 45,      # tempo massimo di calcolo: poi scrive il file parziale
    "DAILY_DELAY": 0.25,         # pausa extra tra una partita e l'altra (s)
    "DAILY_SAVE_EVERY": 25,
    "DAILY_WORKERS": 4,          # partite valutate in parallelo (richieste FotMob contemporanee)      # salva la cache ogni N partite (job interrotto = lavoro non perso)
}
DEFAULT_CHAT_ID = "621551511"
EXCLUDE_NAME_RE = re.compile(
    r"\b(u-?1[5-9]|u-?2[0-3]|under ?\d\d|youth|primavera|reserve|reserves|women|woman|femenil|femenina|"
    r"feminine|f[ée]minine|frauen|damallsvenskan|wsl|nwsl|baller|futsal|beach|esports|amateur|"
    r"premier league 2|professional development|next pro|friendl\w*|cup|copa|coppa|coupe|pokal|ta[cç]a|"
    r"puchar|beker|kupa|cupa|kup|trophy|shield|super ?cup|supercopa|supercoppa|play-?offs?)\b", re.I)
RESERVE_TEAM_RE = re.compile(r"(\s(II|2|B|U-?\d\d)$|^jong\s|\breserves?\b|\bacademy\b)", re.I)
EXCLUDE_RESERVE_TEAMS = True     # esclude squadre riserve/B (es. "Brann 2", "Jong PSV")
# --- Quota live Over 0.5 (The Odds API v4, env ODDS_API_KEY) ---
ODDS_BOOKMAKER = "paddypower"        # uso interno: il bookmaker non viene mai mostrato
ODDS_MARKET = "alternate_totals"     # 1 credito per chiamata
ODDS_TIME_TOL_H = 3                  # tolleranza orario d'inizio per abbinare l'evento
# lega FotMob (id) -> sport key The Odds API (solo campionati nazionali)
ODDS_SPORT = {
    112: "soccer_argentina_primera_division", 113: "soccer_australia_aleague", 38: "soccer_austria_bundesliga",
    40: "soccer_belgium_first_div", 268: "soccer_brazil_campeonato", 8814: "soccer_brazil_serie_b",
    273: "soccer_chile_campeonato", 46: "soccer_denmark_superliga", 47: "soccer_epl", 48: "soccer_efl_champ",
    108: "soccer_england_league1", 109: "soccer_england_league2", 51: "soccer_finland_veikkausliiga",
    53: "soccer_france_ligue_one", 110: "soccer_france_ligue_two", 54: "soccer_germany_bundesliga",
    146: "soccer_germany_bundesliga2", 208: "soccer_germany_liga3", 135: "soccer_greece_super_league",
    55: "soccer_italy_serie_a", 86: "soccer_italy_serie_b", 223: "soccer_japan_j_league", 9080: "soccer_korea_kleague1",
    126: "soccer_league_of_ireland", 230: "soccer_mexico_ligamx", 57: "soccer_netherlands_eredivisie",
    59: "soccer_norway_eliteserien", 196: "soccer_poland_ekstraklasa", 61: "soccer_portugal_primeira_liga",
    63: "soccer_russia_premier_league", 536: "soccer_saudi_arabia_pro_league", 87: "soccer_spain_la_liga",
    140: "soccer_spain_segunda_division", 64: "soccer_spl", 67: "soccer_sweden_allsvenskan",
    168: "soccer_sweden_superettan", 69: "soccer_switzerland_superleague", 71: "soccer_turkey_super_league",
    130: "soccer_usa_mls",
}
# ================================================================

ROME = ZoneInfo("Europe/Rome")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "live", "data")
SIGNALS_F = os.path.join(DATA, "signals.json")
STATE_F = os.path.join(DATA, "state.json")
CACHE_DIR = os.path.join(ROOT, "scanner", ".cache")
CACHE_F = os.path.join(CACHE_DIR, "cache.json")
TODAY_F = os.path.join(DATA, "today.json")
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
FM = "https://www.fotmob.com/api/data"
TYPES = ["storico", "xg", "segna", "subisce", "mai00"]
TYPE_NAMES = {"storico": "STORICO GOL (serie senza 0-0)", "xg": "xG", "segna": "SEGNA SEMPRE", "subisce": "SUBISCE SEMPRE", "mai00": "MAI 0-0"}
TYPE_ICONS = {"storico": "📚", "xg": "📈", "segna": "⚽", "subisce": "🥅", "mai00": "🚫"}
NREQ = [0]
_RUNCACHE = {}
_LOCK = threading.RLock()          # cache/contatori (thread-safe per --daily in parallelo)
_KEYLOCKS = {}
def keylock(k):
    """Lock per chiave: due thread non scaricano la stessa stagione/squadra/partita insieme."""
    with _LOCK: return _KEYLOCKS.setdefault(k, threading.Lock())

def now_utc(): return datetime.datetime.now(datetime.timezone.utc)
def ts(): return time.time()
def rome_str(dt=None): return (dt or now_utc()).astimezone(ROME).strftime("%Y-%m-%d %H:%M")
def log(*a): print(*a, flush=True)
def esc(s): return html.escape(str(s if s is not None else ""), quote=False)

def get(url, tries=3):
    err = None
    for i in range(tries):
        try:
            with _LOCK: NREQ[0] += 1
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
    e = CACHE.get(bucket, {}).get(str(key))
    if e and ts() - e["t"] < ttl_s: return e["v"]
    return None
def cput(bucket, key, val):
    with _LOCK: CACHE.setdefault(bucket, {})[str(key)] = {"t": ts(), "v": val}

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
    with keylock("ls|" + key): return _league_season(lid, season, key)

def _league_season(lid, season, key):
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
    with keylock(f"team|{tid}"): return _team_history(tid)

def _team_history(tid):
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
    with keylock(f"mxg|{mid}"): return _match_xg(mid)

def _match_xg(mid):
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
    ev["ko"] = g.get("matchTimeUTCDate")
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

def build_message(ev, live, types, test=False, odds=None):
    """Un solo messaggio con tutti i tipi di segnale scattati sulla partita."""
    L = []
    if test: L.append("🧪 <b>TEST</b> (messaggio di prova, non è un segnale reale)")
    names = " + ".join(f"{TYPE_ICONS[t]} {TYPE_NAMES[t]}" for t in types)
    L.append(f"🚨 <b>{'SEGNALE' if len(types) == 1 else 'SEGNALI'}: {names}</b>")
    L.append(f"🏆 {esc(ev['league'])} ({esc(ev['country'])})")
    L.append(f"⚽ <b>{esc(ev['home'])} - {esc(ev['away'])}</b>")
    mnt = f"{live['minute']}'" if live.get("minute") is not None else ("FINITA" if live.get("finished") else (live.get("phase") or "?"))
    L.append(f"⏱ {mnt}   📊 {esc(live.get('score') or '0 - 0')}")
    if odds is not None: L.append(odds_line(odds))
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

# ---------------------------------------------------------------- quota Over 0.5 live
ODDS_API = "https://api.the-odds-api.com/v4"
ODDS_STATUS = {}
_STOP = {"fc", "cf", "sk", "ac", "as", "sc", "fk", "cd", "ud", "sd", "rc", "rcd", "afc", "ss", "us", "ssc", "vfb", "vfl",
         "tsg", "sv", "bk", "if", "ik", "ff", "aik", "club", "de", "del", "la", "le", "the", "calcio", "cfc", "fbc", "bsc",
         "kv", "krc", "rsc", "osc", "ogc", "sco", "esp", "nk", "hnk", "gnk", "ks", "sl", "ca", "cs", "ec", "se", "cr", "fbk",
         "1", "04", "05", "07", "08", "09", "1899", "1900", "1909", "1913"}

_TRANSLIT = str.maketrans({"æ": "ae", "Æ": "ae", "ø": "o", "Ø": "o", "œ": "oe", "ß": "ss", "ł": "l", "Ł": "l",
                           "ı": "i", "đ": "d", "Đ": "d", "þ": "th", "ð": "d"})
_ALIAS = {"hamkam": "hamarkameratene", "olympiakos": "olympiacos", "man": "manchester", "wolves": "wolverhampton",
          "spurs": "tottenham", "psg": "paris saint germain", "inter": "inter", "gladbach": "monchengladbach"}

def _norm_tokens(name, keep_generic=False):
    t = unicodedata.normalize("NFKD", str(name or "").translate(_TRANSLIT)).encode("ascii", "ignore").decode().lower()
    t = re.sub(r"[^a-z0-9 ]+", " ", t.replace("-", " ").replace(".", " ").replace("'", ""))
    toks = [w for x in t.split() if x for w in _ALIAS.get(x, x).split()]
    core = [w for w in toks if w not in _STOP]
    return set(core if core and not keep_generic else toks)

def _tok_eq(x, y):
    if x == y: return True
    if len(x) >= 3 and len(y) >= 3 and (x.startswith(y) or y.startswith(x)): return True
    return len(x) >= 5 and len(y) >= 5 and difflib.SequenceMatcher(None, x, y).ratio() >= 0.8

def name_score(a, b):
    """Somiglianza 0..1 tra due nomi squadra (accenti, sigle FC/CF/SK..., token comuni o prefissi)."""
    best = 0.0
    for kg in (False, True):
        A, B = _norm_tokens(a, kg), _norm_tokens(b, kg)
        if not A or not B: continue
        hit = sum(1 for x in A if any(_tok_eq(x, y) for y in B))
        best = max(best, hit / min(len(A), len(B)))
    return best

def odds_get(path, params):
    key = os.environ.get("ODDS_API_KEY")
    q = urllib.parse.urlencode(dict(params, apiKey=key))
    req = urllib.request.Request(f"{ODDS_API}{path}?{q}", headers={"User-Agent": UA})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            data = json.load(r); hdr = r.headers
    except urllib.error.HTTPError as e:   # mai stampare l'URL (contiene la chiave)
        raise RuntimeError(f"Odds API HTTP {e.code}") from None
    except Exception as e:
        raise RuntimeError(f"Odds API errore {type(e).__name__}") from None
    if hdr.get("x-requests-remaining") is not None:
        ODDS_STATUS.update({"remaining": hdr.get("x-requests-remaining"), "used": hdr.get("x-requests-used"),
                            "last_cost": hdr.get("x-requests-last"), "time": rome_str()})
    return data

def find_odds_event(sport, home, away, ko_iso):
    """Evento The Odds API per la partita (endpoint /events: gratuito)."""
    evs = odds_get(f"/sports/{sport}/events", {"dateFormat": "iso"})
    try: ko = datetime.datetime.fromisoformat(ko_iso.replace("Z", "+00:00"))
    except Exception: ko = None
    best, bs = None, 0
    for e in evs:
        ct = None
        if ko:
            try:
                ct = datetime.datetime.fromisoformat(e["commence_time"].replace("Z", "+00:00"))
                if abs((ct - ko).total_seconds()) > ODDS_TIME_TOL_H * 3600: continue
            except Exception: pass
        sh, sa = name_score(home, e.get("home_team")), name_score(away, e.get("away_team"))
        # entrambe simili, oppure una identica e stesso orario (una squadra non gioca due partite insieme)
        if min(sh, sa) < 0.5 and not (max(sh, sa) >= 1 and ko and ct and abs((ct - ko).total_seconds()) <= 1800): continue
        sc = sh + sa
        if sc > bs: best, bs = e, sc
    return best

def over05_live(ev):
    """Quota live Over 0.5 (una chiamata a pagamento: 1 credito). Ritorna dict con price o reason."""
    out = {"price": None}
    if not os.environ.get("ODDS_API_KEY"): out["reason"] = "chiave API assente"; return out
    sport = ODDS_SPORT.get(int(ev["lid"]))
    if not sport: out["reason"] = "campionato non coperto"; return out
    try:
        e = find_odds_event(sport, ev["home"], ev["away"], ev.get("ko") or "")
        if not e: out["reason"] = "partita non trovata"; return out
        out["event"] = e["id"]
        d = odds_get(f"/sports/{sport}/events/{e['id']}/odds",
                     {"bookmakers": ODDS_BOOKMAKER, "markets": ODDS_MARKET, "oddsFormat": "decimal"})
        for b in d.get("bookmakers") or []:
            if b.get("key") != ODDS_BOOKMAKER: continue
            for mk in b.get("markets") or []:
                if mk.get("key") != ODDS_MARKET: continue
                for o in mk.get("outcomes") or []:
                    if str(o.get("name")).lower() == "over" and abs(float(o.get("point", -1)) - 0.5) < 1e-6:
                        out["price"] = float(o["price"]); out["time"] = rome_str(); return out
        out["reason"] = "quota non offerta"
    except Exception as ex:
        out["reason"] = str(ex)[:80]
    return out

def odds_line(od):
    if od and od.get("price"): return f"💰 Over 0.5 live: <b>{od['price']:.2f}</b>"
    return "💰 Over 0.5 live: non disponibile"

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

def signal_record(ev, live, typ, odds=None):
    rec = {"id": f"{ev['matchId']}-{typ}", "type": typ, "time": rome_str(), "ts": int(ts()),
           "league": ev["league"], "country": ev["country"], "leagueId": ev["lid"],
           "home": ev["home"], "away": ev["away"], "matchId": ev["matchId"],
           "reason": reason_text(ev, typ), "minute": live.get("minute"), "score_at_signal": live.get("score"),
           "stats": live, "status": "pending", "final": None,
           "url": f"https://www.fotmob.com/match/{ev['matchId']}",
           "over05": (odds or {}).get("price"), "over05_note": None if (odds or {}).get("price") else (odds or {}).get("reason")}
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
                od = over05_live(ev) if not dry else {"price": None, "reason": "dry-run"}   # 1 sola chiamata per partita
                log(f"   quota Over 0.5 live: {od.get('price') or od.get('reason')}")
                if not dry: send_telegram(build_message(ev, snap, hits, odds=od))
                for t in hits:
                    sent[t] = rome_str()
                    signals.append(signal_record(ev, snap, t, od)); n_sig += 1
            state["checked"][str(mid)] = {"t": int(ts()), "r": "valutata", "res": res}
        except Exception as e:
            log(f"   errore: {type(e).__name__}: {e}")
    # pulizia state
    for k in [k for k, v in state["checked"].items() if ts() - v.get("t", 0) > 2 * 86400]: del state["checked"][k]
    for k in [k for k in state["sent"] if not any(str(s["matchId"]) == k and s["status"] == "pending" for s in signals)
              and k not in state["checked"]]:
        del state["sent"][k]
    state["rules"] = rules_dict()
    if ODDS_STATUS: state["odds_api"] = dict(ODDS_STATUS)
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

# ---------------------------------------------------------------- partite del giorno (--daily)
def day_matches(day):
    """Partite FotMob della data (YYYYMMDD, calendario ora italiana) in campionati nazionali candidati."""
    j = get(f"{FM}/matches?date={day}&timezone=Europe%2FRome")
    out, n_all = [], 0
    for L in j.get("leagues") or []:
        for m in L.get("matches") or []:
            n_all += 1
            st = m.get("status") or {}
            if st.get("cancelled") or st.get("awarded"): continue
            if (L.get("ccode") or "").upper() == "INT": continue
            if EXCLUDE_NAME_RE.search(L.get("name") or ""): continue
            if EXCLUDE_RESERVE_TEAMS and (RESERVE_TEAM_RE.search(m["home"].get("name") or "") or RESERVE_TEAM_RE.search(m["away"].get("name") or "")):
                continue
            m["_league"] = {"ccode": L.get("ccode"), "name": L.get("name"), "id": L.get("id"),
                            "pid": L.get("primaryId") or L.get("parentLeagueId") or L.get("id")}
            out.append(m)
    out.sort(key=lambda m: ((m.get("status") or {}).get("utcTime") or "", m["_league"]["name"] or ""))
    return out, n_all

def pseudo_md(m):
    """matchDetails minimale costruito dalla lista partite: evaluate() lavora solo su dati prematch,
    così si evita 1 richiesta matchDetails per partita (niente H2H, che è solo informativo)."""
    return {"general": {"matchId": int(m["id"]), "homeTeam": {"id": m["home"]["id"], "name": m["home"]["name"]},
                        "awayTeam": {"id": m["away"]["id"], "name": m["away"]["name"]},
                        "parentLeagueId": m["_league"]["pid"], "leagueId": m["_league"]["id"],
                        "leagueName": m["_league"]["name"], "countryCode": m["_league"]["ccode"],
                        "matchTimeUTCDate": (m.get("status") or {}).get("utcTime")},
            "header": {}, "content": {}}

def daily_entry(ev, m, hits):
    """Numeri chiave per ogni tipo soddisfatto (stessa struttura di signal_record)."""
    st = m.get("status") or {}
    try: ko = datetime.datetime.fromisoformat(st["utcTime"].replace("Z", "+00:00")).astimezone(ROME)
    except Exception: ko = None
    score = parse_score(st)
    finished = bool(st.get("finished"))
    e = {"matchId": ev["matchId"], "kickoff": ko.strftime("%H:%M") if ko else None,
         "kickoff_utc": st.get("utcTime"), "league": ev["league"], "country": ev["country"], "leagueId": ev["lid"],
         "home": ev["home"], "away": ev["away"], "url": f"https://www.fotmob.com/match/{ev['matchId']}",
         "finished": finished, "score": f"{score[0]}-{score[1]}" if score is not None else None,
         "types": hits, "reasons": {t: reason_text(ev, t) for t in hits}, "info": {}}
    if "storico" in hits:
        s = ev["storico"]["strong"]; o = "away" if s == "home" else "home"
        S, O = ev["hist"][s], ev["hist"][o]
        e["info"]["storico"] = {"strong": s, "streak": S["streak"], "complete": S["complete"], "capped": S["capped"],
                                "last00": S.get("last00"), "other_zz": O["zz"], "other_n": O["n"]}
    if "xg" in hits:
        x = ev["xg"]
        e["info"]["xg"] = {"total": round(x["total"], 2), "exp_home": round(x["exp_home"], 2),
                           "exp_away": round(x["exp_away"], 2), "method": x.get("method"), "season": x.get("season")}
    for t, k in (("segna", "scored"), ("subisce", "conceded"), ("mai00", "no00")):
        if t not in hits: continue
        s = ev[t]["strong"]; o = "away" if s == "home" else "home"
        S, O = ev["cur"][s], ev["cur"][o]
        e["info"][t] = {"strong": s, "season": ev["cur_season"], "strong_k": S[k], "strong_n": S["n"],
                        "strong_pct": round(100 * S[k] / S["n"]) if S["n"] else 0,
                        "other_k": O[k], "other_n": O["n"], "other_pct": round(100 * O[k] / O["n"]) if O["n"] else 0}
    if ev.get("cur"):
        e["cur"] = ev["cur"]
    return e

def daily(day=None, out_path=None, budget_min=None):
    t0 = time.time()
    day = day or now_utc().astimezone(ROME).strftime("%Y%m%d")
    budget = (budget_min or CFG["DAILY_BUDGET_MIN"]) * 60
    ms, n_all = day_matches(day)
    log(f"partite del {day}: {n_all} totali, {len(ms)} candidate (campionati nazionali, filtro nome)")
    res, skipped_leagues = [], {}
    cnt = {"eval": 0, "err": 0, "done": 0, "skip_budget": 0}
    bad_leagues = {}
    def work(i, m):
        if time.time() - t0 > budget:
            with _LOCK: cnt["skip_budget"] += 1
            return
        pid = int(m["_league"]["pid"])
        lname = f"{m['_league']['ccode']} {m['_league']['name']}"
        if pid in bad_leagues: return
        try:
            meta = league_meta(pid)
            ok, why = league_ok(meta, m["_league"]["name"])
            if not ok:
                bad_leagues[pid] = why; skipped_leagues[lname] = why; return
            ev = evaluate(pseudo_md(m))
            if not ev["league_ok"]:
                skipped_leagues[lname] = ev["league_why"]; return
            hits = [t for t in TYPES if ev["sig"].get(t)]
            with _LOCK:
                cnt["eval"] += 1
                if hits: res.append(daily_entry(ev, m, hits))
            log(f"[{i + 1}/{len(ms)}] {lname}: {ev['home']} - {ev['away']} -> {'+'.join(hits) if hits else '-'}  (req {NREQ[0]})")
        except Exception as e:
            with _LOCK: cnt["err"] += 1
            log(f"[{i + 1}/{len(ms)}] errore {m['home'].get('name')} - {m['away'].get('name')}: {type(e).__name__}: {e}")
        finally:
            time.sleep(CFG["DAILY_DELAY"])
    # prima una partita per campionato (scarica metadati/calendario una volta sola e scarta subito le leghe non valide), poi le altre
    first = {}
    for i, m in enumerate(ms): first.setdefault(int(m["_league"]["pid"]), (i, m))
    rest = [(i, m) for i, m in enumerate(ms) if first[int(m["_league"]["pid"])][0] != i]
    with concurrent.futures.ThreadPoolExecutor(max_workers=CFG["DAILY_WORKERS"]) as ex:
        for batch in (list(first.values()), rest):
            futs = [ex.submit(work, i, m) for i, m in batch]
            for f in concurrent.futures.as_completed(futs):
                cnt["done"] += 1
                if cnt["done"] % CFG["DAILY_SAVE_EVERY"] == 0:
                    with _LOCK: save_json(CACHE_F, CACHE, compact=True)
    n_eval, n_err = cnt["eval"], cnt["err"]
    partial = cnt["skip_budget"] > 0
    if partial: log(f"!! budget di {budget / 60:.0f} min esaurito: {cnt['skip_budget']} partite non valutate")
    res.sort(key=lambda e: (e.get("kickoff_utc") or "", e["league"] or ""))
    by_type = {t: sum(1 for e in res if t in e["types"]) for t in TYPES}
    out = {"date": f"{day[:4]}-{day[4:6]}-{day[6:]}", "generated_at": rome_str(), "partial": partial,
           "stats": {"matches_day": n_all, "candidates": len(ms), "evaluated": n_eval, "qualified": len(res),
                     "errors": n_err, "not_evaluated_budget": cnt["skip_budget"], "by_type": by_type, "requests": NREQ[0], "seconds": round(time.time() - t0)},
           "skipped_leagues": skipped_leagues, "rules": rules_dict(), "matches": res}
    save_json(out_path or TODAY_F, out)
    log(f"fine daily: valutate {n_eval}, qualificate {len(res)} {by_type}, errori {n_err}, "
        f"richieste HTTP {NREQ[0]}, {time.time() - t0:.0f}s -> {out_path or TODAY_F}")
    return out

# ---------------------------------------------------------------- test mode
def test(mids, send=False, save=False, odds=False):
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
        od = None
        if odds:
            od = over05_live(ev)
            log(f"  quota Over 0.5 live -> {od} | crediti: {ODDS_STATUS}")
        msg = build_message(ev, snap, types, test=True, odds=od)
        log("\n--- messaggio (tutti i tipi, con esito condizione) ---\n" + msg)
        if send:
            send_telegram(msg); send = False   # un solo messaggio di prova
    log(f"\nrichieste HTTP: {NREQ[0]}")

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--test", action="append", help="matchId da valutare forzatamente")
    ap.add_argument("--send", action="store_true", help="in --test invia 1 messaggio Telegram 🧪 TEST")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--odds", action="store_true", help="in --test legge anche la quota Over 0.5 live (1 credito)")
    ap.add_argument("--daily", action="store_true", help="genera live/data/today.json (partite del giorno)")
    ap.add_argument("--date", help="in --daily: data YYYYMMDD (default oggi, ora italiana)")
    ap.add_argument("--out", help="in --daily: file di uscita (default live/data/today.json)")
    ap.add_argument("--budget", type=float, help="in --daily: minuti massimi di calcolo")
    a = ap.parse_args()
    global CACHE
    CACHE = load_json(CACHE_F, {})
    t0 = time.time()
    try:
        if a.daily: daily(a.date, a.out, a.budget)
        elif a.test: test(a.test, send=a.send, odds=a.odds)
        else:
            try: scan(dry=a.dry_run)
            except Exception as e:   # errore di rete/FotMob: non far fallire il workflow, riprova al prossimo giro
                log(f"ERRORE scansione: {type(e).__name__}: {e}")
    finally:
        prune_cache(); save_json(CACHE_F, CACHE, compact=True)
        log(f"durata {time.time() - t0:.1f}s")

if __name__ == "__main__":
    main()
