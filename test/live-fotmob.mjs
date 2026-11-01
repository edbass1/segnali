/** Controlla su una Serie A vera che i minuti gol e i ritardi escano da FotMob. */
import { scoreBoard, windowBoard, xgProfile, leagueOk } from '../js/logic.mjs';

const API = 'https://www.fotmob.com/api/data/';
async function getJSON(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(url + ' ' + r.status);
  return r.json();
}
function parseScore(st) {
  const m = String(st && st.scoreStr || '').match(/(\d+)\s*-\s*(\d+)/);
  return m ? [+m[1], +m[2]] : null;
}
async function detail(mid) {
  const d = await getJSON(API + 'matchDetails?matchId=' + mid);
  const evs = ((((d.content || {}).matchFacts || {}).events || {}).events) || [];
  const goals = evs.filter(e => e.type === 'Goal').map(e => [e.time | 0, e.overloadTime | 0, e.isHome ? 1 : 0]);
  const sc = parseScore((d.header || {}).status || {});
  const ok = !!sc && goals.filter(g => g[2]).length === sc[0] && goals.filter(g => !g[2]).length === sc[1];
  let xg = null;
  const per = (((d.content || {}).stats || {}).Periods || {}).All;
  if (per) for (const gr of per.stats || []) for (const x of gr.stats || []) {
    if (x.key === 'expected_goals' && x.stats && x.stats[0] != null && x.stats[1] != null) xg = [+x.stats[0], +x.stats[1]];
  }
  return { ok, goals, xg, sc };
}
const league = await getJSON(API + 'leagues?id=55');
const det = league.details || {};
const ok = leagueOk({ type: det.type, gender: det.gender, country: det.country, name: det.name }, 'Serie A');
if (!ok.ok) throw new Error('lega non valida ' + ok.why);
const matches = [];
for (const m of (league.fixtures || {}).allMatches || []) {
  const st = m.status || {};
  if (!st.finished || st.cancelled) continue;
  const sc = parseScore(st);
  if (!sc) continue;
  matches.push({ id: String(m.id), t: Date.parse(st.utcTime), h: String(m.home.id), a: String(m.away.id), hn: m.home.name, an: m.away.name, hg: sc[0], ag: sc[1] });
}
const como = matches.filter(m => m.hn === 'Como' || m.an === 'Como').sort((a, b) => b.t - a.t);
console.log('Serie A', det.selectedSeason, 'finite', matches.length, 'Como', como.length, 'lega', ok.ok);
const rows = [];
for (const m of como) {
  const d = await detail(m.id);
  const home = m.hn === 'Como';
  rows.push({
    gf: home ? m.hg : m.ag, ga: home ? m.ag : m.hg,
    opp: home ? m.an : m.hn, date: new Date(m.t).toISOString().slice(0, 10),
    goalsOk: d.ok,
    goals: d.ok ? d.goals.map(g => ({ min: g[0], extra: g[1] || 0, for: (g[2] === 1) === home })) : [],
    xgFor: d.xg ? (home ? d.xg[0] : d.xg[1]) : null,
    xgAgainst: d.xg ? (home ? d.xg[1] : d.xg[0]) : null,
    home, score: m.hg + '-' + m.ag,
  });
}
const b = scoreBoard(rows);
const w = windowBoard(rows, 60);
const x = xgProfile(rows);
const bad = rows.filter(r => !r.goalsOk).length;
console.log(JSON.stringify({
  n: rows.length, goalsMissing: bad,
  last: rows.slice(0, 5).map(r => ({ date: r.date, opp: r.opp, score: r.score, gf: r.gf, ga: r.ga, mins: r.goals.map(g => (g.for ? '+' : '-') + g.min) })),
  zz: b.zz.n, zzOpen: b.zz.open, r10: b.r10.n, r01: b.r01.n,
  last30any: w.any.n, last30for: w.scored.n, last30ag: w.conceded.n,
  pAny: w.pAny, xgFor: x.all.xgFor, xgHome: x.home,
}, null, 1));
if (bad > rows.length / 3) throw new Error('troppi dettagli gol scartati');
if (!rows.length) throw new Error('Como senza partite');
