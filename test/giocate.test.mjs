import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  analyze, applySuggestedResult, bonusIssues, combinedOdds, deleteEverywhere, emptyState,
  evaluateBonus, exportBackup, importBackup, isoWeekKey, loadState, meaningfulFingerprint,
  mergeStates, normalizeState, oddsForBet, outcomeOf, playDraft, profitOf, rangeForView,
  saveState, sendSlip, setBetResult, setSelectionResult, streaks, toCsv, toRemote, toggleSlipItem,
} from '../live/giocate-model.js';
import { decodeContent, encodeContent, syncRemote } from '../live/giocate-github.js';
import { buildPost, sendTelegramPhoto } from '../live/giocate-telegram.js';

const TOKEN = 'github_pat_TESTSECRET123';
const BOT = '123456789:TESTBOTSECRET';

function sel(over = {}) {
  return {
    id: over.id || 's1',
    matchId: '1',
    date: '2026-11-06',
    kickoff: '15:00',
    home: 'Inter',
    away: 'Milan',
    league: 'Serie A',
    country: 'ITA',
    market: 'Over 1.5',
    odds: 1.8,
    result: 'vinta',
    score: '2-1',
    ...over,
  };
}

function played(over = {}) {
  return {
    id: over.id || 'b1',
    kind: over.kind || 'singola',
    side: over.side || 'back',
    status: 'settled',
    createdAt: '2026-11-06T10:00:00.000Z',
    updatedAt: '2026-11-06T18:00:00.000Z',
    playedAt: '2026-11-06T10:00:00.000Z',
    settledAt: '2026-11-06T18:00:00.000Z',
    stake: 10,
    commissionPct: null,
    result: 'vinta',
    bookmaker: 'Bet365',
    selections: [sel()],
    ...over,
  };
}

test('utile back, lay, cash out, rimborso e commissione', () => {
  assert.equal(profitOf(played()), 8);
  assert.equal(profitOf(played({ commissionPct: 5 })), 7.6);
  assert.equal(profitOf(played({ result: 'persa', selections: [sel({ result: 'persa' })] })), -10);
  assert.equal(profitOf(played({ result: 'void', selections: [sel({ result: 'void' })] })), 0);
  assert.equal(profitOf(played({ result: 'cashout', cashoutAmount: 15 })), 5);
  assert.equal(profitOf(played({ result: 'cashout', cashoutAmount: 15, commissionPct: 5 })), 4.75);
  assert.equal(profitOf(played({ result: 'cashout', cashoutAmount: 6 })), -4);
  assert.equal(profitOf(played({ side: 'lay', odds: undefined, selections: [sel({ odds: 1.8 })], result: 'vinta' })), 10);
  assert.equal(profitOf(played({ side: 'lay', commissionPct: 5, selections: [sel({ odds: 1.8 })] })), 9.5);
  assert.equal(profitOf(played({ side: 'lay', result: 'persa', selections: [sel({ odds: 1.8, result: 'persa' })] })), -8);
});

test('multipla: prodotto, gamba rimborsata e quota manuale', () => {
  const selections = [
    sel({ id: 'a', odds: 1.5, result: 'vinta' }),
    sel({ id: 'b', odds: 2, result: 'vinta', home: 'Roma', away: 'Lazio', kickoff: '18:00' }),
  ];
  assert.equal(combinedOdds(selections), 3);
  assert.equal(profitOf(played({ kind: 'multipla', selections })), 20);
  const withVoid = [
    sel({ id: 'a', odds: 2, result: 'vinta' }),
    sel({ id: 'b', odds: 1.5, result: 'void' }),
  ];
  assert.equal(oddsForBet({ kind: 'multipla', totalOddsManual: false, selections: withVoid }, { settlement: false }), 3);
  assert.equal(oddsForBet({ kind: 'multipla', totalOddsManual: false, selections: withVoid }, { settlement: true }), 2);
  assert.equal(profitOf(played({ kind: 'multipla', selections: withVoid })), 10);
  assert.equal(profitOf(played({
    kind: 'multipla', totalOddsManual: true, totalOdds: 3.2, selections: withVoid,
  })), 22);
  assert.equal(combinedOdds([sel({ odds: 1.91 }), sel({ odds: 1.33 })]), 2.54);
});

test('unione: non cancella, il più recente vince, il tombstone resta', () => {
  const local = {
    updatedAt: '2026-11-06T12:00:00.000Z',
    settingsUpdatedAt: '2026-11-06T12:00:00.000Z',
    bets: [
      played({ id: 'A', stake: 30, updatedAt: '2026-11-06T12:00:00.000Z' }),
      played({ id: 'B', stake: 5 }),
    ],
    deletedIds: ['D'],
  };
  const remote = {
    updatedAt: '2026-11-06T11:00:00.000Z',
    settingsUpdatedAt: '2026-11-06T09:00:00.000Z',
    bets: [
      played({ id: 'A', stake: 10, updatedAt: '2026-11-06T10:00:00.000Z' }),
      played({ id: 'C', stake: 8, updatedAt: '2026-11-06T11:00:00.000Z' }),
      played({ id: 'D', stake: 99, updatedAt: '2026-11-07T11:00:00.000Z' }),
    ],
  };
  const merged = mergeStates(local, remote);
  const ids = merged.bets.map((b) => b.id).sort();
  assert.deepEqual(ids, ['A', 'B', 'C']);
  assert.equal(merged.bets.find((b) => b.id === 'A').stake, 30);
  assert.ok(merged.deletedIds.includes('D'));

  const remoteNewer = mergeStates(
    { bets: [played({ id: 'A', stake: 10, updatedAt: '2026-11-01T00:00:00.000Z' })] },
    { bets: [played({ id: 'A', stake: 25, updatedAt: '2026-11-02T00:00:00.000Z' })] },
  );
  assert.equal(remoteNewer.bets[0].stake, 25);
});

test('i segreti non entrano nel file remoto né nel backup', () => {
  const state = emptyState();
  state.secrets.githubToken = TOKEN;
  state.secrets.telegramBotToken = BOT;
  state.secrets.telegramChatId = '-100123';
  state.bets.push(played());
  const remote = toRemote(state);
  const blob = JSON.stringify(remote) + exportBackup(state);
  assert.equal(blob.includes(TOKEN), false);
  assert.equal(blob.includes(BOT), false);
  assert.equal(blob.includes('-100123'), false);
  assert.equal(meaningfulFingerprint(remote), meaningfulFingerprint(toRemote(remote)));
});

test('localStorage: cache senza token, il token resta nella chiave segreta', () => {
  const mem = new Map();
  const storage = {
    getItem: (k) => (mem.has(k) ? mem.get(k) : null),
    setItem: (k, v) => mem.set(k, String(v)),
  };
  const state = emptyState();
  state.secrets.githubToken = TOKEN;
  state.bets.push(played({ id: 'keep' }));
  saveState(storage, state);
  const data = JSON.parse(storage.getItem('segnali.giocate.v1'));
  assert.equal(JSON.stringify(data).includes(TOKEN), false);
  assert.equal(JSON.parse(storage.getItem('segnali.giocate.secrets.v1')).githubToken, TOKEN);
  const loaded = loadState(storage);
  assert.equal(loaded.secrets.githubToken, TOKEN);
  assert.equal(loaded.bets[0].id, 'keep');
  assert.equal(loadState({ getItem() { throw new Error('bloccato'); } }).bets.length, 0);
});

test('import unisce e non cancella le giocate già presenti', () => {
  const state = emptyState();
  state.bets.push(played({ id: 'local' }));
  const backup = exportBackup({ bets: [played({ id: 'file', stake: 4 })] });
  const merged = importBackup(state, backup);
  assert.deepEqual(merged.bets.map((b) => b.id).sort(), ['file', 'local']);
});

test('schedina singole e multipla, poi esito dalle selezioni', () => {
  const state = emptyState();
  toggleSlipItem(state, { matchId: 10, date: '2026-11-07', kickoff: '15:00', home: 'Inter', away: 'Milan', league: 'Serie A', country: 'ITA' });
  toggleSlipItem(state, { matchId: 11, date: '2026-11-07', kickoff: '18:00', home: 'Roma', away: 'Lazio', league: 'Serie A', country: 'ITA' });
  state.slip.mode = 'singole';
  const created = sendSlip(state);
  assert.equal(created.length, 2);
  assert.equal(state.slip.items.length, 0);
  assert.equal(state.drafts.length, 2);
  toggleSlipItem(state, { matchId: 12, date: '2026-11-07', kickoff: '20:45', home: 'Juve', away: 'Napoli', league: 'Serie A', country: 'ITA' });
  toggleSlipItem(state, { matchId: 13, date: '2026-11-07', kickoff: '21:00', home: 'Atalanta', away: 'Fiorentina', league: 'Serie A', country: 'ITA' });
  state.slip.mode = 'multipla';
  const multi = sendSlip(state)[0];
  assert.equal(multi.kind, 'multipla');
  assert.equal(multi.selections.length, 2);
  multi.selections[0].market = 'Over 1.5';
  multi.selections[0].odds = 1.5;
  multi.selections[1].market = 'Gol';
  multi.selections[1].odds = 1.7;
  multi.stake = 10;
  const playedBet = playDraft(state, multi.id);
  assert.equal(playedBet.ok, true);
  assert.equal(state.bets[0].status, 'active');
  setSelectionResult(state.bets[0], state.bets[0].selections[0].id, 'vinta');
  setSelectionResult(state.bets[0], state.bets[0].selections[1].id, 'void');
  assert.equal(state.bets[0].result, 'vinta');
  assert.equal(profitOf(state.bets[0]), 5);
  applySuggestedResult(state.bets[0]);
  deleteEverywhere(state, state.bets[0].id);
  assert.equal(state.bets.length, 0);
  assert.equal(state.drafts.length, 2);
  const back = mergeStates({ bets: [played({ id: state.deletedIds[0], stake: 99 })] }, state);
  assert.equal(back.bets.find((b) => b.id === state.deletedIds[0]), undefined);
});

test('bilancio: yield, strike, serie, fasce, campionato e date', () => {
  assert.deepEqual(rangeForView('settimana', '2026-11-06'), { from: '2026-11-02', to: '2026-11-08' });
  assert.deepEqual(rangeForView('mese', '2026-11-06'), { from: '2026-11-01', to: '2026-11-30' });
  assert.equal(isoWeekKey('2026-11-02'), isoWeekKey('2026-11-08'));
  assert.notEqual(isoWeekKey('2026-11-08'), isoWeekKey('2026-11-09'));
  const state = emptyState();
  state.settings.startingBankroll = 100;
  state.bets = [
    played({ id: 'w1', result: 'vinta', selections: [sel({ date: '2026-11-01', result: 'vinta', odds: 1.8 })] }),
    played({ id: 'w2', result: 'vinta', selections: [sel({ date: '2026-11-02', result: 'vinta', odds: 2 })] }),
    played({ id: 'l1', result: 'persa', stake: 10, selections: [sel({ date: '2026-11-03', result: 'persa', odds: 1.5, market: '1X', league: 'Premier League' })] }),
    played({ id: 'v1', result: 'void', selections: [sel({ date: '2026-11-04', result: 'void' })] }),
    played({ id: 'l2', result: 'persa', selections: [sel({ date: '2026-11-05', result: 'persa', odds: 3 })] }),
    played({ id: 'l3', result: 'persa', selections: [sel({ date: '2026-11-06', result: 'persa', odds: 6 })] }),
  ];
  const all = analyze(state, { view: 'tutto', today: '2026-11-06' });
  assert.equal(all.kpis.profit, 8 + 10 - 10 - 10 - 10);
  assert.equal(all.kpis.staked, 50);
  assert.equal(all.kpis.voids, 1);
  assert.equal(all.kpis.wins, 2);
  assert.equal(all.kpis.losses, 3);
  assert.equal(Math.round(all.kpis.yield * 10) / 10, -24);
  assert.equal(all.kpis.roi, (all.kpis.profit / 100) * 100);
  assert.equal(all.kpis.strike, 40);
  assert.equal(all.kpis.current.type, 'loss');
  assert.equal(all.kpis.current.length, 3);
  assert.equal(all.kpis.longestWin, 2);
  assert.equal(all.kpis.longestLoss, 3);
  assert.equal(all.kpis.biggestWin.profit, 10);
  assert.equal(all.kpis.biggestLoss.profit, -10);
  assert.ok(all.byKind.some((r) => r.label === 'Singola'));
  assert.ok(all.byMarket.some((r) => r.label === 'Over 1.5'));
  assert.ok(all.byMarket.some((r) => r.label === '1X'));
  assert.ok(all.byBook.some((r) => r.label === 'Bet365'));
  assert.ok(all.byLeague.some((r) => r.label === 'Serie A'));
  assert.ok(all.byLeague.some((r) => r.label === 'Premier League'));
  assert.ok(all.byOdds.some((r) => r.label === '6,00+'));
  const today = analyze(state, { view: 'oggi', today: '2026-11-06' });
  assert.equal(today.kpis.bets, 1);
  assert.equal(today.kpis.profit, -10);
  const serie = streaks(state.bets);
  assert.equal(serie.longestWin, 2);
  const csv = toCsv(all.rows);
  assert.ok(csv.charCodeAt(0) === 0xfeff);
  assert.match(csv, /Inter – Milan/);
  assert.equal(csv.includes(TOKEN), false);
  assert.match(csv, /;/);
});

test('testo Telegram prematch e risultati, con e senza puntata', () => {
  const bet = played();
  const pre = buildPost([bet], { mode: 'prematch', showStake: true, scope: 'bet', dateLabel: 'venerdì 6 novembre 2026' });
  assert.match(pre.text, /PREMATCH/);
  assert.match(pre.text, /Inter – Milan/);
  assert.match(pre.text, /Over 1\.5/);
  assert.match(pre.text, /1,80/);
  assert.match(pre.text, /Puntata/);
  assert.doesNotMatch(pre.text, /VINTA/);
  const hidden = buildPost([bet], { mode: 'prematch', showStake: false, scope: 'bet' });
  assert.doesNotMatch(hidden.text, /Puntata/);
  const post = buildPost([bet], { mode: 'risultati', showStake: true, scope: 'bet', dateLabel: 'venerdì 6 novembre 2026' });
  assert.match(post.text, /VINTA/);
  assert.match(post.text, /\+8,00 €/);
  assert.equal(post.model.hero, 'VINTA');
  assert.equal(post.model.accent, '#22c55e');
  const lost = played({ id: 'l', result: 'persa', selections: [sel({ result: 'persa', home: 'Roma', away: 'Lazio' })] });
  const day = buildPost([bet, lost], { mode: 'risultati', showStake: false, scope: 'day', dateLabel: 'venerdì 6 novembre 2026' });
  assert.match(day.text, /Utile giornata/);
  assert.match(day.text, /PERSA/);
  assert.match(day.text, /Roma – Lazio/);
  assert.equal(day.model.cards.length, 2);
});

test('GitHub: crea il file, unisce sul 409 e non scrive il token', async () => {
  let sha = null;
  let file = null;
  let conflicted = false;
  let lastBody = '';
  const fetchImpl = async (url, opts = {}) => {
    const method = opts.method || 'GET';
    assert.equal(String(opts.headers.Authorization || '').includes(TOKEN), true);
    assert.equal(url.includes(TOKEN), false);
    if (method === 'GET') {
      if (!file) return new Response(JSON.stringify({ message: 'Not Found' }), { status: 404 });
      return new Response(JSON.stringify({ sha, content: encodeContent(file), encoding: 'base64' }), { status: 200 });
    }
    lastBody = opts.body;
    const body = JSON.parse(opts.body);
    if (!conflicted) {
      conflicted = true;
      file = { bets: [played({ id: 'dal-remoto', stake: 4, updatedAt: '2026-11-06T19:00:00.000Z' })] };
      sha = 'sha-remoto';
      return new Response(JSON.stringify({ message: 'conflict' }), { status: 409 });
    }
    if (body.sha !== sha) return new Response(JSON.stringify({ message: 'sha' }), { status: 409 });
    file = decodeContent(body.content);
    sha = 'sha-ok';
    return new Response(JSON.stringify({ content: { sha }, commit: { sha: 'c1' } }), { status: 200 });
  };
  const local = emptyState();
  local.secrets.githubToken = TOKEN;
  local.secrets.telegramBotToken = BOT;
  local.bets.push(played({ id: 'dal-locale', stake: 7 }));
  const result = await syncRemote(fetchImpl, local.target, TOKEN, local);
  assert.equal(result.wrote, true);
  assert.equal(result.sha, 'sha-ok');
  const ids = file.bets.map((b) => b.id).sort();
  assert.deepEqual(ids, ['dal-locale', 'dal-remoto']);
  assert.equal(lastBody.includes(TOKEN), false);
  assert.equal(lastBody.includes(BOT), false);
  assert.equal(JSON.stringify(file).includes(TOKEN), false);
  const round = decodeContent(encodeContent({ squadra: 'Nürnberg', avversario: 'São Paulo', emoji: '⚽' }));
  assert.equal(round.squadra, 'Nürnberg');
  assert.equal(round.emoji, '⚽');
});

test('Telegram: invio foto e errore CORS', async () => {
  let seen = null;
  const ok = await sendTelegramPhoto(async (url, opts) => {
    seen = { url, chat: opts.body.get('chat_id'), caption: opts.body.get('caption') };
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }, { token: '123:ABC_def', chatId: '-1005', blob: new Blob(['jpg']), caption: 'ciao' });
  assert.equal(ok.ok, true);
  assert.equal(seen.url, 'https://api.telegram.org/bot123:ABC_def/sendPhoto');
  assert.equal(seen.chat, '-1005');
  assert.equal(seen.caption, 'ciao');
  await assert.rejects(
    () => sendTelegramPhoto(async () => { throw new TypeError('Failed to fetch'); }, {
      token: '123:ABC', chatId: '@canale', blob: new Blob(['jpg']), caption: 'x',
    }),
    /CORS/,
  );
  await assert.rejects(
    () => sendTelegramPhoto(async () => { throw new Error('non chiamare'); }, {
      token: 'token sbagliato', chatId: '1', blob: new Blob(['x']), caption: '',
    }),
    /Token del bot/,
  );
});

test('la pagina live conserva archivio, segnali e il pulsante AGGIUNGI', () => {
  const html = readFileSync(new URL('../live/index.html', import.meta.url), 'utf8');
  assert.match(html, /archive\.js/);
  assert.match(html, /giocate-ui\.js/);
  assert.match(html, /giocate\.css/);
  assert.match(html, /class="add-slip"/);
  assert.match(html, /id="p-storico"/);
  assert.match(html, /id="p-oggi"/);
  assert.match(html, /data\/today\.json/);
  assert.match(html, /data\/tomorrow\.json/);
  assert.match(html, /data\/dayafter\.json/);
  assert.match(html, /AGGIUNGI/);
});

function leg(id, odds, result) {
  return sel({ id, odds, result, home: 'Casa ' + id, away: 'Ospite ' + id });
}

test('la multipla si chiude persa appena una selezione è persa, vinta solo se tutte sono chiuse', () => {
  const bet = played({
    id: 'm',
    kind: 'multipla',
    status: 'active',
    result: null,
    stake: 10,
    selections: [leg('a', 1.8, null), leg('b', 1.5, null), leg('c', 2, 'void')],
  });
  setSelectionResult(bet, 'b', 'persa');
  assert.equal(bet.status, 'settled');
  assert.equal(bet.result, 'persa');
  assert.equal(profitOf(bet), -10);
  assert.equal(outcomeOf(bet).title, 'FINITA – HAI PERSO');
  assert.match(outcomeOf(bet).detail, /subito/);

  const open = played({
    id: 'o',
    kind: 'multipla',
    status: 'active',
    result: null,
    selections: [leg('a', 1.8, 'vinta'), leg('b', 1.5, null)],
  });
  assert.equal(open.status, 'active');
  assert.equal(outcomeOf(open).title, 'IN CORSO');
  assert.match(outcomeOf(open).detail, /1 selezione ancora aperta/);

  const won = played({
    id: 'w',
    kind: 'multipla',
    status: 'active',
    result: null,
    stake: 10,
    selections: [leg('a', 2, null), leg('b', 1.5, 'void')],
  });
  setSelectionResult(won, 'a', 'vinta');
  assert.equal(won.result, 'vinta');
  assert.equal(profitOf(won), 10);
  assert.equal(outcomeOf(won).title, 'FINITA – HAI VINTO');

  const single = played({ id: 's', status: 'active', result: null, selections: [sel({ result: null, odds: 1.8 })] });
  const closed = setBetResult(single, 'vinta');
  assert.equal(closed.closed, true);
  assert.equal(outcomeOf(single).title, 'FINITA – HAI VINTO');
  assert.equal(profitOf(single), 8);
});

test('bonus: rigioco, perdita a saldo zero, completamento e file vecchio', () => {
  const old = normalizeState({ bets: [played({ id: 'vecchia' })], settings: { showStakeOnImage: false } });
  assert.deepEqual(old.bonuses, []);
  assert.equal(old.bets[0].bonusId, '');
  assert.equal(toRemote(old).bonuses.length, 0);

  const state = emptyState();
  state.slip.mode = 'bonus';
  state.slip.bonusDraft = { amount: 50, minSelections: 3, minOdds: 1.5, wagerMode: 'multiplier', wagerMultiplier: 3 };
  for (const [id, home] of [[1, 'A'], [2, 'B'], [3, 'C']]) {
    toggleSlipItem(state, { matchId: id, date: '2026-11-07', kickoff: '15:0' + id, home, away: 'X', league: 'Serie A', country: 'ITA' });
  }
  const first = sendSlip(state)[0];
  assert.equal(first.bonusId, state.bonuses[0].id);
  assert.equal(first.stake, 50);
  first.selections.forEach((s, i) => { s.market = 'Over 1.5'; s.odds = [1.4, 1.6, 1.7][i]; });
  assert.match(bonusIssues(state, first)[0], /almeno 1,50/);
  first.selections[0].odds = 1.6;
  assert.equal(playDraft(state, first.id).ok, true);
  const placed = state.bets[0];
  setSelectionResult(placed, placed.selections[0].id, 'vinta');
  setSelectionResult(placed, placed.selections[1].id, 'vinta');
  setSelectionResult(placed, placed.selections[2].id, 'vinta');
  let snap = evaluateBonus(state, state.bonuses[0]);
  assert.equal(snap.status, 'open');
  assert.equal(snap.wagered, 50);
  assert.equal(snap.target, 150);
  assert.equal(snap.balance, 50 + profitOf(placed));

  state.slip.mode = 'bonus';
  state.slip.bonusId = state.bonuses[0].id;
  for (const id of [4, 5, 6]) {
    toggleSlipItem(state, { matchId: id, date: '2026-11-08', kickoff: '18:00', home: 'H' + id, away: 'A', league: 'Serie A', country: 'ITA' });
  }
  const second = sendSlip(state)[0];
  assert.equal(second.stake, snap.balance);
  second.selections.forEach((s) => { s.market = '1'; s.odds = 1.8; });
  assert.equal(playDraft(state, second.id).ok, true);
  const follow = state.bets.find((b) => b.id === second.id);
  setSelectionResult(follow, follow.selections[0].id, 'persa');
  assert.equal(follow.status, 'settled');
  assert.equal(follow.result, 'persa');
  assert.equal(openSelectionCountSafe(follow), 2);
  snap = evaluateBonus(state, state.bonuses[0]);
  assert.equal(snap.status, 'lost');
  assert.equal(snap.balance, 0);
  const report = analyze(state, { view: 'tutto', today: '2026-11-08' });
  assert.equal(report.kpis.profit, 0);
  assert.equal(report.kpis.staked, 0);
  assert.equal(report.kpis.bonusProfit, roundProfit(profitOf(placed) + profitOf(follow)));

  const done = emptyState();
  done.bonuses = [{
    id: 'bn', amount: 10, minSelections: 1, minOdds: 1.2, wagerMode: 'multiplier', wagerMultiplier: 2,
    createdAt: '2026-11-01T00:00:00.000Z', updatedAt: '2026-11-01T00:00:00.000Z',
  }];
  const win = (id, date, stake) => played({
    id, bonusId: 'bn', stake, result: 'vinta', status: 'settled',
    selections: [sel({ id: id + 's', date, odds: 2, result: 'vinta' })],
    settledAt: date + 'T20:00:00.000Z',
  });
  done.bets = [win('one', '2026-11-02', 10), win('two', '2026-11-03', 10)];
  const finished = evaluateBonus(done, done.bonuses[0]);
  assert.equal(finished.status, 'completed');
  assert.equal(finished.wagered, 20);
  assert.equal(finished.converted, 30);
  const money = analyze(done, { view: 'tutto', today: '2026-11-03' });
  assert.equal(money.kpis.profit, 30);
  assert.equal(money.kpis.staked, 0);
  assert.equal(money.kpis.bets, 0);
  const merged = mergeStates(done, { bonuses: [{ ...done.bonuses[0], amount: 99, updatedAt: '2026-10-01T00:00:00.000Z' }] });
  assert.equal(merged.bonuses[0].amount, 10);
});

function openSelectionCountSafe(bet) {
  return bet.selections.filter((s) => !s.result).length;
}
function roundProfit(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
