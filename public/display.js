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
  if (s === 'fuori_orario') sub = `Prenotabile dalle ${st.open_time} alle ${st.close_time}, dal lunedì al venerdì`;

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

  root.innerHTML = `<div class="screen s-${s}">
    <section class="main">
      <div class="room-label"><img class="logo" src="brand/logo-bianco.png" alt="CARDO Centro Uffici"></div>
      <div class="room-name">${esc(room.name)}</div>
      <div class="room-meta"><span>👥 ${room.capacity} posti</span>${room.location ? `<span>📍 ${esc(room.location)}</span>` : ''}${room.equipment ? `<span>🖥 ${esc(room.equipment)}</span>` : ''}</div>
      <div class="status">
        <div class="status-word">${WORD[s]}</div>
        <div class="status-sub">${sub}</div>
        ${meeting}
        ${actions ? `<div class="actions">${actions}</div>` : ''}
        <div class="footer-hint">Prenota questa sala dal tuo ufficio: <b>${esc(location.host)}</b></div>
      </div>
    </section>
    <aside class="side">
      <div class="clock" id="clock">${n.time}</div>
      <div class="date">${dateLong(n.date)}</div>
      <div class="agenda-title">Programma di oggi</div>
      <div class="agenda">${agenda || '<div class="empty-day">Nessuna prenotazione oggi: la sala è libera.</div>'}</div>
      <div class="brand"><span>${esc(st.building_name)}</span><span>Aggiornato ${n.time}</span></div>
    </aside>
  </div>`;
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
  else if (n.min < toMin(st.open_time) || n.min >= toMin(st.close_time)) { cls = 'fuori_orario'; word = 'Chiusa'; sub = `Prenotabile dalle ${st.open_time} alle ${st.close_time}`; }
  const people = cur.length ? `<div class="meeting"><div class="m-label">In palestra adesso</div>${cur.map((c) => `<div class="m-title" style="font-size:3vh">${G[c.gender] || ''}${c.company ? ' · ' + esc(c.company) : ''} <span style="opacity:.7;font-weight:600">${c.start}–${c.end}</span></div>`).join('')}</div>` : '';
  const toCheck = (st.today || []).filter((b) => !b.checked_in && n.min >= toMin(b.start) - 10 && n.min < toMin(b.end));
  const actions = st.checkin_required && toCheck.length ? `<div class="actions">${toCheck.map((b) => `<button class="act primary" data-act="checkin" data-id="${b.id}">✓ Conferma presenza · ${G[b.gender] || ''} ${b.start}</button>`).join('')}</div>` : '';
  const rows = [];
  for (let t = Math.ceil(toMin(st.open_time) / 60) * 60; t + 60 <= toMin(st.close_time); t += 60) {
    const at = (st.today || []).filter((b) => toMin(b.start) < t + 60 && toMin(b.end) > t);
    if (t + 60 <= n.min && !at.length) continue;
    const g = (x) => { const b = at.find((y) => y.gender === x); return b ? `<b>${G[x]}</b> ${esc(b.company || 'occupato')}` : `<span style="opacity:.6">${G[x]} libero</span>`; };
    const cls = t + 60 <= n.min ? 'past' : t <= n.min ? 'now' : at.length ? '' : 'free';
    rows.push(`<div class="ag ${cls}"><div class="t">${hh(t)}<small>${hh(t + 60)}</small></div><div class="w"><span style="font-size:1.8vh;opacity:1">${g('M')}</span><span style="font-size:1.8vh;opacity:1">${g('F')}</span></div></div>`);
  }
  root.innerHTML = `<div class="screen s-${cls}">
    <section class="main">
      <div class="room-label"><img class="logo" src="brand/logo-bianco.png" alt="CARDO Centro Uffici"></div>
      <div class="room-name">🏋️ ${esc(room.name)}</div>
      <div class="room-meta"><span>Massimo 1 uomo + 1 donna per ora</span>${room.location ? `<span>📍 ${esc(room.location)}</span>` : ''}</div>
      <div class="status"><div class="status-word">${word}</div><div class="status-sub">${sub}</div>${people}${actions}
        <div class="footer-hint">Prenota la palestra dal tuo ufficio: <b>${esc(location.host)}</b></div></div>
    </section>
    <aside class="side"><div class="clock" id="clock">${n.time}</div><div class="date">${dateLong(n.date)}</div>
      <div class="agenda-title">Ingressi di oggi</div><div class="agenda">${st.open ? rows.slice(0, 7).join('') : '<div class="empty-day">Oggi la palestra è chiusa.</div>'}</div>
      <div class="brand"><span>${esc(st.building_name)}</span><span>Aggiornato ${n.time}</span></div></aside>
  </div>`;
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
