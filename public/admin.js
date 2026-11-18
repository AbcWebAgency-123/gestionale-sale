/* Pannello di amministrazione dello stabile */
let ME = null; let CFG = null;
const ic = (p) => `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`;
const SECTIONS = [
  ['panoramica', 'Panoramica', ic('<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>')],
  ['prenotazioni', 'Prenotazioni', ic('<path d="M7 3v3M17 3v3M4 9h16M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z"/>')],
  ['aziende', 'Aziende', ic('<path d="M3 21h18M5 21V5a1 1 0 0 1 1-1h8a1 1 0 0 1 1 1v16M15 9h3a1 1 0 0 1 1 1v11M8 8h3M8 12h3M8 16h3"/>')],
  ['utenti', 'Utenti', ic('<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.6-3.6 3.3-5.5 6.5-5.5s5.9 1.9 6.5 5.5M16 4.5a3.5 3.5 0 0 1 0 7M18.5 14.8c1.7.8 2.8 2.5 3 5.2"/>')],
  ['sale', 'Sale e display', ic('<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>')],
  ['chiusure', 'Chiusure e festività', ic('<circle cx="12" cy="12" r="9"/><path d="M5.6 5.6l12.8 12.8"/>')],
  ['impostazioni', 'Regole e impostazioni', ic('<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>')],
  ['registro', 'Registro attività', ic('<path d="M12 8v4l3 2"/><circle cx="12" cy="12" r="9"/>')],
];

async function init() {
  try { ME = await api('/api/me'); } catch { location.href = 'index.html'; return; }
  if (ME.role !== 'admin') { location.href = 'index.html'; return; }
  if (ME.must_change_password) await passwordModal(true);
  CFG = await api('/api/config');
  renderTopbar(ME, 'admin', CFG.building_name);
  $('#app').classList.remove('hidden');
  $('#side-nav').innerHTML = SECTIONS.map(([k, l, i]) => `<button data-s="${k}">${i}<span>${l}</span></button>`).join('');
  $$('#side-nav button').forEach((b) => (b.onclick = () => { location.hash = b.dataset.s; }));
  window.addEventListener('hashchange', show);
  show();
}
function show() {
  const s = (location.hash || '#panoramica').slice(1);
  $$('#side-nav button').forEach((b) => b.classList.toggle('active', b.dataset.s === s));
  ({ panoramica, prenotazioni, aziende, utenti, sale, chiusure, impostazioni, registro }[s] || panoramica)();
}
const C = () => $('#content');
const head = (title, sub, right = '') => `<div class="page-head"><div><h1>${title}</h1>${sub ? `<p class="muted" style="margin:4px 0 0">${sub}</p>` : ''}</div><div class="spacer"></div>${right}</div>`;
const thisMonth = () => new Date().toISOString().slice(0, 7);

/* ------------------------------------------------------------ panoramica */
async function panoramica(month = thisMonth()) {
  const r = await api(`/api/admin/report?month=${month}`);
  const totH = r.rooms.reduce((t, x) => t + x.hours, 0);
  const avgOcc = r.rooms.length ? r.rooms.reduce((t, x) => t + x.occupancy, 0) / r.rooms.length : 0;
  const noShow = r.rooms.reduce((t, x) => t + x.no_show, 0);
  const colors = Object.fromEntries(CFG.rooms.map((x) => [x.name, x.color]));
  const maxC = Math.max(1, ...r.companies.map((c) => c.hours));
  C().innerHTML = head('Panoramica', `Utilizzo delle sale nel mese · ${r.workdays} giorni lavorativi`,
    `<input type="month" id="m" value="${month}" style="width:170px">
     <a class="btn btn-ghost" href="/api/admin/export.csv?month=${month}">Esporta CSV</a>
     <a class="btn btn-ghost" href="/api/admin/backup" title="Scarica una copia completa del database">Backup dati</a>`) + `
    <div class="kpis">
      <div class="card kpi"><small>Prenotazioni</small><b>${r.bookings}</b><span>nel mese</span></div>
      <div class="card kpi"><small>Ore prenotate</small><b>${fmtHours(totH)}</b><span>su ${fmtHours(r.hours_available_per_room * r.rooms.length)} disponibili</span></div>
      <div class="card kpi"><small>Occupazione media</small><b>${avgOcc.toFixed(0)}%</b><span>delle 5 sale</span></div>
      <div class="card kpi"><small>Aziende che hanno prenotato</small><b>${r.companies.length}</b><span>${noShow ? `${noShow} sale liberate per mancato check-in` : 'nessun mancato check-in'}</span></div>
    </div>
    <div class="settings-grid">
      <div class="card"><div class="card-head"><h3>Occupazione per sala</h3></div><div class="card-pad bars">
        ${r.rooms.map((x) => `<div class="bar-row"><b>${esc(x.room)}</b><div class="track"><div class="fill" style="width:${Math.min(100, x.occupancy)}%;background:${colors[x.room] || 'var(--primary)'}"></div></div><span class="val">${String(x.occupancy).replace(".", ",")}% · ${fmtHours(x.hours)}</span></div>`).join('')}
      </div></div>
      <div class="card"><div class="card-head"><h3>Aziende più attive</h3></div><div class="card-pad bars">
        ${r.companies.slice(0, 10).map((x) => `<div class="bar-row"><span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(x.company)}</span><div class="track"><div class="fill" style="width:${(100 * x.hours) / maxC}%;background:var(--primary)"></div></div><span class="val">${fmtHours(x.hours)} · ${x.bookings} pren.</span></div>`).join('') || '<p class="muted">Nessuna prenotazione in questo mese.</p>'}
      </div></div>
    </div>
    ${r.companies.length > 10 ? `<div class="card" style="margin-top:20px"><div class="card-head"><h3>Tutte le aziende</h3></div><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Azienda</th><th class="num">Ore</th><th class="num">Prenotazioni</th><th class="num">Mancati check-in</th></tr></thead><tbody>
      ${r.companies.map((x) => `<tr><td>${esc(x.company)}</td><td class="num">${fmtHours(x.hours)}</td><td class="num">${x.bookings}</td><td class="num">${x.no_show || ''}</td></tr>`).join('')}</tbody></table></div></div>` : ''}`;
  $('#m').onchange = (e) => panoramica(e.target.value);
}

/* ------------------------------------------------------------ prenotazioni */
const bkFilter = { from: null, to: null, company: '', room: '', status: 'confermata' };
async function prenotazioni() {
  const today = new Date().toISOString().slice(0, 10);
  bkFilter.from ??= today; bkFilter.to ??= addDays(today, 30);
  const companies = await api('/api/admin/companies');
  C().innerHTML = head('Prenotazioni', 'Cerca, controlla e annulla le prenotazioni di tutte le aziende', `<a class="btn btn-primary" href="index.html">Prenota dal calendario</a>`) + `
    <div class="card"><div class="toolbar">
      <label class="small muted">Dal</label><input type="date" id="f-from" value="${bkFilter.from}">
      <label class="small muted">al</label><input type="date" id="f-to" value="${bkFilter.to}">
      <select id="f-company"><option value="">Tutte le aziende</option>${companies.map((c) => `<option value="${c.id}" ${String(c.id) === bkFilter.company ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select>
      <select id="f-room"><option value="">Tutte le sale</option>${CFG.rooms.map((r) => `<option value="${r.id}" ${String(r.id) === bkFilter.room ? 'selected' : ''}>${esc(r.name)}</option>`).join('')}</select>
      <select id="f-status"><option value="">Tutti gli stati</option>${['confermata', 'cancellata', 'liberata'].map((s) => `<option ${s === bkFilter.status ? 'selected' : ''}>${s}</option>`).join('')}</select>
      <div class="spacer"></div><span class="muted small" id="f-count"></span>
    </div><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Data</th><th>Orario</th><th>Sala</th><th>Azienda</th><th>Titolo</th><th>Prenotata da</th><th>Stato</th><th></th></tr></thead><tbody id="bk-body"></tbody></table></div></div>`;
  const load = async () => {
    Object.assign(bkFilter, { from: $('#f-from').value, to: $('#f-to').value, company: $('#f-company').value, room: $('#f-room').value, status: $('#f-status').value });
    const q = new URLSearchParams(Object.entries(bkFilter).filter(([, v]) => v));
    const rows = await api(`/api/admin/bookings?${q}`).catch((e) => { toast(e.message, 'err'); return []; });
    $('#f-count').textContent = `${rows.length} risultati`;
    const tag = { confermata: 'tag-green', cancellata: '', liberata: 'tag-red' };
    $('#bk-body').innerHTML = rows.map((b) => `<tr class="${b.status !== 'confermata' ? 'inactive' : ''}"><td>${fmtDateShort(b.date)}</td><td>${b.start}–${b.end}</td><td>${esc(b.room_name)}</td><td>${esc(b.company_name || '—')}</td><td>${esc(b.title)}${b.series_id ? ' <span class="tag">ricorrente</span>' : ''}</td><td>${esc(b.user_name || '')}</td>
      <td><span class="tag ${tag[b.status]}">${b.status}</span>${b.checked_in ? ' <span class="tag tag-green">check-in</span>' : ''}</td>
      <td class="actions">${b.status === 'confermata' ? `<button class="btn btn-danger-ghost btn-sm" data-del="${b.id}">Annulla</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="8" class="empty">Nessuna prenotazione trovata</td></tr>';
    $$('[data-del]').forEach((x) => x.onclick = async () => {
      if (!await confirmBox('Annullare la prenotazione?', 'L\'azienda vedrà la prenotazione come annullata e la sala tornerà disponibile.', { okText: 'Annulla prenotazione', danger: true })) return;
      try { await api(`/api/bookings/${x.dataset.del}`, { method: 'DELETE' }); toast('Prenotazione annullata'); load(); } catch (e) { toast(e.message, 'err'); }
    });
  };
  $$('.toolbar input, .toolbar select').forEach((x) => (x.onchange = load));
  load();
}

/* ------------------------------------------------------------ aziende */
async function aziende() {
  const rows = await api('/api/admin/companies');
  const active = rows.filter((c) => c.active).length;
  C().innerHTML = head('Aziende', `${active} aziende attive nello stabile`, `<button class="btn btn-ghost" id="imp">Importa da CSV</button><button class="btn btn-primary" id="add">+ Nuova azienda</button>`) + `
    <div class="card"><div class="toolbar"><input class="search" id="q" placeholder="Cerca azienda, referente, piano…"><label class="check" style="padding:0"><input type="checkbox" id="show-inactive"><span class="small">Mostra disattivate</span></label></div>
    <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Azienda</th><th>Ubicazione</th><th>Referente</th><th class="num">Utenti</th><th class="num">Ore questo mese</th><th class="num">Monte ore</th><th></th></tr></thead><tbody id="body"></tbody></table></div></div>`;
  const draw = () => {
    const q = $('#q').value.toLowerCase(); const inact = $('#show-inactive').checked;
    $('#body').innerHTML = rows.filter((c) => (inact || c.active) && `${c.name} ${c.location} ${c.contact_name} ${c.contact_email}`.toLowerCase().includes(q)).map((c) => `
      <tr class="${c.active ? '' : 'inactive'}"><td><b>${esc(c.name)}</b>${c.active ? '' : ' <span class="tag">disattivata</span>'}</td><td>${esc(c.location)}</td>
      <td>${esc(c.contact_name)}<br><span class="muted small">${esc(c.contact_email)} ${esc(c.contact_phone)}</span></td>
      <td class="num">${c.users_count}</td><td class="num">${fmtHours(c.hours_this_month)}</td><td class="num">${c.monthly_quota_hours != null ? fmtHours(c.monthly_quota_hours) : '<span class="muted">illimitato</span>'}</td>
      <td class="actions"><button class="btn btn-ghost btn-sm" data-edit="${c.id}">Modifica</button></td></tr>`).join('') || '<tr><td colspan="7" class="empty">Nessuna azienda. Aggiungine una o importale da CSV.</td></tr>';
    $$('[data-edit]').forEach((b) => (b.onclick = () => companyModal(rows.find((c) => c.id === +b.dataset.edit))));
  };
  $('#q').oninput = draw; $('#show-inactive').onchange = draw; draw();
  $('#add').onclick = () => companyModal({ active: 1 });
  $('#imp').onclick = importModal;
}
function companyModal(c) {
  const m = openModal(`
    <div class="modal-head"><h3>${c.id ? 'Modifica azienda' : 'Nuova azienda'}</h3><button class="icon-btn" data-close>✕</button></div>
    <form class="modal-body" id="f">
      <label class="field"><span>Ragione sociale</span><input name="name" required value="${esc(c.name)}"></label>
      <label class="field"><span>Ubicazione nello stabile</span><input name="location" placeholder="Es. Piano 3, interno 12" value="${esc(c.location)}"></label>
      <div class="row"><label class="field"><span>Referente</span><input name="contact_name" value="${esc(c.contact_name)}"></label><label class="field"><span>Telefono</span><input name="contact_phone" value="${esc(c.contact_phone)}"></label></div>
      <label class="field"><span>Email referente</span><input type="email" name="contact_email" value="${esc(c.contact_email)}"></label>
      <label class="field"><span>Monte ore mensile</span><input type="number" step="0.5" min="0" name="monthly_quota_hours" value="${c.monthly_quota_hours ?? ''}" placeholder="Vuoto = illimitato"><small>Numero massimo di ore di sala prenotabili ogni mese (utile se le sale sono incluse nel contratto con un limite).</small></label>
      <label class="check"><input type="checkbox" name="active" ${c.active ? 'checked' : ''}><span><b>Azienda attiva</b><small>Se disattivata, i suoi utenti non possono accedere e le prenotazioni future vengono annullate.</small></span></label>
      <div class="form-error" id="err"></div>
    </form>
    <div class="modal-foot"><button class="btn btn-ghost" data-close>Annulla</button><button class="btn btn-primary" form="f">Salva</button></div>`);
  $('#f', m.el).onsubmit = async (e) => {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(e.target)); d.active = !!d.active;
    try {
      if (c.id && c.active && !d.active) {
        if (!await confirmBox('Disattivare l\'azienda?', 'Tutti gli utenti verranno disattivati e le prenotazioni future annullate.', { danger: true, okText: 'Disattiva' })) return;
        await api(`/api/admin/companies/${c.id}`, { method: 'DELETE' });
      }
      await api(c.id ? `/api/admin/companies/${c.id}` : '/api/admin/companies', { method: c.id ? 'PUT' : 'POST', body: d });
      m.close(); toast('Azienda salvata'); aziende();
    } catch (err) { $('#err', m.el).textContent = err.message; }
  };
}
function credentialsTable(list) {
  const csv = 'Azienda;Nome;Email;Ruolo;Password\n' + list.map((u) => [u.company, u.name, u.email, u.role, u.password].join(';')).join('\n');
  const url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv' }));
  return `<p class="muted">Credenziali generate: consegnale agli utenti (al primo accesso dovranno cambiare la password). <b>Non saranno più visibili</b> dopo aver chiuso questa finestra.</p>
    <a class="btn btn-primary btn-sm" href="${url}" download="credenziali-utenti.csv" style="margin-bottom:12px">Scarica credenziali (CSV)</a>
    <div class="tbl-wrap" style="max-height:300px"><table class="tbl"><thead><tr><th>Azienda</th><th>Email</th><th>Password</th></tr></thead><tbody>${list.map((u) => `<tr><td>${esc(u.company)}</td><td>${esc(u.email)}</td><td><code>${esc(u.password)}</code></td></tr>`).join('')}</tbody></table></div>`;
}
function importModal() {
  const m = openModal(`
    <div class="modal-head"><h3>Importa aziende e utenti</h3><button class="icon-btn" data-close>✕</button></div>
    <div class="modal-body" id="imp-body">
      <p class="muted" style="margin-top:0">Carica un file CSV (anche esportato da Excel) con le colonne <b>azienda; nome; email; ruolo</b>. Il ruolo può essere <code>referente</code> o <code>utente</code>. Le aziende non presenti vengono create automaticamente; una riga con solo il nome dell'azienda crea l'azienda senza utenti.</p>
      <pre style="background:var(--surface-2);padding:12px;border-radius:10px;font-size:12.5px;overflow:auto">azienda;nome;email;ruolo
Alfa Srl;Mario Rossi;mario.rossi@alfa.it;referente
Alfa Srl;Laura Bianchi;laura.bianchi@alfa.it;utente
Beta Spa;Giulia Verdi;g.verdi@beta.com;referente</pre>
      <label class="field"><span>File CSV</span><input type="file" id="csv-file" accept=".csv,text/csv,.txt"></label>
      <label class="field"><span>…oppure incolla qui il contenuto</span><textarea id="csv-text" rows="6"></textarea></label>
      <div class="form-error" id="err"></div>
    </div>
    <div class="modal-foot"><button class="btn btn-ghost" data-close>Chiudi</button><button class="btn btn-primary" id="go">Importa</button></div>`, { wide: true, onClose: () => location.hash.includes('utenti') ? utenti() : aziende() });
  $('#csv-file', m.el).onchange = async (e) => { const f = e.target.files[0]; if (f) $('#csv-text', m.el).value = await f.text(); };
  $('#go', m.el).onclick = async () => {
    try {
      const r = await api('/api/admin/import', { method: 'POST', body: { csv: $('#csv-text', m.el).value } });
      $('#imp-body', m.el).innerHTML = `<p><b>${r.companies_created}</b> aziende create · <b>${r.users_created.length}</b> utenti creati</p>
        ${r.errors.length ? `<div class="form-error">${r.errors.map(esc).join('<br>')}</div>` : ''}${r.users_created.length ? credentialsTable(r.users_created) : ''}`;
      $('#go', m.el).remove();
    } catch (err) { $('#err', m.el).textContent = err.message; }
  };
}

/* ------------------------------------------------------------ utenti */
async function utenti() {
  const [rows, companies] = await Promise.all([api('/api/admin/users'), api('/api/admin/companies')]);
  const ROLE = { admin: 'Amministratore', referente: 'Referente', utente: 'Utente' };
  C().innerHTML = head('Utenti', `${rows.filter((u) => u.active).length} utenti attivi`, `<button class="btn btn-ghost" id="imp">Importa da CSV</button><button class="btn btn-primary" id="add">+ Nuovo utente</button>`) + `
    <div class="card"><div class="toolbar"><input class="search" id="q" placeholder="Cerca nome o email…">
      <select id="fc"><option value="">Tutte le aziende</option>${companies.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select>
      <label class="check" style="padding:0"><input type="checkbox" id="show-inactive"><span class="small">Mostra disattivati</span></label></div>
    <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Nome</th><th>Email</th><th>Azienda</th><th>Ruolo</th><th>Ultimo accesso</th><th></th></tr></thead><tbody id="body"></tbody></table></div></div>
    <p class="muted small" style="margin-top:12px"><b>Referente</b>: può modificare e annullare tutte le prenotazioni della propria azienda. <b>Utente</b>: gestisce solo le proprie. <b>Amministratore</b>: gestisce tutto lo stabile.</p>`;
  const draw = () => {
    const q = $('#q').value.toLowerCase(); const fc = $('#fc').value; const inact = $('#show-inactive').checked;
    $('#body').innerHTML = rows.filter((u) => (inact || u.active) && (!fc || String(u.company_id) === fc) && `${u.name} ${u.email}`.toLowerCase().includes(q)).map((u) => `
      <tr class="${u.active ? '' : 'inactive'}"><td><b>${esc(u.name)}</b>${u.must_change_password ? ' <span class="tag tag-amber" title="Non ha ancora cambiato la password iniziale">primo accesso</span>' : ''}</td><td>${esc(u.email)}</td><td>${esc(u.company_name || '—')}</td>
      <td><span class="role-pill role-${u.role}">${ROLE[u.role]}</span></td><td class="muted small">${u.last_login ? u.last_login.slice(0, 16).replace('T', ' ') : 'mai'}</td>
      <td class="actions"><button class="btn btn-ghost btn-sm" data-reset="${u.id}">Reset password</button> <button class="btn btn-ghost btn-sm" data-edit="${u.id}">Modifica</button></td></tr>`).join('') || '<tr><td colspan="6" class="empty">Nessun utente</td></tr>';
    $$('[data-edit]').forEach((b) => (b.onclick = () => userModal(rows.find((u) => u.id === +b.dataset.edit), companies)));
    $$('[data-reset]').forEach((b) => (b.onclick = async () => {
      const u = rows.find((x) => x.id === +b.dataset.reset);
      if (!await confirmBox('Reimpostare la password?', `Verrà generata una nuova password temporanea per <b>${esc(u.name)}</b>.`, { okText: 'Genera password' })) return;
      const r = await api(`/api/admin/users/${u.id}/reset-password`, { method: 'POST', body: {} });
      openModal(`<div class="modal-head"><h3>Nuova password</h3><button class="icon-btn" data-close>✕</button></div><div class="modal-body"><p class="muted" style="margin-top:0">Comunica a <b>${esc(u.name)}</b> (${esc(u.email)}) la password temporanea:</p><div class="pw-box">${esc(r.password)}</div><p class="muted small">Al primo accesso dovrà sceglierne una personale.</p></div><div class="modal-foot"><button class="btn btn-primary" data-close>Fatto</button></div>`);
    }));
  };
  $('#q').oninput = draw; $('#fc').onchange = draw; $('#show-inactive').onchange = draw; draw();
  $('#add').onclick = () => userModal({ active: 1, role: 'utente' }, companies);
  $('#imp').onclick = importModal;
}
function userModal(u, companies) {
  const m = openModal(`
    <div class="modal-head"><h3>${u.id ? 'Modifica utente' : 'Nuovo utente'}</h3><button class="icon-btn" data-close>✕</button></div>
    <form class="modal-body" id="f">
      <div class="row"><label class="field"><span>Nome e cognome</span><input name="name" required value="${esc(u.name)}"></label><label class="field"><span>Email</span><input type="email" name="email" required value="${esc(u.email)}"></label></div>
      <div class="row">
        <label class="field"><span>Azienda</span><select name="company_id"><option value="">— nessuna (solo amministratori) —</option>${companies.filter((c) => c.active || c.id === u.company_id).map((c) => `<option value="${c.id}" ${c.id === u.company_id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label>
        <label class="field"><span>Ruolo</span><select name="role">${[['utente', 'Utente'], ['referente', 'Referente aziendale'], ['admin', 'Amministratore stabile']].map(([v, l]) => `<option value="${v}" ${u.role === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      </div>
      ${u.id ? `<label class="check"><input type="checkbox" name="active" ${u.active ? 'checked' : ''}><span><b>Utente attivo</b><small>Un utente disattivato non può più accedere.</small></span></label>` : '<p class="muted small">Verrà generata una password temporanea da consegnare all\'utente.</p>'}
      <div class="form-error" id="err"></div>
    </form>
    <div class="modal-foot"><button class="btn btn-ghost" data-close>Annulla</button><button class="btn btn-primary" form="f">Salva</button></div>`);
  $('#f', m.el).onsubmit = async (e) => {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(e.target)); d.active = u.id ? !!d.active : true;
    try {
      const r = await api(u.id ? `/api/admin/users/${u.id}` : '/api/admin/users', { method: u.id ? 'PUT' : 'POST', body: d });
      m.close(); toast('Utente salvato'); utenti();
      if (r.password) openModal(`<div class="modal-head"><h3>Utente creato</h3><button class="icon-btn" data-close>✕</button></div><div class="modal-body"><p class="muted" style="margin-top:0">Credenziali di <b>${esc(d.name)}</b>:</p><p>Email: <b>${esc(d.email)}</b></p><div class="pw-box">${esc(r.password)}</div><p class="muted small">Indirizzo di accesso: <b>${esc(location.origin)}</b>. Al primo accesso verrà chiesto di cambiare la password.</p></div><div class="modal-foot"><button class="btn btn-primary" data-close>Fatto</button></div>`);
    } catch (err) { $('#err', m.el).textContent = err.message; }
  };
}

/* ------------------------------------------------------------ sale e display */
async function sale() {
  const [rooms, settings] = await Promise.all([api('/api/admin/rooms'), api('/api/admin/settings')]);
  const link = (t) => `${location.origin}/display.html?token=${t}`;
  C().innerHTML = head('Sale e display', 'Configura le sale e i tablet posizionati accanto a ciascuna porta', '<button class="btn btn-primary" id="add">+ Nuova sala</button>') + `
    <div class="room-cards">${rooms.map((r) => `
      <div class="card room-card" style="border-top-color:${r.color}${r.active ? '' : ';opacity:.6'}">
        <div style="display:flex;gap:10px;align-items:flex-start"><div style="flex:1"><h3>${esc(r.name)} ${r.active ? '' : '<span class="tag">non attiva</span>'}</h3><p class="muted small" style="margin:0">${r.capacity} posti${r.location ? ' · ' + esc(r.location) : ''}</p></div><button class="btn btn-ghost btn-sm" data-edit="${r.id}">Modifica</button></div>
        <p class="small" style="margin:10px 0 0;color:var(--text-2)">${esc(r.equipment) || '<span class="muted">Nessuna dotazione indicata</span>'}</p>
        <div class="small" style="margin-top:14px;font-weight:600">Link del display</div>
        <div class="link-box"><input readonly value="${link(r.display_token)}"><button class="btn btn-ghost btn-sm" data-copy="${link(r.display_token)}">Copia</button><a class="btn btn-ghost btn-sm" target="_blank" href="${link(r.display_token)}">Apri</a></div>
        <button class="btn btn-ghost btn-sm" style="margin-top:10px" data-token="${r.id}">Rigenera link</button>
      </div>`).join('')}
      <div class="card room-card" style="border-top-color:#0f172a">
        <h3>Display atrio / reception</h3><p class="muted small" style="margin:0">Mostra lo stato di tutte le sale su un unico schermo, ideale all'ingresso o agli ascensori.</p>
        <div class="link-box" style="margin-top:28px"><input readonly value="${link(settings.lobby_token)}"><button class="btn btn-ghost btn-sm" data-copy="${link(settings.lobby_token)}">Copia</button><a class="btn btn-ghost btn-sm" target="_blank" href="${link(settings.lobby_token)}">Apri</a></div>
        <button class="btn btn-ghost btn-sm" style="margin-top:10px" id="lobby-regen">Rigenera link</button>
      </div>
    </div>
    <div class="card card-pad" style="margin-top:20px"><h3 style="font-size:15px">Come configurare i tablet</h3>
      <ol class="rules"><li>Collega il tablet alla rete Wi-Fi dello stabile e alla corrente (consigliato un supporto a parete con alimentazione).</li>
      <li>Apri il <b>link del display</b> della sala nel browser del tablet (copialo qui sopra o invialo per email).</li>
      <li>Blocca il tablet sulla pagina: su Android usa un'app kiosk (es. <i>Fully Kiosk Browser</i>), su iPad attiva <i>Accesso guidato</i> da Impostazioni → Accessibilità.</li>
      <li>Disattiva lo spegnimento automatico dello schermo. Il display si aggiorna da solo in tempo reale.</li>
      <li>Se un tablet viene smarrito o rubato, premi <b>Rigenera link</b>: il vecchio indirizzo smetterà di funzionare.</li></ol></div>`;
  $$('[data-copy]').forEach((b) => (b.onclick = async () => { try { await navigator.clipboard.writeText(b.dataset.copy); toast('Link copiato'); } catch { b.previousElementSibling.select(); document.execCommand('copy'); toast('Link copiato'); } }));
  $$('[data-edit]').forEach((b) => (b.onclick = () => roomModal(rooms.find((r) => r.id === +b.dataset.edit))));
  $$('[data-token]').forEach((b) => (b.onclick = async () => { if (!await confirmBox('Rigenerare il link?', 'Il tablet attuale di questa sala smetterà di funzionare finché non imposti il nuovo link.', { okText: 'Rigenera' })) return; await api(`/api/admin/rooms/${b.dataset.token}/token`, { method: 'POST', body: {} }); toast('Nuovo link generato'); sale(); }));
  $('#lobby-regen').onclick = async () => { if (!await confirmBox('Rigenerare il link dell\'atrio?', 'Lo schermo attuale smetterà di funzionare finché non imposti il nuovo link.', { okText: 'Rigenera' })) return; await api('/api/admin/lobby-token', { method: 'POST', body: {} }); toast('Nuovo link generato'); sale(); };
  $('#add').onclick = () => roomModal({ active: 1, capacity: 8, color: '#0891b2', sort_order: rooms.length });
}
function roomModal(r) {
  const m = openModal(`
    <div class="modal-head"><h3>${r.id ? 'Modifica sala' : 'Nuova sala'}</h3><button class="icon-btn" data-close>✕</button></div>
    <form class="modal-body" id="f">
      <div class="row"><label class="field"><span>Nome</span><input name="name" required value="${esc(r.name)}"></label><label class="field"><span>Capienza (persone)</span><input type="number" min="1" name="capacity" required value="${r.capacity}"></label></div>
      <label class="field"><span>Ubicazione</span><input name="location" value="${esc(r.location)}" placeholder="Es. Primo piano, lato ascensori"></label>
      <label class="field"><span>Dotazioni</span><input name="equipment" value="${esc(r.equipment)}" placeholder="Es. Schermo 65&quot;, videoconferenza, lavagna"></label>
      <div class="row"><label class="field"><span>Colore</span><input type="color" name="color" value="${r.color}"></label><label class="field"><span>Ordine di visualizzazione</span><input type="number" name="sort_order" value="${r.sort_order}"></label></div>
      <label class="check"><input type="checkbox" name="active" ${r.active ? 'checked' : ''}><span><b>Sala prenotabile</b><small>Togli la spunta per lavori o manutenzione prolungata.</small></span></label>
      <div class="form-error" id="err"></div>
    </form>
    <div class="modal-foot"><button class="btn btn-ghost" data-close>Annulla</button><button class="btn btn-primary" form="f">Salva</button></div>`);
  $('#f', m.el).onsubmit = async (e) => {
    e.preventDefault(); const d = Object.fromEntries(new FormData(e.target)); d.active = !!d.active;
    try { await api(r.id ? `/api/admin/rooms/${r.id}` : '/api/admin/rooms', { method: r.id ? 'PUT' : 'POST', body: d }); CFG = await api('/api/config'); m.close(); toast('Sala salvata'); sale(); }
    catch (err) { $('#err', m.el).textContent = err.message; }
  };
}

/* ------------------------------------------------------------ chiusure */
async function chiusure() {
  const rows = await api('/api/admin/closures');
  const today = new Date().toISOString().slice(0, 10);
  const future = rows.filter((r) => r.date >= today); const past = rows.filter((r) => r.date < today).reverse().slice(0, 20);
  C().innerHTML = head('Chiusure e festività', 'Nei giorni di chiusura le sale non sono prenotabili. Le festività nazionali sono già inserite.') + `
    <div class="settings-grid">
      <div class="card"><div class="card-head"><h3>Aggiungi chiusura</h3></div><form class="card-pad" id="f">
        <div class="row"><label class="field"><span>Dal</span><input type="date" name="date" required></label><label class="field"><span>Al (facoltativo)</span><input type="date" name="to"></label></div>
        <label class="field"><span>Motivo</span><input name="reason" placeholder="Es. Patrono, chiusura estiva, manutenzione impianti"></label>
        <label class="check"><input type="checkbox" name="cancel_bookings"><span><b>Annulla le prenotazioni già presenti</b><small>Altrimenti restano valide e vanno gestite manualmente.</small></span></label>
        <button class="btn btn-primary">Aggiungi</button></form></div>
      <div class="card"><div class="card-head"><h3>Prossime chiusure</h3></div><div class="tbl-wrap" style="max-height:480px"><table class="tbl"><tbody>
        ${future.map((r) => `<tr><td style="white-space:nowrap"><b>${fmtDateLong(r.date)}</b></td><td>${esc(r.reason)}</td><td class="actions"><button class="btn btn-ghost btn-sm" data-del="${r.date}">Rimuovi</button></td></tr>`).join('') || '<tr><td class="empty">Nessuna chiusura programmata</td></tr>'}
      </tbody></table></div></div>
    </div>
    ${past.length ? `<p class="muted small" style="margin-top:16px">Ultime chiusure passate: ${past.map((r) => fmtDateShort(r.date)).join(', ')}</p>` : ''}`;
  $('#f').onsubmit = async (e) => {
    e.preventDefault(); const d = Object.fromEntries(new FormData(e.target)); d.cancel_bookings = !!d.cancel_bookings; if (!d.to) delete d.to;
    try { const r = await api('/api/admin/closures', { method: 'POST', body: d }); toast(r.bookings_on_dates ? (r.cancelled ? `Chiusura aggiunta, ${r.bookings_on_dates} prenotazioni annullate` : `Chiusura aggiunta. Attenzione: ci sono ${r.bookings_on_dates} prenotazioni in quelle date`) : 'Chiusura aggiunta', r.bookings_on_dates && !r.cancelled ? 'warn' : 'ok'); chiusure(); }
    catch (err) { toast(err.message, 'err'); }
  };
  $$('[data-del]').forEach((b) => (b.onclick = async () => { await api(`/api/admin/closures/${b.dataset.del}`, { method: 'DELETE' }); toast('Chiusura rimossa'); chiusure(); }));
}

/* ------------------------------------------------------------ impostazioni */
async function impostazioni() {
  const s = await api('/api/admin/settings');
  const chk = (k, title, sub) => `<label class="check"><input type="checkbox" name="${k}" ${s[k] === '1' ? 'checked' : ''}><span><b>${title}</b><small>${sub}</small></span></label>`;
  C().innerHTML = head('Regole e impostazioni', 'Le regole valgono per tutti gli utenti delle aziende (gli amministratori possono superare i limiti)') + `
    <form id="f"><div class="settings-grid">
      <div class="card"><div class="card-head"><h3>Generale e orari</h3></div><div class="card-pad">
        <label class="field"><span>Nome dello stabile</span><input name="building_name" value="${esc(s.building_name)}"></label>
        <div class="row"><label class="field"><span>Apertura sale</span><input type="time" name="open_time" value="${s.open_time}" step="900"></label><label class="field"><span>Chiusura sale</span><input type="time" name="close_time" value="${s.close_time}" step="900"></label></div>
        <label class="field"><span>Durata minima di uno slot</span><select name="slot_minutes">${['15', '30', '60'].map((v) => `<option value="${v}" ${s.slot_minutes === v ? 'selected' : ''}>${v} minuti</option>`).join('')}</select></label>
        <p class="muted small">Le prenotazioni sono sempre dal lunedì al venerdì. Per i giorni di chiusura usa la sezione Chiusure.</p>
      </div></div>
      <div class="card"><div class="card-head"><h3>Limiti per un uso equo tra le aziende</h3></div><div class="card-pad">
        <div class="row"><label class="field"><span>Durata massima (ore)</span><input type="number" step="0.5" min="0.5" name="max_hours_per_booking" value="${s.max_hours_per_booking}"></label>
        <label class="field"><span>Anticipo massimo (giorni)</span><input type="number" min="1" name="max_advance_days" value="${s.max_advance_days}"></label></div>
        <div class="row"><label class="field"><span>Prenotazioni attive per azienda</span><input type="number" min="0" name="max_active_per_company" value="${s.max_active_per_company}"><small>0 = nessun limite</small></label>
        <label class="field"><span>Ripetizioni settimanali max</span><input type="number" min="0" max="52" name="max_repeat_weeks" value="${s.max_repeat_weeks}"></label></div>
        <p class="muted small">Il monte ore mensile si imposta per singola azienda nella sezione Aziende.</p>
      </div></div>
      <div class="card"><div class="card-head"><h3>Check-in al display</h3></div><div class="card-pad">
        ${chk('checkin_required', 'Richiedi conferma di presenza', 'Chi ha prenotato deve toccare “Conferma presenza” sul tablet della sala. Se nessuno lo fa, la sala torna libera automaticamente (riduce le prenotazioni “fantasma”).')}
        <label class="field"><span>Tempo massimo per il check-in (minuti dall'inizio)</span><input type="number" min="5" max="60" name="checkin_grace_minutes" value="${s.checkin_grace_minutes}"></label>
      </div></div>
      <div class="card"><div class="card-head"><h3>Privacy</h3></div><div class="card-pad">
        ${chk('show_titles_to_others', 'Mostra il titolo delle riunioni alle altre aziende', 'Se disattivato, le altre aziende vedono solo “Riservata” e il nome dell\'azienda.')}
        ${chk('display_show_title', 'Mostra il titolo sui display', 'Il titolo della riunione compare sul tablet fuori dalla sala.')}
        ${chk('display_show_company', 'Mostra il nome dell\'azienda sui display', 'Utile per chi cerca la propria riunione nei corridoi.')}
      </div></div>
    </div>
    <div style="margin-top:20px;display:flex;justify-content:flex-end"><button class="btn btn-primary">Salva impostazioni</button></div></form>`;
  $('#f').onsubmit = async (e) => {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(e.target));
    for (const k of ['checkin_required', 'show_titles_to_others', 'display_show_title', 'display_show_company']) d[k] = d[k] ? '1' : '0';
    try { await api('/api/admin/settings', { method: 'PUT', body: d }); CFG = await api('/api/config'); toast('Impostazioni salvate'); }
    catch (err) { toast(err.message, 'err'); }
  };
}

/* ------------------------------------------------------------ registro */
async function registro() {
  const rows = await api('/api/admin/audit');
  const L = { prenotazione_creata: 'Prenotazione creata', prenotazione_modificata: 'Prenotazione modificata', prenotazione_cancellata: 'Prenotazione annullata', auto_rilascio: 'Sala liberata (no check-in)', checkin_display: 'Check-in dal display', termina_display: 'Riunione terminata dal display', cambio_password: 'Cambio password', import_csv: 'Importazione CSV' };
  C().innerHTML = head('Registro attività', 'Ultime 300 operazioni, utile per chiarire contestazioni tra aziende') + `
    <div class="card"><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Quando (UTC)</th><th>Chi</th><th>Operazione</th><th>Dettagli</th></tr></thead><tbody>
    ${rows.map((r) => `<tr><td class="small" style="white-space:nowrap">${esc(r.at)}</td><td>${esc(r.user_name || (r.action.includes('display') || r.action === 'auto_rilascio' ? 'Sistema / display' : '—'))}</td><td>${esc(L[r.action] || r.action.replace(/_/g, ' '))}</td><td class="small muted" style="max-width:520px;word-break:break-word">${esc(r.detail).slice(0, 220)}</td></tr>`).join('')}
    </tbody></table></div></div>`;
}

init();
