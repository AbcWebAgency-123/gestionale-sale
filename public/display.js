/* Display da tablet: fuori dalla sala (?token=…) oppure nell'atrio (token atrio) */
const token = new URLSearchParams(location.search).get('token');
const root = document.getElementById('root');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const toMin = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
const GIORNI = ['domenica', 'lunedì', 'martedì', 'mercoledì', 'giovedì', 'venerdì', 'sabato'];
const MESI = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];
const WORD = { libera: 'Libera', occupata: 'Occupata', in_arrivo: 'In arrivo', chiusa: 'Chiusa', fuori_orario: 'Chiusa' };
let st = null; let tz = 'Europe/Rome';

function clockNow() {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(new Date()).map((x) => [x.type, x.value]));
  const date = `${p.year}-${p.month}-${p.day}`;
  return { date, time: `${p.hour}:${p.minute}`, min: +p.hour * 60 + +p.minute, sec: +p.second };
}
const dateLong = (d) => { const x = new Date(d + 'T12:00:00Z'); return `${GIORNI[x.getUTCDay()]} ${x.getUTCDate()} ${MESI[x.getUTCMonth()]}`; };
const minutesTo = (t, n) => { const m = toMin(t) - n.min; return m <= 1 ? 'tra 1 minuto' : m < 60 ? `tra ${m} minuti` : `alle ${t}`; };

if (!token) {
  root.innerHTML = `<div class="setup"><div><h1>Display sala</h1><p>Questa pagina va aperta dal link del display che trovi in <b>Amministrazione → Sale e display</b>. Ogni sala ha un indirizzo personale da impostare sul tablet posizionato accanto alla porta.</p></div></div>`;
}

async function load() {
  try {
    const r = await fetch(`/api/display/state?token=${encodeURIComponent(token)}`, { cache: 'no-store' });
    const data = await r.json();
    if (!r.ok) { root.innerHTML = `<div class="setup"><div><h1>Display non configurato</h1><p>${esc(data.error || 'Errore')}.<br>Copia di nuovo il link del display da Amministrazione → Sale e display.</p></div></div>`; return; }
    st = data; tz = data.timezone || tz;
    document.getElementById('offline').style.display = 'none';
    render();
  } catch {
    document.getElementById('offline').style.display = 'block';
  }
}

function render() {
  if (!st) return;
  const n = clockNow();
  if (st.lobby) return renderLobby(n);
  const s = st.status;
  const room = st.room;
  if (room.kind === 'palestra') return renderGym(n);
  let sub = '';
  if (s === 'libera') sub = st.next ? `Libera fino alle ${st.next.start}` : `Libera per il resto della giornata`;
  if (s === 'in_arrivo') sub = `Prossima riunione ${minutesTo(st.next.start, n)}`;
  if (s === 'occupata') sub = `Riunione in corso fino alle ${st.current.end}`;
  if (s === 'chiusa') sub = 'Lo stabile oggi è chiuso';
  if (s === 'fuori_orario') sub = `Prenotabile dalle ${st.open_time} alle ${st.close_time}, dal lunedì al ${room.kind === 'palestra' && st.gym_saturday ? 'sabato' : 'venerdì'}`;

  const focus = st.current || (s === 'in_arrivo' ? st.next : null);
  let meeting = '';
  if (focus) {
    const isCur = focus === st.current;
    const pct = isCur ? Math.min(100, Math.max(0, ((n.min + n.sec / 60 - toMin(focus.start)) / (toMin(focus.end) - toMin(focus.start))) * 100)) : 0;
    meeting = `<div class="meeting">
      <div class="m-label">${isCur ? 'In corso' : 'Prossima riunione'} · ${focus.start} – ${focus.end}</div>
      <div class="m-title">${esc(focus.title)}</div>
      ${focus.company ? `<div class="m-sub">${esc(focus.company)}</div>` : ''}
      ${isCur ? `<div class="progress"><div style="width:${pct}%"></div></div>` : ''}
    </div>`;
  } else if (st.next) {
    meeting = `<div class="meeting"><div class="m-label">Prossima riunione · ${st.next.start} – ${st.next.end}</div><div class="m-title">${esc(st.next.title)}</div>${st.next.company ? `<div class="m-sub">${esc(st.next.company)}</div>` : ''}</div>`;
  }

  // azioni sul tablet
  let actions = '';
  const checkTarget = [st.current, st.next].find((b) => b && !b.checked_in && n.min >= toMin(b.start) - 10 && n.min < toMin(b.end));
  if (st.checkin_required && checkTarget) {
    const deadline = toMin(checkTarget.start) + st.checkin_grace_minutes;
    const h = String(Math.floor(deadline / 60)).padStart(2, '0') + ':' + String(deadline % 60).padStart(2, '0');
    actions += `<button class="act primary" data-act="checkin" data-id="${checkTarget.id}">✓ Conferma presenza</button>`;
    if (n.min < deadline) actions += `<div class="footer-hint" style="width:100%;margin-top:0">Se nessuno conferma entro le ${h} la sala verrà liberata.</div>`;
  }
  if (st.current) actions += `<button class="act" data-act="end" data-id="${st.current.id}">Libera la sala ora</button>`;

  // agenda con spazi liberi
  const items = [];
  let cursor = toMin(st.open_time);
  for (const b of st.today) {
    if (toMin(b.start) > cursor) items.push({ free: true, start: cursor, end: toMin(b.start) });
    items.push(b); cursor = Math.max(cursor, toMin(b.end));
  }
  if (cursor < toMin(st.close_time) && st.open) items.push({ free: true, start: cursor, end: toMin(st.close_time) });
  const hh = (m) => String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
  const visible = items.filter((it) => (it.free ? it.end : toMin(it.end)) > n.min || items.length <= 7).slice(0, 7);
  const agenda = !st.open ? '<div class="empty-day">Nessuna prenotazione oggi.</div>' : visible.map((it) => {
    if (it.free) return `<div class="ag free ${it.end <= n.min ? 'past' : ''}"><div class="t">${hh(it.start)}<small>${hh(it.end)}</small></div><div class="w"><b>Libera</b></div></div>`;
    const cls = toMin(it.end) <= n.min ? 'past' : toMin(it.start) <= n.min ? 'now' : '';
    return `<div class="ag ${cls}"><div class="t">${it.start}<small>${it.end}</small></div><div class="w"><b>${esc(it.title)}</b><span>${esc(it.company)}</span></div></div>`;
  }).join('');

  weekScreen({ cls: s, word: WORD[s], sub, meeting, actions });
  bindActions();
}

function renderGym(n) {
  const room = st.room; const cur = st.current_all || [];
  const hh = (m) => String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
  const G = { M: 'Uomo', F: 'Donna' };
  let cls = 'libera'; let word = 'Libera'; let sub = st.next ? `Prossimo ingresso alle ${st.next.start}` : 'Nessun ingresso previsto oggi';
  if (!st.open) { cls = 'chiusa'; word = 'Chiusa'; sub = 'Oggi la palestra è chiusa'; }
  else if (cur.length >= 2) { cls = 'occupata'; word = 'Completa'; sub = `Fino alle ${cur[0].end}`; }
  else if (cur.length === 1) { cls = 'in_arrivo'; word = 'In uso'; sub = `${G[cur[0].gender] || ''} fino alle ${cur[0].end} · 1 posto libero`; }
  else if (st.status === 'fuori_orario') { cls = 'fuori_orario'; word = 'Chiusa'; sub = `Aperta dalle ${(st.hours || {}).open || st.open_time} alle ${(st.hours || {}).close || st.close_time}`; }
  else if (st.slots && st.slots.length && !st.slots.some((x) => toMin(x.start) <= n.min && n.min < toMin(x.end))) { const nx = st.slots.find((x) => toMin(x.start) > n.min); sub = nx ? `Prossima fascia ${nx.start}–${nx.end}` : sub; }
  const people = cur.length ? `<div class="meeting"><div class="m-label">In palestra adesso</div>${cur.map((c) => `<div class="m-title" style="font-size:3vh">${G[c.gender] || ''}${c.company ? ' · ' + esc(c.company) : ''} <span style="opacity:.7;font-weight:600">${c.start}–${c.end}</span></div>`).join('')}</div>` : '';
  const toCheck = (st.today || []).filter((b) => !b.checked_in && n.min >= toMin(b.start) - 10 && n.min < toMin(b.end));
  const actions = st.checkin_required && toCheck.length ? `<div class="actions">${toCheck.map((b) => `<button class="act primary" data-act="checkin" data-id="${b.id}">✓ Conferma presenza · ${G[b.gender] || ''} ${b.start}</button>`).join('')}</div>` : '';
  weekScreen({ cls, word, sub, meeting: people, actions: actions.replace(/^<div class="actions">|<\/div>$/g, '') });
  bindActions();
}

// ---------------------------------------------------------------- monitor della sala: settimana + QR per prenotare
let pick = null; let pickTimer = null;
const G2 = { M: 'Uomo', F: 'Donna' };
const hhmm = (m) => String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
const GG = ['Dom', 'Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab'];
function bookUrl() {
  const base = st.book_url && /^https?:/.test(st.book_url) ? st.book_url : `${location.origin}/index.html?prenota=${st.room.id}`;
  return pick ? `${base}&date=${pick.date}&start=${pick.start}` : base;
}
function qrSvg(text) {
  try { const q = qrcode(0, 'M'); q.addData(text); q.make(); return q.createSvgTag({ cellSize: 4, margin: 0, scalable: true }); } catch { return ''; }
}
function weekScreen({ cls, word, sub, meeting, actions }) {
  const n = clockNow(); const room = st.room; const gym = room.kind === 'palestra';
  const w = st.week || { days: [], bookings: [] };
  const hrsO = gym && st.hours ? st.hours.open : st.open_time; const hrsC = gym && st.hours ? st.hours.close : st.close_time;
  const o = Math.floor(toMin(hrsO) / 30) * 30; const c = Math.ceil(toMin(hrsC) / 30) * 30; const span = c - o;
  const gslots = gym && st.slots && st.slots.length ? st.slots : null;
  const pos = (t) => ((toMin(t) - o) / span) * 100;
  const hours = []; for (let t = Math.ceil(o / 60) * 60; t <= c; t += 60) hours.push(t);
  const cols = w.days.map((d) => {
    const x = new Date(d.date + 'T12:00:00Z'); const isToday = d.date === n.date; const past = d.date < n.date;
    const list = w.bookings.filter((b) => b.date === d.date);
    const blocks = d.closed ? `<div class="wk-closed"><span>${esc(d.closed)}</span></div>` : list.map((b) => {
      const ended = past || (isToday && toMin(b.end) <= n.min); const now = isToday && toMin(b.start) <= n.min && n.min < toMin(b.end);
      const lane = gym ? (b.gender === 'F' ? 'lane-r' : 'lane-l') : '';
      const short = toMin(b.end) - toMin(b.start) <= 60 ? 'short' : '';
      return `<div class="wk-b ${lane} ${short} ${ended ? 'past' : ''} ${now ? 'now' : ''}" style="top:${pos(b.start)}%;height:${pos(b.end) - pos(b.start)}%">
        ${gym ? `<span class="g1">${G2[b.gender] || ''}</span>` : `<b>${b.start}–${b.end}</b><span>${esc(b.company || b.title)}</span>`}${!gym && b.company && b.title && b.title !== 'Riservata' ? `<em>${esc(b.title)}</em>` : ''}</div>`;
    }).join('');
    const pastShade = past ? 100 : isToday ? Math.max(0, Math.min(100, ((n.min - o) / span) * 100)) : 0;
    const sel = pick && pick.date === d.date ? `<div class="wk-pick" style="top:${pos(pick.start)}%;height:${pos(pick.end) - pos(pick.start)}%"><b>${pick.start}</b></div>` : '';
    return `<div class="wk-col ${isToday ? 'today' : ''} ${d.closed ? 'closed' : ''}" data-date="${d.date}">
      <div class="wk-day"><span>${GG[x.getUTCDay()]}</span><b>${x.getUTCDate()}</b>${gym && !d.closed ? '<div class="wk-lanes"><span>U</span><span>D</span></div>' : ''}</div>
      <div class="wk-body">${hours.map((t) => `<i class="wk-hl" style="top:${((t - o) / span) * 100}%"></i>`).join('')}
        ${pastShade ? `<div class="wk-past" style="height:${pastShade}%"></div>` : ''}
        ${gslots && !d.closed ? gslots.map((x) => `<i class="wk-slot" style="top:${pos(x.start)}%;height:${pos(x.end) - pos(x.start)}%"></i>`).join('') : ''}
        ${blocks}${sel}
        ${isToday && n.min >= o && n.min <= c ? `<div class="wk-now" style="top:${((n.min - o) / span) * 100}%"></div>` : ''}</div></div>`;
  }).join('');
  const first = w.days[0]; const last = w.days[w.days.length - 1];
  const range = first ? `${new Date(first.date + 'T12:00:00Z').getUTCDate()} – ${dateLong(last.date).replace(/^\S+ /, '')}` : '';
  root.innerHTML = `<div class="wk">
    <section class="wk-main">
      <header class="wk-head"><img class="logo" src="brand/logo-bianco.png" alt="CARDO Centro Uffici">
        <div class="wk-title"><h1>${gym ? '🏋️ ' : ''}${esc(room.name)}</h1><span>${gym ? `Massimo 1 uomo + 1 donna per fascia${gslots ? ` · fasce da ${toMin(gslots[0].end) - toMin(gslots[0].start)} min dalle ${gslots[0].start} alle ${gslots.at(-1).end}` : ''}` : `👥 ${room.capacity} posti`}${room.location ? ' · ' + esc(room.location) : ''} · Settimana ${range}</span></div></header>
      <div class="wk-grid" style="--n:${w.days.length};grid-template-columns:7vh repeat(${w.days.length}, 1fr)">
        <div class="wk-axis"><div class="wk-day"></div><div class="wk-body">${hours.map((t) => `<span style="top:${((t - o) / span) * 100}%">${hhmm(t)}</span>`).join('')}</div></div>
        ${cols}
      </div>
    </section>
    <aside class="wk-side s-${cls}">
      <div class="clock" id="clock">${n.time}</div><div class="date">${dateLong(n.date)}</div>
      <div class="wk-status"><div class="wk-word">${word}</div><div class="status-sub">${sub}</div></div>
      ${meeting}
      ${actions ? `<div class="actions">${actions}</div>` : ''}
      <div class="wk-qr"><div class="qr">${qrSvg(bookUrl())}</div>
        <div><b>${pick ? `Prenota ${GG[new Date(pick.date + 'T12:00:00Z').getUTCDay()].toLowerCase()} ${Number(pick.date.slice(8))} alle ${pick.start}` : `Prenota ${gym ? 'la palestra' : 'questa sala'}`}</b>
        <span>Inquadra il codice con il telefono e accedi: ${pick ? 'trovi già giorno e orario scelti.' : 'trovi già la sala selezionata.'}${'ontouchstart' in window && !pick ? ' Oppure tocca uno spazio libero nel calendario.' : ''}</span></div></div>
    </aside>
  </div>`;
  // tocco su uno spazio libero: QR con giorno e ora già impostati
  document.querySelectorAll('.wk-col:not(.closed) .wk-body').forEach((el) => (el.onclick = (e) => {
    const date = el.parentElement.dataset.date; const r = el.getBoundingClientRect();
    const yMin = o + ((e.clientY - r.top) / r.height) * span;
    let m; let start; let end; let step = 30;
    if (gslots) {
      const gs = gslots.find((x) => toMin(x.start) <= yMin && yMin < toMin(x.end)); if (!gs) return;
      m = toMin(gs.start); start = gs.start; end = gs.end; step = toMin(gs.end) - m;
    } else {
      m = o + Math.floor((yMin - o) / step) * step; m = Math.max(o, Math.min(c - step, m));
      start = hhmm(m); end = hhmm(m + (60 <= c - m ? 60 : 30));
    }
    if (date < n.date || (date === n.date && m + step <= n.min)) return;
    const list = w.bookings.filter((b) => b.date === date && toMin(b.start) < m + step && toMin(b.end) > m);
    if (gym ? list.length >= 2 : list.length) return;
    pick = { date, start, end }; render();
    clearTimeout(pickTimer); pickTimer = setTimeout(() => { pick = null; render(); }, 60000);
  }));
  bindActions();
}

function renderLobby(n) {
  const cards = st.rooms.map((r) => {
    const s = r.status;
    if (r.room.kind === 'palestra') {
      const c = (r.current_all || []).length;
      const ws = !r.open ? 'chiusa' : c >= 2 ? 'occupata' : c === 1 ? 'in_arrivo' : s === 'fuori_orario' ? 'fuori_orario' : 'libera';
      const wl = !r.open || ws === 'fuori_orario' ? 'Chiusa' : c >= 2 ? 'Completa' : c === 1 ? 'In uso' : 'Libera';
      return `<div class="lc s-${ws}"><h2>🏋️ ${esc(r.room.name)}</h2><div class="lm">1 uomo + 1 donna per ora</div><div class="lst">${wl}</div><div class="lsub">${c === 1 ? '1 posto libero' : c >= 2 ? 'fino alle ' + r.current_all[0].end : ''}</div><div class="lnext">${r.next ? 'Prossimo ingresso: ' + r.next.start : 'Nessun altro ingresso oggi'}</div></div>`;
    }
    const sub = s === 'occupata' ? `fino alle ${r.current.end}` : s === 'in_arrivo' ? `riunione ${minutesTo(r.next.start, n)}` : s === 'libera' ? (r.next ? `fino alle ${r.next.start}` : 'per il resto della giornata') : '';
    const nxt = r.current ? (r.next ? `Dopo: ${r.next.start} ${esc(r.next.title)}` : 'Poi libera') : (r.next ? `Prossima: ${r.next.start}–${r.next.end} ${esc(r.next.company || r.next.title)}` : 'Nessun\'altra riunione oggi');
    return `<div class="lc s-${s}">
      <h2>${esc(r.room.name)}</h2><div class="lm">${r.room.capacity} posti${r.room.location ? ' · ' + esc(r.room.location) : ''}</div>
      <div class="lst">${WORD[s]}</div><div class="lsub">${sub}</div>
      ${r.current ? `<div class="lsub" style="opacity:.8;margin-top:.6vh">${esc(r.current.company || r.current.title)}</div>` : ''}
      <div class="lnext">${nxt}</div></div>`;
  }).join('');
  root.innerHTML = `<div class="lobby">
    <div class="lobby-head"><div><img class="lobby-logo" src="brand/logo-bianco.png" alt="CARDO Centro Uffici"><h1>Sale riunioni</h1><p>${esc(st.building_name)} · ${dateLong(n.date)}</p></div><div class="clock" id="clock">${n.time}</div></div>
    <div class="lobby-grid" style="grid-template-columns:repeat(${st.rooms.length <= 3 ? st.rooms.length : Math.ceil(st.rooms.length / 2)}, 1fr)">${cards}</div></div>`;
}

function bindActions() {
  document.querySelectorAll('[data-act]').forEach((b) => {
    let armed = false; let t;
    b.onclick = async () => {
      if (b.dataset.act === 'end' && !armed) {
        armed = true; b.classList.add('confirm'); b.textContent = 'Tocca di nuovo per confermare';
        t = setTimeout(() => { armed = false; render(); }, 4000); return;
      }
      clearTimeout(t); b.disabled = true;
      try {
        const r = await fetch(`/api/display/${b.dataset.act}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, booking_id: +b.dataset.id }) });
        if (!r.ok) { const e = await r.json(); b.textContent = e.error || 'Errore'; setTimeout(load, 2500); return; }
      } catch { /* offline */ }
      load();
    };
  });
}

if (token) {
  load();
  setInterval(load, 20000);
  setInterval(() => { const c = document.getElementById('clock'); if (c) { const n = clockNow(); c.textContent = n.time; if (n.sec === 0) render(); } }, 1000);
  // aggiornamento immediato quando qualcuno prenota o cancella
  const connect = () => { const es = new EventSource(`/api/events?token=${encodeURIComponent(token)}`); es.addEventListener('changed', () => setTimeout(load, 200)); es.onerror = () => { es.close(); setTimeout(connect, 10000); }; };
  connect();
  // schermo sempre acceso (dove supportato) e ricarica notturna di sicurezza
  const wake = async () => { try { await navigator.wakeLock?.request('screen'); } catch { /* ignore */ } };
  wake(); document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && wake());
  setInterval(() => { const n = clockNow(); if (n.time === '03:00') location.reload(); }, 60000);
}
const fs = document.getElementById('fs');
fs.onclick = () => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen?.());
document.addEventListener('fullscreenchange', () => (fs.style.display = document.fullscreenElement ? 'none' : ''));
