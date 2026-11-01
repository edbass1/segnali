/* Logica pura: parser alert, ritardi, xG, quote eque.
   Funziona nel browser e nei test Node. Nessuna rete. */

export const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
export const num = s => { const v = parseFloat(String(s).replace(',', '.')); return isFinite(v) ? v : null; };

export function normName(s) {
  s = String(s || '').toLowerCase()
    .replace(/ı/g, 'i').replace(/ł/g, 'l').replace(/ø/g, 'o').replace(/æ/g, 'ae')
    .replace(/ß/g, 'ss').replace(/đ/g, 'd').replace(/œ/g, 'oe').replace(/ð/g, 'd').replace(/þ/g, 'th');
  s = s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  return s.replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
}
const STOP = new Set(['fc', 'fk', 'sk', 'sc', 'ac', 'as', 'cf', 'cd', 'ud', 'afc', 'club', 'calcio', 'ssc', 'ss', 'us', 'asd',
  'sv', 'vfb', 'vfl', 'tsv', 'bk', 'if', 'ik', 'nk', 'hnk', 'ks', 'cs', 'sd', 'rc', 'rcd', 'ca', 'ec', 'fbc', 'ssd', 'sad',
  'kulubu', 'futbol', 'football', 'de', 'the', 'and', 'ad', 'fsv', 'spa', 'srl', 'jk', 'kv', 'kvc', 'krc', 'aa', 'cp', 'ff', 'sl']);
const ABBR = { utd: 'united', man: 'manchester', ath: 'athletic', atl: 'atletico', dep: 'deportivo', spt: 'sporting', wed: 'wednesday', st: 'saint', int: 'inter', intl: 'internacional', bor: 'borussia', mgladbach: 'monchengladbach', gladbach: 'monchengladbach', psg: 'paris saint germain' };
export function coreTokens(s) {
  const t = normName(s).split(' ').map(x => ABBR[x] || x).join(' ').split(' ').filter(x => x && !STOP.has(x));
  return t.length ? t : normName(s).split(' ').filter(Boolean);
}
function bigrams(s) { const r = []; s = s.replace(/ /g, ''); for (let i = 0; i < s.length - 1; i++) r.push(s.slice(i, i + 2)); return r; }
function dice(a, b) {
  const A = bigrams(a), B = bigrams(b); if (!A.length || !B.length) return a === b ? 1 : 0;
  const m = new Map(); A.forEach(x => m.set(x, (m.get(x) || 0) + 1)); let inter = 0;
  B.forEach(x => { const c = m.get(x); if (c) { inter++; m.set(x, c - 1); } }); return 2 * inter / (A.length + B.length);
}
export function nameSim(a, b) {
  const ta = coreTokens(a), tb = coreTokens(b); const ca = ta.join(' '), cb = tb.join(' ');
  if (!ca || !cb) return 0; if (ca === cb) return 1;
  const d = dice(ca, cb); let hits = 0;
  ta.forEach(x => { if (tb.some(y => y === x || (x.length >= 4 && y.length >= 4 && (y.startsWith(x) || x.startsWith(y))) || dice(x, y) >= 0.8)) hits++; });
  const tok = hits / Math.max(ta.length, tb.length);
  const contain = (` ${cb} `.includes(` ${ca} `) || ` ${ca} `.includes(` ${cb} `)) ? 0.86 : 0;
  let s = Math.max(d, 0.6 * tok + 0.4 * d, contain);
  const youth = x => /\b(u\d\d|ii|b|women|w|femminile|reserves?|primavera|youth|academy)\b/.test(normName(x));
  if (youth(b) && !youth(a)) s -= 0.3;
  return clamp(s, 0, 1);
}
export function leagueSim(alertLeague, leagueName) {
  if (!alertLeague || !leagueName) return 0;
  const a = ' ' + normName(alertLeague) + ' ', t = normName(leagueName).split(' ').filter(Boolean);
  if (!t.length) return 0; let h = 0; t.forEach(x => { if (a.includes(' ' + x + ' ')) h++; });
  return h / t.length;
}

const CUP_RE = /\b(cup|coppa|copa|coupe|pokal|beker|tac[a]|trophy|shield|super ?cup|supercoppa|play-?off|qualif|champions league|europa league|conference league|libertadores|friendl|amichevol)\b/i;
export function leagueOk(meta, name) {
  if (!meta) return { ok: false, why: 'campionato sconosciuto' };
  if (meta.type && meta.type !== 'league') return { ok: false, why: 'non è un campionato (coppa o altro)' };
  if ((meta.gender || 'male') !== 'male') return { ok: false, why: 'campionato femminile, escluso' };
  const cc = (meta.country || '').toUpperCase();
  if (!cc || cc === 'INT') return { ok: false, why: 'competizione internazionale, esclusa' };
  if (CUP_RE.test(meta.name || '') || CUP_RE.test(name || '')) return { ok: false, why: 'nome da coppa, esclusa' };
  return { ok: true, why: '' };
}

/* ---------- parser alert InPlayGuru ---------- */
function flagIso(str) {
  const cps = [...String(str)].map(c => c.codePointAt(0)).filter(c => c >= 0x1F1E6 && c <= 0x1F1FF);
  return cps.length >= 2 ? String.fromCharCode(cps[0] - 0x1F1E6 + 65, cps[1] - 0x1F1E6 + 65) : null;
}
function pair(v) { const m = String(v).match(/(-?\d+(?:[.,]\d+)?)\s*[-–—:\/]\s*(-?\d+(?:[.,]\d+)?)/); return m ? [num(m[1]), num(m[2])] : null; }
function nums(v) { return (String(v).match(/\d+(?:[.,]\d+)?/g) || []).map(num); }
export function parseTimer(v) {
  const s = String(v || '').trim(); const l = s.toLowerCase();
  if (!s) return null;
  if (/half\s*-?\s*time|^ht\b|intervallo|^break/.test(l)) return { minute: 45, extra: 0, phase: 'HT', label: 'Intervallo' };
  if (/full\s*-?\s*time|^ft\b|finale|ended|finished/.test(l)) return { minute: 90, extra: 99, phase: 'FT', label: 'Finale' };
  if (/not\s*started|pre-?match|^ns\b/.test(l)) return { minute: 0, extra: 0, phase: 'PRE', label: 'Pre-partita' };
  const m = s.match(/(\d{1,3})\s*(?:'|’|′)?\s*(?:\+\s*(\d{1,2}))?/);
  if (!m) return null;
  const minute = parseInt(m[1], 10), extra = m[2] ? parseInt(m[2], 10) : 0;
  if (minute > 130) return null;
  const phase = minute <= 45 ? '1H' : (minute <= 100 ? '2H' : 'ET');
  return { minute, extra, phase, label: minute + (extra ? '+' + extra : '') + "'" };
}
function oddsKey(k) {
  const l = k.toLowerCase();
  if (/1x2|match odds|full ?time result|esito/.test(l)) return /pre/.test(l) ? 'x12pre' : 'x12live';
  const m = l.match(/(?:over\s*\/\s*under|o\s*\/\s*u|goal line|total goals)\s*([\d.,]+)/);
  if (m) return 'ou:' + num(m[1]).toFixed(2);
  if (/both teams|btts|gg\s*\/?\s*ng/.test(l)) return 'btts';
  return null;
}
function setOdds(A, key, n) {
  if (!n.every(x => x >= 1.01 && x < 1000)) return;
  if (key.startsWith('ou:')) A.ou[key.slice(3)] = { line: num(key.slice(3)), over: n[0], under: n[1] };
  else if (key === 'btts') A.odds.btts = { yes: n[0], no: n[1] };
  else if (n.length >= 3) A.odds[key] = { h: n[0], d: n[1], a: n[2] };
}
export function parseAlert(text) {
  const raw = String(text || '').replace(/\r/g, '');
  const lines = raw.split('\n').map(l => l.replace(/\u200b/g, '').trim()).filter(l => l.length);
  const A = { raw, leagueLine: null, league: null, iso2: null, posH: null, posA: null, home: null, away: null,
    timer: null, minute: null, extra: 0, phase: null, score: null, stats: {}, odds: {}, ou: {}, warnings: [] };
  let teamIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (/^[^:]{1,45}:/.test(l) && !/https?:/.test(l.split(':')[0])) continue;
    const c = l.replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim();
    const m = c.match(/^(.*?\S)\s+(?:vs\.?|v\.?|VS|-|–)\s+(\S.*)$/i);
    if (m && !/^\d/.test(m[1]) && m[1].length >= 2 && m[2].length >= 2 && !/\d\s*-\s*\d/.test(c)) {
      A.home = m[1].replace(/^[^\p{L}\p{N}]+/u, '').trim();
      A.away = m[2].replace(/[^\p{L}\p{N}.)]+$/u, '').trim();
      teamIdx = i; break;
    }
  }
  if (teamIdx < 0) A.warnings.push('Riga squadre non trovata');
  const lgLine = teamIdx > 0 ? lines[teamIdx - 1] : null;
  if (lgLine && !/:/.test(lgLine.replace(/https?:\/\/\S+/g, ''))) {
    A.leagueLine = lgLine; A.iso2 = flagIso(lgLine);
    const pm = lgLine.match(/\(\s*(\d+)\s*(?:st|nd|rd|th|°|º)?\s*vs\.?\s*(\d+)\s*(?:st|nd|rd|th|°|º)?\s*\)/i);
    if (pm) { A.posH = +pm[1]; A.posA = +pm[2]; }
    A.league = lgLine.replace(/\([^)]*\)/g, ' ').replace(/[\u{1F1E6}-\u{1F1FF}\u{1F3F4}\u{E0000}-\u{E007F}]/gu, '').replace(/[^\p{L}\p{N}.\s\-\/']/gu, ' ').replace(/\s+/g, ' ').trim();
  }
  let pending = null;
  for (let i = 0; i < lines.length; i++) {
    if (i === teamIdx) continue;
    if (i === teamIdx - 1 && A.leagueLine) continue;
    const l = lines[i];
    if (/^➕|live stats/i.test(l)) { pending = null; continue; }
    const kv = l.match(/^([^:]{1,60}?):\s*(.*)$/);
    if (kv && !/^https?$/i.test(kv[1].trim())) {
      const key = kv[1].trim(), val = kv[2].trim(), kl = key.toLowerCase();
      const ok = oddsKey(key);
      if (ok) {
        const n = nums(val);
        if (n.length >= 2) { setOdds(A, ok, n); pending = null; } else pending = ok;
        continue;
      }
      pending = null;
      if (/^(timer|time|minute|minuto|tempo)$/.test(kl)) { A.timer = parseTimer(val); continue; }
      if (/^(goals|score|risultato|punteggio)$/.test(kl)) { A.score = pair(val); continue; }
      const p = pair(val);
      let sk = null;
      if (/^xg/.test(kl)) sk = 'xg';
      else if (/shots on target|on target|tiri in porta/.test(kl)) sk = 'sot';
      else if (/shots off target|off target/.test(kl)) sk = 'soff';
      else if (/dangerous attacks|attacchi pericolosi/.test(kl)) sk = 'da';
      else if (/red cards?|rossi/.test(kl)) sk = 'red';
      else if (/possession|possesso/.test(kl)) sk = 'poss';
      else if (/^shots$|total shots|tiri totali/.test(kl)) sk = 'shots';
      if (sk && p) A.stats[sk] = p;
      continue;
    }
    if (pending) { const n = nums(l); if (n.length >= 2) setOdds(A, pending, n); pending = null; }
  }
  if (!A.timer) { A.warnings.push("Minuto non trovato: uso l'intervallo (45')"); A.timer = { minute: 45, extra: 0, phase: 'HT', label: "45' (assunto)", assumed: true }; }
  A.minute = A.timer.minute; A.extra = A.timer.extra; A.phase = A.timer.phase;
  if (!A.score) { A.warnings.push('Punteggio non trovato: uso 0-0'); A.score = [0, 0]; }
  A.is00 = A.score[0] === 0 && A.score[1] === 0;
  return A;
}

/* Finestra dell'alert.
   45' / intervallo -> secondo tempo, gol dal 46' in poi (il 45'+ resta nel primo tempo).
   dal 58' in poi -> ultimi 30 minuti, gol dal 61' al 90'+.
   Il ritardo conta le partite di fila, dalla più recente, senza quell'evento. */
export function alertWindow(A) {
  const m = A.minute || 0;
  if (A.phase === 'HT' || (A.phase === '1H' && m >= 43)) {
    return {
      id: '2h', after: 45,
      title: 'Ritardo nel secondo tempo',
      def: 'Partite di fila, stagione di campionato in corso, senza un gol dal 46′ al 90′+. Il recupero del primo tempo (45′+) non conta: è ancora primo tempo.',
    };
  }
  if (m >= 58) {
    return {
      id: 'last30', after: 60,
      title: 'Ritardo over 0,5 ultimi 30 minuti',
      def: 'Partite di fila, stagione di campionato in corso, senza un gol nei minuti 61-90′+ (ultimi 30 minuti, recupero compreso). Un gol al 60′ non conta: a quel minuto è già successo.',
    };
  }
  return null;
}

/** true se il gol è nella finestra "dopo il minuto after" (after=60 => dal 61). */
export function goalAfter(g, after) { return g.min > after; }

/** Ritardo: quante partite (dalla più recente) senza l'evento. Lista già ordinata, recente prima. */
export function ritardo(matches, pred) {
  let n = 0;
  for (const m of matches) {
    if (m.unknown) return { n, open: false, partial: true, when: null };
    if (pred(m)) return { n, open: false, partial: false, when: m };
    n++;
  }
  return { n, open: true, partial: false, when: null };
}

export function scoreBoard(matches) {
  return {
    n: matches.length,
    zz: ritardo(matches, m => m.gf + m.ga === 0),
    r10: ritardo(matches, m => m.gf === 1 && m.ga === 0),
    r01: ritardo(matches, m => m.gf === 0 && m.ga === 1),
  };
}

function windowHit(m, after, kind) {
  return (m.goals || []).some(g => goalAfter(g, after) && (kind === 'any' || (kind === 'for' ? g.for : !g.for)));
}
export function windowBoard(matches, after) {
  const seq = matches.map(m => (m.goalsOk ? m : { ...m, unknown: true }));
  const known = matches.filter(m => m.goalsOk);
  const rate = kind => known.length ? known.filter(m => windowHit(m, after, kind)).length / known.length : null;
  const goalsFor = known.reduce((s, m) => s + (m.goals || []).filter(g => goalAfter(g, after) && g.for).length, 0);
  const cond = known.filter(m => scoreAt(m, after)[0] === 0 && scoreAt(m, after)[1] === 0);
  const condHit = cond.filter(m => windowHit(m, after, 'any')).length;
  return {
    nKnown: known.length,
    nAll: matches.length,
    any: ritardo(seq, m => windowHit(m, after, 'any')),
    scored: ritardo(seq, m => windowHit(m, after, 'for')),
    conceded: ritardo(seq, m => windowHit(m, after, 'against')),
    pAny: rate('any'), pFor: rate('for'), pAg: rate('against'),
    gFor: known.length ? goalsFor / known.length : null,
    condN: cond.length, condK: condHit,
    condP: cond.length ? condHit / cond.length : null,
  };
}
export function scoreAt(m, minute) {
  let f = 0, a = 0;
  for (const g of m.goals || []) if (g.min <= minute) { if (g.for) f++; else a++; }
  return [f, a];
}

export function xgProfile(matches) {
  const ok = matches.filter(m => m.xgFor != null && m.xgAgainst != null);
  const avg = (list, k) => list.length ? list.reduce((s, m) => s + m[k], 0) / list.length : null;
  const pack = list => ({ n: list.length, xgFor: avg(list, 'xgFor'), xgAg: avg(list, 'xgAgainst') });
  return { all: pack(ok), home: pack(ok.filter(m => m.home)), away: pack(ok.filter(m => !m.home)) };
}

const DEFAULT_SHARE = [0.12, 0.14, 0.16, 0.17, 0.18, 0.23];
export function bandTotals(timingOverall) {
  const bands = [0, 0, 0, 0, 0, 0];
  let gp = 0;
  for (const t of Object.values(timingOverall || {})) {
    gp += t.gp || 0;
    (t.b || []).forEach((p, i) => { if (i < 6) bands[i] += p[0] || 0; });
  }
  const goals = bands.reduce((a, b) => a + b, 0);
  const matches = gp / 2;
  return {
    bands, goals, matches,
    share: bands.map(b => goals ? b / goals : 0),
    lambda: matches ? goals / matches : null,
  };
}
export function cumShare(share, minute) {
  const cuts = [15, 30, 45, 60, 75, 90];
  const s = share && share.length === 6 ? share : DEFAULT_SHARE;
  let acc = 0, prev = 0;
  for (let i = 0; i < 6; i++) {
    if (minute >= cuts[i]) acc += s[i];
    else {
      const w = cuts[i] - prev;
      acc += s[i] * clamp((minute - prev) / w, 0, 1);
      break;
    }
    prev = cuts[i];
  }
  return clamp(acc, 0.05, 0.98);
}

function shrink(sum, n, prior, k) { return (sum + prior * k) / ((n || 0) + k); }

export function devig2(over, under) {
  if (!(over > 1) || !(under > 1)) return null;
  const io = 1 / over, iu = 1 / under, s = io + iu;
  return { pOver: io / s, pUnder: iu / s, margin: s - 1 };
}

/** Soglie con commissione c (es. 0.05 = 5%). Back: quota minima. Lay: quota massima. */
export function thresholds(p, c) {
  if (!(p > 0.01 && p < 0.99)) return null;
  const cc = clamp(c || 0, 0, 0.2);
  return {
    p,
    fair: 1 / p,
    backMin: 1 + (1 - p) / (p * (1 - cc)),
    layMax: 1 + (p * (1 - cc)) / (1 - p),
  };
}

function wavgPct(map, key) {
  let s = 0, w = 0;
  for (const t of Object.values(map || {})) {
    if (t[key] == null || !t.gp) continue;
    s += t[key] * t.gp; w += t.gp;
  }
  return w ? s / w / 100 : null;
}

export function trading(homeMatches, awayMatches, A, ss, commission) {
  const win = alertWindow(A);
  const after = win ? win.after : (A.minute || 45);
  const totals = bandTotals(ss && ss.timing && ss.timing.overall);
  const share = totals.goals ? totals.share : DEFAULT_SHARE;
  const playedShare = cumShare(share, A.phase === 'HT' ? 45 : (A.minute || 45));
  const restShare = 1 - playedShare;
  // gol medi di campionato nella finestra che resta (o nella finestra fissa dell'alert)
  let leagueLambda = null;
  if (totals.matches && totals.goals) {
    if (win && win.id === 'last30') leagueLambda = (totals.bands[4] + totals.bands[5]) / totals.matches;
    else if (win && win.id === '2h') leagueLambda = (totals.bands[3] + totals.bands[4] + totals.bands[5]) / totals.matches;
    else leagueLambda = totals.lambda * restShare;
  }
  const h2map = ss && ss.ou && ss.ou['h2:overall'];
  const leagueP2h = wavgPct(h2map, 'o05');
  if (win && win.id === '2h' && leagueP2h != null && leagueLambda == null) {
    // se mancano le fasce, ricava un λ dal tasso "almeno un gol nel 2° tempo"
    leagueLambda = -Math.log(Math.max(0.05, 1 - leagueP2h));
  }
  if (leagueLambda == null) leagueLambda = win && win.id === 'last30' ? 0.95 : 1.25;

  const sideRate = (matches, venueHome) => {
    const pool = matches.filter(m => m.goalsOk && (venueHome ? m.home : !m.home));
    const use = pool.length >= 4 ? pool : matches.filter(m => m.goalsOk);
    const gf = use.reduce((s, m) => s + (m.goals || []).filter(g => g.min > after && g.for).length, 0);
    return { n: use.length, avg: use.length ? gf / use.length : 0, venue: pool.length >= 4 };
  };
  const hs = sideRate(homeMatches, true);
  const as = sideRate(awayMatches, false);
  const priorH = leagueLambda * 0.56;
  const priorA = leagueLambda * 0.44;
  let lh = shrink(hs.avg * hs.n, hs.n, priorH, 4);
  let la = shrink(as.avg * as.n, as.n, priorA, 4);

  const xh = xgProfile(homeMatches), xa = xgProfile(awayMatches);
  const homeBase = xh.home.n >= 3 ? xh.home : xh.all;
  const awayBase = xa.away.n >= 3 ? xa.away : xa.all;
  const live = A.stats.xg || null;
  let paceNote = null;
  if (live && homeBase.xgFor != null && awayBase.xgFor != null) {
    const expH = Math.max(0.12, homeBase.xgFor * playedShare);
    const expA = Math.max(0.12, awayBase.xgFor * playedShare);
    const f = i => clamp(Math.pow(live[i] / [expH, expA][i], 0.4), 0.75, 1.4);
    lh *= f(0); la *= f(1);
    paceNote = { expH, expA, liveH: live[0], liveA: live[1], fH: f(0), fA: f(1) };
  }
  const p0 = Math.exp(-(lh + la));
  const pModel = 1 - p0;
  const hb = windowBoard(homeMatches, after), ab = windowBoard(awayMatches, after);
  let pEmp = null, nEmp = 0;
  if (A.is00 && hb.condN + ab.condN >= 4) {
    const k = hb.condK + ab.condK, n = hb.condN + ab.condN;
    pEmp = k / n; nEmp = n;
  } else if (hb.nKnown + ab.nKnown >= 6) {
    const k = (hb.pAny || 0) * hb.nKnown + (ab.pAny || 0) * ab.nKnown;
    nEmp = hb.nKnown + ab.nKnown; pEmp = k / nEmp;
  }
  const wEmp = nEmp >= 12 ? 0.5 : nEmp >= 6 ? 0.3 : 0;
  const p = clamp(wEmp * (pEmp == null ? pModel : pEmp) + (1 - wEmp) * pModel, 0.02, 0.98);
  const shareH = (lh + la) > 0 ? lh / (lh + la) : 0.5;
  const th = thresholds(p, commission);
  const nextH = thresholds(p * shareH, commission);
  const nextA = thresholds(p * (1 - shareH), commission);
  const ou = A.ou['0.50'] || A.ou['0.5'] || null;
  const market = ou ? devig2(ou.over, ou.under) : null;
  return {
    after, win, playedShare, leagueLambda, leagueP2h, totals,
    lh, la, pModel, pEmp, nEmp, wEmp, p, shareH,
    hs, as, paceNote, homeXg: xh, awayXg: xa, homeBase, awayBase,
    hb, ab, th, nextH, nextA, market, ou,
  };
}

function emptySide() {
  return { gp: 0, b: [[0, 0], [0, 0], [0, 0], [0, 0], [0, 0], [0, 0]], any2: 0, any60: 0 };
}
function bandOfMin(min) {
  if (min <= 15) return 0;
  if (min <= 30) return 1;
  if (min <= 45) return 2;
  if (min <= 60) return 3;
  if (min <= 75) return 4;
  return 5;
}
/** Fasce, secondo tempo e ultimi 30 minuti per ogni squadra, dai minuti reali. */
export function timingFromArchive(matchMap) {
  const teams = new Map();
  const ensure = (id, name) => {
    const k = String(id);
    if (!teams.has(k)) teams.set(k, { id: k, name: name || '', gp: 0, b: [[0, 0], [0, 0], [0, 0], [0, 0], [0, 0], [0, 0]], h1: [0, 0], h2: [0, 0], any2: 0, any60: 0, over05: 0, home: emptySide(), away: emptySide() });
    const t = teams.get(k);
    if (name) t.name = name;
    return t;
  };
  const list = Array.isArray(matchMap) ? matchMap : Object.values(matchMap || {});
  let n = 0, bands = [0, 0, 0, 0, 0, 0], any2 = 0, any60 = 0;
  for (const m of list) {
    if (!m || !m.ok || !Array.isArray(m.goals)) continue;
    n++;
    let a2 = false, a60 = false;
    for (const g of m.goals) {
      bands[bandOfMin(g[0])]++;
      if (g[0] > 45) a2 = true;
      if (g[0] > 60) a60 = true;
    }
    if (a2) any2++;
    if (a60) any60++;
    for (const isHome of [true, false]) {
      const T = ensure(isHome ? m.h : m.a, isHome ? m.hn : m.an);
      const S = isHome ? T.home : T.away;
      T.gp++; S.gp++;
      if ((m.hg || 0) + (m.ag || 0) > 0) T.over05++;
      let s2 = false, s60 = false;
      for (const g of m.goals) {
        const mine = (g[2] === 1) === isHome;
        const i = bandOfMin(g[0]);
        T.b[i][mine ? 0 : 1]++;
        S.b[i][mine ? 0 : 1]++;
        if (g[0] <= 45) T.h1[mine ? 0 : 1]++;
        else T.h2[mine ? 0 : 1]++;
        if (g[0] > 45) s2 = true;
        if (g[0] > 60) s60 = true;
      }
      if (s2) { T.any2++; S.any2++; }
      if (s60) { T.any60++; S.any60++; }
    }
  }
  return { teams: [...teams.values()], matches: n, bands, p2h: n ? any2 / n : null, p60: n ? any60 / n : null };
}
export function archiveAsStats(built, updated) {
  if (!built || !built.teams.length) return null;
  const overall = {}, home = {}, away = {}, h2 = {}, h2h = {}, h2a = {}, full = {};
  const pct = (k, n) => n ? Math.round(1000 * k / n) / 10 : null;
  for (const t of built.teams) {
    overall[t.name] = { gp: t.gp, b: t.b, h1: t.h1, h2: t.h2 };
    home[t.name] = { gp: t.home.gp, b: t.home.b };
    away[t.name] = { gp: t.away.gp, b: t.away.b };
    h2[t.name] = { gp: t.gp, o05: pct(t.any2, t.gp) };
    h2h[t.name] = { gp: t.home.gp, o05: pct(t.home.any2, t.home.gp) };
    h2a[t.name] = { gp: t.away.gp, o05: pct(t.away.any2, t.away.gp) };
    full[t.name] = { gp: t.gp, o05: pct(t.over05, t.gp) };
  }
  return { source: 'fotmob', updated: updated || '', timing: { overall, home, away }, ou: { 'h2:overall': h2, 'h2:home': h2h, 'h2:away': h2a, 'full:overall': full }, league: built };
}

export function advice(A, homeName, awayName, tr, seasonLabel) {
  const live = A.stats.xg;
  const H = tr.homeBase, W = tr.awayBase;
  const lines = [];
  const fmt = x => x == null ? '–' : x.toFixed(2).replace('.', ',');
  if (!(H && H.n) && !(W && W.n)) {
    lines.push(`Questi sono gli xG del campionato${seasonLabel ? ' ' + seasonLabel : ''}: questo campionato non li pubblica. Capita in Serie C e in molti campionati minori. I ritardi e i tempi dei gol, più sotto, non dipendono dagli xG: vengono dal minuto di ogni gol.`);
    if (!live) lines.push('Attenzione che l\'alert non ha nemmeno gli xG live. Per il prezzo usa la quota equa calcolata sui gol di questa finestra.');
    else {
      const liveT = live[0] + live[1];
      lines.push(`Attenzione che gli xG live sono ${fmt(live[0])} – ${fmt(live[1])} (totale ${fmt(liveT)}). Senza la media di stagione non so se è tanto per queste due squadre. Come bussola rozza: totale sopra 1,0 a questo punto, con lo 0-0, il campo ha già creato; sotto 0,6 lo 0-0 è coerente col gioco.`);
    }
  } else lines.push(
    `Questi sono gli xG del campionato${seasonLabel ? ' ' + seasonLabel : ''}: ` +
    `${homeName} ${H.n >= 3 && tr.homeXg.home.n >= 3 ? 'in casa' : 'in stagione'} fa ${fmt(H.xgFor)} xG a partita e ne subisce ${fmt(H.xgAg)} (${H.n} partite con xG). ` +
    `${awayName} ${W.n >= 3 && tr.awayXg.away.n >= 3 ? 'in trasferta' : 'in stagione'} fa ${fmt(W.xgFor)} xG e ne subisce ${fmt(W.xgAg)} (${W.n} partite).`
  );
  let move = 'Mossa: senza xG live nell\'alert non confronto il ritmo di oggi. Usa i ritardi e la quota equa qui sotto, che viene dallo storico dei gol in questa finestra.';
  const noHist = !(H && H.n) && !(W && W.n);
  if (noHist) {
    if (live && tr.th) {
      const liveT = live[0] + live[1];
      if (A.is00 && liveT >= 1) move = `Mossa: xG live ${fmt(liveT)}, senza media di stagione. Back Over 0,5 solo sopra ${fmt(tr.th.backMin)}. Lay del pareggio solo sotto ${fmt(tr.th.layMax)}.`;
      else if (A.is00 && liveT < 0.6) move = `Mossa: xG live bassi (${fmt(liveT)}). L'Over 0,5 ha senso solo sopra ${fmt(tr.th.backMin)}.`;
      else move = `Mossa: almeno un gol da qui ha quota equa ${fmt(tr.th.fair)}. Back sopra ${fmt(tr.th.backMin)}${A.is00 ? `, lay del pareggio sotto ${fmt(tr.th.layMax)}` : ''}.`;
    }
  } else if (!live) {
    lines.push('Attenzione che l\'alert non contiene gli xG live (riga «xG:»). Il confronto col campionato resta sullo storico, non sulla partita di oggi.');
  } else {
    const expT = (tr.paceNote ? tr.paceNote.expH + tr.paceNote.expA : null);
    const liveT = live[0] + live[1];
    lines.push(
      `In questa partita, al ${A.phase === 'HT' ? 'intervallo' : A.minute + '′'}, gli xG live sono ${fmt(live[0])} – ${fmt(live[1])} (totale ${fmt(liveT)}). ` +
      (expT != null
        ? `A questo punto della gara, col ritmo xG di campionato, ci si aspetterebbe circa ${fmt(tr.paceNote.expH)} – ${fmt(tr.paceNote.expA)} (totale ${fmt(expT)}).`
        : 'Non ho abbastanza xG storici per dire quanto sarebbe "normale" a questo minuto.')
    );
    const delta = expT != null ? liveT - expT : null;
    const red = A.stats.red || [0, 0];
    if (red[0] + red[1] > 0) lines.push('Attenzione che c\'è un\'espulsione: lo storico di campionato non la vede, quindi pesa di più quello che sta succedendo adesso.');
    if (A.is00 && delta != null && delta >= 0.25 && liveT >= 0.75) {
      lines.push(`Attenzione che le occasioni già create (${fmt(liveT)} xG) sono sopra il ritmo di queste squadre e il punteggio è ancora 0-0. Il tabellone è indietro rispetto al gioco: non è una garanzia di gol, è un contesto in cui l'Over 0,5 (e, sullo 0-0, il lay del pareggio, che paga lo stesso esito) ha dalla sua il campo.`);
      move = `Mossa: back Over 0,5 solo se la quota è almeno ${fmt(tr.th.backMin)} (commissione già contata). Sullo 0-0 il lay del pareggio ha valore se la quota è sotto ${fmt(tr.th.layMax)}.`;
    } else if (A.is00 && delta != null && liveT + 0.05 < expT && liveT < 0.7) {
      lines.push(`Attenzione che il gioco ha prodotto pochi xG (${fmt(liveT)} contro ${fmt(expT)} attesi a questo minuto). Lo 0-0 è coerente con quello che è successo in campo. Una quota Over 0,5 corta, in questo contesto, paga poco rispetto al rischio.`);
      move = `Mossa: lascia perdere l'Over 0,5 se la quota è sotto ${fmt(tr.th.backMin)}. Ha senso comprarlo solo più su di quel prezzo. Il lay del pareggio, sullo 0-0, solo sotto quota ${fmt(tr.th.layMax)}.`;
    } else if (delta != null && Math.abs(live[0] - tr.paceNote.expH) >= 0.28 && live[0] > live[1] * 1.6) {
      lines.push(`Attenzione che ${homeName} sta creando molto di più del proprio standard (${fmt(live[0])} live contro ${fmt(tr.paceNote.expH)} attesi ora). Il prossimo gol, se arriva, è più probabile da questa parte.`);
      move = `Mossa: il prossimo gol di ${homeName} ha quota equa ${fmt(tr.nextH.fair)}. Back solo sopra ${fmt(tr.nextH.backMin)}.`;
    } else if (delta != null && Math.abs(live[1] - tr.paceNote.expA) >= 0.28 && live[1] > live[0] * 1.6) {
      lines.push(`Attenzione che ${awayName} sta creando molto di più del proprio standard (${fmt(live[1])} live contro ${fmt(tr.paceNote.expA)} attesi ora). Il prossimo gol, se arriva, è più probabile da questa parte.`);
      move = `Mossa: il prossimo gol di ${awayName} ha quota equa ${fmt(tr.nextA.fair)}. Back solo sopra ${fmt(tr.nextA.backMin)}.`;
    } else if (!A.is00 && delta != null && (A.score[0] + A.score[1]) + 0.4 < liveT) {
      lines.push(`Attenzione che i gol veri (${A.score[0]}-${A.score[1]}) sono sotto gli xG live (${fmt(liveT)}). Le occasioni create sono più dei gol: c'è spazio per un altro gol, senza che sia dovuto.`);
      move = `Mossa: back Over ${(A.score[0] + A.score[1] + 0.5).toFixed(2).replace('.', ',')} (almeno un altro gol) se la quota è sopra ${fmt(tr.th.backMin)}.`;
    } else if (!A.is00 && delta != null && (A.score[0] + A.score[1]) > liveT + 0.6) {
      lines.push(`Attenzione che i gol veri (${A.score[0]}-${A.score[1]}) sono sopra gli xG live (${fmt(liveT)}). Il vantaggio sul tabellone è più largo delle occasioni: è un punteggio fragile, non un segnale per inseguire un altro gol a quota bassa.`);
      move = `Mossa: non inseguire un altro gol a quota corta. La quota equa per almeno un gol da qui è ${fmt(tr.th.fair)}.`;
    } else {
      lines.push('Attenzione che xG live e ritmo di campionato sono vicini: non c\'è uno scarto netto da tradare. Il prezzo decide.');
      move = `Mossa: almeno un gol da qui ha quota equa ${fmt(tr.th.fair)}. Back sopra ${fmt(tr.th.backMin)}${A.is00 ? `, lay del pareggio sotto ${fmt(tr.th.layMax)}` : ''}.`;
    }
  }
  return { lines, move };
}

export const XG_GUIDE = [
  'xG vuol dire «gol attesi». Non sono i gol del tabellone: è una stima di quanti gol quella squadra «meritava» in base ai tiri e alle occasioni.',
  '1,40 xG in una partita non promette 1 gol. Su una gara sola il caso pesa. Su tante partite la media dei gol si avvicina alla media degli xG.',
  'xG fatti = quanto crea la squadra. xG subiti = quanto concede. Una squadra può fare pochi gol pur avendo xG alti (finalizzazione scarsa) o il contrario.',
  '«In casa» e «in trasferta» contano di più della media generale, quando ci sono almeno 3 partite con xG. Si attacca e si difende in modo diverso.',
  'Per tradare: confronta gli xG live dell\'alert con gli xG di campionato riportati a questo minuto. Se il live è più alto e il punteggio è ancora basso, il prezzo dell\'Over spesso è interessante. Se il live è basso, una quota Over corta di solito non paga.',
  'Lo xG non sa niente di espulsioni, rigori appena fischiati o di un portiere in giornata. È un numero, non una sentenza.',
];

/* Paesi: prefisso SoccerStats, codice FotMob, nome inglese della bandiera. */
const CC_GROUPS = [
  ['ENG', 'EN', 'GB', 'ENGLAND'],
  ['ITA', 'IT', 'ITALY'],
  ['SPA', 'ESP', 'ES', 'SPAIN'],
  ['FRA', 'FR', 'FRANCE'],
  ['GER', 'DE', 'GERMANY'],
  ['NED', 'NL', 'NET', 'NETHERLANDS', 'HOLLAND'],
  ['POR', 'PT', 'PORTUGAL'],
  ['TUR', 'TR', 'TURKEY'],
  ['BEL', 'BE', 'BELGIUM'],
  ['GRE', 'GR', 'GREECE'],
  ['SCO', 'SC', 'SCOTLAND'],
  ['AUT', 'AT', 'AUSTRIA'],
  ['SUI', 'CH', 'SWITZERLAND'],
  ['DEN', 'DK', 'DENMARK'],
  ['POL', 'PL', 'POLAND'],
  ['BRA', 'BR', 'BRAZIL'],
  ['ARG', 'AR', 'ARGENTINA'],
  ['MEX', 'MX', 'MEXICO'],
  ['USA', 'US', 'UNITED STATES'],
  ['JPN', 'JP', 'JAPAN'],
  ['NOR', 'NO', 'NORWAY'],
  ['SWE', 'SE', 'SWEDEN'],
  ['RUS', 'RU', 'RUSSIA'],
  ['UKR', 'UA', 'UKRAINE'],
  ['CRO', 'HR', 'CROATIA'],
  ['CZE', 'CZ', 'CZECHREPUBLIC', 'CZECH'],
  ['ROU', 'RO', 'ROMANIA'],
  ['HUN', 'HU', 'HUNGARY'],
  ['SRB', 'RS', 'SERBIA'],
  ['BUL', 'BG', 'BULGARIA'],
  ['AUS', 'AU', 'AUSTRALIA'],
  ['CHI', 'CL', 'CHILE'],
  ['COL', 'CO', 'COLOMBIA'],
  ['CHN', 'CN', 'CHINA'],
  ['KOR', 'KR', 'SOUTHKOREA', 'KOREA'],
  ['IRL', 'IE', 'IRELAND'],
  ['FIN', 'FI', 'FINLAND'],
  ['ISR', 'IL', 'ISRAEL'],
  ['CYP', 'CY', 'CYPRUS'],
  ['KSA', 'SA', 'SAUDIARABIA', 'SAUDI'],
];
const CC_MAP = {};
CC_GROUPS.forEach(g => g.forEach(x => { CC_MAP[x] = g[0]; }));
export function canonCountry(c) { return CC_MAP[String(c || '').toUpperCase().replace(/[^A-Z]/g, '')] || ''; }

export function matchSoccerstats(index, league) {
  const list = (index && index.leagues) || [];
  const country = canonCountry(league.country);
  const lname = league.name || '';
  let best = null, bs = -1;
  for (const row of list) {
    if (row.cup || !row.name) continue;
    let s = Math.max(nameSim(lname, row.name), leagueSim(lname, row.name));
    const rc = canonCountry(row.country || row.countryName);
    if (country && rc) s += rc === country ? 0.35 : -0.4;
    const div = n => { const m = normName(n).match(/\b([12]|ii|primera|segunda|serie [a-d]|ligue [12]|bundesliga|championship|league one|league two|1 lig|2 lig|super lig|premier)\b/); return m ? m[0] : ''; };
    const d1 = div(lname), d2 = div(row.name);
    if (d1 && d2 && d1 !== d2) s -= 0.5;
    if (s > bs) { bs = s; best = row; }
  }
  return bs >= 0.8 ? best : null;
}

export function pickSsTeam(names, teamName) {
  let best = null, bs = 0;
  for (const n of names) {
    const s = nameSim(teamName, n);
    if (s > bs) { bs = s; best = n; }
  }
  return bs >= 0.72 ? { name: best, sim: bs } : null;
}

export function pickPair(hc, ac) {
  let best = null;
  const H = hc.slice(0, 6), A = ac.slice(0, 6);
  if (!H.length || !A.length) return { h: H[0] || null, a: A[0] || null, score: 0 };
  H.forEach(h => A.forEach(a => {
    if (h.id === a.id) return;
    const s = h.sim + a.sim + 0.12 * ((h.lsim || 0) + (a.lsim || 0)) + (h.leagueId && h.leagueId === a.leagueId ? 0.2 : 0);
    if (!best || s > best.score) best = { h, a, score: s };
  }));
  return best || { h: H[0], a: A[0], score: 0 };
}
