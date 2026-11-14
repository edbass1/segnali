// Interfaccia schedina, giocate, bilancio e post Telegram.
import {
  BOOKS, MARKETS, amountStaked, analyze, applySuggestedResult, betDate, betKickoff, bonusIssues,
  combinedOdds, deleteEverywhere, evaluateBonus, exportBackup, formatDateIT, formatDateShort,
  formatOdds, formatOddsInput, formatPct, formatPlainMoney, formatSignedMoney, importBackup,
  loadState, matchLabel, maxStakeFor, meaningfulFingerprint, mergeStates, normalizeBonusDraft,
  normalizeTarget, oddsForBet, outcomeOf, parseDecimal, playDraft, previewWinProfit, profitOf,
  removeSelection, romeToday, saveState, sendSlip, setBetResult, setSelectionResult, targetKey,
  toCsv, toggleSlipItem, validateTarget, wagerTargetOf,
} from './giocate-model.js';
import { syncRemote } from './giocate-github.js';
import { buildPost, canvasToJpeg, drawTicket, sendTelegramPhoto, sortForPost } from './giocate-telegram.js';

const PANELS = ['schedina', 'giocate', 'bilancio', 'telegram', 'impostazioni'];
const ui = {
  filter: 'tutte',
  view: 'tutto',
  from: '',
  to: '',
  tgMode: 'prematch',
  tgScope: 'day',
  tgDate: '',
  tgBetId: '',
};

function browserStorage() {
  try {
    const probe = '__segnali_probe__';
    localStorage.setItem(probe, '1');
    localStorage.removeItem(probe);
    return localStorage;
  } catch {
    if (!browserStorage.mem) {
      const m = new Map();
      browserStorage.mem = {
        getItem: (key) => (m.has(key) ? m.get(key) : null),
        setItem: (key, value) => m.set(key, String(value)),
        removeItem: (key) => m.delete(key),
      };
    }
    return browserStorage.mem;
  }
}

let state = loadState(browserStorage());
ui.tgDate = romeToday();
let syncing = false;
let syncQueued = false;
let syncTimer = 0;
let toastTimer = 0;
let lastBlob = null;
let lastText = '';
let lastName = 'giocata.jpg';
const charts = [];

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[c]));

function numInput(n) {
  if (n == null || n === '') return '';
  return String(n).replace('.', ',');
}

function storage() {
  try { saveState(browserStorage(), state); }
  catch { state.sync.error = 'Memoria del browser piena: esporta un backup JSON.'; }
}

function persistDirty() {
  state.sync.status = state.secrets.githubToken ? 'dirty' : 'local';
  storage();
  updateSyncBar();
  updateChrome();
  scheduleSync();
}

function scheduleSync() {
  clearTimeout(syncTimer);
  if (!state.secrets.githubToken) return;
  syncTimer = setTimeout(() => { syncNow(); }, 2000);
}

function findBet(id) {
  return state.drafts.find((b) => b.id === id) || state.bets.find((b) => b.id === id);
}

function panelOn(name) {
  const el = document.getElementById('p-' + name);
  return !!(el && el.classList.contains('on'));
}

function toast(message) {
  const el = document.getElementById('g-toast');
  if (!el) return;
  el.textContent = message;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 3400);
}

function ask(message, confirmLabel = 'ELIMINA') {
  const modal = document.getElementById('g-modal');
  modal.querySelector('p').textContent = message;
  const yes = modal.querySelector('[data-yes]');
  const no = modal.querySelector('[data-no]');
  yes.textContent = confirmLabel;
  modal.hidden = false;
  return new Promise((resolve) => {
    const done = (value) => {
      modal.hidden = true;
      yes.onclick = null;
      no.onclick = null;
      resolve(value);
    };
    yes.onclick = () => done(true);
    no.onclick = () => done(false);
  });
}

function downloadBlob(blob, name) {
  const a = document.createElement('a');
  const url = URL.createObjectURL(blob);
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2500);
}

function updateSyncBar() {
  const bar = document.getElementById('g-syncbar');
  if (!bar) return;
  const token = !!state.secrets.githubToken;
  let github;
  if (!token) github = '<span class="bad">Non sincronizzato</span> · manca il token';
  else if (state.sync.status === 'syncing') github = 'Sincronizzo…';
  else if (state.sync.status === 'error') github = `<span class="bad">Non sincronizzato</span> · ${esc(state.sync.error)}`;
  else if (state.sync.status === 'synced') github = '<span class="ok">Salvato</span>';
  else github = '<span class="bad">Non sincronizzato</span>';
  const when = state.sync.lastSyncedAt ? ` · ultimo invio ${esc(String(state.sync.lastSyncedAt).replace('T', ' ').slice(0, 16))}` : '';
  bar.innerHTML = `<div><b>Questo browser:</b> <span class="ok">salvato</span><br><b>GitHub:</b> ${github}${when}</div>
    <div class="g-actions"><button type="button" class="g-btn" data-sync>Sincronizza</button>
    <button type="button" class="g-btn" data-go-settings>Impostazioni</button></div>`;
}

function syncAddButtons() {
  const keys = new Set(state.slip.items.map((i) => i.key));
  document.querySelectorAll('.add-slip').forEach((btn) => {
    const on = keys.has(`${btn.dataset.date}|${btn.dataset.mid}`);
    btn.classList.toggle('on', on);
    btn.textContent = on ? 'IN SCHEDINA' : 'AGGIUNGI';
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
  });
}

function updateChrome() {
  const nSlip = state.slip.items.length;
  const nOpen = state.drafts.length + state.bets.filter((b) => b.status !== 'settled').length;
  const schedina = document.querySelector('.tab[data-t="schedina"]');
  const giocate = document.querySelector('.tab[data-t="giocate"]');
  if (schedina) schedina.textContent = nSlip ? `🧾 Schedina (${nSlip})` : '🧾 Schedina';
  if (giocate) giocate.textContent = nOpen ? `📒 Giocate (${nOpen})` : '📒 Giocate';
  const dock = document.getElementById('g-dock');
  if (dock) {
    const showDock = nSlip > 0 && !panelOn('schedina');
    dock.hidden = !showDock;
    document.body.classList.toggle('g-dock-on', showDock);
    const btn = dock.querySelector('[data-open]');
    if (btn) btn.textContent = `SCHEDINA · ${nSlip} ${nSlip === 1 ? 'partita' : 'partite'}`;
  }
  syncAddButtons();
}

function applyMerged(next) {
  const flags = new Map();
  for (const b of [...state.drafts, ...state.bets]) flags.set(b.id, !!b.editing);
  state.drafts = next.drafts;
  state.bets = next.bets;
  state.deletedIds = next.deletedIds;
  state.slip = next.slip;
  state.bonuses = next.bonuses || [];
  state.settings = next.settings;
  state.settingsUpdatedAt = next.settingsUpdatedAt;
  state.updatedAt = next.updatedAt;
  for (const b of [...state.drafts, ...state.bets]) if (flags.get(b.id)) b.editing = true;
  renderSlip();
  renderGiocateList();
  if (panelOn('bilancio')) renderBalanceBody();
  if (panelOn('telegram')) renderTelegramPreview();
  fillSettingsNumbers();
  updateChrome();
}

async function syncOnce(manual) {
  flushGiocateForms();
  if (!state.secrets.githubToken) {
    state.sync.status = 'local';
    if (manual) {
      state.sync.error = 'Incolla il token nelle impostazioni per sincronizzare.';
      toast('Manca il token: le giocate restano in questo browser.');
    }
    updateSyncBar();
    return;
  }
  const targetErr = validateTarget(state.target);
  if (targetErr) {
    state.sync.status = 'error';
    state.sync.error = targetErr;
    updateSyncBar();
    return;
  }
  if (state.sync.targetKey && state.sync.targetKey !== targetKey(state.target)) state.sync.sha = null;
  state.sync.status = 'syncing';
  state.sync.error = '';
  updateSyncBar();
  try {
    const result = await syncRemote(fetch, normalizeTarget(state.target), state.secrets.githubToken.trim(), state);
    flushGiocateForms();
    const merged = mergeStates(state, result.state);
    const before = meaningfulFingerprint(state);
    applyMerged(merged);
    state.sync.sha = result.sha;
    state.sync.lastSyncedAt = new Date().toISOString();
    state.sync.targetKey = targetKey(state.target);
    state.sync.error = '';
    storage();
    const after = meaningfulFingerprint(state);
    if (after !== meaningfulFingerprint(result.state)) {
      state.sync.status = 'dirty';
      scheduleSync();
    } else state.sync.status = 'synced';
    if (manual && before === after) toast('Sincronizzato.');
    else if (manual) toast(result.wrote ? 'Sincronizzato con GitHub.' : 'Aggiornato da GitHub.');
  } catch (e) {
    state.sync.status = 'error';
    state.sync.error = e.message || 'Sincronizzazione non riuscita.';
    if (manual) toast(state.sync.error);
  }
  updateSyncBar();
}

async function syncNow(opts = {}) {
  if (syncing) { syncQueued = true; return; }
  syncing = true;
  try {
    let manual = !!opts.manual;
    do {
      syncQueued = false;
      await syncOnce(manual);
      manual = false;
    } while (syncQueued);
  } finally {
    syncing = false;
  }
}

function readCard(card, bet) {
  let changed = false;
  const write = (obj, key, value) => {
    if (obj[key] !== value) { obj[key] = value; changed = true; }
  };
  const field = (root, name) => root.querySelector(`[data-f="${name}"]`);
  const stakeEl = field(card, 'stake');
  if (stakeEl) write(bet, 'stake', parseUser(stakeEl.value));
  const bookEl = field(card, 'bookmaker');
  if (bookEl) write(bet, 'bookmaker', bookEl.value);
  const commEl = field(card, 'commission');
  if (commEl) write(bet, 'commissionPct', parseUser(commEl.value));
  const totalEl = field(card, 'totalOdds');
  if (totalEl && bet.totalOddsManual) write(bet, 'totalOdds', parseUser(totalEl.value));
  const cashEl = field(card, 'cashout');
  if (cashEl) write(bet, 'cashoutAmount', parseUser(cashEl.value));
  card.querySelectorAll('[data-sel]').forEach((row) => {
    const sel = bet.selections.find((s) => s.id === row.dataset.sel);
    if (!sel) return;
    const market = field(row, 'market');
    if (market) write(sel, 'market', market.value);
    const odds = field(row, 'odds');
    if (odds) write(sel, 'odds', parseUser(odds.value));
    const score = field(row, 'score');
    if (score) write(sel, 'score', score.value);
  });
  if (!bet.totalOddsManual) {
    const prod = combinedOdds(bet.selections);
    if (prod !== bet.totalOdds) { bet.totalOdds = prod; changed = true; }
    if (totalEl && document.activeElement !== totalEl) totalEl.value = prod == null ? '' : formatOdds(prod);
  }
  if (bet.result === 'cashout') {
    if (parseUser(bet.cashoutAmount) == null) {
      if (bet.status !== 'active') { bet.status = 'active'; bet.settledAt = ''; changed = true; }
    } else if (bet.status !== 'settled') {
      bet.status = 'settled';
      bet.settledAt = new Date().toISOString();
      changed = true;
    }
  }
  if (changed) bet.updatedAt = new Date().toISOString();
  return changed;
}

function parseUser(v) {
  return parseDecimal(v);
}

function flushGiocateForms() {
  document.querySelectorAll('#g-bet-list .g-card').forEach((card) => {
    const bet = findBet(card.dataset.id);
    if (bet) readCard(card, bet);
  });
}

function refreshDerived(card, bet) {
  const prev = card.querySelector('[data-derived="preview"]');
  if (prev) {
    const win = previewWinProfit(bet);
    const risk = bet.side === 'lay' ? amountStaked(bet) : null;
    prev.textContent = `Se vinta: ${win == null ? '—' : formatSignedMoney(win)}`
      + (risk == null ? '' : ` · Responsabilità ${formatPlainMoney(risk)}`);
  }
  const prof = card.querySelector('[data-derived="profit"]');
  if (prof) {
    const p = bet.result ? profitOf(bet) : null;
    prof.textContent = p == null ? '—' : formatSignedMoney(p);
  }
}

function legHtml(bet, s, form) {
  const res = bet.status === 'draft' || bet.kind !== 'multipla' ? '' : `<div class="g-actions">
      ${selBtn(s, 'vinta', 'VINTA', 'good')}
      ${selBtn(s, 'persa', 'PERSA', 'bad')}
      ${selBtn(s, 'void', 'RIMBORSO', '')}
    </div>`;
  if (!form) {
    return `<div class="g-leg" data-sel="${esc(s.id)}">
      <div class="g-when">${esc(formatDateShort(s.date))} · ${esc(s.kickoff || '—')}</div>
      <div class="g-teams">${esc(s.home)} – ${esc(s.away)}</div>
      <div class="g-league">${esc(s.league || '')}${s.country ? ` (${esc(s.country)})` : ''}</div>
      <div class="g-line"><b>${esc((bet.side === 'lay' ? 'LAY · ' : '') + (s.market || '—'))}</b><span>quota ${s.odds == null ? '—' : esc(formatOdds(s.odds))}</span></div>
      <label>Risultato finale <input data-f="score" value="${esc(s.score || '')}" placeholder="es. 2-1"></label>
      ${res}
    </div>`;
  }
  return `<div class="g-leg" data-sel="${esc(s.id)}">
    <div class="g-when">${esc(formatDateShort(s.date))} · ${esc(s.kickoff || '—')}</div>
    <div class="g-teams">${esc(s.home)} – ${esc(s.away)}</div>
    <div class="g-league">${esc(s.league || '')}${s.country ? ` (${esc(s.country)})` : ''}</div>
    <div class="g-fields">
      <label class="g-span2">Tipo di giocata
        <input data-f="market" list="g-markets" value="${esc(s.market || '')}" placeholder="Over 1.5, 1X, Lay 0-0, BTTS…" autocomplete="off">
      </label>
      <label>Quota <input data-f="odds" inputmode="decimal" value="${esc(formatOddsInput(s.odds))}" placeholder="1,85"></label>
      ${bet.status === 'draft' ? '' : `<label>Risultato finale <input data-f="score" value="${esc(s.score || '')}" placeholder="es. 2-1"></label>`}
    </div>
    ${bet.kind === 'multipla' && bet.status === 'draft' ? `<button type="button" class="g-btn" data-act="remove-sel" data-sel-id="${esc(s.id)}">Togli partita</button>` : ''}
    ${res}
  </div>`;
}

function selBtn(s, result, label, cls) {
  return `<button type="button" class="g-btn ${cls}${s.result === result ? ' on' : ''}" data-act="sel-result" data-result="${result}" data-sel-id="${esc(s.id)}">${label}</button>`;
}

function betBtn(bet, result, label, cls) {
  return `<button type="button" class="g-btn ${cls}${bet.result === result ? ' on' : ''}" data-act="result" data-result="${result}">${label}</button>`;
}

function moneyHtml(bet, form) {
  if (!form) {
    const price = oddsForBet(bet, { settlement: false });
    const bits = [
      `${bet.kind === 'multipla' ? 'Quota totale ' : 'Quota '}${price == null ? '—' : formatOdds(price)}`,
      `Puntata ${formatPlainMoney(bet.stake)}`,
      bet.side === 'lay' ? `Responsabilità ${formatPlainMoney(amountStaked(bet))}` : '',
      bet.bookmaker || '',
      bet.commissionPct != null ? `Comm. ${numInput(bet.commissionPct)}%` : '',
    ].filter(Boolean);
    return `<div class="g-meta">${esc(bits.join(' · '))}</div>${bet.result === 'cashout' ? cashHtml(bet) : ''}`;
  }
  return `<div class="g-fields">
      ${bet.kind === 'multipla' ? `<label class="g-span2">Quota totale
        <input data-f="totalOdds" inputmode="decimal" value="${esc(formatOdds(oddsForBet(bet, { settlement: false })))}">
      </label><p class="g-hint g-span2">È il prodotto delle quote. Se la modifichi resta la tua cifra, finché non premi Ricalcola.</p>` : ''}
      <label>Puntata € <input data-f="stake" inputmode="decimal" value="${esc(numInput(bet.stake))}" placeholder="10"></label>
      <label>Bookmaker / exchange <input data-f="bookmaker" list="g-books" value="${esc(bet.bookmaker || '')}" placeholder="Bet365, Betfair, Snai…" autocomplete="off"></label>
      <label class="g-span2">Commissione exchange % (opzionale)
        <input data-f="commission" inputmode="decimal" value="${esc(numInput(bet.commissionPct))}" placeholder="es. 2">
      </label>
    </div>
    ${bet.kind === 'multipla' ? '<button type="button" class="g-btn" data-act="recalc">Ricalcola quota</button>' : ''}
    <p class="g-hint">${bet.side === 'lay'
      ? 'Lay: la puntata è quanto vinci se la selezione non esce, prima della commissione. Rischi puntata × (quota − 1). La commissione si applica solo se l\'utile è positivo.'
      : 'Se vinci, utile = puntata × (quota − 1), al netto della commissione. La commissione si applica solo sull\'utile positivo.'}</p>
    ${bet.result === 'cashout' ? cashHtml(bet) : ''}`;
}

function cashHtml(bet) {
  return `<label>Importo incassato € (torna sul conto, puntata inclusa)
    <input data-f="cashout" inputmode="decimal" value="${esc(numInput(bet.cashoutAmount))}" placeholder="15">
  </label><p class="g-hint">Utile = incasso − quanto era a rischio. Con commissione, solo se l'utile è positivo.</p>`;
}

function sideHtml(bet) {
  return `<div class="g-switch">
    <button type="button" class="g-btn${bet.side !== 'lay' ? ' on' : ''}" data-act="side-back">BACK</button>
    <button type="button" class="g-btn${bet.side === 'lay' ? ' on' : ''}" data-act="side-lay">LAY</button>
  </div>`;
}

function bannerHtml(bet) {
  if (bet.status === 'draft') return '';
  const outcome = outcomeOf(bet);
  const amount = outcome.amount == null ? '' : `<div class="a" data-derived="profit">${esc(formatSignedMoney(outcome.amount))}</div>`;
  const detail = outcome.detail ? `<div class="d">${esc(outcome.detail)}</div>` : '';
  return `<div class="g-banner ${esc(outcome.tone)}"><div class="t">${esc(outcome.title)}</div>${amount}${detail}</div>`;
}

function cardHtml(bet) {
  const form = bet.status === 'draft' || bet.editing;
  const phase = bet.status === 'draft' ? 'DA COMPLETARE' : bet.status === 'settled' ? 'CHIUSA' : 'IN CORSO';
  const kind = bet.kind === 'multipla' ? 'MULTIPLA' : 'SINGOLA';
  const issues = bet.bonusId && bet.status !== 'settled' ? bonusIssues(state, bet) : [];
  const maxStake = bet.bonusId ? maxStakeFor(state, bet) : null;
  return `<article class="g-card${bet.bonusId ? ' g-bonus-bet' : ''}" data-id="${esc(bet.id)}">
    ${bannerHtml(bet)}
    <div class="g-kicker">${phase} · ${kind} · ${bet.side === 'lay' ? 'LAY' : 'BACK'}${bet.bonusId ? ' · BONUS' : ''}</div>
    ${bet.selections.map((s) => legHtml(bet, s, form)).join('')}
    ${form ? sideHtml(bet) : ''}
    ${moneyHtml(bet, form)}
    ${maxStake != null && form ? `<p class="g-hint">Puntata massima del bonus: ${esc(formatPlainMoney(maxStake))}.</p>` : ''}
    ${issues.length ? `<div class="g-err">${issues.map((line) => esc(line)).join('<br>')}</div>` : ''}
    ${form ? `<div class="g-preview" data-derived="preview"></div><div class="g-err" data-derived="err"></div>` : ''}
    ${bet.status === 'draft' ? '' : `<div class="g-actions">
      ${betBtn(bet, 'vinta', 'VINTA', 'good')}
      ${betBtn(bet, 'persa', 'PERSA', 'bad')}
      ${betBtn(bet, 'void', 'RIMBORSO', '')}
      ${betBtn(bet, 'cashout', 'CASH OUT', 'warn')}
    </div>`}
    ${bet.kind === 'multipla' && bet.status !== 'draft' ? '<button type="button" class="g-btn" data-act="suggest">Usa esito delle selezioni</button>' : ''}
    <div class="g-actions">
      ${bet.status === 'draft'
        ? '<button type="button" class="g-btn primary" data-act="play">GIOCA</button>'
        : `<button type="button" class="g-btn" data-act="edit">${bet.editing ? 'CHIUDI MODIFICA' : 'MODIFICA'}</button>
           <button type="button" class="g-btn" data-act="post-pre">POST PREMATCH</button>
           <button type="button" class="g-btn" data-act="post-res">POST RISULTATO</button>`}
      <button type="button" class="g-btn bad" data-act="delete">ELIMINA</button>
    </div>
  </article>`;
}

function bonusCard(bonus) {
  const snap = evaluateBonus(state, bonus);
  const pct = Math.round(snap.progress * 100);
  const head = snap.status === 'completed'
    ? `<div class="g-banner win"><div class="t">BONUS COMPLETATO</div><div class="a">${esc(formatSignedMoney(snap.converted))}</div><div class="d">Il saldo è diventato soldi veri.</div></div>`
    : snap.status === 'lost'
      ? '<div class="g-banner loss"><div class="t">BONUS PERSO</div><div class="d">Saldo a zero. Il rigioco si ferma.</div></div>'
      : `<div class="g-banner open"><div class="t">BONUS IN CORSO</div><div class="d">Saldo ${esc(formatPlainMoney(snap.balance))}</div></div>`;
  const next = snap.status === 'open' && snap.available > 0
    ? `<button type="button" class="g-btn primary" data-act="bonus-next" data-bonus="${esc(bonus.id)}">APRI SCOMMESSA SUCCESSIVA</button>`
    : '';
  return `<section class="g-bonus">
    <h3>Bonus ${esc(formatPlainMoney(bonus.amount))}</h3>
    ${head}
    <p class="g-hint">Minimo ${bonus.minSelections} selezioni · quota minima ${esc(formatOdds(bonus.minOdds))} · rigioco ${esc(formatPlainMoney(snap.target))}</p>
    <div class="g-progress" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"><div style="width:${pct}%"></div></div>
    <p><b>${esc(formatPlainMoney(snap.wagered))}</b> rigiocati su ${esc(formatPlainMoney(snap.target))}. Ne restano <b>${esc(formatPlainMoney(snap.remaining))}</b>. Saldo libero <b>${esc(formatPlainMoney(snap.available))}</b>.</p>
    ${next}
    <div class="g-chain">${snap.bets.map(cardHtml).join('') || '<p class="g-empty">Nessuna giocata collegata.</p>'}</div>
  </section>`;
}

function bonusStatusOf(id) {
  if (!id) return '';
  const bonus = (state.bonuses || []).find((b) => b.id === id);
  return bonus ? evaluateBonus(state, bonus).status : '';
}

function finale(html) {
  const modal = document.getElementById('g-modal');
  const text = modal.querySelector('p');
  const yes = modal.querySelector('[data-yes]');
  const no = modal.querySelector('[data-no]');
  text.innerHTML = html;
  yes.textContent = 'HO CAPITO';
  no.hidden = true;
  modal.hidden = false;
  return new Promise((resolve) => {
    const done = () => {
      modal.hidden = true;
      no.hidden = false;
      yes.textContent = 'ELIMINA';
      text.textContent = '';
      yes.onclick = null;
      resolve();
    };
    yes.onclick = done;
  });
}

function maybeFinale(bet, wasSettled, bonusBefore) {
  const justClosed = !wasSettled && bet.status === 'settled';
  let bonusHtml = '';
  if (bet.bonusId) {
    const bonus = (state.bonuses || []).find((b) => b.id === bet.bonusId);
    const snap = bonus ? evaluateBonus(state, bonus) : null;
    if (snap && bonusBefore === 'open' && snap.status === 'completed') {
      bonusHtml = `<div class="g-banner win"><div class="t">BONUS COMPLETATO</div><div class="a">${esc(formatSignedMoney(snap.converted))}</div><div class="d">Questo saldo diventa soldi veri.</div></div>`;
    } else if (snap && bonusBefore === 'open' && snap.status === 'lost') {
      bonusHtml = '<div class="g-banner loss"><div class="t">BONUS PERSO</div><div class="d">Il saldo del bonus è arrivato a zero.</div></div>';
    }
  }
  if (!justClosed && !bonusHtml) return;
  const outcome = outcomeOf(bet);
  const amount = outcome.amount == null ? '' : `<div class="a">${esc(formatSignedMoney(outcome.amount))}</div>`;
  const detail = outcome.detail ? `<div class="d">${esc(outcome.detail)}</div>` : '';
  finale(`<div class="g-banner ${esc(outcome.tone)}"><div class="t">${esc(outcome.title)}</div>${amount}${detail}</div>${bonusHtml}`);
}

function visibleBets() {
  const byKick = (a, b) => betDate(a).localeCompare(betDate(b)) || betKickoff(a).localeCompare(betKickoff(b));
  const own = (list) => list.filter((b) => !b.bonusId);
  const drafts = own(state.drafts).sort(byKick);
  const active = own(state.bets).filter((b) => b.status !== 'settled').sort(byKick);
  const closed = own(state.bets).filter((b) => b.status === 'settled').sort((a, b) => betDate(b).localeCompare(betDate(a)) || betKickoff(b).localeCompare(betKickoff(a)));
  if (ui.filter === 'bozze') return drafts;
  if (ui.filter === 'corso') return active;
  if (ui.filter === 'chiuse') return closed;
  return [...drafts, ...active, ...closed];
}

function renderGiocateList() {
  const list = document.getElementById('g-bet-list');
  if (!list) return;
  const y = window.scrollY;
  const bets = visibleBets();
  const empty = {
    tutte: 'Nessuna giocata. Aggiungi le partite dalla lista e premi INVIA.',
    bozze: 'Nessuna giocata da completare.',
    corso: 'Nessuna giocata in corso.',
    chiuse: 'Nessuna giocata chiusa.',
  }[ui.filter];
  const bonuses = (state.bonuses || []).map(bonusCard).join('');
  const body = bets.length ? bets.map(cardHtml).join('') : ((state.bonuses || []).length ? '' : `<div class="g-empty">${empty}</div>`);
  list.innerHTML = bonuses + body;
  list.querySelectorAll('.g-card').forEach((card) => {
    const bet = findBet(card.dataset.id);
    if (bet) refreshDerived(card, bet);
  });
  document.querySelectorAll('#p-giocate [data-filter]').forEach((b) => b.classList.toggle('on', b.dataset.filter === ui.filter));
  window.scrollTo(0, y);
}

function ensureGiocate() {
  const panel = document.getElementById('p-giocate');
  if (panel.dataset.ready) return;
  panel.dataset.ready = '1';
  panel.innerHTML = `<h2>Giocate</h2>
    <p class="g-lead">Compila tipo di giocata, quota e puntata, poi premi GIOCA. Quando tutte le selezioni hanno un esito, compare FINITA. Una selezione persa chiude subito la multipla. Il bonus con rigioco sta nelle schede gialle, separato dai soldi veri.</p>
    <div class="g-chips">
      <button type="button" class="g-btn g-chip" data-filter="tutte">Tutte</button>
      <button type="button" class="g-btn g-chip" data-filter="bozze">Da completare</button>
      <button type="button" class="g-btn g-chip" data-filter="corso">In corso</button>
      <button type="button" class="g-btn g-chip" data-filter="chiuse">Chiuse</button>
    </div>
    <div id="g-bet-list"></div>
    <datalist id="g-markets">${MARKETS.map((m) => `<option value="${esc(m)}"></option>`).join('')}</datalist>
    <datalist id="g-books">${BOOKS.map((m) => `<option value="${esc(m)}"></option>`).join('')}</datalist>`;
  panel.addEventListener('click', onGiocateClick);
  panel.addEventListener('input', (e) => {
    const card = e.target.closest('.g-card');
    if (!card) return;
    const bet = findBet(card.dataset.id);
    if (!bet) return;
    if (e.target.dataset.f === 'totalOdds') bet.totalOddsManual = true;
    const wasSettled = bet.status === 'settled';
    const bonusBefore = bonusStatusOf(bet.bonusId);
    const changed = readCard(card, bet);
    refreshDerived(card, bet);
    if (!wasSettled && bet.status === 'settled') maybeFinale(bet, wasSettled, bonusBefore);
    if (changed) persistDirty();
  });
  panel.addEventListener('focusout', () => {
    setTimeout(() => {
      if (panelOn('bilancio')) renderBalanceBody();
      if (panelOn('telegram')) renderTelegramPreview();
    }, 0);
  });
}

function onGiocateClick(e) {
  const filter = e.target.closest('[data-filter]');
  if (filter) {
    flushGiocateForms();
    ui.filter = filter.dataset.filter;
    renderGiocateList();
    return;
  }
  const act = e.target.closest('[data-act]');
  if (!act) return;
  if (act.dataset.act === 'bonus-next') {
    state.slip.bonusId = act.dataset.bonus;
    state.slip.mode = 'bonus';
    state.slip.updatedAt = new Date().toISOString();
    persistDirty();
    applyTab('schedina');
    toast('Aggiungi le partite della prossima giocata e premi INVIA. La puntata sarà il saldo bonus.');
    return;
  }
  flushGiocateForms();
  const card = act.closest('.g-card');
  if (!card) return;
  const bet = findBet(card.dataset.id);
  if (!bet) return;
  readCard(card, bet);
  const action = act.dataset.act;
  if (action === 'play') {
    const res = playDraft(state, bet.id);
    const err = card.querySelector('[data-derived="err"]');
    if (!res.ok) {
      if (err) err.textContent = res.message;
      persistDirty();
      return;
    }
    toast('Giocata registrata. A risultato pronto segna vinta, persa, rimborso o cash out.');
    afterStructural();
    return;
  }
  if (action === 'delete') {
    ask('Eliminare questa giocata? Non viene mai cancellata da sola: solo tu puoi toglierla. Alla sincronizzazione sparisce anche dal file su GitHub.').then((yes) => {
      if (!yes) return;
      deleteEverywhere(state, bet.id);
      afterStructural();
      toast('Giocata eliminata.');
    });
    return;
  }
  if (action === 'edit') {
    bet.editing = !bet.editing;
    renderGiocateList();
    return;
  }
  if (action === 'result') {
    const wasSettled = bet.status === 'settled';
    const bonusBefore = bonusStatusOf(bet.bonusId);
    const res = setBetResult(bet, act.dataset.result);
    if (res && res.message && !res.ok) toast(res.message);
    maybeFinale(bet, wasSettled, bonusBefore);
    afterStructural();
    return;
  }
  if (action === 'sel-result') {
    const wasSettled = bet.status === 'settled';
    const bonusBefore = bonusStatusOf(bet.bonusId);
    setSelectionResult(bet, act.dataset.selId, act.dataset.result);
    maybeFinale(bet, wasSettled, bonusBefore);
    afterStructural();
    return;
  }
  if (action === 'suggest') {
    const wasSettled = bet.status === 'settled';
    const bonusBefore = bonusStatusOf(bet.bonusId);
    applySuggestedResult(bet);
    maybeFinale(bet, wasSettled, bonusBefore);
    afterStructural();
    return;
  }
  if (action === 'recalc') {
    bet.totalOddsManual = false;
    bet.totalOdds = combinedOdds(bet.selections);
    bet.updatedAt = new Date().toISOString();
    afterStructural();
    return;
  }
  if (action === 'remove-sel') {
    removeSelection(state, bet, act.dataset.selId);
    afterStructural();
    return;
  }
  if (action === 'side-back' || action === 'side-lay') {
    bet.side = action === 'side-lay' ? 'lay' : 'back';
    bet.updatedAt = new Date().toISOString();
    afterStructural();
    return;
  }
  if (action === 'post-pre' || action === 'post-res') openPost(bet.id, action === 'post-pre' ? 'prematch' : 'risultati');
}

function afterStructural() {
  persistDirty();
  renderGiocateList();
  renderSlip();
  if (panelOn('bilancio')) renderBalanceBody();
  if (panelOn('telegram')) renderTelegramPreview();
}

function bonusTargetLabel() {
  const draft = normalizeBonusDraft(state.slip.bonusDraft);
  if (draft.amount == null) return 'Rigioco richiesto: inserisci prima l\'importo del bonus.';
  const target = wagerTargetOf(draft);
  const how = draft.wagerMode === 'amount' ? 'importo fisso' : `${formatOdds(draft.wagerMultiplier)}× il bonus`;
  return `Rigioco richiesto: ${formatPlainMoney(target)} (${how}).`;
}

function readBonusForm(root) {
  const form = root.querySelector('[data-bonus-form]');
  if (!form) return;
  const draft = state.slip.bonusDraft;
  draft.amount = parseDecimal(form.querySelector('[data-f="b-amount"]').value);
  draft.minSelections = parseDecimal(form.querySelector('[data-f="b-min"]').value);
  draft.minOdds = parseDecimal(form.querySelector('[data-f="b-odds"]').value);
  draft.wagerMultiplier = parseDecimal(form.querySelector('[data-f="b-mult"]').value);
  draft.wagerAmount = parseDecimal(form.querySelector('[data-f="b-wager"]').value);
  const mode = form.querySelector('[data-f="b-mode"]:checked');
  draft.wagerMode = mode && mode.value === 'amount' ? 'amount' : 'multiplier';
  state.slip.bonusDraft = normalizeBonusDraft(draft);
  if (form.querySelector('[data-f="b-amount"]').value.trim() === '') state.slip.bonusDraft.amount = null;
}

function renderSlip() {
  const el = document.getElementById('p-schedina');
  if (!el) return;
  const items = state.slip.items;
  const mode = state.slip.mode === 'multipla' || state.slip.mode === 'bonus' ? state.slip.mode : 'singole';
  const draft = normalizeBonusDraft(state.slip.bonusDraft);
  const linked = state.slip.bonusId ? (state.bonuses || []).find((b) => b.id === state.slip.bonusId) : null;
  const linkedSnap = linked ? evaluateBonus(state, linked) : null;
  const bonusBox = mode !== 'bonus' ? '' : linked ? `<div class="g-warn">Prossima giocata del bonus da ${esc(formatPlainMoney(linked.amount))}. Saldo libero <b>${esc(formatPlainMoney(linkedSnap.available))}</b>. Minimo ${linked.minSelections} partite, quota minima ${esc(formatOdds(linked.minOdds))}. INVIA precompila la puntata con il saldo.</div>` : `<div class="g-fields" data-bonus-form>
      <label>Importo bonus € <input data-f="b-amount" inputmode="decimal" value="${esc(draft.amount == null ? '' : numInput(draft.amount))}" placeholder="50"></label>
      <label>Minimo selezioni <input data-f="b-min" inputmode="numeric" value="${esc(String(draft.minSelections))}"></label>
      <label>Quota minima per selezione <input data-f="b-odds" inputmode="decimal" value="${esc(numInput(draft.minOdds))}"></label>
      <label class="g-check"><input type="radio" name="b-mode" data-f="b-mode" value="multiplier" ${draft.wagerMode !== 'amount' ? 'checked' : ''}> Rigioco in moltiplicatore</label>
      <label>Moltiplicatore <input data-f="b-mult" inputmode="decimal" value="${esc(numInput(draft.wagerMultiplier))}" placeholder="3"></label>
      <label class="g-check"><input type="radio" name="b-mode" data-f="b-mode" value="amount" ${draft.wagerMode === 'amount' ? 'checked' : ''}> Rigioco in euro</label>
      <label>Rigioco fisso € <input data-f="b-wager" inputmode="decimal" value="${esc(draft.wagerAmount == null ? '' : numInput(draft.wagerAmount))}" placeholder="150"></label>
    </div><p class="g-hint" data-bonus-target>${esc(bonusTargetLabel())}</p>`;
  el.innerHTML = `<h2>Schedina</h2>
    <p class="g-lead">SINGOLE: una giocata per partita. MULTIPLA: tutte insieme. BONUS: una multipla col saldo bonus e le condizioni di rigioco.</p>
    <div class="g-switch">
      <button type="button" class="g-btn${mode === 'singole' ? ' on' : ''}" data-mode="singole">SINGOLE</button>
      <button type="button" class="g-btn${mode === 'multipla' ? ' on' : ''}" data-mode="multipla">MULTIPLA</button>
      <button type="button" class="g-btn${mode === 'bonus' ? ' on' : ''}" data-mode="bonus">BONUS</button>
    </div>
    ${bonusBox}
    ${items.length ? items.map((item) => `<article class="g-card">
        <div class="g-when">${esc(formatDateShort(item.date))} · ${esc(item.kickoff || '—')}</div>
        <div class="g-teams">${esc(item.home)} – ${esc(item.away)}</div>
        <div class="g-league">${esc(item.league || '')}${item.country ? ` (${esc(item.country)})` : ''}</div>
        <button type="button" class="g-btn" data-remove="${esc(item.key)}">TOGLI</button>
      </article>`).join('') : '<div class="g-empty">Nessuna partita. Apri Partite del giorno e premi AGGIUNGI.</div>'}
    <button type="button" class="g-btn primary" data-invia ${items.length ? '' : 'disabled'}>INVIA</button>`;
  el.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => {
    if (b.closest('[data-bonus-form]')) return;
    readBonusForm(el);
    state.slip.mode = b.dataset.mode;
    if (b.dataset.mode !== 'bonus') state.slip.bonusId = '';
    state.slip.updatedAt = new Date().toISOString();
    state.updatedAt = state.slip.updatedAt;
    persistDirty();
    renderSlip();
  }));
  if (!el.dataset.bonusBound) {
    el.dataset.bonusBound = '1';
    const onBonusEdit = (e) => {
      if (!e.target.closest('[data-bonus-form]')) return;
      readBonusForm(el);
      const hint = el.querySelector('[data-bonus-target]');
      if (hint) hint.textContent = bonusTargetLabel();
      persistDirty();
    };
    el.addEventListener('input', onBonusEdit);
    el.addEventListener('change', onBonusEdit);
  }
  el.querySelectorAll('[data-remove]').forEach((b) => b.addEventListener('click', () => {
    const item = state.slip.items.find((x) => x.key === b.dataset.remove);
    if (item) toggleSlipItem(state, item);
    persistDirty();
    renderSlip();
  }));
  const send = el.querySelector('[data-invia]');
  if (send) send.addEventListener('click', () => {
    readBonusForm(el);
    const modeNow = state.slip.mode;
    const n = state.slip.items.length;
    if (!n) return;
    const created = sendSlip(state);
    if (!created.length) {
      toast(state.slip.notice || 'Controlla la schedina.');
      renderSlip();
      return;
    }
    persistDirty();
    renderSlip();
    applyTab('giocate');
    const msg = modeNow === 'bonus' ? 'Bonus inviato in Giocate. Compila le quote e premi GIOCA.'
      : modeNow === 'multipla' ? 'Multipla inviata in Giocate.'
        : `${n} ${n === 1 ? 'giocata inviata' : 'giocate inviate'}. Compila e premi GIOCA.`;
    toast(msg);
  });
}

function dropCharts() {
  while (charts.length) {
    try { charts.pop().destroy(); } catch { /* grafico già chiuso */ }
  }
}

function ensureBalance() {
  const panel = document.getElementById('p-bilancio');
  if (panel.dataset.ready) return;
  panel.dataset.ready = '1';
  panel.innerHTML = `<h2>Bilancio</h2>
    <p class="g-lead">Yield = utile ÷ puntato. ROI = utile ÷ bankroll iniziale, se lo hai impostato; altrimenti coincide con la yield. Lo strike rate esclude i rimborsi. Il cash out positivo conta come vinta, quello negativo come persa.</p>
    <div class="g-chips" id="g-views">
      <button type="button" class="g-btn g-chip" data-view="oggi">Oggi</button>
      <button type="button" class="g-btn g-chip" data-view="settimana">Settimana</button>
      <button type="button" class="g-btn g-chip" data-view="mese">Mese</button>
      <button type="button" class="g-btn g-chip" data-view="tutto">Totale</button>
      <button type="button" class="g-btn g-chip" data-view="intervallo">Intervallo</button>
    </div>
    <div class="g-fields" id="g-range" hidden>
      <label>Dal <input type="date" id="g-from"></label>
      <label>Al <input type="date" id="g-to"></label>
    </div>
    <div class="g-actions"><button type="button" class="g-btn" id="g-csv">Esporta CSV</button></div>
    <div id="g-balance-body"></div>`;
  panel.querySelectorAll('[data-view]').forEach((b) => b.addEventListener('click', () => {
    ui.view = b.dataset.view;
    document.getElementById('g-range').hidden = ui.view !== 'intervallo';
    renderBalanceBody();
  }));
  panel.querySelector('#g-from').addEventListener('change', (e) => { ui.from = e.target.value; renderBalanceBody(); });
  panel.querySelector('#g-to').addEventListener('change', (e) => { ui.to = e.target.value; renderBalanceBody(); });
  panel.querySelector('#g-csv').addEventListener('click', () => {
    const report = currentReport();
    downloadBlob(new Blob([toCsv(report.rows)], { type: 'text/csv;charset=utf-8' }), `bilancio-${romeToday()}.csv`);
  });
}

function currentReport() {
  return analyze(state, { view: ui.view, today: romeToday(), from: ui.from, to: ui.to });
}

function kpi(label, value, sub, cls) {
  return `<div class="g-kpi"><div class="l">${esc(label)}</div><div class="v ${cls || ''}">${value}</div>${sub ? `<div class="s">${sub}</div>` : ''}</div>`;
}

function moneyCls(n) { return n > 0 ? 'pos' : n < 0 ? 'neg' : ''; }

function streakLabel(s) {
  if (!s || s.type === 'none' || !s.length) return '—';
  return `${s.length} ${s.type === 'win' ? 'vinte' : 'perse'}`;
}

function breakdown(title, rows) {
  if (!rows.length) return '';
  const body = rows.map((r) => `<tr>
      <td>${esc(r.label)}</td><td>${r.bets}</td><td>${r.wins}/${r.losses}/${r.voids}${r.cashouts ? ` · C${r.cashouts}` : ''}</td>
      <td>${esc(formatPlainMoney(r.staked))}</td>
      <td class="${moneyCls(r.profit)}">${esc(formatSignedMoney(r.profit))}</td>
      <td>${esc(formatPct(r.yield))}</td></tr>`).join('');
  return `<section><h3>${esc(title)}</h3><div class="g-table-wrap"><table class="g-table"><thead><tr>
      <th>Voce</th><th>N</th><th>V/P/R</th><th>Puntato</th><th>Utile</th><th>Yield</th>
    </tr></thead><tbody>${body}</tbody></table></div></section>`;
}

function renderBalanceBody() {
  const body = document.getElementById('g-balance-body');
  if (!body) return;
  dropCharts();
  document.querySelectorAll('#g-views [data-view]').forEach((b) => b.classList.toggle('on', b.dataset.view === ui.view));
  const report = currentReport();
  const k = report.kpis;
  const periodName = { day: 'Utile per giorno', week: 'Utile per settimana', month: 'Utile per mese' }[report.granularity];
  const range = !report.from && !report.to
    ? 'Tutto lo storico'
    : `${report.from ? formatDateShort(report.from) : '…'} – ${report.to ? formatDateShort(report.to) : '…'}`;
  const detail = report.rows.map((r) => `<tr>
      <td>${esc(r.Data)} ${esc(r.Orario)}</td>
      <td>${esc(r.Partite)}</td>
      <td>${esc(r.Mercato)}</td>
      <td>${esc(r.Quota)}</td>
      <td>${esc(r.Esito)}</td>
      <td class="${String(r.Utile).startsWith('-') ? 'neg' : 'pos'}">${esc(String(r.Utile).replace('.', ','))} €</td>
    </tr>`).join('');
  body.innerHTML = `<p class="g-hint">${esc(range)}${k.startingBankroll ? ` · bankroll iniziale ${esc(formatPlainMoney(k.startingBankroll))}` : ''}</p>
    <div class="g-kpis">
      ${kpi('Utile soldi veri', esc(formatSignedMoney(k.profit)), k.bonusConverted ? `di cui ${esc(formatPlainMoney(k.bonusConverted))} da bonus completati` : 'senza le giocate bonus', moneyCls(k.profit))}
      ${kpi('Puntato', esc(formatPlainMoney(k.staked)), 'rimborsi esclusi')}
      ${kpi('Yield', esc(formatPct(k.yield)))}
      ${kpi('ROI', esc(formatPct(k.roi)), k.startingBankroll ? 'sul bankroll' : 'come la yield')}
      ${kpi('Strike rate', esc(formatPct(k.strike, false)), `${k.wins} V · ${k.losses} P · ${k.voids} R`)}
      ${kpi('Giocate', String(k.bets), k.cashouts ? `${k.cashouts} cash out` : 'chiuse nel periodo')}
      ${kpi('Quota media', k.avgOdds == null ? '—' : esc(formatOdds(k.avgOdds)), k.avgOddsWeighted == null ? '' : `ponderata ${esc(formatOdds(k.avgOddsWeighted))}`)}
      ${kpi('Puntata media', k.avgStake == null ? '—' : esc(formatPlainMoney(k.avgStake)), 'importo a rischio')}
      ${kpi('Miglior vincita', k.biggestWin ? esc(formatSignedMoney(k.biggestWin.profit)) : '—', k.biggestWin ? esc(k.biggestWin.label) : '', 'pos')}
      ${kpi('Peggior perdita', k.biggestLoss ? esc(formatSignedMoney(k.biggestLoss.profit)) : '—', k.biggestLoss ? esc(k.biggestLoss.label) : '', 'neg')}
      ${kpi('Serie attuale', esc(streakLabel(k.current)), `record vinte ${k.longestWin} · perse ${k.longestLoss}`)}
      ${kpi('In corso', String(k.openBets), `a rischio ${esc(formatPlainMoney(k.openStaked))}`)}
    </div>
    ${(state.bonuses || []).length ? `<h3>Bonus e soldi veri</h3><div class="g-kpis">
      ${kpi('Convertito dai bonus', esc(formatSignedMoney(k.bonusConverted)), 'entra nell\'utile vero', moneyCls(k.bonusConverted))}
      ${kpi('Utile giocate bonus', esc(formatSignedMoney(k.bonusProfit)), 'non è denaro proprio', moneyCls(k.bonusProfit))}
      ${kpi('Saldo bonus in corso', esc(formatPlainMoney(k.bonusOpenBalance)), `${k.bonusOpen} aperti · ${k.bonusCompleted} completati · ${k.bonusLost} persi`)}
    </div><p class="g-hint">Le giocate bonus non entrano nel puntato né nello strike dei soldi veri. A rigioco finito, il saldo che resta diventa utile vero. Se il saldo va a zero, il bonus è perso e i soldi veri non cambiano.</p>` : ''}
    ${report.incomplete ? `<p class="g-hint">${report.incomplete} giocate senza quota o puntata: escluse dall'utile.</p>` : ''}
    ${k.bets ? `<div class="g-charts two">
      <div class="g-chart"><h3>Curva bankroll</h3><canvas id="g-equity"></canvas></div>
      <div class="g-chart"><h3>${esc(periodName)}</h3><canvas id="g-bars"></canvas></div>
    </div>` : '<div class="g-empty">Nessuna giocata chiusa in questo periodo. Quando segni l\'esito, i numeri e i grafici compaiono qui.</div>'}
    ${breakdown('Singola / multipla', report.byKind)}
    ${breakdown('Tipo di giocata', report.byMarket)}
    ${breakdown('Bookmaker', report.byBook)}
    ${breakdown('Fascia di quota', report.byOdds)}
    ${breakdown('Campionato', report.byLeague)}
    ${report.rows.length ? `<h3>Dettaglio</h3><div class="g-table-wrap"><table class="g-table"><thead><tr>
      <th>Quando</th><th>Partita</th><th>Giocata</th><th>Quota</th><th>Esito</th><th>Utile</th>
    </tr></thead><tbody>${detail}</tbody></table></div>` : ''}`;
  if (k.bets) drawCharts(report);
}

function drawCharts(report) {
  const start = async () => {
    let ChartLib;
    try { ChartLib = await loadChartJs(); }
    catch {
      const note = document.createElement('p');
      note.className = 'g-hint';
      note.textContent = 'Grafici non disponibili: Chart.js non si è caricato. I numeri restano validi.';
      document.getElementById('g-balance-body')?.prepend(note);
      return;
    }
    if (!panelOn('bilancio')) return;
    ChartLib.defaults.color = '#d6d6d6';
    ChartLib.defaults.borderColor = '#2a2a2a';
    ChartLib.defaults.font.size = 14;
    const equity = document.getElementById('g-equity');
    const bars = document.getElementById('g-bars');
    if (!equity || !bars) return;
    const bank = state.settings.startingBankroll;
    charts.push(new ChartLib(equity, {
      type: 'line',
      data: {
        labels: report.equity.map((p) => p.label),
        datasets: [{
          label: bank ? 'Bankroll' : 'Utile cumulato',
          data: report.equity.map((p) => bank ? p.value : p.profit),
          borderColor: '#22c55e',
          backgroundColor: 'rgba(34,197,94,.16)',
          fill: true,
          tension: 0.25,
          pointRadius: 3,
          pointBackgroundColor: '#22c55e',
        }],
      },
      options: chartOptions(),
    }));
    charts.push(new ChartLib(bars, {
      type: 'bar',
      data: {
        labels: report.byPeriod.map((p) => p.label),
        datasets: [{
          label: 'Utile',
          data: report.byPeriod.map((p) => p.profit),
          backgroundColor: report.byPeriod.map((p) => (p.profit >= 0 ? '#22c55e' : '#ef4444')),
        }],
      },
      options: chartOptions(),
    }));
  };
  start();
}

function chartOptions() {
  const grid = { color: '#262626' };
  const ticks = { color: '#d0d0d0' };
  return {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { labels: { color: '#eee' } } },
    scales: { x: { ticks, grid }, y: { ticks, grid } },
  };
}

let chartJsPromise;
function loadChartJs() {
  if (window.Chart) return Promise.resolve(window.Chart);
  chartJsPromise ||= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/chart.js@4.4.6/dist/chart.umd.min.js';
    s.onload = () => resolve(window.Chart);
    s.onerror = () => reject(new Error('chart'));
    document.head.appendChild(s);
  });
  return chartJsPromise;
}

function allTracked() {
  return [...state.drafts, ...state.bets];
}

function ensureTelegram() {
  const panel = document.getElementById('p-telegram');
  if (panel.dataset.ready) return;
  panel.dataset.ready = '1';
  panel.innerHTML = `<h2>Posta su Telegram</h2>
    <p class="g-lead">Due versioni con lo stesso stile: PREMATCH prima delle partite e RISULTATI dopo, con il cartellino vinta o persa. Scarica il JPG, copia il testo oppure, dal telefono, condividilo direttamente.</p>
    <div class="g-fields">
      <label>Versione
        <select id="g-tg-mode">
          <option value="prematch">PREMATCH</option>
          <option value="risultati">RISULTATI</option>
        </select>
      </label>
      <label>Cosa pubblicare
        <select id="g-tg-scope">
          <option value="day">Tutte le giocate di un giorno</option>
          <option value="bet">Una sola giocata</option>
        </select>
      </label>
      <label id="g-tg-date-wrap">Giorno <input type="date" id="g-tg-date"></label>
      <label id="g-tg-bet-wrap">Giocata <select id="g-tg-bet"></select></label>
      <label class="g-check"><input type="checkbox" id="g-tg-stake"> Includi la puntata</label>
    </div>
    <div class="g-actions">
      <button type="button" class="g-btn primary" id="g-jpg">Scarica JPG</button>
      <button type="button" class="g-btn" id="g-copy">Copia testo</button>
      <button type="button" class="g-btn" id="g-share">Condividi</button>
      <button type="button" class="g-btn" id="g-channel">INVIA AL CANALE</button>
    </div>
    <p class="g-hint">Condividi usa il foglio del telefono: se c'è Telegram, puoi mandare immagine e testo insieme. La didascalia del canale arriva al massimo a 1024 caratteri.</p>
    <p id="g-tg-msg" class="g-hint"></p>
    <img id="g-tg-img" alt="Anteprima del post">
    <label>Testo pronto da incollare <textarea id="g-tg-text" readonly></textarea></label>`;
  const mode = panel.querySelector('#g-tg-mode');
  const scope = panel.querySelector('#g-tg-scope');
  const date = panel.querySelector('#g-tg-date');
  const stake = panel.querySelector('#g-tg-stake');
  mode.value = ui.tgMode;
  scope.value = ui.tgScope;
  date.value = ui.tgDate;
  stake.checked = !!state.settings.showStakeOnImage;
  mode.addEventListener('change', () => { ui.tgMode = mode.value; renderTelegramPreview(); });
  scope.addEventListener('change', () => { ui.tgScope = scope.value; renderTelegramPreview(); });
  date.addEventListener('change', () => { ui.tgDate = date.value; renderTelegramPreview(); });
  panel.querySelector('#g-tg-bet').addEventListener('change', (e) => { ui.tgBetId = e.target.value; renderTelegramPreview(); });
  stake.addEventListener('change', () => {
    state.settings.showStakeOnImage = stake.checked;
    state.settingsUpdatedAt = new Date().toISOString();
    persistDirty();
    renderTelegramPreview();
  });
  panel.querySelector('#g-jpg').addEventListener('click', () => {
    if (lastBlob) downloadBlob(lastBlob, lastName);
  });
  panel.querySelector('#g-copy').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(lastText);
      toast('Testo copiato.');
    } catch {
      const area = document.getElementById('g-tg-text');
      area.focus();
      area.select();
      toast('Seleziona il testo e copialo.');
    }
  });
  panel.querySelector('#g-share').addEventListener('click', shareCurrent);
  panel.querySelector('#g-channel').addEventListener('click', sendChannel);
}

function selectedPostBets() {
  if (ui.tgScope === 'bet') {
    const bet = allTracked().find((b) => b.id === ui.tgBetId);
    return bet ? [bet] : [];
  }
  return sortForPost(allTracked().filter((b) => betDate(b) === ui.tgDate));
}

function fillBetSelect() {
  const sel = document.getElementById('g-tg-bet');
  if (!sel) return;
  const list = sortForPost(allTracked());
  const prev = ui.tgBetId;
  sel.innerHTML = list.map((b) => `<option value="${esc(b.id)}">${esc(formatDateShort(betDate(b)))} ${esc(betKickoff(b))} ${esc(matchLabel(b))}</option>`).join('');
  if (prev && list.some((b) => b.id === prev)) sel.value = prev;
  else ui.tgBetId = sel.value || '';
  const dateWrap = document.getElementById('g-tg-date-wrap');
  const betWrap = document.getElementById('g-tg-bet-wrap');
  if (dateWrap) dateWrap.hidden = ui.tgScope !== 'day';
  if (betWrap) betWrap.hidden = ui.tgScope !== 'bet';
}

async function ensureFonts() {
  if (!document.fonts) return;
  try {
    await Promise.race([
      Promise.all([
        document.fonts.load('700 72px Oswald'),
        document.fonts.load('600 32px "Source Sans 3"'),
      ]),
      new Promise((resolve) => setTimeout(resolve, 1800)),
    ]);
  } catch { /* restano i font di sistema */ }
}

let previewToken = 0;
async function renderTelegramPreview() {
  if (!document.getElementById('g-tg-text')) return;
  fillBetSelect();
  const msg = document.getElementById('g-tg-msg');
  const bets = selectedPostBets();
  const token = ++previewToken;
  if (!bets.length) {
    lastBlob = null;
    lastText = '';
    document.getElementById('g-tg-text').value = '';
    document.getElementById('g-tg-img').removeAttribute('src');
    msg.textContent = 'Nessuna giocata per questa scelta.';
    return;
  }
  const date = ui.tgScope === 'day' ? ui.tgDate : betDate(bets[0]);
  const post = buildPost(bets, {
    mode: ui.tgMode,
    showStake: !!state.settings.showStakeOnImage,
    scope: ui.tgScope,
    dateLabel: formatDateIT(date),
  });
  lastText = post.text;
  document.getElementById('g-tg-text').value = post.text;
  await ensureFonts();
  if (token !== previewToken) return;
  const canvas = document.createElement('canvas');
  drawTicket(canvas, post.model);
  const blob = await canvasToJpeg(canvas);
  if (token !== previewToken) return;
  lastBlob = blob;
  lastName = `${ui.tgMode}-${date || 'giocata'}.jpg`;
  const img = document.getElementById('g-tg-img');
  if (img.dataset.url) URL.revokeObjectURL(img.dataset.url);
  const url = URL.createObjectURL(blob);
  img.dataset.url = url;
  img.src = url;
  msg.textContent = post.text.length > 1024 ? 'Il testo completo è qui sotto. Sul canale la didascalia viene accorciata a 1024 caratteri.' : '';
}

function openPost(betId, mode) {
  ui.tgScope = 'bet';
  ui.tgBetId = betId;
  ui.tgMode = mode;
  applyTab('telegram');
  const modeEl = document.getElementById('g-tg-mode');
  const scopeEl = document.getElementById('g-tg-scope');
  if (modeEl) modeEl.value = mode;
  if (scopeEl) scopeEl.value = 'bet';
  renderTelegramPreview();
}

async function shareCurrent() {
  if (!lastBlob) { toast('Prima genera un post.'); return; }
  const file = new File([lastBlob], lastName, { type: 'image/jpeg' });
  try {
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], text: lastText, title: 'Giocate' });
      return;
    }
    if (navigator.share) {
      await navigator.share({ text: lastText, title: 'Giocate' });
      toast('Condiviso il testo. Questo browser non invia l\'immagine: scarica il JPG.');
      return;
    }
  } catch (e) {
    if (e && e.name === 'AbortError') return;
  }
  toast('Condivisione non disponibile. Scarica il JPG e copia il testo.');
}

async function sendChannel() {
  const msg = document.getElementById('g-tg-msg');
  if (!lastBlob) { msg.textContent = 'Nessuna immagine da inviare.'; return; }
  try {
    await sendTelegramPhoto(fetch, {
      token: state.secrets.telegramBotToken,
      chatId: state.secrets.telegramChatId,
      blob: lastBlob,
      caption: lastText,
    });
    msg.textContent = 'Inviato al canale.';
    toast('Inviato al canale.');
  } catch (e) {
    msg.textContent = e.message || 'Invio non riuscito.';
  }
}

function ensureSettings() {
  const panel = document.getElementById('p-impostazioni');
  if (panel.dataset.ready) {
    fillSettingsNumbers();
    return;
  }
  panel.dataset.ready = '1';
  panel.innerHTML = `<h2>Impostazioni</h2>
    <div class="g-warn"><b>Privacy.</b> Il repository predefinito edbass1/segnali è pubblico: chiunque può leggere il file delle giocate. Per tenerle private crea un repository privato e scrivi qui owner, nome e percorso.</div>
    <div class="g-help"><b>Come creare il token GitHub</b>
      <ol>
        <li>Apri GitHub → Settings → Developer settings → Personal access tokens → Fine-grained tokens.</li>
        <li>Generate new token. Dai un nome, per esempio «Segnali giocate».</li>
        <li>Repository access: Only select repositories, e scegli solo il repository dove salvare le giocate.</li>
        <li>Permissions → Repository permissions → Contents: Read and write. Il resto può restare su No access.</li>
        <li>Genera il token e incollalo qui. Resta solo in questo browser (localStorage): non finisce nel codice del sito e non viene scritto nel file delle giocate.</li>
      </ol>
      <p>Il token va incollato su ogni dispositivo: telefono e computer non condividono la memoria. Se due dispositivi salvano insieme, le giocate si uniscono. Niente viene cancellato da solo: una giocata sparisce solo se premi Elimina.</p>
    </div>
    <div class="g-fields">
      <label class="g-span2">Token GitHub <input id="g-token" type="password" autocomplete="new-password" spellcheck="false" placeholder="github_pat_…"></label>
      <label>Owner <input id="g-owner" autocomplete="off" spellcheck="false"></label>
      <label>Repository <input id="g-repo" autocomplete="off" spellcheck="false"></label>
      <label>Percorso file <input id="g-path" autocomplete="off" spellcheck="false"></label>
      <label>Branch <input id="g-branch" autocomplete="off" spellcheck="false"></label>
    </div>
    <div class="g-actions">
      <button type="button" class="g-btn" id="g-show-token">Mostra token</button>
      <button type="button" class="g-btn primary" id="g-sync">Sincronizza</button>
    </div>
    <h3>Telegram, invio al canale</h3>
    <p class="g-hint">Opzionale. Crea un bot con BotFather, aggiungilo come amministratore del canale e incolla token e chat id (per un canale è un numero, spesso -100…). L'invio diretto dal browser può essere bloccato da Telegram: in quel caso usa Condividi oppure scarica il JPG. Anche questi dati restano solo in questo browser.</p>
    <div class="g-fields">
      <label>Token del bot <input id="g-bot" type="password" autocomplete="new-password" spellcheck="false" placeholder="123456:ABC…"></label>
      <label>Chat id o @canale <input id="g-chat" autocomplete="off" spellcheck="false" placeholder="-100… oppure @canale"></label>
    </div>
    <h3>Bankroll e commissione</h3>
    <div class="g-fields">
      <label>Bankroll iniziale € <input id="g-bank" inputmode="decimal" placeholder="1000"></label>
      <label>Commissione predefinita % <input id="g-defcomm" inputmode="decimal" placeholder="vuoto = nessuna"></label>
    </div>
    <p class="g-hint">La commissione predefinita vale per le giocate nuove. Su ogni giocata puoi cambiarla. Si applica solo all'utile positivo.</p>
    <h3>Backup</h3>
    <p class="g-hint">Il backup non contiene token. Importare unisce le giocate: non cancella quelle già presenti.</p>
    <div class="g-actions">
      <button type="button" class="g-btn" id="g-export">Esporta backup JSON</button>
      <button type="button" class="g-btn" id="g-import-btn">Importa backup JSON</button>
      <input id="g-import" type="file" accept="application/json,.json" hidden>
    </div>`;
  const token = panel.querySelector('#g-token');
  const owner = panel.querySelector('#g-owner');
  const repo = panel.querySelector('#g-repo');
  const path = panel.querySelector('#g-path');
  const branch = panel.querySelector('#g-branch');
  const bot = panel.querySelector('#g-bot');
  const chat = panel.querySelector('#g-chat');
  token.value = state.secrets.githubToken || '';
  owner.value = state.target.owner;
  repo.value = state.target.repo;
  path.value = state.target.path;
  branch.value = state.target.branch;
  bot.value = state.secrets.telegramBotToken || '';
  chat.value = state.secrets.telegramChatId || '';
  fillSettingsNumbers();
  const saveSecrets = () => {
    state.secrets.githubToken = token.value.trim();
    state.secrets.telegramBotToken = bot.value.trim();
    state.secrets.telegramChatId = chat.value.trim();
    storage();
    updateSyncBar();
  };
  token.addEventListener('change', () => { saveSecrets(); syncNow({ manual: true }); });
  bot.addEventListener('change', saveSecrets);
  chat.addEventListener('change', saveSecrets);
  const saveTarget = () => {
    const prev = targetKey(state.target);
    state.target = normalizeTarget({ owner: owner.value.trim(), repo: repo.value.trim(), path: path.value.trim(), branch: branch.value.trim() });
    if (targetKey(state.target) !== prev) state.sync.sha = null;
    storage();
  };
  [owner, repo, path, branch].forEach((el) => el.addEventListener('change', saveTarget));
  panel.querySelector('#g-show-token').addEventListener('click', () => {
    const show = token.type === 'password';
    token.type = show ? 'text' : 'password';
    bot.type = show ? 'text' : 'password';
    panel.querySelector('#g-show-token').textContent = show ? 'Nascondi token' : 'Mostra token';
  });
  panel.querySelector('#g-sync').addEventListener('click', () => { saveTarget(); saveSecrets(); syncNow({ manual: true }); });
  panel.querySelector('#g-bank').addEventListener('change', (e) => {
    state.settings.startingBankroll = parseDecimal(e.target.value);
    state.settingsUpdatedAt = new Date().toISOString();
    persistDirty();
    if (panelOn('bilancio')) renderBalanceBody();
  });
  panel.querySelector('#g-defcomm').addEventListener('change', (e) => {
    state.settings.defaultCommission = parseDecimal(e.target.value);
    state.settingsUpdatedAt = new Date().toISOString();
    persistDirty();
  });
  panel.querySelector('#g-export').addEventListener('click', () => {
    flushGiocateForms();
    downloadBlob(new Blob([exportBackup(state)], { type: 'application/json' }), `giocate-${romeToday()}.json`);
  });
  const file = panel.querySelector('#g-import');
  panel.querySelector('#g-import-btn').addEventListener('click', () => file.click());
  file.addEventListener('change', async () => {
    const picked = file.files && file.files[0];
    file.value = '';
    if (!picked) return;
    try {
      const text = await picked.text();
      const merged = importBackup(state, text);
      applyMerged(merged);
      persistDirty();
      toast('Backup unito. Nessuna giocata già presente è stata cancellata.');
    } catch (e) {
      toast(e.message || 'File non valido.');
    }
  });
}

function fillSettingsNumbers() {
  const bank = document.getElementById('g-bank');
  const comm = document.getElementById('g-defcomm');
  if (bank && document.activeElement !== bank) bank.value = numInput(state.settings.startingBankroll);
  if (comm && document.activeElement !== comm) comm.value = numInput(state.settings.defaultCommission);
}

function applyTab(name, { hash = true } = {}) {
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('on', t.dataset.t === name));
  document.querySelectorAll('.panel').forEach((p) => p.classList.toggle('on', p.id === 'p-' + name));
  if (hash) {
    const next = '#' + name;
    if (location.hash !== next) history.replaceState(null, '', next);
  }
  if (name === 'schedina') renderSlip();
  if (name === 'giocate') { ensureGiocate(); renderGiocateList(); }
  if (name === 'bilancio') { ensureBalance(); renderBalanceBody(); }
  if (name === 'telegram') { ensureTelegram(); renderTelegramPreview(); }
  if (name === 'impostazioni') ensureSettings();
  updateChrome();
}

function installChrome() {
  const header = document.querySelector('header');
  const bar = document.createElement('div');
  bar.id = 'g-syncbar';
  bar.className = 'g-syncbar';
  header.appendChild(bar);
  bar.addEventListener('click', (e) => {
    if (e.target.closest('[data-sync]')) syncNow({ manual: true });
    if (e.target.closest('[data-go-settings]')) applyTab('impostazioni');
  });
  const dock = document.createElement('div');
  dock.id = 'g-dock';
  dock.hidden = true;
  dock.innerHTML = '<button type="button" data-open>SCHEDINA</button>';
  document.body.appendChild(dock);
  dock.querySelector('[data-open]').addEventListener('click', () => applyTab('schedina'));
  const modal = document.createElement('div');
  modal.id = 'g-modal';
  modal.hidden = true;
  modal.innerHTML = `<div class="g-modal-card" role="dialog" aria-modal="true" aria-labelledby="g-modal-text">
      <p id="g-modal-text"></p>
      <div class="g-actions">
        <button type="button" class="g-btn bad" data-yes>ELIMINA</button>
        <button type="button" class="g-btn" data-no>ANNULLA</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
  const toastEl = document.createElement('div');
  toastEl.id = 'g-toast';
  toastEl.hidden = true;
  toastEl.setAttribute('role', 'status');
  document.body.appendChild(toastEl);
  const oggi = document.querySelector('.tab[data-t="oggi"]');
  const anchor = oggi ? oggi.nextSibling : null;
  const main = document.querySelector('main');
  for (const [id, label] of [
    ['schedina', '🧾 Schedina'],
    ['giocate', '📒 Giocate'],
    ['bilancio', '📊 Bilancio'],
    ['telegram', '📣 Telegram'],
    ['impostazioni', '⚙️ Impostazioni'],
  ]) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'tab';
    btn.dataset.t = id;
    btn.textContent = label;
    btn.addEventListener('click', () => applyTab(id));
    if (oggi) oggi.parentNode.insertBefore(btn, anchor);
    else document.querySelector('.tabs').appendChild(btn);
    const panel = document.createElement('section');
    panel.className = 'panel g-panel';
    panel.id = 'p-' + id;
    main.appendChild(panel);
  }
}

function installMatchButtons() {
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('.add-slip');
    if (!btn) return;
    e.preventDefault();
    const added = toggleSlipItem(state, {
      matchId: btn.dataset.mid,
      date: btn.dataset.date,
      kickoff: btn.dataset.ko,
      home: btn.dataset.home,
      away: btn.dataset.away,
      league: btn.dataset.league,
      country: btn.dataset.country,
      url: btn.dataset.url,
    });
    persistDirty();
    renderSlip();
    toast(added ? 'Partita aggiunta alla schedina.' : 'Partita tolta dalla schedina.');
  });
  window.Giocate = { afterRenderDay: syncAddButtons };
  if (typeof window.renderDay === 'function') {
    const orig = window.renderDay;
    window.renderDay = function renderDayWrapped(...args) {
      const out = orig.apply(this, args);
      syncAddButtons();
      return out;
    };
  }
}

function init() {
  installChrome();
  installMatchButtons();
  ensureGiocate();
  renderSlip();
  renderGiocateList();
  updateSyncBar();
  updateChrome();
  const start = location.hash.replace('#', '');
  if (PANELS.includes(start)) applyTab(start, { hash: false });
  window.addEventListener('hashchange', () => {
    const name = location.hash.replace('#', '');
    if (PANELS.includes(name)) applyTab(name, { hash: false });
  });
  syncNow();
}

init();
