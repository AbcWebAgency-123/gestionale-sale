/* Pagina di prenotazione per gli utenti delle aziende */
const state = { me: null, cfg: null, date: null, week: [], bookings: [], companies: [] };

const ICON = {
  people: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.6-3.6 3.3-5.5 6.5-5.5s5.9 1.9 6.5 5.5M16 4.5a3.5 3.5 0 0 1 0 7M18.5 14.8c1.7.8 2.8 2.5 3 5.2"/></svg>',
  pin: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M12 21s-7-6.1-7-11.5a7 7 0 0 1 14 0C19 14.9 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/></svg>',
  plus: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
  left: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M15 18l-6-6 6-6"/></svg>',
  right: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M9 18l6-6-6-6"/></svg>',
  cal: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M7 3v3M17 3v3M4 9h16M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z"/></svg>',
  edit: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M4 20h4L19 9l-4-4L4 16v4zM14 6l4 4"/></svg>',
  trash: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>',
};

/* ---------------------------------------------------------------- tempo */
function nowLocal() {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: state.cfg?.timezone || 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date()).map((x) => [x.type, x.value]));
  const date = `${p.year}-${p.month}-${p.day}`; const time = `${p.hour}:${p.minute}`;
  return { date, time, min: toMin(time) };
}
const isClosed = (d) => [0, 6].includes(weekday(d)) || state.cfg.closures.some((c) => c.date === d);
const closureReason = (d) => (state.cfg.closures.find((c) => c.date === d) || {}).reason;
function nextWorkday(d, dir = 1) { let x = d; for (let i = 0; i < 30; i++) { if (![0, 6].includes(weekday(x))) return x; x = addDays(x, dir); } return x; }
const mondayOf = (d) => addDays(d, -((weekday(d) + 6) % 7));
function firstBookableDay() {
  const n = nowLocal(); let d = n.date;
  if (isClosed(d) || n.min >= toMin(state.cfg.close_time) - state.cfg.slot_minutes) d = addDays(d, 1);
  for (let i = 0; i < 30 && isClosed(d); i++) d = addDays(d, 1);
  return d;
}
const slotsCount = () => (toMin(state.cfg.close_time) - toMin(state.cfg.open_time)) / state.cfg.slot_minutes;
const slotTime = (i) => toHHMM(toMin(state.cfg.open_time) + i * state.cfg.slot_minutes);
const slotIndex = (t) => (toMin(t) - toMin(state.cfg.open_time)) / state.cfg.slot_minutes;

/* ---------------------------------------------------------------- avvio */
async function init() {
  try { state.me = await api('/api/me'); }
  catch (e) { return showLogin(); }
  if (state.me.must_change_password) { await passwordModal(true); state.me.must_change_password = false; }
  state.cfg = await api('/api/config');
  if (state.me.role === 'admin') state.companies = (await api('/api/admin/companies')).filter((c) => c.active);
  document.title = `Sale Riunioni — ${state.cfg.building_name}`;
  renderTopbar(state.me, location.hash === '#mie' ? 'mie' : 'calendario', state.cfg.building_name);
  $('#app').classList.remove('hidden');
  state.date = firstBookableDay();
  window.addEventListener('hashchange', route);
  route();
  liveUpdates('/api/events', () => { if (location.hash === '#mie') renderMine(); else loadDay(); });
  setInterval(() => { if (location.hash !== '#mie') renderGrid(); }, 60000);
}
function route() {
  const mine = location.hash === '#mie';
  $('#view-calendario').classList.toggle('hidden', mine);
  $('#view-mie').classList.toggle('hidden', !mine);
  $$('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === (mine ? 'mie' : 'calendario')));
  if (mine) renderMine(); else { renderCalendarShell(); loadDay(); }
}

function showLogin() {
  $('#login').classList.remove('hidden');
  const demo = [['Sala 1', '#5fd0b8', 'Libera'], ['Sala 2', '#f08bb2', 'Occupata'], ['Sala 3', '#e8b765', 'Libera'], ['Sala 4', '#5fd0b8', 'Libera'], ['Sala 5', '#f08bb2', 'Occupata']];
  $('#login-preview').innerHTML = demo.map(([n, c, s]) => `<div><i style="background:${c}"></i><span>${n}<br><span style="opacity:.7;font-weight:500">${s}</span></span></div>`).join('');
  $('#login-form').onsubmit = async (e) => {
    e.preventDefault();
    const btn = $('button', e.target); btn.disabled = true;
    try { await api('/api/login', { method: 'POST', body: Object.fromEntries(new FormData(e.target)) }); location.reload(); }
    catch (err) { $('#login-err').textContent = err.message; btn.disabled = false; }
  };
}

/* ---------------------------------------------------------------- calendario */
function renderCalendarShell() {
  $('#view-calendario').innerHTML = `
    <div class="cal-toolbar">
      <div class="cal-title" id="cal-title"></div>
      <div class="nav-group">
        <button class="icon-btn" id="prev" title="Giorno precedente">${ICON.left}</button>
        <button class="btn btn-ghost btn-sm" id="today">Oggi</button>
        <button class="icon-btn" id="next" title="Giorno successivo">${ICON.right}</button>
      </div>
      <div class="week-strip" id="week"></div>
      <input type="date" class="date-input" id="pick-date" title="Vai a una data">
      <div style="flex:1"></div>
      <button class="btn btn-accent" id="new-bk">${ICON.plus} Nuova prenotazione</button>
    </div>
    <div class="card grid-card"><div class="grid-scroll" id="grid-wrap"></div></div>
    <div class="legend">
      <span><i style="background:var(--primary);border-color:var(--primary)"></i>Prenotazioni della tua azienda</span>
      <span><i style="background:#e6f1ef;border-color:#b5d4d0"></i>Prenotate da altre aziende</span>
      <span><i style="background:repeating-linear-gradient(-45deg,#fafbfd,#fafbfd 3px,#eceff5 3px,#eceff5 6px);border-color:var(--line)"></i>Orario passato</span>
      <span style="margin-left:auto">Suggerimento: clicca su uno spazio libero, oppure trascina per scegliere più mezz'ore.</span>
    </div>`;
  $('#prev').onclick = () => { let d = addDays(state.date, -1); while ([0, 6].includes(weekday(d))) d = addDays(d, -1); go(d); };
  $('#next').onclick = () => { let d = addDays(state.date, 1); while ([0, 6].includes(weekday(d))) d = addDays(d, 1); go(d); };
  $('#today').onclick = () => go(nextWorkday(nowLocal().date));
  $('#pick-date').onchange = (e) => e.target.value && go(nextWorkday(e.target.value));
  $('#new-bk').onclick = () => bookingModal({ date: state.date });
}
function go(d) { state.date = d; loadDay(); }

async function loadDay() {
  if (!$('#grid-wrap')) return;
  const mon = mondayOf(state.date);
  state.week = [0, 1, 2, 3, 4].map((i) => addDays(mon, i));
  try { state.bookings = await api(`/api/bookings?from=${state.week[0]}&to=${state.week[4]}`); }
  catch (e) { if (e.status === 401) location.reload(); toast(e.message, 'err'); return; }
  renderGrid();
}

function renderGrid() {
  const cfg = state.cfg; const d = state.date; const n = nowLocal();
  $('#cal-title').innerHTML = `${fmtDateLong(d).replace(/ \d{4}$/, '')}<small>${d === n.date ? 'Oggi · ' : ''}${cfg.open_time} – ${cfg.close_time} · ${state.bookings.filter((b) => b.date === d).length} prenotazioni</small>`;
  $('#pick-date').value = d;
  $('#week').innerHTML = state.week.map((wd) => {
    const cnt = state.bookings.filter((b) => b.date === wd && b.own_company).length;
    return `<button class="week-day ${wd === d ? 'active' : ''} ${wd === n.date ? 'today' : ''} ${isClosed(wd) ? 'closed' : ''}" data-d="${wd}" title="${isClosed(wd) ? esc(closureReason(wd) || 'Chiuso') : (cnt ? cnt + ' prenotazioni della tua azienda' : '')}">
      ${cnt ? '<span class="dot"></span>' : ''}<small>${GIORNI_BREVI[weekday(wd)]}</small><b>${Number(wd.slice(8))}</b></button>`;
  }).join('');
  $$('#week .week-day').forEach((b) => (b.onclick = () => go(b.dataset.d)));

  const wrap = $('#grid-wrap');
  if (isClosed(d)) {
    wrap.innerHTML = `<div class="closed-banner"><div class="big">🏢</div><h3>Stabile chiuso</h3><p class="muted">${esc(closureReason(d) || 'Le sale sono prenotabili dal lunedì al venerdì.')}</p></div>`;
    return;
  }
  const rooms = cfg.rooms; const N = slotsCount(); const cols = `64px repeat(${rooms.length}, minmax(150px, 1fr))`;
  const dayBookings = state.bookings.filter((b) => b.date === d);
  const isToday = d === n.date;
  const isPastSlot = (i) => d < n.date || (isToday && toMin(slotTime(i)) + cfg.slot_minutes <= n.min);

  let head = `<div class="cal-head" style="grid-template-columns:${cols}"><div></div>`;
  for (const r of rooms) {
    let badge = '';
    if (isToday && n.min >= toMin(cfg.open_time) && n.min < toMin(cfg.close_time)) {
      const busy = dayBookings.find((b) => b.room_id === r.id && toMin(b.start) <= n.min && n.min < toMin(b.end));
      badge = busy ? `<span class="status-badge st-occupata">Occupata fino alle ${busy.end}</span>` : '<span class="status-badge st-libera">Libera ora</span>';
    }
    head += `<div class="room-head" title="${esc(r.equipment)}">
      <div class="rh-top"><span class="swatch" style="background:${r.color}"></span><b>${esc(r.name)}</b></div>
      <div class="meta"><span>${ICON.people} ${r.capacity} posti</span>${r.location ? `<span>${ICON.pin} ${esc(r.location)}</span>` : ''}</div>${badge}</div>`;
  }
  head += '</div>';

  let body = `<div class="cal-grid" id="cal-grid" style="grid-template-columns:${cols};grid-template-rows:repeat(${N}, var(--slot-h))">`;
  for (let i = 0; i < N; i++) {
    const t = slotTime(i); const isHour = t.endsWith(':00');
    body += `<div class="time-col ${i === 0 ? 'first' : ''}" style="grid-row:${i + 1};grid-column:1">${isHour || i === 0 ? t : ''}</div>`;
    rooms.forEach((r, ri) => {
      body += `<div class="slot ${isHour ? 'hour' : ''} ${isPastSlot(i) ? 'past' : ''}" style="grid-row:${i + 1};grid-column:${ri + 2}" data-room="${r.id}" data-i="${i}" data-t="${t}"></div>`;
    });
  }
  for (const b of dayBookings) {
    const ri = rooms.findIndex((r) => r.id === b.room_id); if (ri < 0) continue;
    const r = rooms[ri]; const s = Math.floor(slotIndex(b.start)); const e = Math.max(s + 1, Math.ceil(slotIndex(b.end))); const span = e - s;
    const own = b.own_company;
    const style = own
      ? `background:${r.color};border-color:${r.color};color:#fff`
      : `background:color-mix(in srgb, ${r.color} 9%, white);border-color:color-mix(in srgb, ${r.color} 30%, white);color:color-mix(in srgb, ${r.color} 65%, #0f172a)`;
    body += `<div class="booking ${own ? '' : 'other'} ${b.mine ? 'mine-tag' : ''} ${span <= 1 ? 'short' : span === 2 ? 'medium' : ''}" data-id="${b.id}" style="grid-row:${s + 1}/${e + 1};grid-column:${ri + 2};${style}" title="${esc(b.title)} · ${esc(b.company_name)} · ${b.start}–${b.end}">
      <span class="b-time">${b.start}–${b.end}</span><span class="b-title">${esc(b.title)}</span>
      <span class="b-sub">${esc(b.company_name)}${own && b.user_name ? ' · ' + esc(b.user_name) : ''}</span></div>`;
  }
  if (isToday && n.min >= toMin(cfg.open_time) && n.min <= toMin(cfg.close_time)) {
    const top = ((n.min - toMin(cfg.open_time)) / cfg.slot_minutes) * parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--slot-h'));
    body += `<div class="now-line" data-t="${n.time}" style="top:${top}px;left:64px"></div>`;
  }
  body += '</div>';
  wrap.innerHTML = head + body;

  // click e trascinamento per selezionare
  const grid = $('#cal-grid');
  let sel = null;
  const paint = () => {
    $$('.slot.sel', grid).forEach((x) => x.classList.remove('sel'));
    if (!sel) return;
    const [a, b] = [Math.min(sel.a, sel.b), Math.max(sel.a, sel.b)];
    $$(`.slot[data-room="${sel.room}"]`, grid).forEach((x) => { const i = +x.dataset.i; if (i >= a && i <= b) x.classList.add('sel'); });
  };
  grid.addEventListener('pointerdown', (e) => {
    const s = e.target.closest('.slot'); if (!s || s.classList.contains('past') || e.button !== 0) return;
    sel = { room: +s.dataset.room, a: +s.dataset.i, b: +s.dataset.i }; paint();
    grid.setPointerCapture?.(e.pointerId);
  });
  grid.addEventListener('pointermove', (e) => {
    if (!sel) return;
    const s = document.elementFromPoint(e.clientX, e.clientY)?.closest('.slot');
    if (s && +s.dataset.room === sel.room && !s.classList.contains('past')) { sel.b = +s.dataset.i; paint(); }
  });
  const finish = () => {
    if (!sel) return;
    const [a, b] = [Math.min(sel.a, sel.b), Math.max(sel.a, sel.b)];
    const room = sel.room; sel = null;
    // se è un solo click proponi 1 ora (se libera), altrimenti l'intervallo trascinato
    let end = b + 1;
    if (a === b) {
      const want = Math.min(a + Math.round(60 / state.cfg.slot_minutes), slotsCount());
      end = a + 1;
      while (end < want && !dayBookings.some((x) => x.room_id === room && Math.floor(slotIndex(x.start)) <= end && Math.ceil(slotIndex(x.end)) > end)) end++;
    }
    bookingModal({ date: state.date, room_id: room, start: slotTime(a), end: slotTime(end) }, paint);
  };
  grid.addEventListener('pointerup', finish);
  grid.addEventListener('pointercancel', () => { sel = null; paint(); });
  $$('.booking', grid).forEach((el) => {
    el.addEventListener('pointerdown', (e) => e.stopPropagation());
    el.addEventListener('click', () => {
      const b = state.bookings.find((x) => x.id === +el.dataset.id);
      if (b.can_edit) bookingModal(b); else infoModal(b);
    });
  });
}

function infoModal(b) {
  const r = state.cfg.rooms.find((x) => x.id === b.room_id);
  openModal(`
    <div class="modal-head"><h3>${esc(b.title)}</h3><button class="icon-btn" data-close>✕</button></div>
    <div class="modal-body">
      <p style="margin-top:0"><span class="summary-pill" style="background:color-mix(in srgb, ${r.color} 12%, white);color:${r.color}">${esc(r.name)}</span></p>
      <p><b>${fmtDateLong(b.date)}</b><br>dalle ${b.start} alle ${b.end}</p>
      <p class="muted">Prenotata da <b>${esc(b.company_name)}</b>.</p>
    </div>
    <div class="modal-foot"><button class="btn btn-primary" data-close>Chiudi</button></div>`);
}

/* ---------------------------------------------------------------- modale prenotazione */
async function bookingModal(b, onClose) {
  const cfg = state.cfg; const editing = !!b.id; const isAdmin = state.me.role === 'admin';
  const N = slotsCount();
  const f = { title: b.title || '', date: b.date || state.date, start: b.start || '', end: b.end || '', room_id: b.room_id || null, attendees: b.attendees || '', notes: b.notes || '', repeat_weeks: 0, company_id: b.company_id || '' };
  if (!f.start) {
    const n = nowLocal();
    let i = 0; if (f.date === n.date) i = Math.max(0, Math.ceil((n.min - toMin(cfg.open_time)) / cfg.slot_minutes));
    f.start = slotTime(Math.min(i, N - 1)); f.end = slotTime(Math.min(i + 2, N));
  }
  let dayCache = { date: null, list: [] };
  const dayList = async (d) => {
    if (dayCache.date !== d) {
      const inWeek = state.week.includes(d);
      dayCache = { date: d, list: inWeek ? state.bookings.filter((x) => x.date === d) : await api(`/api/bookings?date=${d}`).catch(() => []) };
    }
    return dayCache.list;
  };
  const startOpts = () => Array.from({ length: N }, (_, i) => slotTime(i));
  const endOpts = (start) => {
    const s = slotIndex(start); const max = isAdmin ? N : Math.min(N, s + Math.round(cfg.max_hours_per_booking * 60 / cfg.slot_minutes));
    return Array.from({ length: max - s }, (_, k) => slotTime(s + k + 1));
  };
  const dur = (a, z) => { const m = toMin(z) - toMin(a); return m >= 60 ? `${Math.floor(m / 60)} h${m % 60 ? ' ' + (m % 60) + ' min' : ''}` : `${m} min`; };

  const m = openModal(`
    <div class="modal-head"><h3>${editing ? 'Modifica prenotazione' : 'Nuova prenotazione'}</h3><button class="icon-btn" data-close aria-label="Chiudi">✕</button></div>
    <form class="modal-body" id="bk-form" autocomplete="off">
      <label class="field"><span>Titolo della riunione</span><input name="title" required maxlength="120" placeholder="Es. Riunione commerciale, colloquio, call con cliente…" value="${esc(f.title)}"></label>
      <div class="row-3">
        <label class="field"><span>Giorno</span><input type="date" name="date" required value="${f.date}"></label>
        <label class="field"><span>Dalle</span><select name="start"></select></label>
        <label class="field"><span>Alle</span><select name="end"></select></label>
      </div>
      <div class="summary-pill" id="bk-summary"></div>
      <div class="field" style="margin-bottom:6px"><span>Sala</span></div>
      <div class="room-pick" id="room-pick"></div>
      <div class="row">
        <label class="field"><span>Partecipanti (facoltativo)</span><input type="number" name="attendees" min="1" max="500" value="${esc(f.attendees)}" placeholder="Es. 6"></label>
        ${!editing ? `<label class="field"><span>Ripeti ogni settimana</span><select name="repeat_weeks"><option value="0">Non ripetere</option>${Array.from({ length: cfg.max_repeat_weeks }, (_, i) => `<option value="${i + 1}">Per altre ${i + 1} settiman${i ? 'e' : 'a'}</option>`).join('')}</select></label>` : '<div></div>'}
      </div>
      ${isAdmin ? `<label class="field"><span>Per conto dell'azienda</span><select name="company_id"><option value="">— Amministrazione stabile —</option>${state.companies.map((c) => `<option value="${c.id}" ${c.id === f.company_id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label>` : ''}
      <label class="field"><span>Note (visibili solo alla tua azienda)</span><textarea name="notes" maxlength="1000" placeholder="Es. serve il collegamento video, catering alle 11…">${esc(f.notes)}</textarea></label>
      <div class="form-error" id="bk-err"></div>
    </form>
    <div class="modal-foot">
      ${editing ? `<button class="btn btn-danger-ghost left" id="bk-del">${ICON.trash} Annulla prenotazione</button>` : ''}
      <button class="btn btn-ghost" data-close>Chiudi</button>
      <button class="btn btn-primary" form="bk-form" id="bk-save">${editing ? 'Salva modifiche' : 'Conferma prenotazione'}</button>
    </div>`, { wide: true, onClose });
  const form = $('#bk-form', m.el);
  const sStart = form.start; const sEnd = form.end;
  sStart.innerHTML = startOpts().map((t) => `<option ${t === f.start ? 'selected' : ''}>${t}</option>`).join('');
  const fillEnd = () => {
    const opts = endOpts(sStart.value); const cur = sEnd.value || f.end;
    sEnd.innerHTML = opts.map((t) => `<option value="${t}">${t}  (${dur(sStart.value, t)})</option>`).join('');
    sEnd.value = opts.includes(cur) ? cur : opts[Math.min(1, opts.length - 1)];
  };
  fillEnd();

  const refresh = async () => {
    const d = form.date.value; const a = sStart.value; const z = sEnd.value;
    const att = parseInt(form.attendees.value, 10) || 0;
    $('#bk-summary', m.el).innerHTML = d ? `${ICON.cal} ${fmtDateLong(d)} · ${a}–${z} · ${dur(a, z)}` : '';
    let warn = '';
    if (d && isClosed(d)) warn = [0, 6].includes(weekday(d)) ? 'Le sale sono prenotabili solo dal lunedì al venerdì.' : `Lo stabile è chiuso: ${closureReason(d) || 'chiusura'}.`;
    const list = d && !warn ? await dayList(d) : [];
    $('#room-pick', m.el).innerHTML = cfg.rooms.map((r) => {
      const busy = list.find((x) => x.room_id === r.id && x.id !== b.id && x.start < z && x.end > a);
      const checked = +f.room_id === r.id;
      return `<label class="room-opt ${checked ? 'checked' : ''} ${busy ? 'busy' : ''} ${att > r.capacity ? 'small-cap' : ''}">
        <input type="radio" name="room_id" value="${r.id}" ${checked ? 'checked' : ''}>
        <b><i style="background:${r.color}"></i>${esc(r.name)}</b>
        <small>${r.capacity} posti${r.location ? ' · ' + esc(r.location) : ''}</small>
        <span class="avail ${busy ? 'ko' : 'ok'}">${warn ? '—' : busy ? `Occupata ${busy.start}–${busy.end}` : '● Disponibile'}</span>
        <span class="cap-warn">Troppo piccola per ${att} persone</span>
      </label>`;
    }).join('');
    $$('.room-opt input', m.el).forEach((i) => i.onchange = () => { f.room_id = +i.value; $$('.room-opt', m.el).forEach((x) => x.classList.toggle('checked', x.contains(i))); });
    $('#bk-err', m.el).textContent = warn;
  };
  sStart.onchange = () => { fillEnd(); refresh(); };
  sEnd.onchange = refresh; form.date.onchange = refresh; form.attendees.oninput = refresh;
  await refresh();

  form.onsubmit = async (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(form));
    if (!data.room_id) { $('#bk-err', m.el).textContent = 'Seleziona una sala'; return; }
    const btn = $('#bk-save', m.el); btn.disabled = true;
    try {
      if (editing) {
        await api(`/api/bookings/${b.id}`, { method: 'PUT', body: data });
        toast('Prenotazione aggiornata');
      } else {
        const r = await api('/api/bookings', { method: 'POST', body: data });
        if (r.skipped.length) toast(`Create ${r.created.length} prenotazioni. Saltate ${r.skipped.length}: ${r.skipped.map((s) => fmtDateShort(s.date)).join(', ')}`, 'warn');
        else toast(r.created.length > 1 ? `${r.created.length} prenotazioni confermate` : 'Prenotazione confermata!');
        if (r.warning) toast(r.warning, 'warn');
      }
      m.close();
      if (data.date !== state.date && location.hash !== '#mie') state.date = data.date;
      location.hash === '#mie' ? renderMine() : loadDay();
    } catch (err) { $('#bk-err', m.el).textContent = err.message; btn.disabled = false; }
  };
  if (editing) $('#bk-del', m.el).onclick = async () => { if (await cancelBooking(b)) m.close(); };
}

async function cancelBooking(b) {
  const extra = b.series_id ? `<label class="check"><input type="radio" name="scope" value="one" checked><span><b>Solo questa</b><small>${fmtDateLong(b.date)}</small></span></label>
    <label class="check"><input type="radio" name="scope" value="series"><span><b>Questa e tutte le successive della serie</b><small>Riunione ricorrente settimanale</small></span></label>` : '';
  const ok = await confirmBox('Annullare la prenotazione?', `<b>${esc(b.title)}</b><br>${fmtDateLong(b.date)}, ${b.start}–${b.end}<br><br>La sala tornerà disponibile per le altre aziende.`, { okText: 'Sì, annulla', danger: true, extra });
  if (!ok) return false;
  try {
    const r = await api(`/api/bookings/${b.id}${ok.scope === 'series' ? '?series=1' : ''}`, { method: 'DELETE' });
    toast(r.cancelled > 1 ? `${r.cancelled} prenotazioni annullate` : 'Prenotazione annullata');
    location.hash === '#mie' ? renderMine() : loadDay();
    return true;
  } catch (e) { toast(e.message, 'err'); return false; }
}

/* ---------------------------------------------------------------- le mie prenotazioni */
const mineState = { scope: 'mine', past: false };
async function renderMine() {
  const v = $('#view-mie');
  let data;
  try { data = await api(`/api/bookings/mine?scope=${mineState.scope}&past=${mineState.past ? 1 : 0}`); }
  catch (e) { if (e.status === 401) location.reload(); return toast(e.message, 'err'); }
  const groups = {};
  for (const b of data.bookings) (groups[b.date] ??= []).push(b);
  const rooms = Object.fromEntries(state.cfg.rooms.map((r) => [r.id, r]));
  const n = nowLocal();
  const statusTag = (b) => {
    if (b.status === 'liberata') return '<span class="tag tag-red">Rilasciata (no check-in)</span>';
    if (b.date === n.date && toMin(b.start) <= n.min && n.min < toMin(b.end)) return '<span class="tag tag-green">In corso</span>';
    if (b.series_id) return '<span class="tag">Ricorrente</span>';
    return '';
  };
  const q = data.quota;
  v.innerHTML = `
    <div class="page-head">
      <h1>Le mie prenotazioni</h1><div class="spacer"></div>
      ${state.me.company_id ? `<div class="seg" id="seg-scope"><button data-v="mine" class="${mineState.scope === 'mine' ? 'active' : ''}">Mie</button><button data-v="company" class="${mineState.scope === 'company' ? 'active' : ''}">Tutta ${esc(state.me.company_name)}</button></div>` : ''}
      <div class="seg" id="seg-time"><button data-v="0" class="${!mineState.past ? 'active' : ''}">Prossime</button><button data-v="1" class="${mineState.past ? 'active' : ''}">Passate</button></div>
      <button class="btn btn-accent" id="mine-new">${ICON.plus} Nuova prenotazione</button>
    </div>
    <div class="mine-layout">
      <div>${Object.keys(groups).length ? Object.entries(groups).map(([d, list]) => `
        <div class="day-group"><h4>${d === n.date ? 'Oggi · ' : d === addDays(n.date, 1) ? 'Domani · ' : ''}${fmtDateLong(d)}</h4>
        ${list.map((b) => { const r = rooms[b.room_id] || { color: '#94a3b8', name: b.room_name }; const ended = b.date < n.date || (b.date === n.date && toMin(b.end) <= n.min); return `
          <div class="bk-item" style="border-left-color:${r.color}">
            <div class="bk-time">${b.start} – ${b.end}<small>${esc(r.name)}</small></div>
            <div class="bk-main"><b>${esc(b.title)} ${statusTag(b)}</b><small>${[b.attendees ? b.attendees + ' partecipanti' : '', mineState.scope === 'company' ? 'Prenotata da ' + esc(b.user_name || '') : esc(b.notes || '')].filter(Boolean).join(' · ')}</small></div>
            <div class="bk-actions">
              ${b.status === 'confermata' ? `<a class="btn btn-ghost btn-sm" href="/api/bookings/${b.id}/ics" title="Aggiungi al tuo calendario (Outlook, Google, Apple)">${ICON.cal} Calendario</a>` : ''}
              ${b.can_edit && !ended && b.status === 'confermata' ? `<button class="btn btn-ghost btn-sm" data-edit="${b.id}">${ICON.edit} Modifica</button><button class="btn btn-danger-ghost btn-sm" data-del="${b.id}">${ICON.trash}</button>` : ''}
            </div>
          </div>`; }).join('')}</div>`).join('') : `<div class="card empty"><div class="big">📅</div><h3>${mineState.past ? 'Nessuna prenotazione passata' : 'Nessuna prenotazione in programma'}</h3><p>Vai al calendario per prenotare una sala.</p><a class="btn btn-primary" href="#calendario">Apri il calendario</a></div>`}
      </div>
      <aside>
        ${q ? `<div class="card card-pad side-card"><h3>Utilizzo di ${esc(state.me.company_name)}</h3><p class="muted small" style="margin:0">Mese di ${MESI[+q.month.slice(5) - 1]} ${q.month.slice(0, 4)}</p>
          ${q.limit != null ? `<div class="quota-bar ${q.used / q.limit > .8 ? 'warn' : ''}"><div style="width:${Math.min(100, (100 * q.used) / (q.limit || 1))}%"></div></div><b>${fmtHours(q.used)}</b> <span class="muted">su ${fmtHours(q.limit)} disponibili</span>`
            : `<p style="font-size:26px;font-weight:750;margin:10px 0 0">${fmtHours(q.used)}</p><span class="muted small">prenotate questo mese</span>`}</div>` : ''}
        <div class="card card-pad side-card"><h3>Regole di utilizzo</h3><ul class="rules">
          <li>Sale prenotabili dal <b>lunedì al venerdì</b>, dalle <b>${state.cfg.open_time}</b> alle <b>${state.cfg.close_time}</b>.</li>
          <li>Blocchi da ${state.cfg.slot_minutes} minuti, massimo ${String(state.cfg.max_hours_per_booking).replace('.', ',')} ore per prenotazione.</li>
          <li>Prenotazione fino a ${state.cfg.max_advance_days} giorni in anticipo.</li>
          ${state.cfg.checkin_required ? `<li>Conferma la presenza sul display della sala entro <b>${state.cfg.checkin_grace_minutes} minuti</b> dall'inizio, altrimenti la sala viene liberata.</li>` : ''}
          <li>Se non ti serve più, <b>annulla</b> la prenotazione: libererai la sala per gli altri.</li></ul></div>
      </aside>
    </div>`;
  $$('#seg-scope button').forEach((b) => b.onclick = () => { mineState.scope = b.dataset.v; renderMine(); });
  $$('#seg-time button').forEach((b) => b.onclick = () => { mineState.past = b.dataset.v === '1'; renderMine(); });
  $('#mine-new').onclick = () => bookingModal({ date: firstBookableDay() });
  $$('[data-edit]').forEach((x) => x.onclick = () => bookingModal(data.bookings.find((b) => b.id === +x.dataset.edit)));
  $$('[data-del]').forEach((x) => x.onclick = () => cancelBooking(data.bookings.find((b) => b.id === +x.dataset.del)));
}

init();
