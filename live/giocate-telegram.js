// Testo con emoji e immagine JPG (canvas) per Telegram. Prematch e risultati.

import {
  betDate, betKickoff, betLeague, formatDateIT, formatDateShort, formatOdds,
  formatPlainMoney, formatSignedMoney, oddsForBet, profitOf,
} from './giocate-model.js';

const RESULT = {
  vinta: ['✅', 'VINTA', '#22c55e'],
  persa: ['❌', 'PERSA', '#ef4444'],
  void: ['♻️', 'RIMBORSO', '#a3a3a3'],
  cashout: ['💵', 'CASH OUT', '#eab308'],
};

export function sortForPost(bets) {
  return [...bets].sort((a, b) => {
    const d = betDate(a).localeCompare(betDate(b));
    if (d) return d;
    const ka = betKickoff(a);
    const kb = betKickoff(b);
    if (ka !== kb) return ka.localeCompare(kb);
    return String(a.createdAt).localeCompare(String(b.createdAt));
  });
}

function resultOf(bet) {
  return RESULT[bet.result] || ['⏳', 'IN ATTESA', '#eab308'];
}

function sums(bets) {
  let profit = 0;
  let any = false;
  let wins = 0;
  let losses = 0;
  let voids = 0;
  let pending = 0;
  for (const bet of bets) {
    if (!bet.result) { pending += 1; continue; }
    const p = profitOf(bet);
    if (p == null) { pending += 1; continue; }
    any = true;
    profit += p;
    if (bet.result === 'vinta' || (bet.result === 'cashout' && p > 0)) wins += 1;
    else if (bet.result === 'persa' || (bet.result === 'cashout' && p < 0)) losses += 1;
    else voids += 1;
  }
  return { profit: any ? Math.round((profit + Number.EPSILON) * 100) / 100 : null, wins, losses, voids, pending, any };
}

function heroFor(bets, mode) {
  if (mode !== 'risultati') return { word: 'PREMATCH', color: '#38bdf8', emoji: '⚽️' };
  if (bets.length === 1 && bets[0].result) {
    const [emoji, word, color] = resultOf(bets[0]);
    return { word, color, emoji };
  }
  const s = sums(bets);
  if (s.wins > 0 && s.losses === 0 && s.pending === 0) return { word: 'TUTTE VINTE', color: '#22c55e', emoji: '✅' };
  if (s.losses > 0 && s.wins === 0 && s.pending === 0) return { word: 'TUTTE PERSE', color: '#ef4444', emoji: '❌' };
  const color = s.profit == null ? '#eab308' : s.profit >= 0 ? '#22c55e' : '#ef4444';
  return { word: 'RISULTATI', color, emoji: '📣' };
}

function selectionLines(bet, mode) {
  return bet.selections.map((s, i) => {
    const n = bet.kind === 'multipla' ? `${i + 1}️⃣ ` : '';
    const res = mode === 'risultati' && bet.kind === 'multipla' ? `${(RESULT[s.result] || ['⏳', ''])[0]} ` : '';
    const head = `${n}${res}${s.kickoff || '—'} · ${s.home} – ${s.away}`.trim();
    const market = `${bet.side === 'lay' ? 'LAY · ' : ''}${s.market || 'Giocata da indicare'}`;
    const odds = s.odds == null ? '' : `quota ${formatOdds(s.odds)}`;
    return { head, league: s.league ? `${s.league}${s.country ? ` (${s.country})` : ''}` : '', market, odds, score: s.score || '' };
  });
}

function betBlock(bet, opt) {
  const lines = [];
  const price = oddsForBet(bet, { settlement: false });
  if (bet.kind === 'multipla') lines.push('🎲 MULTIPLA');
  else if (opt.mode === 'risultati') {
    const [emoji, word] = resultOf(bet);
    lines.push(`${emoji} ${word}`);
  }
  if (bet.kind === 'singola') {
    const s = bet.selections[0];
    lines.push(`🕒 ${s.kickoff || '—'}`);
    lines.push(`🏟 ${s.home} – ${s.away}`);
    if (s.league) lines.push(`🏆 ${s.league}${s.country ? ` (${s.country})` : ''}`);
    lines.push(`🎯 ${bet.side === 'lay' ? 'LAY · ' : ''}${s.market || 'Giocata da indicare'}`);
    if (s.odds != null) lines.push(`📊 Quota ${formatOdds(s.odds)}`);
    if (opt.mode === 'risultati' && s.score) lines.push(`🏁 ${s.score}`);
  } else {
    if (price != null) lines.push(`📊 Quota totale ${formatOdds(price)}`);
  }
  if (opt.showStake && bet.stake != null) lines.push(`💰 Puntata ${formatPlainMoney(bet.stake)}`);
  if (opt.mode === 'risultati' && bet.result) {
    const p = profitOf(bet);
    if (p != null) lines.push(`💵 Utile ${formatSignedMoney(p)}`);
  }
  if (bet.bookmaker) lines.push(`🏦 ${bet.bookmaker}`);
  if (bet.kind === 'multipla') {
    lines.push('');
    for (const sel of selectionLines(bet, opt.mode)) {
      lines.push(sel.head);
      if (sel.league) lines.push(`🏆 ${sel.league}`);
      lines.push(`🎯 ${sel.market}${sel.odds ? ` · ${sel.odds}` : ''}`);
      if (opt.mode === 'risultati' && sel.score) lines.push(`🏁 ${sel.score}`);
      lines.push('');
    }
  }
  return lines;
}

export function buildPost(bets, opts = {}) {
  const mode = opts.mode === 'risultati' ? 'risultati' : 'prematch';
  const showStake = !!opts.showStake;
  const list = sortForPost(bets);
  const dateLabel = opts.dateLabel || (list[0] ? formatDateIT(betDate(list[0])) : '');
  const hero = heroFor(list, mode);
  const tally = sums(list);
  const scope = opts.scope || (list.length > 1 ? 'day' : 'bet');
  const header = [];
  header.push(`${hero.emoji} ${hero.word}${dateLabel ? ` · ${dateLabel}` : ''}`);
  if (mode === 'prematch') header.push(list.length === 1 ? '1 giocata' : `${list.length} giocate`);
  else {
    const title = scope === 'day' ? 'Utile giornata' : 'Utile';
    header.push(`💵 ${title} ${tally.profit == null ? '—' : formatSignedMoney(tally.profit)}`);
    header.push(`✅ ${tally.wins} vinte · ❌ ${tally.losses} perse · ♻️ ${tally.voids} rimborsi${tally.pending ? ` · ⏳ ${tally.pending} in attesa` : ''}`);
  }
  const blocks = list.map((bet) => betBlock(bet, { mode, showStake }));
  const text = [...header, '', ...blocks.flatMap((b, i) => (i ? ['──────────', '', ...b, ''] : [...b, '']))].join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
  const model = {
    accent: hero.color,
    hero: hero.word,
    subtitle: dateLabel || 'Giocate',
    profitLabel: mode === 'risultati' ? (tally.profit == null ? 'Utile —' : formatSignedMoney(tally.profit)) : '',
    profitColor: mode === 'risultati' ? (tally.profit == null ? '#eab308' : tally.profit >= 0 ? '#22c55e' : '#ef4444') : '#fff',
    record: mode === 'risultati'
      ? `${tally.wins} vinte · ${tally.losses} perse · ${tally.voids} rimborsi`
      : (list.length === 1 ? '1 giocata' : `${list.length} giocate`),
    cards: list.map((bet) => cardModel(bet, { mode, showStake })),
  };
  return { text, model, hero };
}

function cardModel(bet, opt) {
  const [emoji, word, color] = opt.mode === 'risultati' ? resultOf(bet) : ['', bet.kind === 'multipla' ? 'MULTIPLA' : 'SINGOLA', '#38bdf8'];
  const price = oddsForBet(bet, { settlement: false });
  const meta = [];
  if (opt.showStake && bet.stake != null) meta.push(`Puntata ${formatPlainMoney(bet.stake)}`);
  if (bet.side === 'lay') meta.push('LAY');
  if (bet.bookmaker) meta.push(bet.bookmaker);
  if (opt.mode === 'risultati' && bet.result) {
    const p = profitOf(bet);
    if (p != null) meta.push(`Utile ${formatSignedMoney(p)}`);
  }
  return {
    badge: opt.mode === 'risultati' ? word : (bet.kind === 'multipla' ? 'MULTIPLA' : 'SINGOLA'),
    badgeColor: opt.mode === 'risultati' ? color : '#38bdf8',
    emoji,
    when: `${formatDateShort(betDate(bet))}${betKickoff(bet) ? ' · ' + betKickoff(bet) : ''}`,
    title: bet.kind === 'singola'
      ? `${bet.selections[0].home} – ${bet.selections[0].away}`
      : 'Multipla',
    league: bet.kind === 'singola' ? (betLeague(bet) === 'Più campionati' ? '' : betLeague(bet)) : `${bet.selections.length} selezioni`,
    lines: bet.kind === 'singola'
      ? [{ left: `${bet.side === 'lay' ? 'LAY · ' : ''}${bet.selections[0].market || '—'}`, right: bet.selections[0].odds == null ? '—' : formatOdds(bet.selections[0].odds) }]
      : bet.selections.map((s) => ({
        left: `${s.kickoff || '—'}  ${s.home} – ${s.away}`,
        sub: `${bet.side === 'lay' ? 'LAY · ' : ''}${s.market || '—'}${s.score && opt.mode === 'risultati' ? ' · ' + s.score : ''}`,
        right: s.odds == null ? '—' : formatOdds(s.odds),
        badge: opt.mode === 'risultati' ? (RESULT[s.result] || ['⏳', 'ATTESA'])[1] : '',
      })),
    total: bet.kind === 'multipla' && price != null ? `Quota totale ${formatOdds(price)}` : '',
    score: opt.mode === 'risultati' && bet.kind === 'singola' && bet.selections[0].score ? `Finale ${bet.selections[0].score}` : '',
    meta,
  };
}

function fontOf(size, weight, display) {
  const family = display ? 'Oswald, sans-serif' : '"Source Sans 3", sans-serif';
  return `${weight} ${size}px ${family}`;
}

function wrap(ctx, text, maxWidth) {
  const words = String(text || '').split(/\s+/).filter(Boolean);
  if (!words.length) return [''];
  const lines = [];
  let cur = '';
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (cur && ctx.measureText(next).width > maxWidth) {
      lines.push(cur);
      cur = w;
    } else cur = next;
  }
  if (cur) lines.push(cur);
  return lines;
}

function roundRect(ctx, x, y, w, h, r) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

const W = 1080;
const PAD = 56;

function textHeight(size) { return Math.ceil(size * 1.28); }

function paintText(ctx, paint, text, x, y, { size, weight = 600, display = false, color = '#fff', align = 'left', maxWidth }) {
  ctx.font = fontOf(size, weight, display);
  ctx.textAlign = align;
  ctx.textBaseline = 'top';
  const lines = maxWidth ? wrap(ctx, text, maxWidth) : [String(text ?? '')];
  for (const line of lines) {
    if (paint) {
      ctx.font = fontOf(size, weight, display);
      ctx.fillStyle = color;
      ctx.textAlign = align;
      ctx.textBaseline = 'top';
      ctx.fillText(line, x, y);
    }
    y += textHeight(size);
  }
  return y;
}

function layoutCard(ctx, card, x, y, w, paint) {
  const innerX = x + 32;
  const innerW = w - 64;
  let cy = y + 28;
  if (paint) {
    const h = layoutCard(ctx, card, x, y, w, false);
    ctx.save();
    roundRect(ctx, x, y, w, h, 28);
    ctx.fillStyle = '#141414';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#2a2a2a';
    ctx.stroke();
    ctx.fillStyle = card.badgeColor || '#38bdf8';
    roundRect(ctx, x + 18, y + 28, 8, Math.max(20, h - 56), 4);
    ctx.fill();
    ctx.restore();
  }
  cy = paintText(ctx, paint, card.when, innerX, cy, { size: 26, weight: 600, color: '#a3a3a3' });
  const badge = card.badge || '';
  if (badge && paint) {
    ctx.font = fontOf(22, 700, true);
    const bw = ctx.measureText(badge).width + 28;
    const bx = x + w - 32 - bw;
    const by = y + 24;
    roundRect(ctx, bx, by, bw, 36, 18);
    ctx.fillStyle = card.badgeColor;
    ctx.fill();
    ctx.fillStyle = '#000';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.font = fontOf(22, 700, true);
    ctx.fillText(badge, bx + 14, by + 7);
  } else if (badge) {
    // keep the same vertical start; badge sits on the first line
  }
  cy += 6;
  cy = paintText(ctx, paint, card.title, innerX, cy, { size: 40, weight: 700, display: true, color: '#fff', maxWidth: innerW - 160 });
  if (card.league) cy = paintText(ctx, paint, card.league, innerX, cy + 2, { size: 24, weight: 600, color: '#9a9a9a', maxWidth: innerW });
  cy += 14;
  if (paint) {
    ctx.strokeStyle = '#2a2a2a';
    ctx.beginPath();
    ctx.moveTo(innerX, cy);
    ctx.lineTo(x + w - 32, cy);
    ctx.stroke();
  }
  cy += 14;
  for (const line of card.lines) {
    const right = line.right || '';
    ctx.font = fontOf(30, 700, false);
    const rightW = right ? ctx.measureText(right).width + 16 : 0;
    cy = paintText(ctx, paint, line.left, innerX, cy, { size: 30, weight: 700, color: '#f4f4f4', maxWidth: innerW - rightW });
    if (right && paint) {
      ctx.font = fontOf(30, 700, true);
      ctx.fillStyle = '#fff';
      ctx.textAlign = 'right';
      ctx.textBaseline = 'top';
      ctx.fillText(right, x + w - 32, cy - textHeight(30));
    }
    if (line.sub) cy = paintText(ctx, paint, line.sub, innerX, cy, { size: 24, weight: 600, color: '#cfcfcf', maxWidth: innerW });
    if (line.badge) cy = paintText(ctx, paint, line.badge, innerX, cy, { size: 22, weight: 700, display: true, color: '#9a9a9a' });
    cy += 8;
  }
  if (card.total) cy = paintText(ctx, paint, card.total, innerX, cy, { size: 32, weight: 700, display: true, color: '#fff' });
  if (card.score) cy = paintText(ctx, paint, card.score, innerX, cy + 4, { size: 26, weight: 700, color: '#eab308' });
  if (card.meta.length) {
    cy += 6;
    cy = paintText(ctx, paint, card.meta.join('   ·   '), innerX, cy, { size: 24, weight: 600, color: '#d4d4d4', maxWidth: innerW });
  }
  return cy - y + 28;
}

export function drawTicket(canvas, model) {
  const ctx = canvas.getContext('2d');
  const run = (paint) => {
    let y = 52;
    if (paint) {
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, W, canvas.height);
      ctx.fillStyle = model.accent || '#22c55e';
      ctx.fillRect(0, 0, W, 12);
    }
    y = paintText(ctx, paint, 'SEGNALI', PAD, y, { size: 24, weight: 700, display: true, color: '#8a8a8a' });
    y += 6;
    y = paintText(ctx, paint, model.hero || 'GIOCATE', PAD, y, { size: 78, weight: 700, display: true, color: '#ffffff', maxWidth: W - PAD * 2 });
    y += 4;
    y = paintText(ctx, paint, model.subtitle || '', PAD, y, { size: 32, weight: 600, color: '#d4d4d4', maxWidth: W - PAD * 2 });
    if (model.profitLabel) {
      y += 12;
      y = paintText(ctx, paint, model.profitLabel, PAD, y, { size: 64, weight: 700, display: true, color: model.profitColor || '#fff' });
    }
    if (model.record) {
      y += 4;
      y = paintText(ctx, paint, model.record, PAD, y, { size: 28, weight: 600, color: '#bdbdbd' });
    }
    y += 28;
    for (const card of model.cards || []) {
      const h = layoutCard(ctx, card, PAD, y, W - PAD * 2, paint);
      y += h + 18;
    }
    y += 8;
    if (paint) {
      ctx.strokeStyle = '#222';
      ctx.beginPath();
      ctx.moveTo(PAD, y);
      ctx.lineTo(W - PAD, y);
      ctx.stroke();
    }
    y += 24;
    y = paintText(ctx, paint, 'Segnali · giocate', PAD, y, { size: 22, weight: 600, color: '#737373' });
    return y + 48;
  };
  canvas.width = W;
  canvas.height = 32;
  const height = run(false);
  canvas.width = W;
  canvas.height = Math.max(420, height);
  run(true);
  return canvas;
}

export async function canvasToJpeg(canvas, quality = 0.92) {
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
  if (!blob) throw new Error('Impossibile creare il JPG.');
  return blob;
}

export async function sendTelegramPhoto(fetchImpl, { token, chatId, blob, caption }) {
  const cleanToken = String(token || '').trim();
  const cleanChat = String(chatId || '').trim();
  if (!/^\d+:[A-Za-z0-9_-]+$/.test(cleanToken)) {
    throw new Error('Token del bot non valido. Lo trovi in BotFather e resta solo su questo dispositivo.');
  }
  if (!/^@[A-Za-z][A-Za-z0-9_]{3,}$|^-?\d+$/.test(cleanChat)) {
    throw new Error('Chat id non valido. Usa un numero (anche negativo per i canali) oppure @nomecanale.');
  }
  const form = new FormData();
  form.set('chat_id', cleanChat);
  form.set('caption', String(caption || '').slice(0, 1024));
  form.set('photo', blob, 'giocata.jpg');
  let res;
  try {
    res = await fetchImpl(`https://api.telegram.org/bot${cleanToken}/sendPhoto`, { method: 'POST', body: form });
  } catch (e) {
    const err = new Error('Telegram blocca l\'invio diretto dal browser (CORS). Usa Scarica JPG, Copia testo o Condividi. Il token resta solo su questo dispositivo.');
    err.cause = e;
    throw err;
  }
  let data = {};
  try { data = await res.json(); } catch { /* risposta non JSON */ }
  if (!res.ok || data.ok === false) {
    throw new Error(data.description || `Telegram ha risposto con errore ${res.status}.`);
  }
  return data;
}
