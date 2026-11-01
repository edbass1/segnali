import {
  parseAlert, alertWindow, scoreBoard, windowBoard,
  xgProfile, trading, advice, XG_GUIDE, matchSoccerstats, pickSsTeam,
  timingFromArchive, archiveAsStats, choosePair, canonCountry,
} from './logic.mjs';

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const n1 = x => x == null || !isFinite(x) ? '–' : (Math.round(x * 10) / 10).toFixed(1).replace('.', ',');
const n2 = x => x == null || !isFinite(x) ? '–' : Number(x).toFixed(2).replace('.', ',');
const pct = x => x == null || !isFinite(x) ? '–' : Math.round(x * 100) + '%';

const EX45 = `🇮🇹 Serie A (6th vs 18th)
Como vs Venezia

Timer: Half Time
Goals: 0 - 0
xG: 0.72 - 0.41
Shots On Target: 3 - 1
Dangerous Attacks: 28 - 19
Red Cards: 0 - 0
Over/Under 0.50 Odds:
1.22 4.10`;

const EX60 = `🇮🇹 Serie A (1st vs 4th)
Inter vs Milan

Timer: 60'
Goals: 0 - 0
xG: 1.15 - 0.48
Shots On Target: 5 - 2
Dangerous Attacks: 41 - 22
Red Cards: 0 - 0
Over/Under 0.50 Odds:
1.36 3.10`;

const EXC = `🇮🇹 Serie C (1st vs 8th)
Bari vs Cavese

Timer: 60'
Goals: 0 - 0
xG: 0.84 - 0.37
Shots On Target: 4 - 2
Red Cards: 0 - 0
Over/Under 0.50 Odds:
1.44 2.70`;

function romeDay(ts) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome' }).format(new Date(ts));
}
function fmtDate(ts) {
  return new Intl.DateTimeFormat('it-IT', { timeZone: 'Europe/Rome', day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(ts));
}
function progress(p, msg) {
  $('prog').hidden = false;
  $('pbar').style.width = Math.max(4, Math.min(100, p)) + '%';
  $('pmsg').textContent = msg;
}
function ask(side, alertName, list, catalog) {
  const box = $('picker');
  return new Promise(resolve => {
    const draw = (rows, note) => {
      box.innerHTML = `<div class="card warn pick"><h2>Quale ${side}?</h2><p>${esc(note)}</p>
        ${rows.slice(0, 10).map((c, i) => `<button type="button" data-i="${i}">${esc(c.name)} <span class="muted">· ${esc(c.league || c.leagueName || 'campionato ?')}${c.country ? ' · ' + esc(c.country) : ''}</span></button>`).join('') || '<p>Nessuna squadra con questo nome.</p>'}
        <div class="row"><input id="pickQ" type="text" value="${esc(alertName)}" placeholder="Scrivi il nome"><button type="button" id="pickGo">Cerca</button><button type="button" id="pickStop">Annulla</button></div></div>`;
      box.querySelectorAll('button[data-i]').forEach(b => b.onclick = () => { box.innerHTML = ''; resolve(rows[+b.dataset.i]); });
      $('pickStop').onclick = () => { box.innerHTML = ''; resolve(null); };
      $('pickGo').onclick = () => {
        const q = $('pickQ').value.trim();
        const found = (catalog || []).map(t => ({ ...t, sim: 1 })).filter(t => {
          const n = (t.name || '').toLowerCase();
          return n.includes(q.toLowerCase()) || q.length >= 3 && n.split(/\s+/).some(w => w.startsWith(q.toLowerCase()));
        }).slice(0, 10);
        draw(found.length ? found : rows, found.length ? `Risultati per «${q}».` : `Niente per «${q}». Prova un altro nome.`);
      };
    };
    draw(list, list.length ? `Non sono sicuro di «${alertName}». Scegli la squadra.` : `Non trovo «${alertName}» nell'archivio. Cerca il nome usato dal campionato.`);
  });
}
function viewOf(c, teamId, det) {
  const home = c.h === teamId;
  const goals = det && det.ok ? det.goals.map(g => ({ min: g[0], extra: g[1] || 0, for: (g[2] === 1) === home })) : [];
  let xgFor = null, xgAgainst = null;
  if (det && det.xg) {
    xgFor = home ? det.xg[0] : det.xg[1];
    xgAgainst = home ? det.xg[1] : det.xg[0];
  }
  return {
    id: c.id, t: c.t, home, opp: home ? c.an : c.hn, date: fmtDate(c.t),
    gf: home ? c.hg : c.ag, ga: home ? c.ag : c.hg,
    goalsOk: !!(det && det.ok), goals, xgFor, xgAgainst,
  };
}
function tableXg(league, id) {
  const r = (league.xg || []).find(x => x.id === id);
  if (!r || !r.played) return null;
  return { xgFor: r.xg / r.played, xgAg: r.xga / r.played, n: r.played, totalFor: r.xg, totalAg: r.xga };
}

let LAST = null;

function ritLine(r, nonePhrase) {
  if (!r) return '';
  if (r.partial && r.n === 0) return 'Minuti dei gol mancanti sull\'ultima partita: ritardo non calcolabile.';
  if (r.open) return r.n === 0 ? 'Nessuna partita di campionato finita in stagione.' : `${nonePhrase} nelle ${r.n} partite di questa stagione.`;
  const when = r.when ? ` Ultimo: ${esc(r.when.date)} contro ${esc(r.when.opp)} (${r.when.gf}-${r.when.ga}).` : '';
  const extra = r.partial ? ' Poi manca il dettaglio di una partita più vecchia.' : '';
  const before = r.n === 0 ? 'È successo nell\'ultima partita.' : (r.n === 1 ? '1 partita prima.' : `${r.n} partite prima.`);
  return before + when + extra;
}
function bigRit(r) {
  if (!r) return '–';
  if (r.partial && r.n === 0) return 'n.d.';
  return String(r.n) + (r.partial ? '+' : '');
}

function ssBlock(doc, key) {
  if (!doc || !key) return null;
  const t = (doc.timing && doc.timing.overall && doc.timing.overall[key]) || null;
  const home = (doc.timing && doc.timing.home && doc.timing.home[key]) || null;
  const away = (doc.timing && doc.timing.away && doc.timing.away[key]) || null;
  const ou = (doc.ou && doc.ou['full:overall'] && doc.ou['full:overall'][key]) || null;
  const h2 = (doc.ou && doc.ou['h2:overall'] && doc.ou['h2:overall'][key]) || null;
  const h2h = (doc.ou && doc.ou['h2:home'] && doc.ou['h2:home'][key]) || null;
  const h2a = (doc.ou && doc.ou['h2:away'] && doc.ou['h2:away'][key]) || null;
  return { t, home, away, ou, h2, h2h, h2a, name: key };
}

function render() {
  if (!LAST) return;
  const { A, league, home, away, ss, ssNameH, ssNameA, note, source, fmTeams } = LAST;
  const comm = Math.max(0, Math.min(20, parseFloat(String($('comm').value).replace(',', '.')) || 0)) / 100;
  const tr = trading(home.rows, away.rows, A, ss, comm);
  const ad = advice(A, home.name, away.name, tr, league.season);
  const win = alertWindow(A);
  const hb = win ? windowBoard(home.rows, win.after) : null;
  const ab = win ? windowBoard(away.rows, win.after) : null;
  const sh = ssBlock(ss, ssNameH), sa = ssBlock(ss, ssNameA);
  const colors = ['#7ad7ff', '#3dff8a', '#ffe08a', '#ffb067', '#ff7ad9', '#ff5a5a'];
  const bands = ['0-15′', '16-30′', '31-45′+', '46-60′', '61-75′', '76-90′+'];
  const share = tr.totals.goals ? tr.totals.share : null;

  const teamCard = (side, b) => {
    const sig = (r, label, nonePhrase) => {
      const on = r && r.n >= 10;
      return `<div class="${on ? 'metric' : 'metric muted'}"><span class="k">${label}${on ? '' : ' · sotto 10, non segnalato'}</span><b>${bigRit(r)}</b><div class="subn">${ritLine(r, nonePhrase)}</div></div>`;
    };
    return `<article class="card ${[b.r10, b.r01].some(r => r && r.n >= 10) ? 'signal' : ''}"><h3>${esc(side.name)}</h3>
      <div class="metric"><span class="k">Ritardo 0-0</span><b>${bigRit(b.zz)}</b><div class="subn">${ritLine(b.zz, 'Nessun 0-0')}</div></div>
      ${sig(b.r10, 'Ritardo 1-0 (vittoria 1-0)', 'Nessuna vittoria per 1-0')}
      ${sig(b.r01, 'Ritardo 0-1 (sconfitta 0-1)', 'Nessuna sconfitta per 0-1')}
      <p class="def">${b.n} partite di questo campionato finite, in stagione.</p></article>`;
  };
  const winCard = (side, w) => `<article class="card"><h3>${esc(side.name)}</h3>
    <div class="metric"><span class="k">${esc(win.title)}</span><b>${bigRit(w.any)}</b><div class="subn">${ritLine(w.any, 'Nessun gol in questa finestra')}</div></div>
    <div class="metric"><span class="k">Ritardo over 0,5 segnati ${win.id === 'last30' ? 'ultimi 30 minuti' : 'nel secondo tempo'}</span><b>${bigRit(w.scored)}</b><div class="subn">${ritLine(w.scored, 'Non ha segnato in questa finestra')} In stagione: ${pct(w.pFor)} delle partite con minuti letti.</div></div>
    <div class="metric"><span class="k">Ritardo over 0,5 subiti ${win.id === 'last30' ? 'ultimi 30 minuti' : 'nel secondo tempo'}</span><b>${bigRit(w.conceded)}</b><div class="subn">${ritLine(w.conceded, 'Non ha subito in questa finestra')} In stagione: ${pct(w.pAg)}.</div></div>
    <p class="def">Minuti gol letti su ${w.nKnown} di ${w.nAll} partite. Finite 0-0 a quel minuto: ${w.condK}/${w.condN || 0} poi un gol.</p></article>`;

  const xgRow = (label, p) => `<tr><td>${esc(label)}</td><td>${n2(p && p.xgFor)}</td><td>${n2(p && p.xgAg)}</td><td>${p && p.n ? p.n : '–'}</td></tr>`;
  const live = A.stats.xg;

  let html = `<section class="card hero">
    <div class="muted">${esc(league.country)} · ${esc(league.name)} · ${esc(league.season)}</div>
    <div class="teams"><span>${esc(home.name)}</span><span class="score">${A.score[0]}–${A.score[1]}</span><span>${esc(away.name)}</span></div>
    <div class="minute">${esc(A.timer.label)}${A.phase === 'HT' ? ' · alert del 45′' : A.minute >= 58 ? ' · alert del 60′' : ''}</div>
    <div>${A.stats.sot ? `<span class="tag">Tiri in porta ${A.stats.sot[0]}-${A.stats.sot[1]}</span>` : ''}${A.stats.red && (A.stats.red[0] || A.stats.red[1]) ? `<span class="tag">Rossi ${A.stats.red[0]}-${A.stats.red[1]}</span>` : ''}</div>
  </section>`;
  if (note) html += `<section class="card warn"><p>${esc(note)}</p></section>`;
  if (A.warnings.length) html += `<section class="card warn"><p>${A.warnings.map(esc).join('<br>')}</p></section>`;

  if (A.is00) {
    html += `<section class="card"><h2>Ritardo 0-0, 1-0 e 0-1</h2>
      <p class="def">Solo questo campionato, stagione in corso. Il 1-0 è una vittoria della squadra per 1-0 (casa o trasferta). Lo 0-1 è una sconfitta per 0-1. Il segnale 1-0 / 0-1 compare solo da 10 partite in su. Sotto 10 il numero resta visibile, senza segnale.</p>
      <div class="duo">${teamCard(home, home.board)}${teamCard(away, away.board)}</div></section>`;
  } else {
    html += `<section class="card"><p>Punteggio ${A.score[0]}-${A.score[1]}: i ritardi 0-0, 1-0 e 0-1 si mostrano quando l'alert è sullo 0-0.</p></section>`;
  }

  if (win && hb && ab) {
    html += `<section class="card signal"><h2>${esc(win.title)}</h2><p class="def">${esc(win.def)} Coppe e altre competizioni non entrano nel conto.</p>
      <div class="duo">${winCard(home, hb)}${winCard(away, ab)}</div></section>`;
  } else {
    html += `<section class="card"><h2>Ritardo ultimi 30 minuti</h2><p class="def">Questo conteggio (gol dal 61′ al 90′+) si apre sull'alert del minuto 60. All'intervallo il ritardo è quello del secondo tempo, dal 46′.</p></section>`;
  }

  html += `<section class="card"><h2>xG di campionato e xG live</h2>
    <table><thead><tr><th></th><th>xG fatti</th><th>xG subiti</th><th>Partite</th></tr></thead><tbody>
    ${xgRow(home.name + ' · stagione', home.xg.all)}
    ${xgRow(home.name + ' · in casa', home.xg.home)}
    ${xgRow(away.name + ' · stagione', away.xg.all)}
    ${xgRow(away.name + ' · in trasferta', away.xg.away)}
    ${home.tableXg ? `<tr><td>${esc(home.name)} · tabella FotMob</td><td>${n2(home.tableXg.xgFor)}</td><td>${n2(home.tableXg.xgAg)}</td><td>${home.tableXg.n}</td></tr>` : ''}
    ${away.tableXg ? `<tr><td>${esc(away.name)} · tabella FotMob</td><td>${n2(away.tableXg.xgFor)}</td><td>${n2(away.tableXg.xgAg)}</td><td>${away.tableXg.n}</td></tr>` : ''}
    <tr><td>Live, in questo alert</td><td>${live ? n2(live[0]) : '–'}</td><td>${live ? n2(live[1]) : '–'}</td><td>oggi</td></tr>
    </tbody></table>
    <p class="def">La riga «in casa» / «in trasferta» usa gli xG delle singole partite di questo campionato. Se ce ne sono meno di 3, il consiglio usa la media della stagione. La tabella FotMob è il totale ufficiale del campionato, senza lo split casa/trasferta.</p>
    ${ad.lines.map(l => `<p>${esc(l)}</p>`).join('')}
    <p class="move">${esc(ad.move)}</p>
    <h3>Come leggere gli xG, da zero</h3>
    <ul class="guide">${XG_GUIDE.map(t => `<li>${esc(t)}</li>`).join('')}</ul>
  </section>`;

  const mkt = tr.market;
  html += `<section class="card"><h2>Da qui al novantesimo</h2>
    <p class="def">Finestra usata: ${win ? esc(win.def) : `dal ${A.minute}′ alla fine, sui gol già visti in stagione`}. Probabilità mescolata: modello dei gol nella finestra (${pct(tr.pModel)}) e, quando il campione basta, la frequenza reale delle due squadre (${tr.pEmp == null ? 'campione piccolo, non usata' : pct(tr.pEmp) + ' su ' + tr.nEmp + ' partite'}).</p>
    <div class="trio">
      <div class="card"><div class="k">Almeno un gol da qui</div><div class="big">${pct(tr.p)}</div><div class="subn">quota equa ${n2(tr.th.fair)}</div></div>
      <div class="card"><div class="k">Back Over, quota minima</div><div class="big">${n2(tr.th.backMin)}</div><div class="subn">commissione ${n1(comm * 100)}% già tolta</div></div>
      <div class="card"><div class="k">${A.is00 ? 'Lay pareggio, sotto questa quota' : 'Lay del pareggio'}</div><div class="big">${A.is00 ? n2(tr.th.layMax) : '–'}</div><div class="subn">${A.is00 ? 'Sullo 0-0 il lay del pareggio paga se arriva un gol, come l\'Over 0,5. La quota però è quella del pareggio, non quella dell\'Over.' : 'Con dei gol già fatti, il lay del pareggio non coincide con l\'Over del prossimo gol.'}</div></div>
    </div>
    <p>Prossimo gol ${esc(home.name)}: probabilità ${pct(tr.p * tr.shareH)}, quota equa ${n2(tr.nextH && tr.nextH.fair)}, back sopra ${n2(tr.nextH && tr.nextH.backMin)}.</p>
    <p>Prossimo gol ${esc(away.name)}: probabilità ${pct(tr.p * (1 - tr.shareH))}, quota equa ${n2(tr.nextA && tr.nextA.fair)}, back sopra ${n2(tr.nextA && tr.nextA.backMin)}.</p>
    <p class="def">Gol medi usati nel modello: ${n2(tr.lh)} per ${esc(home.name)} (${tr.hs.venue ? 'solo le gare in casa' : 'tutte le gare di stagione'}, ${tr.hs.n} partite) e ${n2(tr.la)} per ${esc(away.name)} (${tr.as.venue ? 'solo le gare in trasferta' : 'tutte le gare'}, ${tr.as.n}). Media di campionato nella finestra, da SoccerStats: ${n2(tr.leagueLambda)} gol a partita.${tr.leagueP2h != null ? ` Nel secondo tempo SoccerStats vede almeno un gol nel ${pct(tr.leagueP2h)} delle partite.` : ''}</p>
    ${mkt ? `<p>Quota Over 0,5 dell'alert: ${n2(tr.ou.over)} (under ${n2(tr.ou.under)}). Tolta la margine del book, il mercato dice ${pct(mkt.pOver)}. La nostra stima è ${pct(tr.p)}. ${tr.ou.over >= tr.th.backMin ? 'La quota dell\'alert è sopra la soglia di entrata del back.' : 'La quota dell\'alert è sotto la soglia: a questo prezzo il back non ha valore, con questa stima e questa commissione.'}</p>` : '<p>L\'alert non ha la quota Over 0,5: la soglia resta il prezzo da cercare sull\'exchange.</p>'}
    ${share ? `<h3>Dove arrivano i gol in questo campionato</h3><p class="def">Quota dei gol di stagione per fascia, SoccerStats, tutte le squadre (${Math.round(tr.totals.matches)} partite).</p>
      <div class="bar">${share.map((s, i) => `<i style="width:${(s * 100).toFixed(1)}%;background:${colors[i]}"></i>`).join('')}</div>
      <div class="legend">${bands.map((b, i) => `<span><i class="dot" style="background:${colors[i]}"></i>${b} ${Math.round(share[i] * 100)}%</span>`).join('')}</div>` : ''}
  </section>`;

  const ssTeam = (block, side) => {
    if (!block || !block.t) return `<article class="card"><h3>${esc(side.name)}</h3><p>Nome non trovato nelle tabelle SoccerStats.</p></article>`;
    const b = block.t.b || [];
    const last = (b[4] && b[5]) ? [b[4][0] + b[5][0], b[4][1] + b[5][1]] : null;
    return `<article class="card"><h3>${esc(block.name)}</h3>
      <p>${block.t.gp} partite. Gol segnati-subiti negli ultimi 30 minuti (61-90′): <b>${last ? last[0] + '-' + last[1] : '–'}</b>. Nel secondo tempo: ${block.t.h2 ? block.t.h2[0] + '-' + block.t.h2[1] : '–'}.</p>
      <p>Over 0,5 a fine gara: ${block.ou ? n1(block.ou.o05) + '% su ' + block.ou.gp : '–'}. Over 0,5 solo nel secondo tempo: ${block.h2 ? n1(block.h2.o05) + '%' : '–'}.
      ${block.h2h ? ` In casa, secondo tempo: ${n1(block.h2h.o05)}%.` : ''} ${block.h2a ? ` In trasferta, secondo tempo: ${n1(block.h2a.o05)}%.` : ''}</p>
      <p class="def">Porta inviolata (clean sheet) ${block.ou ? n1(block.ou.cs) + '%' : '–'} · non ha segnato ${block.ou ? n1(block.ou.fts) + '%' : '–'} · entrambe a segno ${block.ou ? n1(block.ou.bts) + '%' : '–'}.</p></article>`;
  };
  const fmCard = (id, sideName) => {
    const t = (fmTeams || []).find(x => x.id === id);
    if (!t) return `<article class="card"><h3>${esc(sideName)}</h3><p>Questa squadra non è ancora nell'archivio dei minuti.</p></article>`;
    const last = [t.b[4][0] + t.b[5][0], t.b[4][1] + t.b[5][1]];
    const pc = (k, n) => n ? Math.round(100 * k / n) + '%' : '–';
    return `<article class="card"><h3>${esc(t.name)}</h3>
      <p>${t.gp} partite con i minuti. Gol segnati-subiti negli ultimi 30 minuti: <b>${last[0]}-${last[1]}</b>. Nel secondo tempo: ${t.h2[0]}-${t.h2[1]}.</p>
      <p>Partite con almeno un gol dopo il 60′: <b>${pc(t.any60, t.gp)}</b>. Nel secondo tempo: <b>${pc(t.any2, t.gp)}</b>. Over 0,5 a fine gara: ${pc(t.over05, t.gp)}.</p>
      <p class="def">In casa, gol nel secondo tempo: ${pc(t.home.any2, t.home.gp)} (${t.home.gp} gare). In trasferta: ${pc(t.away.any2, t.away.gp)} (${t.away.gp} gare).</p></article>`;
  };
  if (source === 'fotmob') {
    const lg = (ss && ss.league) || {};
    html += `<section class="card"><h2>Tempi dei gol, tutte le squadre</h2>
      <p class="def">Calcolati sul minuto di ogni gol di questo campionato, stagione in corso. Fonte: archivio FotMob del ${esc((ss.updated || '').replace('T', ' ').replace('Z', ' UTC'))}, ${lg.matches || '–'} partite, ${ (fmTeams || []).length } squadre. Vale anche per Serie C e per i campionati minori: non è la tabella di SoccerStats, che in pubblico ne mostra solo 5.</p>
      <p>Nel campionato, almeno un gol nel secondo tempo: <b>${pct(lg.p2h)}</b>. Almeno un gol dopo il 60′: <b>${pct(lg.p60)}</b>.</p>
      <div class="duo">${fmCard(home.id, home.name)}${fmCard(away.id, away.name)}</div>
    </section>`;
  } else {
    html += `<section class="card"><h2>SoccerStats, solo di riserva</h2>
      <p class="def">${ss ? `I minuti gara per gara di questo campionato non sono ancora in archivio. Uso SoccerStats del ${esc((ss.updated || '').replace('T', ' ').replace('Z', ' UTC'))}.` : 'Né l\'archivio dei minuti né SoccerStats hanno questo campionato.'}${ss && Object.keys((ss.timing && ss.timing.overall) || {}).length <= 5 ? ' La pagina pubblica di SoccerStats mostra solo 5 squadre: se la tua non c\'è, il ritardo sopra resta quello calcolato sulle partite finite.' : ''}</p>
      ${ss && ss.box && ss.box.matches ? `<p>Stagione: ${ss.box.matches} partite. Over 2,5 ${n1(ss.box.over25)}%.</p>` : ''}
      <div class="duo">${ssTeam(sh, home)}${ssTeam(sa, away)}</div>
    </section>`;
  }

  html += `<p class="foot">Definizioni usate in questa schermata. 0-0 = partita finita senza gol. 1-0 / 0-1 = risultato della squadra, non il punteggio «casa-trasferta» della gara. Ultimi 30 minuti = minuti 61, 62, … 90 e recupero. Secondo tempo = dal 46′ compreso il recupero del secondo tempo. Campione: solo le gare finite di ${esc(league.name)} ${esc(league.season)}.</p>`;
  $('out').innerHTML = html;
}

async function analyze() {
  $('out').innerHTML = '';
  $('picker').innerHTML = '';
  const A = parseAlert($('alert').value);
  if (!A.home || !A.away) {
    $('out').innerHTML = '<section class="card bad"><p>Non trovo le due squadre. La riga deve essere del tipo «Como vs Venezia».</p></section>';
    return;
  }
  $('go').disabled = true;
  try {
    progress(8, 'Cerco le squadre nell\'archivio…');
    const catRes = await fetch('data/fotmob/teams.json');
    if (!catRes.ok) throw new Error('Elenco squadre non disponibile. Ricarica la pagina tra qualche minuto.');
    const catalog = ((await catRes.json()).teams || []);
    const choice = choosePair(A.home, A.away, catalog, A.league, A.iso2);
    let homeTeam = choice.best && choice.best.h;
    let awayTeam = choice.best && choice.best.a;
    if (!choice.sure) {
      const country = canonCountry(A.iso2);
      const pool = country ? catalog.filter(t => canonCountry(t.country) === country) : catalog;
      homeTeam = await ask('squadra di casa', A.home, choice.home.length ? choice.home : pool.slice(0, 10), pool.length ? pool : catalog);
      if (!homeTeam) { $('out').innerHTML = '<section class="card"><p>Analisi annullata.</p></section>'; return; }
      const same = (pool.length ? pool : catalog).filter(t => t.leagueId === homeTeam.leagueId && t.id !== homeTeam.id);
      awayTeam = await ask('squadra ospite', A.away, choice.away.filter(t => t.leagueId === homeTeam.leagueId).length ? choice.away.filter(t => t.leagueId === homeTeam.leagueId) : same.slice(0, 10), same);
      if (!awayTeam) { $('out').innerHTML = '<section class="card"><p>Analisi annullata.</p></section>'; return; }
    }
    if (!homeTeam || !awayTeam || homeTeam.leagueId !== awayTeam.leagueId) {
      $('out').innerHTML = '<section class="card bad"><p>Le due squadre devono essere dello stesso campionato. Riprova e scegli i nomi dalla lista.</p></section>';
      return;
    }
    progress(22, 'Apro il campionato…');
    const ar = await fetch('data/fotmob/' + homeTeam.leagueId + '.json');
    if (!ar.ok) {
      $('out').innerHTML = `<section class="card bad"><h2>Campionato non ancora pronto</h2><p>Ho trovato le squadre, ma le partite di questo campionato non sono ancora sul sito.</p><p class="def">L'aggiornamento automatico aggiunge i campionati che hanno giocato negli ultimi giorni. Riprova più tardi.</p></section>`;
      return;
    }
    const doc = await ar.json();
    const league = {
      id: String(doc.leagueId), name: doc.name || homeTeam.league, country: doc.country || '', season: doc.season || '',
      xg: doc.xg || [],
      matches: Object.entries(doc.matches || {}).map(([id, m]) => ({ id, t: m.t, h: String(m.h), a: String(m.a), hn: m.hn, an: m.an, hg: m.hg, ag: m.ag })),
    };
    const pair = { h: { ...homeTeam, id: String(homeTeam.id), name: homeTeam.name }, a: { ...awayTeam, id: String(awayTeam.id), name: awayTeam.name } };
    const today = romeDay(Date.now());
    const hid = pair.h.id, aid = pair.a.id;
    const rowsOf = id => league.matches.filter(m => {
      if (m.h !== id && m.a !== id) return false;
      if ((m.h === hid && m.a === aid || m.h === aid && m.a === hid) && romeDay(m.t) === today) return false;
      return true;
    }).sort((a, b) => b.t - a.t);
    const hComp = rowsOf(hid), aComp = rowsOf(aid);
    const archive = doc;
    const detMap = new Map();
    let missingMinutes = 0;
    for (const c of hComp.concat(aComp)) {
      if (detMap.has(c.id)) continue;
      const a = archive.matches && archive.matches[c.id];
      if (a && a.ok && Array.isArray(a.goals)) detMap.set(c.id, { ok: true, goals: a.goals, xg: a.xg || null });
      else { detMap.set(c.id, null); missingMinutes++; }
    }
    progress(80, 'Minuti dei gol già in archivio');
    const homeRows = hComp.map(c => viewOf(c, hid, detMap.get(c.id)));
    const awayRows = aComp.map(c => viewOf(c, aid, detMap.get(c.id)));
    const built = archive && archive.matches ? timingFromArchive(archive.matches) : null;
    const covered = built && built.teams.some(t => t.id === hid) && built.teams.some(t => t.id === aid);
    let ss = covered ? archiveAsStats(built, archive.updated) : null;
    let ssNameH = null, ssNameA = null, note = missingMinutes ? `Mancano i minuti di ${missingMinutes} partite: quei ritardi sui tempi dei gol si fermano lì. Lo 0-0, l'1-0 e lo 0-1 usano comunque il risultato.` : '', source = covered ? 'fotmob' : '';
    if (!covered) {
      progress(90, 'Minuti non in archivio: provo SoccerStats…');
      try {
        const idx = await (await fetch('data/soccerstats/index.json')).json();
        const hit = matchSoccerstats(idx, { name: league.name, country: league.country || A.iso2 });
        if (hit) {
          const r = await fetch('data/soccerstats/' + hit.code + '.json');
          if (r.ok) {
            ss = await r.json();
            source = 'soccerstats';
            const names = Object.keys((ss.timing && ss.timing.overall) || {});
            ssNameH = (pickSsTeam(names, pair.h.name) || {}).name || null;
            ssNameA = (pickSsTeam(names, pair.a.name) || {}).name || null;
            note = 'I minuti di questo campionato non sono ancora nell\'archivio. Mostro SoccerStats, che sui campionati minori elenca solo 5 squadre.';
          }
        }
      } catch (e) {}
      if (!ss) note = 'Archivio dei minuti non ancora pronto per questo campionato. I ritardi 0-0, 1-0 e 0-1 usano i risultati; i tempi dei gol arrivano appena la partita è nell\'archivio.';
    }
    LAST = {
      A, league, note, source, fmTeams: covered ? built.teams : null,
      home: { id: hid, name: pair.h.name, rows: homeRows, board: scoreBoard(homeRows), xg: xgProfile(homeRows), tableXg: tableXg(league, hid) },
      away: { id: aid, name: pair.a.name, rows: awayRows, board: scoreBoard(awayRows), xg: xgProfile(awayRows), tableXg: tableXg(league, aid) },
      ss, ssNameH, ssNameA,
    };
    $('prog').hidden = true;
    render();
  } catch (e) {
    $('prog').hidden = true;
    $('out').innerHTML = `<section class="card bad"><h2>Non sono riuscito a leggere i dati</h2><p>${esc(e.message || e)}</p><p class="def">I conti usano l'archivio del sito, aggiornato da solo. Se il campionato è nuovo, riprova dopo il prossimo aggiornamento.</p></section>`;
  } finally {
    $('go').disabled = false;
  }
}

$('go').onclick = analyze;
$('ex45').onclick = () => { $('alert').value = EX45; analyze(); };
$('ex60').onclick = () => { $('alert').value = EX60; analyze(); };
$('exC').onclick = () => { $('alert').value = EXC; analyze(); };
$('comm').onchange = () => { try { localStorage.setItem('sg:comm', $('comm').value); } catch (e) {} render(); };
try { const c = localStorage.getItem('sg:comm'); if (c) $('comm').value = c; } catch (e) {}
