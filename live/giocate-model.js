// Modello giocate: quote, utile, unione dei salvataggi, statistiche.
// Nessun segreto (token GitHub o Telegram) entra nei dati sincronizzati.

export const DEFAULT_TARGET = {
  owner: 'edbass1',
  repo: 'segnali',
  path: 'live/data/giocate.json',
  branch: 'main',
};

export const MARKETS = [
  'Over 0.5', 'Over 1.5', 'Over 2.5', 'Over 3.5', 'Under 2.5', 'Under 3.5',
  'Gol', 'Gol SI', 'Gol NO', 'BTTS', '1', 'X', '2', '1X', 'X2', '12',
  'Lay 0-0', 'Lay pareggio', 'Lay 1', 'Lay X', 'Lay 2',
  'Over 0.5 1T', 'Over 1.5 1T', 'Casa segna', 'Ospite segna', 'Multigol', 'Risultato esatto',
];

export const BOOKS = [
  'Bet365', 'Betfair', 'Smarkets', 'Betflag', 'Snai', 'Sisal', 'Eurobet', 'Goldbet',
  'Lottomatica', 'Planetwin365', 'William Hill', 'Pinnacle', 'Betano', '888sport', 'Matchbook',
];

const BET_RESULTS = new Set(['vinta', 'persa', 'void', 'cashout']);
const SEL_RESULTS = new Set(['vinta', 'persa', 'void']);

export function parseDecimal(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (v == null) return null;
  const s = String(v).trim().replace(/\s/g, '').replace(',', '.');
  if (!s || s === '-' || s === '.' || s === '-.') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export function roundTo(n, digits) {
  const f = 10 ** digits;
  return Math.round((n + Number.EPSILON) * f) / f;
}

export function roundMoney(n) {
  return roundTo(n, 2);
}

export function formatPlainMoney(n) {
  if (n == null || !Number.isFinite(Number(n))) return '—';
  return new Intl.NumberFormat('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(n)) + ' €';
}

export function formatSignedMoney(n) {
  if (n == null || !Number.isFinite(Number(n))) return '—';
  const body = new Intl.NumberFormat('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Math.abs(Number(n)));
  if (n > 0) return '+' + body + ' €';
  if (n < 0) return '−' + body + ' €';
  return body + ' €';
}

export function formatPct(n, signed = true) {
  if (n == null || !Number.isFinite(Number(n))) return '—';
  const body = new Intl.NumberFormat('it-IT', { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(Math.abs(Number(n)));
  if (!signed) return body + '%';
  if (n > 0) return '+' + body + '%';
  if (n < 0) return '−' + body + '%';
  return body + '%';
}

export function formatOdds(n) {
  if (n == null || !Number.isFinite(Number(n))) return '';
  return new Intl.NumberFormat('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(n));
}

export function formatOddsInput(n) {
  if (n == null || !Number.isFinite(Number(n))) return '';
  return new Intl.NumberFormat('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 3 }).format(Number(n));
}

const MESI = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];
const GIORNI = ['domenica', 'lunedì', 'martedì', 'mercoledì', 'giovedì', 'venerdì', 'sabato'];

export function formatDateIT(iso) {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso || '';
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return `${GIORNI[dt.getUTCDay()]} ${d} ${MESI[m - 1]} ${y}`;
}

export function formatDateShort(iso) {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso || '';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

export function romeToday(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now);
}

export function uid() {
  if (globalThis.crypto && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

function clip(v, max) {
  if (v == null) return '';
  const s = String(v);
  return s.length > max ? s.slice(0, max) : s;
}

function arr(v) {
  return Array.isArray(v) ? v : [];
}

function stableId(obj) {
  const s = JSON.stringify(obj);
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return 'h' + (h >>> 0).toString(16);
}

export function combinedOdds(selections, { voidsAsOne = false } = {}) {
  if (!selections || !selections.length) return null;
  let p = 1;
  for (const s of selections) {
    let o = parseDecimal(s.odds);
    if (voidsAsOne && s.result === 'void') o = 1;
    if (o == null || o <= 0) return null;
    p *= o;
  }
  return roundTo(p, 2);
}

export function oddsForBet(bet, { settlement = false } = {}) {
  if (!bet) return null;
  if (bet.kind === 'multipla' && bet.totalOddsManual && parseDecimal(bet.totalOdds) != null) {
    return roundTo(parseDecimal(bet.totalOdds), 2);
  }
  return combinedOdds(bet.selections, { voidsAsOne: settlement });
}

function commissionFactor(bet) {
  const c = parseDecimal(bet.commissionPct);
  if (c == null || c <= 0) return 1;
  if (c >= 100) return 0;
  return 1 - c / 100;
}

export function profitOf(bet) {
  if (!bet || !bet.result) return null;
  const stake = parseDecimal(bet.stake);
  if (stake == null || stake < 0) return null;
  const comm = commissionFactor(bet);
  if (bet.result === 'void') return 0;
  const odds = oddsForBet(bet, { settlement: true });
  if (bet.result === 'persa') {
    if (bet.side === 'lay') {
      if (odds == null) return null;
      return roundMoney(-(stake * (odds - 1)));
    }
    return roundMoney(-stake);
  }
  if (bet.result === 'cashout') {
    const back = parseDecimal(bet.cashoutAmount);
    if (back == null || back < 0) return null;
    const risk = bet.side === 'lay' ? (odds == null ? null : stake * (odds - 1)) : stake;
    if (risk == null) return null;
    const raw = back - risk;
    return raw > 0 ? roundMoney(raw * comm) : roundMoney(raw);
  }
  if (bet.result === 'vinta') {
    if (odds == null) return null;
    const raw = bet.side === 'lay' ? stake : stake * (odds - 1);
    return roundMoney(raw * comm);
  }
  return null;
}

export function previewWinProfit(bet) {
  const clone = {
    ...bet,
    result: 'vinta',
    selections: (bet.selections || []).map((s) => ({ ...s, result: s.result === 'void' ? 'void' : 'vinta' })),
  };
  return profitOf(clone);
}

export function amountStaked(bet) {
  const stake = parseDecimal(bet.stake);
  if (stake == null || stake < 0) return null;
  if (bet.side !== 'lay') return roundMoney(stake);
  const settled = !!bet.result && !(bet.result === 'cashout' && parseDecimal(bet.cashoutAmount) == null);
  const odds = oddsForBet(bet, { settlement: settled });
  if (odds == null) return null;
  return roundMoney(stake * (odds - 1));
}

/** Puntato che entra in yield e ROI: i rimborsi sono esclusi. */
export function turnoverOf(bet) {
  if (bet.result === 'void') return 0;
  return amountStaked(bet);
}

export function betDate(bet) {
  const dates = (bet.selections || []).map((s) => s.date).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
  return dates[0] || '';
}

export function betKickoff(bet) {
  const sels = [...(bet.selections || [])].sort((a, b) => (
    String(a.date).localeCompare(String(b.date)) || String(a.kickoff).localeCompare(String(b.kickoff))
  ));
  return sels[0]?.kickoff || '';
}

export function matchLabel(bet) {
  const names = (bet.selections || []).map((s) => `${s.home} – ${s.away}`);
  if (!names.length) return 'Partita';
  if (names.length <= 2) return names.join(' · ');
  return `${names[0]} · ${names[1]} +${names.length - 2}`;
}

export function betLeague(bet) {
  const leagues = [...new Set((bet.selections || []).map((s) => (s.league || '').trim()).filter(Boolean))];
  if (!leagues.length) return 'Non indicato';
  if (leagues.length === 1) return leagues[0];
  return 'Più campionati';
}

export function betMarket(bet) {
  const markets = (bet.selections || []).map((s) => (s.market || '').trim()).filter(Boolean);
  if (!markets.length) return 'Non indicato';
  const uniq = [];
  const seen = new Set();
  for (const m of markets) {
    const k = m.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    uniq.push(m);
  }
  if (bet.kind === 'multipla' && uniq.length > 1) return uniq.join(' + ');
  return uniq[0];
}

export function betBook(bet) {
  const b = (bet.bookmaker || '').trim();
  return b || 'Non indicato';
}

export function oddsBucket(o) {
  if (o == null || !Number.isFinite(o)) return 'Quota mancante';
  if (o < 1.5) return 'Fino a 1,49';
  if (o < 2) return '1,50 – 1,99';
  if (o < 2.5) return '2,00 – 2,49';
  if (o < 3.5) return '2,50 – 3,49';
  if (o < 6) return '3,50 – 5,99';
  return '6,00+';
}

function normalizeSelection(input, betId, index) {
  if (!input || typeof input !== 'object') return null;
  const odds = parseDecimal(input.odds);
  const result = SEL_RESULTS.has(input.result) ? input.result : null;
  return {
    id: clip(input.id, 80) || `${betId}-sel-${index}`,
    matchId: clip(input.matchId, 40),
    date: /^\d{4}-\d{2}-\d{2}$/.test(String(input.date || '')) ? String(input.date) : '',
    kickoff: clip(input.kickoff, 8),
    home: clip(input.home, 80),
    away: clip(input.away, 80),
    league: clip(input.league, 80),
    country: clip(input.country, 40),
    url: clip(input.url, 300),
    market: clip(input.market, 80),
    odds: odds != null && odds > 0 ? roundTo(odds, 3) : null,
    result,
    score: clip(input.score, 20),
  };
}

export function normalizeBet(input) {
  if (!input || typeof input !== 'object') return null;
  const id = clip(input.id, 80) || stableId({
    kind: input.kind, createdAt: input.createdAt, selections: input.selections, stake: input.stake,
  });
  const selections = arr(input.selections).map((s, i) => normalizeSelection(s, id, i)).filter(Boolean);
  if (!selections.length) return null;
  const stake = parseDecimal(input.stake);
  const comm = parseDecimal(input.commissionPct);
  const total = parseDecimal(input.totalOdds);
  const cash = parseDecimal(input.cashoutAmount);
  const result = BET_RESULTS.has(input.result) ? input.result : null;
  let status = 'active';
  if (!result) status = input.status === 'draft' ? 'draft' : 'active';
  else if (result === 'cashout' && cash == null) status = 'active';
  else status = 'settled';
  return {
    id,
    kind: input.kind === 'multipla' ? 'multipla' : 'singola',
    side: input.side === 'lay' ? 'lay' : 'back',
    status,
    createdAt: clip(input.createdAt, 40),
    updatedAt: clip(input.updatedAt, 40),
    playedAt: clip(input.playedAt, 40),
    settledAt: clip(input.settledAt, 40),
    bookmaker: clip(input.bookmaker, 60),
    stake: stake != null && stake >= 0 ? roundMoney(stake) : null,
    commissionPct: comm != null && comm >= 0 && comm <= 100 ? roundTo(comm, 2) : null,
    totalOdds: total != null && total > 0 ? roundTo(total, 2) : null,
    totalOddsManual: !!input.totalOddsManual,
    result,
    resultManual: !!input.resultManual,
    cashoutAmount: cash != null && cash >= 0 ? roundMoney(cash) : null,
    selections,
  };
}

function normalizeSlip(slip) {
  const src = slip && typeof slip === 'object' ? slip : {};
  const items = [];
  const seen = new Set();
  for (const raw of arr(src.items)) {
    if (!raw || typeof raw !== 'object') continue;
    const matchId = raw.matchId == null ? '' : String(raw.matchId);
    const date = /^\d{4}-\d{2}-\d{2}$/.test(String(raw.date || '')) ? String(raw.date) : '';
    if (!matchId || !date) continue;
    const key = `${date}|${matchId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    items.push({
      key,
      matchId: clip(matchId, 40),
      date,
      kickoff: clip(raw.kickoff, 8),
      home: clip(raw.home, 80),
      away: clip(raw.away, 80),
      league: clip(raw.league, 80),
      country: clip(raw.country, 40),
      url: clip(raw.url, 300),
    });
  }
  items.sort((a, b) => a.date.localeCompare(b.date) || String(a.kickoff).localeCompare(String(b.kickoff)) || a.key.localeCompare(b.key));
  return {
    mode: src.mode === 'multipla' ? 'multipla' : 'singole',
    items,
    updatedAt: clip(src.updatedAt, 40),
  };
}

function byCreated(a, b) {
  return String(a.createdAt).localeCompare(String(b.createdAt)) || String(a.id).localeCompare(String(b.id));
}

export function normalizeState(input) {
  const src = input && typeof input === 'object' ? input : {};
  const settingsIn = src.settings && typeof src.settings === 'object' ? src.settings : {};
  const bank = parseDecimal(settingsIn.startingBankroll);
  const comm = parseDecimal(settingsIn.defaultCommission);
  const deleted = [...new Set(arr(src.deletedIds).map((x) => clip(x, 80)).filter(Boolean))].sort();
  const deletedSet = new Set(deleted);
  const bets = [];
  const betIds = new Set();
  for (const raw of arr(src.bets)) {
    const bet = normalizeBet(raw);
    if (!bet || deletedSet.has(bet.id) || betIds.has(bet.id)) continue;
    bet.status = bet.status === 'settled' ? 'settled' : 'active';
    betIds.add(bet.id);
    bets.push(bet);
  }
  bets.sort(byCreated);
  const drafts = [];
  const draftIds = new Set();
  for (const raw of arr(src.drafts)) {
    const bet = normalizeBet(raw);
    if (!bet || deletedSet.has(bet.id) || betIds.has(bet.id) || draftIds.has(bet.id)) continue;
    bet.status = 'draft';
    draftIds.add(bet.id);
    drafts.push(bet);
  }
  drafts.sort(byCreated);
  return {
    version: 1,
    updatedAt: clip(src.updatedAt, 40),
    settingsUpdatedAt: clip(src.settingsUpdatedAt, 40) || clip(src.updatedAt, 40),
    settings: {
      startingBankroll: bank != null && bank > 0 ? roundMoney(bank) : null,
      defaultCommission: comm != null && comm >= 0 && comm <= 100 ? roundTo(comm, 2) : null,
      showStakeOnImage: typeof settingsIn.showStakeOnImage === 'boolean' ? settingsIn.showStakeOnImage : true,
    },
    slip: normalizeSlip(src.slip),
    drafts,
    bets,
    deletedIds: deleted,
  };
}

export function emptyState() {
  const now = new Date().toISOString();
  return {
    ...normalizeState({
      updatedAt: now,
      settingsUpdatedAt: now,
      settings: { showStakeOnImage: true },
    }),
    secrets: { githubToken: '', telegramBotToken: '', telegramChatId: '' },
    target: { ...DEFAULT_TARGET },
    sync: { sha: null, lastSyncedAt: '', status: 'local', error: '' },
  };
}

export function toRemote(state) {
  const n = normalizeState(state);
  return {
    version: 1,
    updatedAt: n.updatedAt,
    settingsUpdatedAt: n.settingsUpdatedAt,
    settings: n.settings,
    slip: n.slip,
    drafts: n.drafts,
    bets: n.bets,
    deletedIds: n.deletedIds,
  };
}

export function syncFingerprint(state) {
  return JSON.stringify(toRemote(state));
}

export function meaningfulFingerprint(state) {
  const r = toRemote(state);
  return JSON.stringify({
    settings: r.settings,
    slip: { mode: r.slip.mode, items: r.slip.items },
    drafts: r.drafts,
    bets: r.bets,
    deletedIds: r.deletedIds,
  });
}

export function isPristine(state) {
  const blank = normalizeState({ settings: { showStakeOnImage: true } });
  return meaningfulFingerprint(state) === meaningfulFingerprint(blank);
}

function mergeById(localList, remoteList, deleted) {
  const map = new Map();
  for (const b of remoteList) {
    if (b && !deleted.has(b.id)) map.set(b.id, b);
  }
  for (const b of localList) {
    if (!b || deleted.has(b.id)) continue;
    const prev = map.get(b.id);
    if (!prev || String(b.updatedAt) >= String(prev.updatedAt)) map.set(b.id, b);
  }
  return [...map.values()];
}

/** Unisce due archivi senza cancellare una giocata, salvo id presenti nei tombstone. */
export function mergeStates(local, remote) {
  const L = normalizeState(local);
  const R = normalizeState(remote);
  const deleted = [...new Set([...L.deletedIds, ...R.deletedIds])].sort();
  const deletedSet = new Set(deleted);
  const settingsPick = String(L.settingsUpdatedAt) >= String(R.settingsUpdatedAt) ? L : R;
  const slip = String(L.slip.updatedAt) >= String(R.slip.updatedAt) ? L.slip : R.slip;
  return normalizeState({
    version: 1,
    updatedAt: String(L.updatedAt) >= String(R.updatedAt) ? L.updatedAt : R.updatedAt,
    settingsUpdatedAt: settingsPick.settingsUpdatedAt,
    settings: settingsPick.settings,
    slip,
    drafts: mergeById(L.drafts, R.drafts, deletedSet),
    bets: mergeById(L.bets, R.bets, deletedSet),
    deletedIds: deleted,
  });
}

export function normalizeTarget(input) {
  const t = input && typeof input === 'object' ? input : {};
  return {
    owner: clip(t.owner, 80) || DEFAULT_TARGET.owner,
    repo: clip(t.repo, 100) || DEFAULT_TARGET.repo,
    path: clip(t.path, 200) || DEFAULT_TARGET.path,
    branch: clip(t.branch, 120) || DEFAULT_TARGET.branch,
  };
}

export function validateTarget(target) {
  const t = normalizeTarget(target);
  if (!/^[A-Za-z0-9_.-]+$/.test(t.owner)) return 'Owner GitHub non valido.';
  if (!/^[A-Za-z0-9_.-]+$/.test(t.repo)) return 'Nome repository non valido.';
  if (!/^[A-Za-z0-9_.\-/]+$/.test(t.path) || t.path.includes('..') || t.path.startsWith('/')) return 'Percorso file non valido.';
  if (!/^[A-Za-z0-9_.\-/]+$/.test(t.branch)) return 'Branch non valido.';
  return '';
}

export function targetKey(target) {
  const t = normalizeTarget(target);
  return `${t.owner}/${t.repo}/${t.path}@${t.branch}`;
}

function selectionFromItem(item) {
  return {
    id: uid(),
    matchId: item.matchId,
    date: item.date,
    kickoff: item.kickoff || '',
    home: item.home || '',
    away: item.away || '',
    league: item.league || '',
    country: item.country || '',
    url: item.url || '',
    market: '',
    odds: null,
    result: null,
    score: '',
  };
}

export function createDraft(kind, items, settings = {}) {
  const now = new Date().toISOString();
  return normalizeBet({
    id: uid(),
    kind: kind === 'multipla' ? 'multipla' : 'singola',
    side: 'back',
    status: 'draft',
    createdAt: now,
    updatedAt: now,
    playedAt: '',
    settledAt: '',
    bookmaker: '',
    stake: null,
    commissionPct: settings.defaultCommission ?? null,
    totalOdds: null,
    totalOddsManual: false,
    result: null,
    resultManual: false,
    cashoutAmount: null,
    selections: items.map(selectionFromItem),
  });
}

export function toggleSlipItem(state, item) {
  const date = String(item.date || '');
  const matchId = item.matchId == null ? '' : String(item.matchId);
  const key = `${date}|${matchId}`;
  const idx = state.slip.items.findIndex((x) => x.key === key);
  if (idx >= 0) state.slip.items.splice(idx, 1);
  else {
    state.slip.items.push({
      key,
      matchId,
      date,
      kickoff: item.kickoff || '',
      home: item.home || '',
      away: item.away || '',
      league: item.league || '',
      country: item.country || '',
      url: item.url || '',
    });
  }
  state.slip.updatedAt = new Date().toISOString();
  state.updatedAt = state.slip.updatedAt;
  return idx < 0;
}

export function sendSlip(state) {
  if (!state.slip.items.length) return [];
  const items = [...state.slip.items];
  const created = [];
  if (state.slip.mode === 'multipla') created.push(createDraft('multipla', items, state.settings));
  else for (const item of items) created.push(createDraft('singola', [item], state.settings));
  state.drafts = [...created, ...state.drafts];
  state.slip.items = [];
  const now = new Date().toISOString();
  state.slip.updatedAt = now;
  state.updatedAt = now;
  return created;
}

export function playable(bet) {
  const stake = parseDecimal(bet.stake);
  if (stake == null || stake <= 0) return { ok: false, message: 'Inserisci la puntata.' };
  const comm = parseDecimal(bet.commissionPct);
  if (comm != null && (comm < 0 || comm > 100)) return { ok: false, message: 'La commissione deve essere tra 0 e 100.' };
  for (const s of bet.selections) {
    if (!String(s.market || '').trim()) return { ok: false, message: 'Inserisci il tipo di giocata per ogni partita.' };
    const o = parseDecimal(s.odds);
    if (o == null || o <= 1) return { ok: false, message: 'La quota deve essere maggiore di 1.' };
  }
  const odds = bet.kind === 'multipla' && bet.totalOddsManual ? parseDecimal(bet.totalOdds) : combinedOdds(bet.selections);
  if (odds == null || odds <= 1) return { ok: false, message: 'Controlla la quota totale.' };
  return { ok: true, message: '' };
}

export function playDraft(state, id) {
  const idx = state.drafts.findIndex((b) => b.id === id);
  if (idx < 0) return { ok: false, message: 'Giocata non trovata.' };
  const bet = state.drafts[idx];
  const check = playable(bet);
  if (!check.ok) return check;
  const now = new Date().toISOString();
  for (const s of bet.selections) s.market = s.market.trim();
  if (!bet.totalOddsManual) bet.totalOdds = combinedOdds(bet.selections);
  bet.status = 'active';
  bet.playedAt = now;
  bet.updatedAt = now;
  bet.result = null;
  bet.settledAt = '';
  state.drafts.splice(idx, 1);
  state.bets.unshift(bet);
  state.updatedAt = now;
  return { ok: true, bet };
}

export function deleteEverywhere(state, id) {
  const sid = String(id);
  state.drafts = state.drafts.filter((b) => b.id !== sid);
  state.bets = state.bets.filter((b) => b.id !== sid);
  if (!state.deletedIds.includes(sid)) state.deletedIds.push(sid);
  state.deletedIds.sort();
  state.updatedAt = new Date().toISOString();
  return state;
}

export function suggestResult(bet) {
  const rs = bet.selections.map((s) => s.result);
  if (!rs.length || rs.some((r) => r == null)) return null;
  if (rs.some((r) => r === 'persa')) return 'persa';
  if (rs.every((r) => r === 'void')) return 'void';
  if (rs.every((r) => r === 'vinta' || r === 'void')) return 'vinta';
  return null;
}

export function setBetResult(bet, result) {
  const now = new Date().toISOString();
  if (bet.result === result && result !== 'cashout') {
    bet.result = null;
    bet.resultManual = false;
    bet.status = 'active';
    bet.settledAt = '';
  } else {
    bet.result = result;
    bet.resultManual = true;
    if (result === 'cashout' && parseDecimal(bet.cashoutAmount) == null) {
      bet.status = 'active';
      bet.settledAt = '';
    } else {
      bet.status = 'settled';
      bet.settledAt = now;
    }
  }
  bet.updatedAt = now;
}

export function setSelectionResult(bet, selId, result) {
  const sel = bet.selections.find((s) => s.id === selId);
  if (!sel) return;
  const now = new Date().toISOString();
  sel.result = sel.result === result ? null : result;
  bet.updatedAt = now;
  if (!bet.resultManual) applySuggested(bet, now);
}

export function applySuggestedResult(bet) {
  bet.resultManual = false;
  applySuggested(bet, new Date().toISOString());
}

function applySuggested(bet, now) {
  const suggested = suggestResult(bet);
  bet.updatedAt = now;
  if (!suggested) {
    if (bet.result !== 'cashout') {
      bet.result = null;
      bet.status = 'active';
      bet.settledAt = '';
    }
    return;
  }
  bet.result = suggested;
  bet.status = 'settled';
  bet.settledAt = bet.settledAt || now;
}

export function removeSelection(state, bet, selId) {
  bet.selections = bet.selections.filter((s) => s.id !== selId);
  bet.updatedAt = new Date().toISOString();
  if (!bet.selections.length) {
    deleteEverywhere(state, bet.id);
    return;
  }
  if (bet.selections.length === 1) bet.kind = 'singola';
  if (!bet.totalOddsManual) bet.totalOdds = combinedOdds(bet.selections);
}

export function isoWeekKey(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  const dayNr = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - dayNr + 3);
  const isoYear = date.getUTCFullYear();
  const firstThursday = new Date(Date.UTC(isoYear, 0, 4));
  const firstDayNr = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayNr + 3);
  const week = 1 + Math.round((date - firstThursday) / 604800000);
  return `${isoYear}-W${String(week).padStart(2, '0')}`;
}

export function daysBetween(a, b) {
  const [ya, ma, da] = a.split('-').map(Number);
  const [yb, mb, db] = b.split('-').map(Number);
  return Math.round((Date.UTC(yb, mb - 1, db) - Date.UTC(ya, ma - 1, da)) / 86400000);
}

function monthEnd(today) {
  const [y, m] = today.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${today.slice(0, 7)}-${String(last).padStart(2, '0')}`;
}

function pad(n) { return String(n).padStart(2, '0'); }

function toIso(dt) {
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

export function rangeForView(view, today, custom = {}) {
  if (view === 'oggi') return { from: today, to: today };
  if (view === 'settimana') {
    const [y, m, d] = today.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    const day = (dt.getUTCDay() + 6) % 7;
    const start = new Date(dt);
    start.setUTCDate(dt.getUTCDate() - day);
    const end = new Date(start);
    end.setUTCDate(start.getUTCDate() + 6);
    return { from: toIso(start), to: toIso(end) };
  }
  if (view === 'mese') return { from: today.slice(0, 7) + '-01', to: monthEnd(today) };
  if (view === 'intervallo') return { from: custom.from || null, to: custom.to || null };
  return { from: null, to: null };
}

export function granularityFor(view, from, to) {
  if (view === 'oggi' || view === 'settimana' || view === 'mese') return 'day';
  if (view === 'tutto' && !from && !to) return 'month';
  if (from && to) {
    const days = Math.abs(daysBetween(from, to));
    if (days <= 31) return 'day';
    if (days <= 120) return 'week';
    return 'month';
  }
  return 'month';
}

function inRange(date, from, to) {
  if (!from && !to) return true;
  if (!date) return false;
  if (from && date < from) return false;
  if (to && date > to) return false;
  return true;
}

function streakKey(bet) {
  if (bet.result === 'vinta') return 'win';
  if (bet.result === 'persa') return 'loss';
  if (bet.result === 'void') return 'skip';
  if (bet.result === 'cashout') {
    const p = profitOf(bet);
    if (p == null || p === 0) return 'skip';
    return p > 0 ? 'win' : 'loss';
  }
  return 'skip';
}

export function streaks(sortedBets) {
  let curType = 'none';
  let curLen = 0;
  let longestWin = 0;
  let longestLoss = 0;
  for (const b of sortedBets) {
    const k = streakKey(b);
    if (k === 'skip') continue;
    if (k === curType) curLen += 1;
    else { curType = k; curLen = 1; }
    if (k === 'win') longestWin = Math.max(longestWin, curLen);
    if (k === 'loss') longestLoss = Math.max(longestLoss, curLen);
  }
  return { current: { type: curType, length: curLen }, longestWin, longestLoss };
}

function chrono(a, b) {
  const d = betDate(a).localeCompare(betDate(b));
  if (d) return d;
  return String(a.settledAt || a.playedAt || a.createdAt).localeCompare(String(b.settledAt || b.playedAt || b.createdAt))
    || String(a.id).localeCompare(String(b.id));
}

function periodKey(date, granularity) {
  if (!date) return 'senza-data';
  if (granularity === 'day') return date;
  if (granularity === 'week') return isoWeekKey(date);
  return date.slice(0, 7);
}

function periodLabel(key, granularity, sampleDate) {
  if (granularity === 'day') return formatDateShort(key);
  if (granularity === 'month') {
    const [y, m] = key.split('-').map(Number);
    if (!y || !m) return key;
    return `${MESI[m - 1]} ${y}`;
  }
  if (!sampleDate) return key;
  const [y, m, d] = sampleDate.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const day = (dt.getUTCDay() + 6) % 7;
  const start = new Date(dt);
  start.setUTCDate(dt.getUTCDate() - day);
  const end = new Date(start);
  end.setUTCDate(start.getUTCDate() + 6);
  return `${pad(start.getUTCDate())}/${pad(start.getUTCMonth() + 1)}–${pad(end.getUTCDate())}/${pad(end.getUTCMonth() + 1)}`;
}

function addBreakdown(map, key, label, bet, profit) {
  let row = map.get(key);
  if (!row) {
    row = { key, label, bets: 0, staked: 0, profit: 0, wins: 0, losses: 0, voids: 0, cashouts: 0 };
    map.set(key, row);
  }
  row.bets += 1;
  const turn = turnoverOf(bet);
  if (turn != null) row.staked = roundMoney(row.staked + turn);
  if (profit != null) row.profit = roundMoney(row.profit + profit);
  if (bet.result === 'vinta') row.wins += 1;
  else if (bet.result === 'persa') row.losses += 1;
  else if (bet.result === 'void') row.voids += 1;
  else if (bet.result === 'cashout') row.cashouts += 1;
}

function finishBreakdown(map) {
  return [...map.values()].map((row) => ({
    ...row,
    yield: row.staked > 0 ? (row.profit / row.staked) * 100 : null,
  })).sort((a, b) => b.profit - a.profit || b.bets - a.bets || a.label.localeCompare(b.label, 'it'));
}

function resultCounts(bet, acc) {
  const k = streakKey(bet);
  if (bet.result === 'vinta' || (bet.result === 'cashout' && k === 'win')) acc.wins += 1;
  else if (bet.result === 'persa' || (bet.result === 'cashout' && k === 'loss')) acc.losses += 1;
  if (bet.result === 'void' || (bet.result === 'cashout' && k === 'skip')) acc.voids += 1;
  if (bet.result === 'cashout') acc.cashouts += 1;
}

export function analyze(state, { view = 'tutto', today = '2026-01-01', from = '', to = '' } = {}) {
  const range = rangeForView(view, today, { from: from || null, to: to || null });
  const granularity = granularityFor(view, range.from, range.to);
  const settled = state.bets.filter((b) => b.status === 'settled' && inRange(betDate(b), range.from, range.to)).sort(chrono);
  const open = state.bets.filter((b) => b.status !== 'settled' && inRange(betDate(b), range.from, range.to));
  let profit = 0;
  let staked = 0;
  let incomplete = 0;
  let stakeBets = 0;
  let oddsSum = 0;
  let oddsN = 0;
  let weightedOdds = 0;
  let weightedStake = 0;
  let biggestWin = null;
  let biggestLoss = null;
  const counts = { wins: 0, losses: 0, voids: 0, cashouts: 0 };
  const byKind = new Map();
  const byMarket = new Map();
  const byBook = new Map();
  const byOdds = new Map();
  const byLeague = new Map();
  const byPeriod = new Map();
  const dayEquity = new Map();
  const rows = [];

  for (const bet of settled) {
    const p = profitOf(bet);
    const turn = turnoverOf(bet);
    if (p == null || turn == null) {
      incomplete += 1;
      continue;
    }
    profit = roundMoney(profit + p);
    staked = roundMoney(staked + turn);
    if (bet.result !== 'void') stakeBets += 1;
    resultCounts(bet, counts);
    const price = oddsForBet(bet, { settlement: false });
    if (price != null) {
      oddsSum += price;
      oddsN += 1;
      if (turn > 0) {
        weightedOdds += price * turn;
        weightedStake += turn;
      }
    }
    if (p > 0 && (biggestWin == null || p > biggestWin.profit)) biggestWin = { profit: p, label: matchLabel(bet) };
    if (p < 0 && (biggestLoss == null || p < biggestLoss.profit)) biggestLoss = { profit: p, label: matchLabel(bet) };
    addBreakdown(byKind, bet.kind, bet.kind === 'multipla' ? 'Multipla' : 'Singola', bet, p);
    addBreakdown(byMarket, betMarket(bet).toLowerCase(), betMarket(bet), bet, p);
    addBreakdown(byBook, betBook(bet).toLowerCase(), betBook(bet), bet, p);
    const bucket = oddsBucket(price);
    addBreakdown(byOdds, bucket, bucket, bet, p);
    addBreakdown(byLeague, betLeague(bet).toLowerCase(), betLeague(bet), bet, p);
    const date = betDate(bet) || 'senza-data';
    const pk = periodKey(date, granularity);
    addBreakdown(byPeriod, pk, periodLabel(pk, granularity, date), bet, p);
    dayEquity.set(date, roundMoney((dayEquity.get(date) || 0) + p));
    rows.push(csvRow(bet, p, turn, price));
  }

  const startBank = state.settings.startingBankroll || 0;
  let running = 0;
  const equity = [];
  const days = [...dayEquity.keys()].sort();
  if (days.length) {
    equity.push({ date: days[0], label: 'Inizio', value: startBank, profit: 0 });
  }
  for (const date of days) {
    running = roundMoney(running + dayEquity.get(date));
    equity.push({
      date,
      label: formatDateShort(date),
      value: roundMoney(startBank + running),
      profit: running,
    });
  }

  const strikeDenom = counts.wins + counts.losses;
  const yieldPct = staked > 0 ? (profit / staked) * 100 : null;
  const roi = startBank > 0 ? (profit / startBank) * 100 : yieldPct;
  const openStaked = open.reduce((sum, b) => {
    const n = amountStaked(b);
    return n == null ? sum : sum + n;
  }, 0);

  return {
    from: range.from,
    to: range.to,
    granularity,
    incomplete,
    kpis: {
      profit,
      staked,
      yield: yieldPct,
      roi,
      strike: strikeDenom ? (counts.wins / strikeDenom) * 100 : null,
      wins: counts.wins,
      losses: counts.losses,
      voids: counts.voids,
      cashouts: counts.cashouts,
      bets: counts.wins + counts.losses + counts.voids,
      openBets: open.length,
      openStaked: roundMoney(openStaked),
      avgOdds: oddsN ? oddsSum / oddsN : null,
      avgOddsWeighted: weightedStake ? weightedOdds / weightedStake : null,
      avgStake: stakeBets ? staked / stakeBets : null,
      biggestWin,
      biggestLoss,
      ...streaks(settled.filter((b) => profitOf(b) != null)),
      startingBankroll: state.settings.startingBankroll,
    },
    equity,
    byPeriod: finishBreakdown(byPeriod).sort((a, b) => a.key.localeCompare(b.key)),
    byKind: finishBreakdown(byKind),
    byMarket: finishBreakdown(byMarket),
    byBook: finishBreakdown(byBook),
    byOdds: finishBreakdown(byOdds),
    byLeague: finishBreakdown(byLeague),
    rows: rows.sort((a, b) => String(b.Data).localeCompare(String(a.Data), 'it') || String(a.Partite).localeCompare(String(b.Partite), 'it')),
  };
}

function csvRow(bet, profit, turn, price) {
  return {
    Data: formatDateShort(betDate(bet)),
    Orario: betKickoff(bet),
    Tipo: bet.kind === 'multipla' ? 'Multipla' : 'Singola',
    Lato: bet.side === 'lay' ? 'Lay' : 'Back',
    Partite: (bet.selections || []).map((s) => `${s.home} – ${s.away}`).join(' | '),
    Campionato: betLeague(bet),
    Mercato: betMarket(bet),
    Quote: (bet.selections || []).map((s) => (s.odds == null ? '' : formatOdds(s.odds))).join(' | '),
    Quota: price == null ? '' : formatOdds(price),
    Puntata: bet.stake == null ? '' : String(bet.stake).replace('.', ','),
    Rischio: turn == null ? '' : String(turn).replace('.', ','),
    Bookmaker: bet.bookmaker || '',
    'Commissione %': bet.commissionPct == null ? '' : String(bet.commissionPct).replace('.', ','),
    Esito: ({ vinta: 'Vinta', persa: 'Persa', void: 'Rimborso', cashout: 'Cash out' })[bet.result] || '',
    'Cash out': bet.cashoutAmount == null ? '' : String(bet.cashoutAmount).replace('.', ','),
    Punteggio: (bet.selections || []).map((s) => s.score).filter(Boolean).join(' | '),
    Utile: String(profit).replace('.', ','),
  };
}

export function toCsv(rows) {
  const headers = rows[0] ? Object.keys(rows[0]) : [
    'Data', 'Orario', 'Tipo', 'Lato', 'Partite', 'Campionato', 'Mercato', 'Quote', 'Quota',
    'Puntata', 'Rischio', 'Bookmaker', 'Commissione %', 'Esito', 'Cash out', 'Punteggio', 'Utile',
  ];
  const lines = [headers.join(';')];
  for (const row of rows) {
    lines.push(headers.map((h) => csvCell(row[h])).join(';'));
  }
  return '\uFEFF' + lines.join('\r\n');
}

function csvCell(v) {
  const s = v == null ? '' : String(v);
  if (/[;"\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export const DATA_KEY = 'segnali.giocate.v1';
export const SECRET_KEY = 'segnali.giocate.secrets.v1';

export function loadState(storage) {
  try {
    const raw = storage.getItem(DATA_KEY);
    const secretRaw = storage.getItem(SECRET_KEY);
    const data = raw ? JSON.parse(raw) : null;
    const secrets = secretRaw ? JSON.parse(secretRaw) : {};
    const norm = normalizeState(data || { settings: { showStakeOnImage: true } });
    if (!data) {
      const now = new Date().toISOString();
      norm.updatedAt = now;
      norm.settingsUpdatedAt = now;
    }
    return {
      ...norm,
      secrets: {
        githubToken: clip(secrets.githubToken, 300),
        telegramBotToken: clip(secrets.telegramBotToken, 200),
        telegramChatId: clip(secrets.telegramChatId, 80),
      },
      target: normalizeTarget(data && data.target),
      sync: {
        sha: data && data.sync ? clip(data.sync.sha, 120) || null : null,
        lastSyncedAt: data && data.sync ? clip(data.sync.lastSyncedAt, 40) : '',
        status: 'local',
        error: '',
      },
    };
  } catch {
    return emptyState();
  }
}

export function saveState(storage, state) {
  const data = {
    ...toRemote(state),
    target: normalizeTarget(state.target),
    sync: {
      sha: state.sync && state.sync.sha ? state.sync.sha : null,
      lastSyncedAt: state.sync && state.sync.lastSyncedAt ? state.sync.lastSyncedAt : '',
    },
  };
  const secrets = {
    githubToken: state.secrets?.githubToken || '',
    telegramBotToken: state.secrets?.telegramBotToken || '',
    telegramChatId: state.secrets?.telegramChatId || '',
  };
  storage.setItem(DATA_KEY, JSON.stringify(data));
  storage.setItem(SECRET_KEY, JSON.stringify(secrets));
}

export function exportBackup(state) {
  return JSON.stringify(toRemote(state), null, 2);
}

export function importBackup(state, jsonText) {
  const incoming = JSON.parse(jsonText);
  if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming)) {
    throw new Error('Il file non è un archivio giocate.');
  }
  return mergeStates(state, incoming);
}
