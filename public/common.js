/* Funzioni condivise tra le pagine */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(path, {
    method, credentials: 'same-origin',
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const ct = res.headers.get('content-type') || '';
  const data = ct.includes('json') ? await res.json() : await res.text();
  if (!res.ok) {
    const err = new Error((data && data.error) || 'Errore di comunicazione');
    err.status = res.status; throw err;
  }
  return data;
}

const toMin = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
const toHHMM = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const addDays = (d, n) => { const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const weekday = (d) => new Date(d + 'T12:00:00Z').getUTCDay();
const GIORNI = ['Domenica', 'Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì', 'Sabato'];
const GIORNI_BREVI = ['Dom', 'Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab'];
const MESI = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];
const fmtDateLong = (d) => { const [y, m, dd] = d.split('-').map(Number); return `${GIORNI[weekday(d)]} ${dd} ${MESI[m - 1]} ${y}`; };
const fmtDateShort = (d) => { const [, m, dd] = d.split('-').map(Number); return `${GIORNI_BREVI[weekday(d)]} ${dd} ${MESI[m - 1].slice(0, 3)}`; };
const fmtHours = (h) => (Math.round(h * 10) / 10).toString().replace('.', ',') + ' h';

function toast(msg, type = 'ok') {
  let box = $('#toasts');
  if (!box) { box = document.createElement('div'); box.id = 'toasts'; document.body.appendChild(box); }
  const t = document.createElement('div');
  t.className = `toast toast-${type}`;
  t.innerHTML = `<span class="toast-icon">${type === 'ok' ? '✓' : type === 'warn' ? '!' : '✕'}</span><span>${esc(msg)}</span>`;
  box.appendChild(t);
  requestAnimationFrame(() => t.classList.add('show'));
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, type === 'err' ? 6000 : 3500);
}

/* Finestra modale generica. Ritorna {el, close} */
function openModal(html, { wide = false, onClose } = {}) {
  const wrap = document.createElement('div');
  wrap.className = 'modal-backdrop';
  wrap.innerHTML = `<div class="modal ${wide ? 'modal-wide' : ''}" role="dialog" aria-modal="true">${html}</div>`;
  document.body.appendChild(wrap);
  document.body.classList.add('no-scroll');
  requestAnimationFrame(() => wrap.classList.add('show'));
  const close = () => {
    wrap.classList.remove('show');
    document.body.classList.remove('no-scroll');
    setTimeout(() => wrap.remove(), 200);
    document.removeEventListener('keydown', onKey);
    onClose && onClose();
  };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  wrap.addEventListener('mousedown', (e) => { if (e.target === wrap) close(); });
  $$('[data-close]', wrap).forEach((b) => b.addEventListener('click', close));
  const first = $('input:not([type=hidden]),select,textarea', wrap);
  if (first) setTimeout(() => first.focus(), 50);
  return { el: wrap, close };
}

function confirmBox(title, text, { okText = 'Conferma', danger = false, extra = '' } = {}) {
  return new Promise((resolve) => {
    let done = false;
    const m = openModal(`
      <div class="modal-head"><h3>${esc(title)}</h3><button class="icon-btn" data-close aria-label="Chiudi">✕</button></div>
      <div class="modal-body"><p class="muted">${text}</p>${extra}</div>
      <div class="modal-foot"><button class="btn btn-ghost" data-close>Annulla</button><button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" id="cb-ok">${esc(okText)}</button></div>`,
    { onClose: () => { if (!done) resolve(false); } });
    $('#cb-ok', m.el).onclick = () => { done = true; const vals = Object.fromEntries($$('input', m.el).map((i) => [i.name, i.type === 'radio' ? (i.checked ? i.value : undefined) : i.value]).filter((x) => x[1] !== undefined)); m.close(); resolve(vals); };
  });
}

/* Cambio password (obbligatorio al primo accesso) */
function passwordModal(forced = false) {
  return new Promise((resolve) => {
    const m = openModal(`
      <div class="modal-head"><h3>${forced ? 'Imposta la tua password' : 'Cambia password'}</h3>${forced ? '' : '<button class="icon-btn" data-close>✕</button>'}</div>
      <form class="modal-body" id="pw-form">
        ${forced ? '<p class="muted">È il tuo primo accesso: scegli una password personale di almeno 8 caratteri.</p>' : ''}
        <label class="field"><span>Password attuale</span><input type="password" name="current" required autocomplete="current-password"></label>
        <label class="field"><span>Nuova password</span><input type="password" name="next" required minlength="8" autocomplete="new-password"></label>
        <label class="field"><span>Ripeti nuova password</span><input type="password" name="again" required minlength="8" autocomplete="new-password"></label>
        <div class="form-error" id="pw-err"></div>
      </form>
      <div class="modal-foot">${forced ? '' : '<button class="btn btn-ghost" data-close>Annulla</button>'}<button class="btn btn-primary" form="pw-form">Salva password</button></div>`);
    if (forced) m.el.onmousedown = null;
    $('#pw-form', m.el).onsubmit = async (e) => {
      e.preventDefault();
      const f = Object.fromEntries(new FormData(e.target));
      if (f.next !== f.again) { $('#pw-err', m.el).textContent = 'Le due password non coincidono'; return; }
      try { await api('/api/me/password', { method: 'POST', body: f }); m.close(); toast('Password aggiornata'); resolve(true); }
      catch (err) { $('#pw-err', m.el).textContent = err.message; }
    };
  });
}

/* Barra superiore comune */
function renderTopbar(me, active, building) {
  const tabs = [
    ['index.html#calendario', 'calendario', 'Calendario sale', '<path d="M7 3v3M17 3v3M4 9h16M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z"/>'],
    ['index.html#mie', 'mie', 'Le mie prenotazioni', '<path d="M9 11l2 2 4-4M5 4h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z"/>'],
  ];
  if (me.role === 'admin') tabs.push(['admin.html', 'admin', 'Amministrazione', '<path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>']);
  const initials = me.name.split(/\s+/).map((x) => x[0]).slice(0, 2).join('').toUpperCase();
  const bar = document.createElement('header');
  bar.className = 'topbar';
  bar.innerHTML = `
    <a class="brand" href="index.html" title="${esc(building || '')}">
      <img src="brand/logo-bianco.png" alt="${esc(building || 'CARDO Centro Uffici')}">
      <span class="brand-sub">Sale<br>riunioni</span>
    </a>
    <nav class="tabs">${tabs.map(([href, key, label, icon]) => `<a href="${href}" data-tab="${key}" class="tab ${key === active ? 'active' : ''}"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${icon}</svg><span>${label}</span></a>`).join('')}</nav>
    <div class="user-menu">
      <button class="user-btn" id="user-btn"><span class="avatar">${esc(initials)}</span><span class="user-info"><b>${esc(me.name)}</b><small>${esc(me.company_name || (me.role === 'admin' ? 'Amministrazione stabile' : ''))}</small></span><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M6 9l6 6 6-6"/></svg></button>
      <div class="dropdown" id="user-dd">
        <div class="dd-head"><b>${esc(me.name)}</b><small>${esc(me.email)}</small><span class="role-pill role-${me.role}">${{ admin: 'Amministratore', referente: 'Referente aziendale', utente: 'Utente' }[me.role]}</span></div>
        <button id="dd-pw">Cambia password</button>
        <button id="dd-out" class="danger">Esci</button>
      </div>
    </div>`;
  document.body.prepend(bar);
  $('#user-btn').onclick = (e) => { e.stopPropagation(); $('#user-dd').classList.toggle('open'); };
  document.addEventListener('click', () => $('#user-dd').classList.remove('open'));
  $('#dd-pw').onclick = () => passwordModal(false);
  $('#dd-out').onclick = async () => { await api('/api/logout', { method: 'POST', body: {} }); location.href = 'index.html'; };
}

/* Aggiornamento in tempo reale via Server-Sent Events */
function liveUpdates(url, onChange) {
  let es; let timer;
  const connect = () => {
    es = new EventSource(url);
    es.addEventListener('changed', () => { clearTimeout(timer); timer = setTimeout(onChange, 250); });
    es.onerror = () => { es.close(); setTimeout(connect, 5000); };
  };
  connect();
}
