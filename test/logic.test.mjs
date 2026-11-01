import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseAlert, alertWindow, goalAfter, ritardo, scoreBoard, windowBoard, scoreAt,
  thresholds, trading, nameSim, advice, bandTotals, cumShare, matchSoccerstats,
  timingFromArchive, choosePair,
} from '../js/logic.mjs';

const g = (min, teamFor) => ({ min, extra: 0, for: teamFor });
const match = (gf, ga, goals, opt = {}) => ({
  gf, ga, goals: goals || [], goalsOk: opt.goalsOk !== false, home: !!opt.home,
  xgFor: opt.xgFor, xgAgainst: opt.xgAgainst, date: opt.date || '', opp: opt.opp || 'X', t: opt.t || 0,
});

test('parser: intervallo 0-0 e quote', () => {
  const A = parseAlert(`🇮🇹 Serie A (3rd vs 12th)
Como vs Venezia

Timer: Half Time
Goals: 0 - 0
xG: 0.61 - 0.94
Over/Under 0.50 Odds:
1.18 4.50`);
  assert.equal(A.home, 'Como');
  assert.equal(A.away, 'Venezia');
  assert.equal(A.phase, 'HT');
  assert.equal(A.minute, 45);
  assert.deepEqual(A.score, [0, 0]);
  assert.equal(A.is00, true);
  assert.equal(A.stats.xg[0], 0.61);
  assert.equal(A.ou['0.50'].over, 1.18);
  assert.equal(A.league, 'Serie A');
  assert.equal(A.iso2, 'IT');
});

test('parser: minuto 60', () => {
  const A = parseAlert(`Timer: 60'\nInter vs Milan\nGoals: 0 - 0\nxG: 1.10 - 0.40`);
  // la riga squadre è dopo il timer: il parser prende la prima riga "A vs B"
  assert.equal(A.minute, 60);
  assert.equal(alertWindow(A).id, 'last30');
  assert.equal(alertWindow(A).after, 60);
});

test('finestra: 45 è secondo tempo, 60 è ultimi 30', () => {
  const ht = parseAlert('Como vs Venezia\nTimer: Half Time\nGoals: 0 - 0');
  const m60 = parseAlert('Como vs Venezia\nTimer: 60\'\nGoals: 0 - 0');
  assert.equal(alertWindow(ht).id, '2h');
  assert.equal(alertWindow(m60).title, 'Ritardo over 0,5 ultimi 30 minuti');
  assert.equal(goalAfter({ min: 60 }, 60), false);
  assert.equal(goalAfter({ min: 61 }, 60), true);
  assert.equal(goalAfter({ min: 90 }, 60), true);
  assert.equal(goalAfter({ min: 45 }, 45), false);
  assert.equal(goalAfter({ min: 46 }, 45), true);
});

test('ritardo 0-0, 1-0 e 0-1 dalla più recente', () => {
  const ms = [
    match(2, 1),
    match(1, 0),
    match(0, 0),
    match(0, 1),
  ];
  const b = scoreBoard(ms);
  assert.equal(b.zz.n, 2);
  assert.equal(b.r10.n, 1);
  assert.equal(b.r01.n, 3);
  assert.equal(b.zz.open, false);
});

test('ritardo aperto se l\'evento non c\'è', () => {
  const ms = [match(1, 0), match(2, 0), match(3, 1)];
  const b = scoreBoard(ms);
  assert.equal(b.zz.open, true);
  assert.equal(b.zz.n, 3);
  assert.equal(b.r10.n, 0);
});

test('ritardo ultimi 30 minuti: solo gol dal 61', () => {
  const ms = [
    match(1, 0, [g(55, true)]),             // gol al 55, niente negli ultimi 30
    match(0, 0, []),                         // 0-0
    match(2, 1, [g(12, true), g(70, false)]), // gol al 70
  ];
  const w = windowBoard(ms, 60);
  assert.equal(w.any.n, 2);       // due partite senza gol dopo il 60, poi il 70
  assert.equal(w.scored.n, 3);    // la squadra non ha segnato dopo il 60
  assert.equal(w.scored.open, true);
  assert.equal(w.conceded.n, 2);
  const at = scoreAt(ms[2], 60);
  assert.deepEqual(at, [1, 0]);   // al 60' era 1-0, il gol del 70 non è ancora contato
});

test('partita senza minuti gol interrompe il ritardo', () => {
  const ms = [match(1, 0, [], { goalsOk: false }), match(1, 0, [g(80, true)])];
  const w = windowBoard(ms, 60);
  assert.equal(w.any.partial, true);
  assert.equal(w.any.n, 0);
});

test('soglie back e lay con commissione 5%', () => {
  const t = thresholds(0.5, 0.05);
  assert.ok(Math.abs(t.fair - 2) < 1e-9);
  assert.ok(Math.abs(t.backMin - (1 + 0.5 / (0.5 * 0.95))) < 1e-9);
  assert.ok(Math.abs(t.layMax - (1 + (0.5 * 0.95) / 0.5)) < 1e-9);
  assert.ok(t.backMin > t.fair);
  assert.ok(t.layMax < t.fair);
});

test('donne e riserve non vincono il confronto col nome', () => {
  assert.ok(nameSim('Como', 'Como') > nameSim('Como', 'Como Women'));
  assert.ok(nameSim('Inter', 'Inter Milan') > 0.8);
});

test('cumulato gol: all\'intervallo solo le prime tre fasce', () => {
  const share = [0.1, 0.1, 0.2, 0.2, 0.2, 0.2];
  assert.ok(Math.abs(cumShare(share, 45) - 0.4) < 1e-9);
  assert.ok(Math.abs(cumShare(share, 60) - 0.6) < 1e-9);
});

test('trading sullo 0-0 al 60 produce una probabilità e una soglia', () => {
  const hist = (mins) => match(mins.length, 0, mins.map(m => g(m, true)), { home: true, goalsOk: true, xgFor: 1.4, xgAgainst: 0.9 });
  const home = [hist([70]), hist([20]), hist([80, 10]), hist([15]), hist([62])];
  const away = [hist([12]), hist([88]), hist([30]), hist([40]), hist([9])].map(m => ({ ...m, home: false, xgFor: 0.8, xgAgainst: 1.3 }));
  const A = parseAlert('Como vs Venezia\nTimer: 60\'\nGoals: 0 - 0\nxG: 1.20 - 0.30\nOver/Under 0.50 Odds:\n1.40 2.80');
  const ss = { timing: { overall: { A: { gp: 10, b: [[2, 1], [2, 1], [2, 1], [2, 1], [3, 1], [3, 1]] }, B: { gp: 10, b: [[2, 1], [2, 1], [2, 1], [2, 1], [3, 1], [3, 1]] } } }, ou: { 'h2:overall': { A: { gp: 10, o05: 70 } } } };
  const tr = trading(home, away, A, ss, 0.05);
  assert.equal(tr.win.id, 'last30');
  assert.ok(tr.p > 0.2 && tr.p < 0.95);
  assert.ok(tr.th.backMin > 1);
  assert.ok(tr.market.pOver > 0.4);
  const text = advice(A, 'Como', 'Venezia', tr, '2026/2027');
  assert.match(text.lines[0], /Questi sono gli xG del campionato/);
  assert.match(text.lines.join(' '), /Attenzione che/);
  assert.match(text.move, /Mossa:/);
  const tot = bandTotals(ss.timing.overall);
  assert.equal(tot.matches, 10);
});

const AUSTRIA = `🇦🇹 Austria Bundesliga (11th vs 2nd)
FK Austria Vienna vs Rapid Vienna

Timer: Half Time
Last Goal: None

Goals: 0 - 0
xG: 0.64 - 0.4
Corners: 4 - 1
Shots On Target: 3 - 1
Dangerous Attacks: 31 - 12
Red Cards: 0 - 0
Possession %: 56 - 44

Over/Under 0.50 Odds:
1.25 3.75`;

test('alert Austria: intervallo, nomi e 0-0', () => {
  const A = parseAlert(AUSTRIA);
  assert.equal(A.home, 'FK Austria Vienna');
  assert.equal(A.away, 'Rapid Vienna');
  assert.equal(A.phase, 'HT');
  assert.equal(A.minute, 45);
  assert.equal(A.is00, true);
  assert.equal(A.iso2, 'AT');
  assert.equal(A.league, 'Austria Bundesliga');
  assert.equal(alertWindow(A).id, '2h');
  assert.equal(A.stats.xg[0], 0.64);
  assert.equal(A.stats.xg[1], 0.4);
});

test('Vienna si abbina a Wien, stesso campionato, senza chiedere', () => {
  assert.ok(nameSim('FK Austria Vienna', 'Austria Wien') >= 0.9);
  assert.ok(nameSim('Rapid Vienna', 'Rapid Wien') >= 0.9);
  assert.ok(nameSim('Bayern Munich', 'Bayern München') >= 0.9);
  const teams = [
    { id: '1', name: 'Austria Wien', leagueId: '38', league: 'Bundesliga', country: 'AUT' },
    { id: '2', name: 'Rapid Wien', leagueId: '38', league: 'Bundesliga', country: 'AUT' },
    { id: '3', name: 'Austria Klagenfurt', leagueId: '38', league: 'Bundesliga', country: 'AUT' },
    { id: '4', name: 'Rapid Bucuresti', leagueId: '99', league: 'Liga 1', country: 'ROU' },
  ];
  const c = choosePair('FK Austria Vienna', 'Rapid Vienna', teams, 'Austria Bundesliga', 'AT');
  assert.equal(c.sure, true);
  assert.equal(c.best.h.name, 'Austria Wien');
  assert.equal(c.best.a.name, 'Rapid Wien');
  assert.equal(c.best.h.leagueId, '38');
});

test('fasce dai minuti: 67 va in 61-75, 76 in 76-90, secondo tempo dal 46', () => {
  const m = { h: '1', a: '2', hn: 'Bari', an: 'Cavese', hg: 2, ag: 1, ok: true, goals: [[21, 0, 1], [46, 0, 0], [67, 0, 1], [76, 0, 0]] };
  const t = timingFromArchive({ x: m });
  const bari = t.teams.find(x => x.name === 'Bari');
  assert.equal(bari.b[1][0], 1);      // 21' segnato, fascia 16-30
  assert.equal(bari.b[3][1], 1);      // 46' subito
  assert.equal(bari.b[4][0], 1);      // 67' segnato
  assert.equal(bari.b[5][1], 1);      // 76' subito
  assert.equal(bari.h2[0] + bari.h2[1], 3);
  assert.equal(bari.any60, 1);
  assert.equal(t.p2h, 1);
  assert.equal(t.matches, 1);
});

test('abbina Serie A e non la Serie B', () => {
  const index = { leagues: [
    { code: 'italy', name: 'Serie A', country: 'ITA', cup: false },
    { code: 'italy2', name: 'Serie B', country: 'ITA', cup: false },
    { code: 'spain', name: 'La Liga', country: 'SPA', cup: false },
  ] };
  const hit = matchSoccerstats(index, { name: 'Serie A', country: 'ITA' });
  assert.equal(hit.code, 'italy');
});
