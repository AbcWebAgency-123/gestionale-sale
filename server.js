'use strict';
/*
 * Gestionale Sale Riunioni — server
 * Nessuna dipendenza esterna: richiede Node.js >= 22.13 (usa node:sqlite).
 */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { createMailer } = require('./lib/mailer');
const { T, dateLong } = require('./lib/templates');

const PORT = parseInt(process.env.PORT || '3000', 10);
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const TZ = process.env.TIMEZONE || 'Europe/Rome';
const PUBLIC_DIR = path.join(__dirname, 'public');
const SESSION_DAYS = 30;
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');

fs.mkdirSync(UPLOAD_DIR, { recursive: true });
const db = new DatabaseSync(path.join(DATA_DIR, 'sale.db'));
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

// ---------------------------------------------------------------- schema
db.exec(`
CREATE TABLE IF NOT EXISTS companies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  location TEXT DEFAULT '',
  contact_name TEXT DEFAULT '',
  contact_email TEXT DEFAULT '',
  contact_phone TEXT DEFAULT '',
  monthly_quota_hours REAL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER REFERENCES companies(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'utente' CHECK (role IN ('admin','referente','utente')),
  must_change_password INTEGER NOT NULL DEFAULT 1,
  active INTEGER NOT NULL DEFAULT 1,
  last_login TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS rooms (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  capacity INTEGER NOT NULL DEFAULT 8,
  location TEXT DEFAULT '',
  equipment TEXT DEFAULT '',
  color TEXT DEFAULT '#2563eb',
  display_token TEXT NOT NULL UNIQUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS bookings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  room_id INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  company_id INTEGER REFERENCES companies(id) ON DELETE SET NULL,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  date TEXT NOT NULL,
  start TEXT NOT NULL,
  end TEXT NOT NULL,
  title TEXT NOT NULL,
  attendees INTEGER,
  notes TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'confermata' CHECK (status IN ('confermata','cancellata','liberata')),
  series_id TEXT,
  checked_in_at TEXT,
  ended_early_at TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_bookings_room_date ON bookings(room_id, date);
CREATE INDEX IF NOT EXISTS idx_bookings_company_date ON bookings(company_id, date);
CREATE TABLE IF NOT EXISTS closures (
  date TEXT PRIMARY KEY,
  reason TEXT DEFAULT ''
);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT DEFAULT CURRENT_TIMESTAMP,
  user_id INTEGER,
  action TEXT,
  detail TEXT
);
CREATE TABLE IF NOT EXISTS penalties (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_id INTEGER REFERENCES bookings(id) ON DELETE SET NULL,
  company_id INTEGER REFERENCES companies(id) ON DELETE SET NULL,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  reason TEXT NOT NULL,
  amount REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'da_addebitare' CHECK (status IN ('da_addebitare','addebitata','annullata')),
  note TEXT DEFAULT '',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT
);
`);
// colonne aggiunte nelle versioni successive (le installazioni esistenti vengono aggiornate)
function addColumn(table, col, def) {
  if (!db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
}
addColumn('users', 'first_name', "TEXT DEFAULT ''");
addColumn('users', 'last_name', "TEXT DEFAULT ''");
addColumn('users', 'email_verified', 'INTEGER NOT NULL DEFAULT 1');
addColumn('users', 'verify_token', 'TEXT');
addColumn('users', 'verify_expires', 'INTEGER');
addColumn('users', 'reset_token', 'TEXT');
addColumn('users', 'reset_expires', 'INTEGER');
addColumn('users', 'self_registered', 'INTEGER NOT NULL DEFAULT 0');
addColumn('users', 'gender', 'TEXT');
addColumn('users', 'approval', "TEXT NOT NULL DEFAULT 'approvato'");
addColumn('users', 'gym_waiver_status', "TEXT NOT NULL DEFAULT 'nessuno'");
addColumn('users', 'gym_waiver_file', 'TEXT');
addColumn('users', 'gym_waiver_at', 'TEXT');
addColumn('users', 'gym_waiver_note', "TEXT DEFAULT ''");
addColumn('rooms', 'kind', "TEXT NOT NULL DEFAULT 'sala'");
addColumn('bookings', 'gender', 'TEXT');
addColumn('bookings', 'reminder_sent_at', 'TEXT');
addColumn('bookings', 'cancelled_at', 'TEXT');
db.exec('CREATE INDEX IF NOT EXISTS idx_users_verify ON users(verify_token); CREATE INDEX IF NOT EXISTS idx_users_reset ON users(reset_token);');

const DEFAULT_SETTINGS = {
  building_name: 'CARDO Centro Uffici',
  open_time: '08:00',
  close_time: '18:00',
  slot_minutes: '30',
  max_hours_per_booking: '4',
  max_advance_days: '60',
  max_active_per_company: '0',       // 0 = illimitate
  max_repeat_weeks: '12',
  checkin_required: '1',             // 1 = la prenotazione va confermata al display (serve per le penali)
  checkin_grace_minutes: '15',
  show_titles_to_others: '1',        // gli altri vedono il titolo della riunione
  display_show_title: '1',           // il display mostra il titolo
  display_show_company: '1',         // il display mostra l'azienda
  default_monthly_quota_hours: '10', // ore di sala al mese per azienda (vuoto = illimitate)
  registration_enabled: '1',         // le aziende possono registrarsi da sole
  admin_notify_email: '',            // avviso all'amministrazione per ogni nuova iscrizione
  reminders_enabled: '1',            // promemoria 24 ore prima
  penalties_enabled: '1',
  penalty_amount: '25',              // euro
  cancel_notice_hours: '24',         // preavviso minimo per annullare senza penale
  gym_rule: 'uno_per_sesso',         // uno_per_sesso | stesso_sesso | misto
  gym_waiver_email: 'info@ufficicardo.com',
  registration_approval: '1',        // ogni iscrizione va approvata dall'amministrazione
  gym_saturday: '1',                 // la palestra è prenotabile anche il sabato
  gym_weekly_hours: '3',             // ore di palestra a settimana per persona (vuoto/0 = illimitate)
  checkin_enabled_at: '',
  lobby_token: crypto.randomBytes(16).toString('hex'),
};
for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) {
  db.prepare('INSERT OR IGNORE INTO settings(key,value) VALUES (?,?)').run(k, v);
}
function getSettings() {
  const s = {};
  for (const r of db.prepare('SELECT key,value FROM settings').all()) s[r.key] = r.value;
  return s;
}
function S() {
  const s = getSettings();
  return {
    ...s,
    slot: parseInt(s.slot_minutes, 10) || 30,
    maxHours: parseFloat(s.max_hours_per_booking) || 0,
    maxAdvance: parseInt(s.max_advance_days, 10) || 0,
    maxActive: parseInt(s.max_active_per_company, 10) || 0,
    maxRepeat: parseInt(s.max_repeat_weeks, 10) || 0,
    checkin: s.checkin_required === '1',
    grace: parseInt(s.checkin_grace_minutes, 10) || 15,
    gymSaturday: s.gym_saturday === '1',
    gymWeekly: parseFloat(String(s.gym_weekly_hours || '').replace(',', '.')) || 0,
  };
}

// ---------------------------------------------------------------- utilità
const hashPassword = (pw) => {
  const salt = crypto.randomBytes(16);
  const h = crypto.scryptSync(pw, salt, 64);
  return `scrypt$${salt.toString('hex')}$${h.toString('hex')}`;
};
const verifyPassword = (pw, stored) => {
  try {
    const [, salt, h] = stored.split('$');
    const calc = crypto.scryptSync(pw, Buffer.from(salt, 'hex'), 64);
    return crypto.timingSafeEqual(calc, Buffer.from(h, 'hex'));
  } catch { return false; }
};
const randomPassword = () => {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  let p = '';
  for (const b of crypto.randomBytes(10)) p += chars[b % chars.length];
  return p;
};
const toMin = (hhmm) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };
const toHHMM = (min) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s + 'T00:00:00Z'));
const isTime = (s) => typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
const weekday = (d) => new Date(d + 'T00:00:00Z').getUTCDay(); // 0 dom … 6 sab
const addDays = (d, n) => { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const daysBetween = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);

const fmtNow = new Intl.DateTimeFormat('en-CA', {
  timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
});
function now() {
  const p = Object.fromEntries(fmtNow.formatToParts(new Date()).map((x) => [x.type, x.value]));
  const date = `${p.year}-${p.month}-${p.day}`;
  const time = `${p.hour}:${p.minute}`;
  return { date, time, min: toMin(time), sec: parseInt(p.second, 10) };
}
function audit(userId, action, detail) {
  db.prepare('INSERT INTO audit(user_id,action,detail) VALUES (?,?,?)').run(userId ?? null, action, typeof detail === 'string' ? detail : JSON.stringify(detail));
}

// ---------------------------------------------------------------- seed iniziale
function seed() {
  const roomCount = db.prepare('SELECT COUNT(*) c FROM rooms').get().c;
  if (roomCount === 0) {
    const rooms = [
      ['B2B', 6, '', '', '#b9771f'],
      ['Sala White', 14, '', '', '#0a615f'],
      ['Sala Cardo', 30, '', 'Oltre 30 posti · prenotazione alla reception', '#a7406b', 'reception'],
      ['Palestra', 2, '', 'Tapis roulant, pesi, panca', '#5b8a72', 'palestra'],
    ];
    const ins = db.prepare('INSERT INTO rooms(name,capacity,location,equipment,color,kind,display_token,sort_order) VALUES (?,?,?,?,?,?,?,?)');
    rooms.forEach((r, i) => ins.run(r[0], r[1], r[2], r[3], r[4], r[5] || 'sala', crypto.randomBytes(16).toString('hex'), i));
  }
  const adminCount = db.prepare("SELECT COUNT(*) c FROM users WHERE role='admin'").get().c;
  if (adminCount === 0) {
    const email = process.env.ADMIN_EMAIL || 'admin@sale.local';
    const pw = process.env.ADMIN_PASSWORD || randomPassword();
    db.prepare("INSERT INTO users(name,email,password_hash,role,must_change_password) VALUES (?,?,?,?,?)")
      .run('Amministratore', email, hashPassword(pw), 'admin', process.env.ADMIN_PASSWORD ? 0 : 1);
    console.log('\n==================================================');
    console.log(' Utente amministratore creato');
    console.log(`   email:    ${email}`);
    console.log(process.env.ADMIN_PASSWORD ? '   password: quella impostata in ADMIN_PASSWORD' : `   password: ${pw}`);
    console.log('   (cambiala dal menu utente dopo il primo accesso)');
    console.log('==================================================\n');
  }
  // Festività nazionali italiane (anno corrente e successivo)
  const y = parseInt(now().date.slice(0, 4), 10);
  for (const year of [y, y + 1]) {
    for (const [d, r] of italianHolidays(year)) {
      db.prepare('INSERT OR IGNORE INTO closures(date,reason) VALUES (?,?)').run(d, r);
    }
  }
  if (process.env.SEED_DEMO === '1' && db.prepare('SELECT COUNT(*) c FROM companies').get().c === 0) seedDemo();
}
function easter(y) { // algoritmo di Gauss/Meeus
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return `${y}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}
function italianHolidays(y) {
  return [
    [`${y}-01-01`, 'Capodanno'], [`${y}-01-06`, 'Epifania'], [addDays(easter(y), 1), "Lunedì dell'Angelo"],
    [`${y}-04-25`, 'Festa della Liberazione'], [`${y}-05-01`, 'Festa del Lavoro'], [`${y}-06-02`, 'Festa della Repubblica'],
    [`${y}-08-15`, 'Ferragosto'], [`${y}-11-01`, 'Ognissanti'], [`${y}-12-08`, 'Immacolata Concezione'],
    [`${y}-12-25`, 'Natale'], [`${y}-12-26`, 'Santo Stefano'],
  ];
}
function seedDemo() {
  const names = ['Alfa Consulting', 'Beta Software', 'Gamma Legal', 'Delta Design', 'Epsilon Finance', 'Zeta Marketing', 'Eta Engineering', 'Theta Studio', 'Iota Logistics', 'Kappa Energy'];
  const insC = db.prepare('INSERT INTO companies(name,location,contact_name,contact_email) VALUES (?,?,?,?)');
  const insU = db.prepare('INSERT INTO users(company_id,name,email,password_hash,role,must_change_password) VALUES (?,?,?,?,?,0)');
  const pw = hashPassword('demo1234');
  for (let i = 1; i <= 60; i++) {
    const n = i <= names.length ? names[i - 1] : `Azienda ${String(i).padStart(2, '0')} Srl`;
    const slug = n.toLowerCase().replace(/[^a-z0-9]+/g, '');
    const c = insC.run(n, `Piano ${1 + (i % 5)}, interno ${i}`, `Referente ${n}`, `info@${slug}.it`);
    insU.run(c.lastInsertRowid, `Referente ${n}`, `referente@${slug}.it`, pw, 'referente');
    insU.run(c.lastInsertRowid, `Utente ${n}`, `utente@${slug}.it`, pw, 'utente');
  }
  // qualche prenotazione di esempio nei prossimi giorni lavorativi
  const rooms = db.prepare("SELECT id FROM rooms WHERE kind<>'palestra'").all();
  const ins = db.prepare('INSERT INTO bookings(room_id,company_id,user_id,date,start,end,title,attendees) VALUES (?,?,?,?,?,?,?,?)');
  const titles = ['Riunione di team', 'Call cliente', 'Colloquio', 'Formazione', 'Board mensile', 'Demo prodotto', 'Revisione progetto'];
  let d = now().date;
  let made = 0;
  for (let k = 0; k < 10 && made < 6; k++, d = addDays(d, 1)) {
    if ([0, 6].includes(weekday(d)) || db.prepare('SELECT 1 FROM closures WHERE date=?').get(d)) continue;
    made++;
    rooms.forEach((r, ri) => {
      let t = 8 * 60 + ((ri * 60 + k * 30) % 120);
      while (t < 17 * 60) {
        const len = [60, 90, 30, 120][(t + ri + k) % 4];
        const end = Math.min(t + len, 18 * 60);
        const cid = 1 + ((t + ri * 7 + k * 13) % 60);
        const u = db.prepare("SELECT id FROM users WHERE company_id=? LIMIT 1").get(cid);
        ins.run(r.id, cid, u.id, d, toHHMM(t), toHHMM(end), titles[(t + ri) % titles.length], 2 + ((t / 30) % 5));
        t = end + [30, 60, 90][(t + k) % 3];
      }
    });
  }
  console.log('Dati demo creati: 60 aziende, utenti referente@<azienda>.it / utente@<azienda>.it, password demo1234');
}
seed();

// Aggiornamento al tema CARDO per installazioni create con i valori iniziali precedenti
(function migrateBrand() {
  db.prepare("UPDATE settings SET value='CARDO Centro Uffici' WHERE key='building_name' AND value='Centro Direzionale'").run();
  const map = { '#2563eb': '#0a615f', '#059669': '#a7406b', '#d97706': '#b9771f', '#7c3aed': '#5b8a72', '#dc2626': '#4a5a86' };
  for (const [a, b] of Object.entries(map)) db.prepare('UPDATE rooms SET color=? WHERE lower(color)=?').run(b, a);
})();
// v2: il check-in al tablet diventa obbligatorio (serve a rilevare il mancato utilizzo per le penali)
(function migrateV2() {
  if (getSettings().mig_v2 !== '1') {
    db.prepare("UPDATE settings SET value='1' WHERE key='checkin_required'").run();
    db.prepare("INSERT OR REPLACE INTO settings(key,value) VALUES ('mig_v2','1')").run();
  }
  if (!getSettings().checkin_enabled_at) db.prepare("UPDATE settings SET value=CURRENT_TIMESTAMP WHERE key='checkin_enabled_at'").run();
  if (getSettings().mig_gym !== '1') {
    if (!db.prepare("SELECT 1 FROM rooms WHERE kind='palestra'").get()) {
      const v = db.prepare("SELECT id FROM rooms WHERE name='Sala Vivaldi'").get();
      if (v) {
        db.prepare(`UPDATE bookings SET status='cancellata' WHERE room_id=? AND status='confermata' AND date>=?`).run(v.id, now().date);
        db.prepare("UPDATE rooms SET name='Palestra', kind='palestra', capacity=2, equipment='Tapis roulant, pesi, panca' WHERE id=?").run(v.id);
      }
    }
    db.prepare("INSERT OR REPLACE INTO settings(key,value) VALUES ('mig_gym','1')").run();
  }
  // v3: sale definitive dello stabile (B2B, Sala White, Sala Cardo alla reception) + Palestra
  if (getSettings().mig_rooms_v3 !== '1') {
    const want = [
      ['B2B', 6, 'sala', '#b9771f', ''],
      ['Sala White', 14, 'sala', '#0a615f', ''],
      ['Sala Cardo', 30, 'reception', '#a7406b', 'Oltre 30 posti · prenotazione alla reception'],
    ];
    const existing = db.prepare("SELECT * FROM rooms WHERE kind<>'palestra' ORDER BY active DESC, sort_order, id").all();
    const used = new Set();
    want.forEach(([name, cap, kind, color, equip], i) => {
      const r = existing.find((x) => x.name === name && !used.has(x.id)) || existing.find((x) => !used.has(x.id));
      if (r) {
        used.add(r.id);
        db.prepare('UPDATE rooms SET name=?,capacity=?,kind=?,color=?,equipment=?,location=?,sort_order=?,active=1 WHERE id=?').run(name, cap, kind, color, equip, '', i, r.id);
      } else {
        db.prepare('INSERT INTO rooms(name,capacity,location,equipment,color,kind,display_token,sort_order) VALUES (?,?,?,?,?,?,?,?)').run(name, cap, '', equip, color, kind, crypto.randomBytes(16).toString('hex'), i);
      }
    });
    // le sale che non esistono più vengono disattivate e le loro prenotazioni future annullate
    for (const r of existing.filter((x) => !used.has(x.id))) {
      db.prepare("UPDATE bookings SET status='cancellata', cancelled_at=CURRENT_TIMESTAMP WHERE room_id=? AND status='confermata' AND date>=?").run(r.id, now().date);
      db.prepare('UPDATE rooms SET active=0 WHERE id=?').run(r.id);
    }
    // sulle sale rinominate le prenotazioni future di prova non sono più valide
    for (const id of used) db.prepare("UPDATE bookings SET status='cancellata', cancelled_at=CURRENT_TIMESTAMP WHERE room_id=? AND status='confermata' AND date>=?").run(id, now().date);
    db.prepare("UPDATE rooms SET sort_order=3, location='' WHERE kind='palestra'").run();
    db.prepare("INSERT OR REPLACE INTO settings(key,value) VALUES ('mig_rooms_v3','1')").run();
  }
})();

// ---------------------------------------------------------------- email
const mailer = createMailer(db);
let baseUrl = (process.env.PUBLIC_URL || '').replace(/\/$/, '');
const BASE = () => baseUrl || getSettings().public_url || '';
function rememberBase(req) {
  if (process.env.PUBLIC_URL) return;
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  if (!host) return;
  const proto = String(req.headers['x-forwarded-proto'] || 'http').split(',')[0].trim();
  const b = `${proto}://${host}`;
  if (b !== baseUrl) { baseUrl = b; db.prepare("INSERT OR REPLACE INTO settings(key,value) VALUES ('public_url',?)").run(b); }
}
function sendMail(to, tpl, data, extra = {}) {
  if (!to) return null;
  const s = getSettings();
  const m = T[tpl]({ base: BASE(), building: s.building_name, ...data });
  return mailer.queue({ to, subject: m.subject, html: m.html, text: m.text, kind: tpl, ...extra });
}
const minutesUntil = (date, time) => { const n = now(); return daysBetween(n.date, date) * 1440 + toMin(time) - n.min; };
function penaltyCfg() {
  const s = getSettings();
  return { on: s.penalties_enabled === '1', amount: parseFloat(String(s.penalty_amount).replace(',', '.')) || 0, notice: parseFloat(s.cancel_notice_hours) || 0 };
}
function addPenalty(b, reason) {
  const p = penaltyCfg();
  if (!p.on || !b.company_id) return null;
  if (db.prepare('SELECT 1 FROM penalties WHERE booking_id=?').get(b.id)) return null;
  const r = db.prepare('INSERT INTO penalties(booking_id,company_id,user_id,reason,amount) VALUES (?,?,?,?,?)').run(b.id, b.company_id, b.user_id, reason, p.amount);
  const u = b.user_id ? db.prepare('SELECT name,email FROM users WHERE id=?').get(b.user_id) : null;
  const c = db.prepare('SELECT name FROM companies WHERE id=?').get(b.company_id);
  const room = db.prepare('SELECT name FROM rooms WHERE id=?').get(b.room_id);
  if (u) sendMail(u.email, 'penalty', { name: u.name, company: c ? c.name : '', room: room ? room.name : '', date: b.date, start: b.start, end: b.end, reason, amount: p.amount });
  audit(null, 'penale', { booking: b.id, reason, amount: p.amount });
  return Number(r.lastInsertRowid);
}
function buildIcs(events) {
  const s = getSettings();
  const dt = (d, t) => d.replace(/-/g, '') + 'T' + t.replace(':', '') + '00';
  const esc = (x) => String(x || '').replace(/[\\;,]/g, (m) => '\\' + m).replace(/\n/g, '\\n');
  const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z';
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Gestionale Sale//IT', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH'];
  for (const e of events) {
    lines.push('BEGIN:VEVENT', `UID:sala-${e.id}@gestionale-sale`, `DTSTAMP:${stamp}`, `DTSTART;TZID=${TZ}:${dt(e.date, e.start)}`, `DTEND;TZID=${TZ}:${dt(e.date, e.end)}`,
      `SUMMARY:${esc(e.title)}`, `LOCATION:${esc(e.room_name + ' — ' + s.building_name)}`, `DESCRIPTION:${esc(e.description || '')}`, 'END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}

// ---------------------------------------------------------------- regole prenotazione
// Libera automaticamente le prenotazioni senza check-in (se il check-in è obbligatorio)
function autoRelease() {
  const s = S();
  if (!s.checkin) return 0;
  const n = now();
  // solo prenotazioni create dopo l'attivazione del check-in, e da almeno "grace" minuti (chi prenota l'ora in corso ha il suo margine)
  const rows = db.prepare(`SELECT * FROM bookings WHERE status='confermata' AND checked_in_at IS NULL AND date=? AND created_at >= ?
    AND (strftime('%s','now') - strftime('%s', created_at)) >= ? * 60`).all(n.date, s.checkin_enabled_at || '', s.grace);
  let changed = 0;
  for (const b of rows) {
    const limit = toMin(b.start) + s.grace;
    if (n.min >= limit && n.min < toMin(b.end)) {
      db.prepare(`UPDATE bookings SET status='liberata', updated_at=CURRENT_TIMESTAMP WHERE id=?`).run(b.id);
      audit(null, 'auto_rilascio', { booking: b.id });
      addPenalty(b, 'mancato_utilizzo');
      changed++;
    }
  }
  if (changed) broadcast();
  return changed;
}
setInterval(autoRelease, 30 * 1000);

// Giorni di apertura: sale dal lunedì al venerdì; la palestra anche il sabato (se attivo)
function dayOpenFor(room, date, s = S()) {
  const wd = weekday(date);
  if (wd === 0) return false;
  if (wd === 6) return !!(room && room.kind === 'palestra' && s.gymSaturday);
  return true;
}
function bookingWindowIssues({ date, start, end }, s, { isAdmin = false, ignorePast = false, room = null } = {}) {
  if (!isDate(date)) return 'Data non valida';
  if (!isTime(start) || !isTime(end)) return 'Orario non valido';
  if (!dayOpenFor(room, date, s)) {
    if (room && room.kind === 'palestra') return s.gymSaturday ? 'La palestra è prenotabile dal lunedì al sabato' : 'La palestra è prenotabile dal lunedì al venerdì';
    return weekday(date) === 6 && s.gymSaturday ? 'Il sabato è prenotabile solo la palestra: le sale riunioni sono disponibili dal lunedì al venerdì' : 'Le sale sono prenotabili solo dal lunedì al venerdì';
  }
  const closure = db.prepare('SELECT reason FROM closures WHERE date=?').get(date);
  if (closure) return `Lo stabile è chiuso in questa data${closure.reason ? ' (' + closure.reason + ')' : ''}`;
  const a = toMin(start), b = toMin(end), open = toMin(s.open_time), close = toMin(s.close_time);
  if (b <= a) return "L'orario di fine deve essere successivo all'inizio";
  if (a < open || b > close) return `Le sale sono prenotabili dalle ${s.open_time} alle ${s.close_time}`;
  if ((a - open) % s.slot || (b - open) % s.slot) return `Gli orari devono essere a intervalli di ${s.slot} minuti`;
  if (!isAdmin && s.maxHours && (b - a) > s.maxHours * 60) return `Durata massima per prenotazione: ${s.maxHours} ore`;
  const n = now();
  if (!ignorePast) {
    if (date < n.date || (date === n.date && b <= n.min)) return 'Non è possibile prenotare nel passato';
    // si può prenotare lo slot in corso, ma non uno già finito
    if (date === n.date && a < n.min - s.slot) return "L'orario di inizio è già passato";
  }
  if (!isAdmin && s.maxAdvance && daysBetween(n.date, date) > s.maxAdvance) return `Si può prenotare al massimo ${s.maxAdvance} giorni in anticipo`;
  return null;
}
function conflict(roomId, date, start, end, excludeId = 0) {
  return db.prepare(`SELECT b.id,b.start,b.end,c.name company FROM bookings b LEFT JOIN companies c ON c.id=b.company_id
    WHERE b.room_id=? AND b.date=? AND b.status='confermata' AND b.id<>? AND b.start < ? AND b.end > ?`).get(roomId, date, excludeId, end, start);
}
// Ore di sala usate nel mese (la palestra non scala dal monte ore)
function companyHoursInMonth(companyId, month, excludeId = 0) {
  const rows = db.prepare(`SELECT b.start,b.end FROM bookings b JOIN rooms r ON r.id=b.room_id
    WHERE b.company_id=? AND b.status='confermata' AND r.kind='sala' AND substr(b.date,1,7)=? AND b.id<>?`).all(companyId, month, excludeId);
  return rows.reduce((t, r) => t + (toMin(r.end) - toMin(r.start)) / 60, 0);
}
function effectiveQuota(companyId) {
  const c = db.prepare('SELECT monthly_quota_hours q FROM companies WHERE id=?').get(companyId);
  if (c && c.q != null) return c.q;
  const d = String(getSettings().default_monthly_quota_hours ?? '').replace(',', '.').trim();
  return d === '' ? null : parseFloat(d);
}
const fmtH = (h) => (Math.round(h * 10) / 10).toString().replace('.', ',');
const MESI_IT = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];
function quotaIssue(companyId, date, start, end, excludeId = 0) {
  if (!companyId) return null;
  const q = effectiveQuota(companyId);
  if (q == null || isNaN(q)) return null;
  const used = companyHoursInMonth(companyId, date.slice(0, 7), excludeId);
  const add = (toMin(end) - toMin(start)) / 60;
  const mese = MESI_IT[parseInt(date.slice(5, 7), 10) - 1];
  if (used >= q - 1e-9) return `La tua azienda ha esaurito le ${fmtH(q)} ore di sala di ${mese}. Il monte ore si rinnova il primo giorno del mese.`;
  if (used + add > q + 1e-9) return `Restano ${fmtH(q - used)} ore di sala per ${mese}: riduci la durata della prenotazione (monte ore ${fmtH(q)} h al mese).`;
  return null;
}
function quotaInfo(companyId) {
  if (!companyId) return null;
  const month = now().date.slice(0, 7);
  const limit = effectiveQuota(companyId);
  const used = +companyHoursInMonth(companyId, month).toFixed(2);
  return { month, used, limit: limit == null || isNaN(limit) ? null : limit, remaining: limit == null || isNaN(limit) ? null : Math.max(0, +(limit - used).toFixed(2)) };
}
function gymIssue(room, date, start, end, gender, userId, excludeId = 0) {
  const a = toMin(start); const b = toMin(end);
  if (b - a !== 60 || a % 60) return "In palestra si prenota un'ora alla volta, partendo dall'ora esatta (es. 10:00–11:00)";
  const rows = db.prepare(`SELECT id,user_id,gender FROM bookings WHERE room_id=? AND date=? AND status='confermata' AND id<>? AND start < ? AND end > ?`).all(room.id, date, excludeId, end, start);
  if (rows.some((r) => r.user_id === userId)) return 'Hai già una prenotazione in palestra in questa ora';
  const rule = getSettings().gym_rule;
  const max = rule === 'uno_per_sesso' ? 2 : Math.max(1, room.capacity || 2);
  if (rows.length >= max) return `Palestra al completo in questa ora (massimo ${max} persone)`;
  if (rule === 'uno_per_sesso' && rows.some((r) => r.gender === gender)) return gender === 'F' ? "Il posto donna di quest'ora è già occupato" : "Il posto uomo di quest'ora è già occupato";
  if (rule === 'stesso_sesso' && rows.some((r) => r.gender && r.gender !== gender)) return `In quest'ora la palestra è già prenotata da ${gender === 'F' ? 'uomini' : 'donne'}`;
  return null;
}
// Limite settimanale di palestra per persona (settimana dal lunedì alla domenica)
const mondayOf = (d) => addDays(d, -((weekday(d) + 6) % 7));
function gymHoursInWeek(userId, date, excludeId = 0) {
  const mon = mondayOf(date);
  const rows = db.prepare(`SELECT b.start,b.end FROM bookings b JOIN rooms r ON r.id=b.room_id
    WHERE b.user_id=? AND r.kind='palestra' AND b.status IN ('confermata','liberata') AND b.date BETWEEN ? AND ? AND b.id<>?`).all(userId, mon, addDays(mon, 6), excludeId);
  return rows.reduce((t, r) => t + (toMin(r.end) - toMin(r.start)) / 60, 0);
}
function gymWeeklyIssue(userId, date, start, end, s) {
  if (!s.gymWeekly) return null;
  const used = gymHoursInWeek(userId, date);
  const add = (toMin(end) - toMin(start)) / 60;
  const lim = fmtH(s.gymWeekly);
  if (used >= s.gymWeekly - 1e-9) return `Hai già prenotato ${lim} ${s.gymWeekly === 1 ? 'ora' : 'ore'} di palestra nella settimana del ${mondayOf(date).slice(8)}/${mondayOf(date).slice(5, 7)}: il massimo è ${lim} ore a settimana per persona`;
  if (used + add > s.gymWeekly + 1e-9) return `Puoi prenotare la palestra al massimo ${lim} ore a settimana`;
  return null;
}
function activeIssue(companyId, s, adding = 1) {
  if (!companyId || !s.maxActive) return null;
  const n = now();
  const cnt = db.prepare(`SELECT COUNT(*) c FROM bookings b JOIN rooms r ON r.id=b.room_id WHERE b.company_id=? AND b.status='confermata' AND r.kind='sala' AND (b.date>? OR (b.date=? AND b.end>?))`).get(companyId, n.date, n.date, n.time).c;
  if (cnt + adding > s.maxActive) return `La tua azienda ha già ${cnt} prenotazioni attive (massimo ${s.maxActive})`;
  return null;
}

// ---------------------------------------------------------------- SSE (aggiornamento in tempo reale)
const clients = new Set();
function broadcast() {
  for (const res of clients) { try { res.write(`event: changed\ndata: ${Date.now()}\n\n`); } catch { /* ignore */ } }
}
setInterval(() => { for (const res of clients) { try { res.write(': ping\n\n'); } catch { /* ignore */ } } }, 25000);

// ---------------------------------------------------------------- HTTP helpers
class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
const send = (res, status, body, headers = {}) => {
  const isStr = typeof body === 'string' || Buffer.isBuffer(body);
  res.writeHead(status, { 'Content-Type': isStr ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(isStr ? body : JSON.stringify(body));
};
async function readBody(req) {
  const chunks = []; let size = 0;
  for await (const c of req) { size += c.length; if (size > 14e6) throw new HttpError(413, 'Richiesta troppo grande (massimo 10 MB)'); chunks.push(c); }
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new HttpError(400, 'JSON non valido'); }
}
const parseCookies = (req) => Object.fromEntries((req.headers.cookie || '').split(';').map((c) => c.trim().split('=').map(decodeURIComponent)).filter((x) => x[0]));
function currentUser(req) {
  const t = parseCookies(req).sid;
  if (!t) return null;
  const row = db.prepare(`SELECT u.*, c.name company_name, c.active company_active FROM sessions s JOIN users u ON u.id=s.user_id
    LEFT JOIN companies c ON c.id=u.company_id WHERE s.token=? AND s.expires_at>?`).get(t, Date.now());
  if (!row || !row.active || (row.company_id && row.company_active === 0)) return null;
  return row;
}
const publicUser = (u) => ({ id: u.id, name: u.name, first_name: u.first_name || '', last_name: u.last_name || '', email: u.email, role: u.role, company_id: u.company_id, company_name: u.company_name || null, must_change_password: !!u.must_change_password, gender: u.gender || null, gym_waiver_status: u.gym_waiver_status || 'nessuno', gym_waiver_note: u.gym_waiver_note || '' });
const need = (cond, status, msg) => { if (!cond) throw new HttpError(status, msg); };
const str = (v, max = 200) => (v == null ? '' : String(v).trim().slice(0, max));

// rate limit semplice sul login
const loginAttempts = new Map();
function checkRate(key) {
  const n = Date.now(); const a = (loginAttempts.get(key) || []).filter((t) => n - t < 15 * 60 * 1000);
  loginAttempts.set(key, a);
  if (a.length >= 10) throw new HttpError(429, 'Troppi tentativi, riprova tra qualche minuto');
  a.push(n);
}

function bookingView(b, user, s) {
  const mine = user && b.user_id === user.id;
  const sameCompany = user && b.company_id && b.company_id === user.company_id;
  const isAdmin = user && user.role === 'admin';
  const canSeeTitle = isAdmin || sameCompany || s.show_titles_to_others === '1';
  return {
    id: b.id, room_id: b.room_id, date: b.date, start: b.start, end: b.end, status: b.status,
    title: canSeeTitle ? b.title : 'Riservata',
    company_id: b.company_id, company_name: b.company_name || '—',
    user_name: (isAdmin || sameCompany) ? b.user_name : undefined,
    attendees: (isAdmin || sameCompany) ? b.attendees : undefined,
    notes: (isAdmin || sameCompany) ? b.notes : undefined,
    series_id: b.series_id, checked_in: !!b.checked_in_at, gender: b.gender || null,
    mine: !!mine, own_company: !!sameCompany,
    can_edit: !!(isAdmin || mine || (sameCompany && user.role === 'referente')),
  };
}
const BOOKING_SELECT = `SELECT b.*, c.name company_name, u.name user_name, r.name room_name FROM bookings b
  LEFT JOIN companies c ON c.id=b.company_id LEFT JOIN users u ON u.id=b.user_id JOIN rooms r ON r.id=b.room_id`;

function roomsList(all = false) {
  return db.prepare(`SELECT id,name,kind,capacity,location,equipment,color,sort_order,active${all ? ',display_token' : ''} FROM rooms ${all ? '' : 'WHERE active=1'} ORDER BY sort_order,id`).all();
}

// ---------------------------------------------------------------- display (tablet fuori dalle sale)
function displayAuth(token) {
  need(token, 401, 'Token mancante');
  const s = getSettings();
  if (token === s.lobby_token) return { lobby: true };
  const room = db.prepare('SELECT * FROM rooms WHERE display_token=? AND active=1').get(token);
  need(room, 401, 'Token display non valido');
  return { room };
}
function roomState(room, s, n) {
  const list = db.prepare(`${BOOKING_SELECT} WHERE b.room_id=? AND b.date=? AND b.status='confermata' ORDER BY b.start`).all(room.id, n.date);
  const open = n.date && dayOpenFor(room, n.date) && !db.prepare('SELECT 1 FROM closures WHERE date=?').get(n.date);
  const items = list.map((b) => ({
    id: b.id, start: b.start, end: b.end,
    title: s.display_show_title === '1' ? b.title : 'Riunione',
    company: s.display_show_company === '1' ? (b.company_name || '') : '',
    checked_in: !!b.checked_in_at,
    gender: b.gender || null,
  }));
  const currentAll = items.filter((b) => toMin(b.start) <= n.min && n.min < toMin(b.end));
  const current = currentAll[0] || null;
  const next = items.find((b) => toMin(b.start) > n.min) || null;
  let status = 'libera';
  if (!open) status = 'chiusa';
  else if (current) status = 'occupata';
  else if (next && toMin(next.start) - n.min <= 15) status = 'in_arrivo';
  else if (n.min < toMin(s.open_time) || n.min >= toMin(s.close_time)) status = 'fuori_orario';
  const freeUntil = !current ? (next ? next.start : s.close_time) : null;
  return {
    room: { id: room.id, name: room.name, kind: room.kind || 'sala', capacity: room.capacity, location: room.location, equipment: room.equipment, color: room.color },
    status, open, current, current_all: currentAll, next, free_until: freeUntil, today: items,
  };
}

// ---------------------------------------------------------------- routing
const routes = [];
const route = (method, pattern, handler, opts = {}) => {
  const keys = []; const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
  routes.push({ method, re, keys, handler, opts });
};

// --- autenticazione
route('POST', '/api/login', async (req, res, ctx) => {
  const { email, password } = ctx.body;
  checkRate(req.socket.remoteAddress + '|' + str(email).toLowerCase());
  const u = db.prepare(`SELECT u.*, c.active company_active FROM users u LEFT JOIN companies c ON c.id=u.company_id WHERE email=?`).get(str(email));
  need(!(u && !u.email_verified), 403, "Non hai ancora confermato l'iscrizione: apri il link che ti abbiamo inviato via email (controlla anche lo spam).");
  need(!(u && u.approval === 'in_attesa'), 403, "La tua iscrizione è in attesa di approvazione da parte dell'amministrazione: riceverai un'email con la password appena sarà approvata.");
  need(u && u.active && verifyPassword(String(password || ''), u.password_hash), 401, 'Email o password non corretti');
  need(!(u.company_id && u.company_active === 0), 403, "L'azienda risulta disattivata. Contatta l'amministrazione dello stabile.");
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare('INSERT INTO sessions(token,user_id,expires_at) VALUES (?,?,?)').run(token, u.id, Date.now() + SESSION_DAYS * 864e5);
  db.prepare('UPDATE users SET last_login=CURRENT_TIMESTAMP WHERE id=?').run(u.id);
  db.prepare('DELETE FROM sessions WHERE expires_at<?').run(Date.now());
  const secure = req.headers['x-forwarded-proto'] === 'https' || process.env.COOKIE_SECURE === '1' ? '; Secure' : '';
  send(res, 200, { ok: true }, { 'Set-Cookie': `sid=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_DAYS * 86400}${secure}` });
}, { public: true });
route('POST', '/api/logout', (req, res) => {
  const t = parseCookies(req).sid;
  if (t) db.prepare('DELETE FROM sessions WHERE token=?').run(t);
  send(res, 200, { ok: true }, { 'Set-Cookie': 'sid=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0' });
}, { public: true });
route('GET', '/api/me', (req, res, ctx) => send(res, 200, publicUser(ctx.user)), { allowPwChange: true });
route('POST', '/api/me/password', (req, res, ctx) => {
  const { current, next } = ctx.body;
  need(verifyPassword(String(current || ''), ctx.user.password_hash), 400, 'La password attuale non è corretta');
  need(typeof next === 'string' && next.length >= 8, 400, 'La nuova password deve avere almeno 8 caratteri');
  db.prepare('UPDATE users SET password_hash=?, must_change_password=0 WHERE id=?').run(hashPassword(next), ctx.user.id);
  audit(ctx.user.id, 'cambio_password', '');
  send(res, 200, { ok: true });
}, { allowPwChange: true });

// --- configurazione per il calendario
route('GET', '/api/config', (req, res, ctx) => {
  const s = getSettings();
  const n = now();
  send(res, 200, {
    building_name: s.building_name, open_time: s.open_time, close_time: s.close_time,
    slot_minutes: parseInt(s.slot_minutes, 10), max_hours_per_booking: parseFloat(s.max_hours_per_booking),
    max_advance_days: parseInt(s.max_advance_days, 10), max_repeat_weeks: parseInt(s.max_repeat_weeks, 10),
    checkin_required: s.checkin_required === '1', checkin_grace_minutes: parseInt(s.checkin_grace_minutes, 10),
    timezone: TZ,
    quota: quotaInfo(ctx.user.company_id),
    penalties: penaltyCfg(),
    gym_rule: s.gym_rule,
    gym_saturday: s.gym_saturday === '1',
    gym_weekly_hours: parseFloat(String(s.gym_weekly_hours || '').replace(',', '.')) || 0,
    gym_week: { this: +gymHoursInWeek(ctx.user.id, n.date).toFixed(2), monday: mondayOf(n.date) },
    rooms: roomsList(),
    closures: db.prepare('SELECT date,reason FROM closures WHERE date>=? ORDER BY date').all(addDays(n.date, -31)),
    now: n,
  });
});

// --- prenotazioni
route('GET', '/api/bookings', (req, res, ctx) => {
  const from = ctx.query.get('from') || ctx.query.get('date');
  const to = ctx.query.get('to') || from;
  need(isDate(from) && isDate(to), 400, 'Intervallo di date non valido');
  need(daysBetween(from, to) <= 62, 400, 'Intervallo troppo ampio');
  const s = getSettings();
  const rows = db.prepare(`${BOOKING_SELECT} WHERE b.date BETWEEN ? AND ? AND b.status='confermata' ORDER BY b.date,b.start`).all(from, to);
  send(res, 200, rows.map((b) => bookingView(b, ctx.user, s)));
});
route('GET', '/api/gym/week', (req, res, ctx) => {
  const d = ctx.query.get('date'); need(isDate(d), 400, 'Data non valida');
  const s = S();
  send(res, 200, { monday: mondayOf(d), used: +gymHoursInWeek(ctx.user.id, d).toFixed(2), limit: s.gymWeekly || null });
});
route('GET', '/api/bookings/mine', (req, res, ctx) => {
  const s = getSettings(); const n = now();
  const scope = ctx.query.get('scope') === 'company' && ctx.user.company_id ? 'company' : 'mine';
  const past = ctx.query.get('past') === '1';
  const where = scope === 'company' ? 'b.company_id=?' : 'b.user_id=?';
  const rows = db.prepare(`${BOOKING_SELECT} WHERE ${where} AND ${past ? 'b.date<?' : 'b.date>=?'} AND b.status<>'cancellata' ORDER BY b.date ${past ? 'DESC' : 'ASC'}, b.start LIMIT 300`)
    .all(scope === 'company' ? ctx.user.company_id : ctx.user.id, n.date);
  const out = rows.map((b) => ({ ...bookingView(b, ctx.user, s), room_name: b.room_name, status: b.status }));
  const quota = quotaInfo(ctx.user.company_id);
  const canSeeCompany = ctx.user.role === 'referente' || scope === 'company';
  const penalties = db.prepare(`SELECT p.id,p.reason,p.amount,p.status,p.created_at,b.date,b.start,b.end,r.name room_name,u.name user_name FROM penalties p
    LEFT JOIN bookings b ON b.id=p.booking_id LEFT JOIN rooms r ON r.id=b.room_id LEFT JOIN users u ON u.id=p.user_id
    WHERE ${canSeeCompany && ctx.user.company_id ? 'p.company_id=?' : 'p.user_id=?'} AND p.status<>'annullata' ORDER BY p.id DESC LIMIT 50`).all(canSeeCompany && ctx.user.company_id ? ctx.user.company_id : ctx.user.id);
  send(res, 200, { bookings: out, quota, penalties });
});

function createBookings(ctx, body) {
  const s = S();
  const isAdmin = ctx.user.role === 'admin';
  const roomId = parseInt(body.room_id, 10);
  const room = db.prepare('SELECT * FROM rooms WHERE id=? AND active=1').get(roomId);
  need(room, 400, 'Sala non valida');
  const gym = room.kind === 'palestra';
  need(isAdmin || room.kind !== 'reception', 403, `${room.name} si prenota direttamente alla reception`);
  let gender = null;
  if (gym) {
    gender = ['M', 'F'].includes(body.gender) ? body.gender : ctx.user.gender;
    need(['M', 'F'].includes(gender), 400, "Indica se l'accesso è per uomo o per donna");
    const ws = ctx.user.gym_waiver_status;
    need(isAdmin || ws === 'approvato', 403, ws === 'in_attesa' ? "Il tuo modulo di responsabilità è in attesa di approvazione: riceverai un'email appena sarà approvato" : 'Per prenotare la palestra devi prima caricare il modulo di responsabilità firmato');
    if (gender !== ctx.user.gender) db.prepare('UPDATE users SET gender=? WHERE id=?').run(gender, ctx.user.id);
  }
  const title = gym ? 'Palestra' : str(body.title, 120);
  need(title, 400, 'Inserisci un titolo per la riunione');
  let companyId = ctx.user.company_id;
  if (isAdmin && body.company_id !== undefined) companyId = body.company_id ? parseInt(body.company_id, 10) : null;
  need(companyId || isAdmin, 400, 'Il tuo utente non è associato a nessuna azienda');
  const attendees = gym ? 1 : (body.attendees ? Math.max(0, parseInt(body.attendees, 10) || 0) : null);
  const repeat = Math.min(Math.max(parseInt(body.repeat_weeks, 10) || 0, 0), s.maxRepeat);
  const dates = [body.date]; for (let i = 1; i <= repeat; i++) dates.push(addDays(body.date, 7 * i));
  const first = bookingWindowIssues({ date: body.date, start: body.start, end: body.end }, s, { isAdmin, room });
  need(!first, 400, first);
  if (gym) {
    const g = gymIssue(room, body.date, body.start, body.end, gender, ctx.user.id); need(!g, 409, g);
    if (!isAdmin) { const w = gymWeeklyIssue(ctx.user.id, body.date, body.start, body.end, s); need(!w, 400, w); }
  } else {
    const c0 = conflict(roomId, body.date, body.start, body.end);
    need(!c0, 409, `La sala è già occupata dalle ${c0?.start} alle ${c0?.end}${c0?.company ? ' (' + c0.company + ')' : ''}`);
    if (!isAdmin) {
      const qa = quotaIssue(companyId, body.date, body.start, body.end); need(!qa, 400, qa);
      const ai = activeIssue(companyId, s, 1); need(!ai, 400, ai);
    }
  }
  const series = repeat ? crypto.randomBytes(8).toString('hex') : null;
  const created = []; const skipped = [];
  const ins = db.prepare(`INSERT INTO bookings(room_id,company_id,user_id,date,start,end,title,attendees,notes,series_id,gender,reminder_sent_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`);
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const d of dates) {
      const issue = bookingWindowIssues({ date: d, start: body.start, end: body.end }, s, { isAdmin, room })
        || (gym ? gymIssue(room, d, body.start, body.end, gender, ctx.user.id) : (conflict(roomId, d, body.start, body.end) ? 'sala già occupata' : null))
        || (gym && !isAdmin ? gymWeeklyIssue(ctx.user.id, d, body.start, body.end, s) : null)
        || (!isAdmin && !gym ? quotaIssue(companyId, d, body.start, body.end) : null)
        || (!isAdmin && !gym && created.length ? activeIssue(companyId, s, 1) : null);
      if (issue) { skipped.push({ date: d, reason: issue }); continue; }
      // se mancano meno di 24 ore il promemoria non serve: basta l'email di conferma
      const reminder = minutesUntil(d, body.start) <= 24 * 60 ? 'non_necessario' : null;
      const r = ins.run(roomId, companyId, ctx.user.id, d, body.start, body.end, title, attendees, gym ? '' : str(body.notes, 1000), series, gender, reminder);
      created.push({ id: Number(r.lastInsertRowid), date: d });
    }
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  audit(ctx.user.id, 'prenotazione_creata', { room: roomId, created, skipped });
  broadcast();
  if (created.length) {
    const pc = penaltyCfg();
    const company = companyId ? db.prepare('SELECT name FROM companies WHERE id=?').get(companyId) : null;
    const ics = buildIcs(created.map((c) => ({ id: c.id, date: c.date, start: body.start, end: body.end, title: gym ? `Palestra (${gender === 'F' ? 'Donna' : 'Uomo'})` : title, room_name: room.name, description: `Prenotazione ${room.name}${company ? ' per ' + company.name : ''}` })));
    sendMail(ctx.user.email, 'bookingConfirmed', { name: ctx.user.name, room: room.name, title, dates: created.map((c) => c.date), start: body.start, end: body.end, gym, gender, notice: pc.notice, penalty: pc.on ? pc.amount : 0 },
      { attachments: [{ filename: 'prenotazione.ics', contentType: 'text/calendar; charset=utf-8; method=PUBLISH', content: ics }] });
  }
  return { created, skipped, warning: !gym && attendees && attendees > room.capacity ? `Attenzione: la sala ha ${room.capacity} posti` : null };
}
route('POST', '/api/bookings', (req, res, ctx) => send(res, 201, createBookings(ctx, ctx.body)));

function loadEditable(ctx, id) {
  const b = db.prepare('SELECT * FROM bookings WHERE id=?').get(id);
  need(b, 404, 'Prenotazione non trovata');
  const u = ctx.user;
  const ok = u.role === 'admin' || b.user_id === u.id || (u.role === 'referente' && b.company_id && b.company_id === u.company_id);
  need(ok, 403, 'Non puoi modificare questa prenotazione');
  return b;
}
route('PUT', '/api/bookings/:id', (req, res, ctx) => {
  const b = loadEditable(ctx, +ctx.params.id);
  need(b.status === 'confermata', 400, 'La prenotazione non è più attiva');
  const s = S(); const isAdmin = ctx.user.role === 'admin';
  const n = now();
  need(isAdmin || b.date > n.date || (b.date === n.date && toMin(b.end) > n.min), 400, 'Non puoi modificare una prenotazione già conclusa');
  const nb = {
    room_id: ctx.body.room_id ? parseInt(ctx.body.room_id, 10) : b.room_id,
    date: ctx.body.date || b.date, start: ctx.body.start || b.start, end: ctx.body.end || b.end,
    title: ctx.body.title !== undefined ? str(ctx.body.title, 120) : b.title,
    attendees: ctx.body.attendees !== undefined ? (parseInt(ctx.body.attendees, 10) || null) : b.attendees,
    notes: ctx.body.notes !== undefined ? str(ctx.body.notes, 1000) : b.notes,
  };
  need(nb.title, 400, 'Inserisci un titolo per la riunione');
  const oldRoom = db.prepare('SELECT * FROM rooms WHERE id=?').get(b.room_id);
  const newRoom = db.prepare('SELECT * FROM rooms WHERE id=? AND active=1').get(nb.room_id);
  need(newRoom, 400, 'Sala non valida');
  need(oldRoom.kind !== 'palestra' && newRoom.kind !== 'palestra', 400, 'Le prenotazioni della palestra non si modificano: annulla e prenota di nuovo');
  need(isAdmin || newRoom.kind !== 'reception' || nb.room_id === b.room_id, 403, `${newRoom.name} si prenota direttamente alla reception`);
  const changedSlot = nb.room_id !== b.room_id || nb.date !== b.date || nb.start !== b.start || nb.end !== b.end;
  if (changedSlot) {
    // se la riunione è in corso si può solo allungare/accorciare la fine
    const issue = bookingWindowIssues(nb, s, { isAdmin, room: newRoom, ignorePast: b.date === n.date && toMin(b.start) <= n.min && nb.start === b.start && nb.date === b.date });
    need(!issue, 400, issue);
    const c = conflict(nb.room_id, nb.date, nb.start, nb.end, b.id);
    need(!c, 409, `La sala è già occupata dalle ${c?.start} alle ${c?.end}${c?.company ? ' (' + c.company + ')' : ''}`);
    if (!isAdmin) { const q = quotaIssue(b.company_id, nb.date, nb.start, nb.end, b.id); need(!q, 400, q); }
  }
  // se cambia giorno/ora il promemoria va ricalcolato
  const reminder = changedSlot ? (minutesUntil(nb.date, nb.start) <= 24 * 60 ? 'non_necessario' : null) : b.reminder_sent_at;
  db.prepare(`UPDATE bookings SET room_id=?,date=?,start=?,end=?,title=?,attendees=?,notes=?,reminder_sent_at=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`)
    .run(nb.room_id, nb.date, nb.start, nb.end, nb.title, nb.attendees, nb.notes, reminder, b.id);
  audit(ctx.user.id, 'prenotazione_modificata', { id: b.id, prima: { r: b.room_id, d: b.date, s: b.start, e: b.end }, dopo: nb });
  broadcast();
  send(res, 200, { ok: true });
});
route('DELETE', '/api/bookings/:id', (req, res, ctx) => {
  const b = loadEditable(ctx, +ctx.params.id);
  const n = now();
  const series = ctx.query.get('series') === '1' && b.series_id;
  const ids = series
    ? db.prepare(`SELECT id FROM bookings WHERE series_id=? AND status='confermata' AND (date>? OR (date=? AND end>?))`).all(b.series_id, n.date, n.date, n.time).map((r) => r.id)
    : [b.id];
  const pc = penaltyCfg(); let late = 0;
  for (const id of ids) {
    const row = db.prepare('SELECT * FROM bookings WHERE id=?').get(id);
    // se la riunione è già iniziata, si chiude adesso invece di cancellarla (resta nello storico)
    if (row.date === n.date && toMin(row.start) < n.min && toMin(row.end) > n.min) {
      // riunione già iniziata: si chiude in questo momento e la sala torna subito libera
      db.prepare(`UPDATE bookings SET end=?, ended_early_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP WHERE id=?`).run(n.time, id);
    } else {
      db.prepare(`UPDATE bookings SET status='cancellata', cancelled_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP WHERE id=?`).run(id);
      // annullamento senza il preavviso richiesto: penale (non per le cancellazioni fatte dall'amministrazione)
      const mu = minutesUntil(row.date, row.start);
      if (ctx.user.role !== 'admin' && pc.on && pc.notice > 0 && mu > -1 && mu < pc.notice * 60) { if (addPenalty(row, 'cancellazione_tardiva')) late++; }
    }
  }
  audit(ctx.user.id, 'prenotazione_cancellata', { ids, penali: late });
  broadcast();
  send(res, 200, { ok: true, cancelled: ids.length, late_penalties: late, penalty_amount: late ? pc.amount : 0 });
});
route('GET', '/api/bookings/:id/ics', (req, res, ctx) => {
  const b = db.prepare(`${BOOKING_SELECT} WHERE b.id=?`).get(+ctx.params.id);
  need(b, 404, 'Prenotazione non trovata');
  need(ctx.user.role === 'admin' || b.company_id === ctx.user.company_id, 403, 'Non autorizzato');
  const ics = buildIcs([{ id: b.id, date: b.date, start: b.start, end: b.end, title: b.title, room_name: b.room_name, description: `Prenotazione ${b.room_name} per ${b.company_name || ''}${b.notes ? '\n' + b.notes : ''}` }]);
  send(res, 200, ics, { 'Content-Type': 'text/calendar; charset=utf-8', 'Content-Disposition': `attachment; filename="prenotazione-${b.id}.ics"` });
});

// --- eventi in tempo reale (utenti loggati o display)
route('GET', '/api/events', (req, res, ctx) => {
  if (!ctx.user) displayAuth(ctx.query.get('token'));
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.write('retry: 5000\n\n');
  clients.add(res);
  req.on('close', () => clients.delete(res));
}, { optionalAuth: true });

// --- display
route('GET', '/api/display/state', (req, res, ctx) => {
  const a = displayAuth(ctx.query.get('token'));
  const s = getSettings(); const n = now();
  const base = { building_name: s.building_name, timezone: TZ, now: n, open_time: s.open_time, close_time: s.close_time, checkin_required: s.checkin_required === '1', checkin_grace_minutes: parseInt(s.checkin_grace_minutes, 10) };
  if (a.lobby) return send(res, 200, { ...base, lobby: true, rooms: roomsList().map((r) => roomState(r, s, n)) });
  send(res, 200, { ...base, lobby: false, ...roomState(a.room, s, n) });
}, { public: true });
route('POST', '/api/display/checkin', (req, res, ctx) => {
  const a = displayAuth(ctx.body.token); need(a.room, 403, 'Solo dal display della sala');
  const n = now();
  const b = db.prepare(`SELECT * FROM bookings WHERE id=? AND room_id=? AND date=? AND status='confermata'`).get(+ctx.body.booking_id, a.room.id, n.date);
  need(b, 404, 'Prenotazione non trovata');
  need(n.min >= toMin(b.start) - 10 && n.min < toMin(b.end), 400, 'Il check-in è possibile da 10 minuti prima dell\'inizio');
  db.prepare('UPDATE bookings SET checked_in_at=CURRENT_TIMESTAMP WHERE id=?').run(b.id);
  audit(null, 'checkin_display', { booking: b.id });
  broadcast(); send(res, 200, { ok: true });
}, { public: true });
route('POST', '/api/display/end', (req, res, ctx) => {
  const a = displayAuth(ctx.body.token); need(a.room, 403, 'Solo dal display della sala');
  const n = now(); const s = S();
  const b = db.prepare(`SELECT * FROM bookings WHERE id=? AND room_id=? AND date=? AND status='confermata'`).get(+ctx.body.booking_id, a.room.id, n.date);
  need(b && toMin(b.start) <= n.min && n.min < toMin(b.end), 400, 'Nessuna riunione in corso');
  // la sala torna libera subito (l'orario reale di fine resta nello storico)
  db.prepare('UPDATE bookings SET end=?, ended_early_at=CURRENT_TIMESTAMP WHERE id=?').run(n.min > toMin(b.start) ? n.time : b.start, b.id);
  if (n.min <= toMin(b.start)) db.prepare(`UPDATE bookings SET status='cancellata' WHERE id=?`).run(b.id);
  audit(null, 'termina_display', { booking: b.id });
  broadcast(); send(res, 200, { ok: true });
}, { public: true });

// --- amministrazione
const A = { admin: true };
route('GET', '/api/admin/companies', (req, res) => {
  const n = now(); const month = n.date.slice(0, 7);
  const rows = db.prepare(`SELECT c.*, (SELECT COUNT(*) FROM users u WHERE u.company_id=c.id) users_count FROM companies c ORDER BY c.name COLLATE NOCASE`).all();
  send(res, 200, rows.map((c) => ({ ...c, hours_this_month: +companyHoursInMonth(c.id, month).toFixed(2), quota_effective: effectiveQuota(c.id) })));
}, A);
function companyFields(b) {
  const name = str(b.name, 120); need(name, 400, 'Nome azienda obbligatorio');
  const q = b.monthly_quota_hours === '' || b.monthly_quota_hours == null ? null : parseFloat(b.monthly_quota_hours);
  need(q === null || (q >= 0 && isFinite(q)), 400, 'Monte ore non valido');
  return [name, str(b.location), str(b.contact_name), str(b.contact_email), str(b.contact_phone), q, b.active === false || b.active === 0 ? 0 : 1];
}
route('POST', '/api/admin/companies', (req, res, ctx) => {
  try {
    const r = db.prepare('INSERT INTO companies(name,location,contact_name,contact_email,contact_phone,monthly_quota_hours,active) VALUES (?,?,?,?,?,?,?)').run(...companyFields(ctx.body));
    audit(ctx.user.id, 'azienda_creata', ctx.body.name); send(res, 201, { id: Number(r.lastInsertRowid) });
  } catch (e) { if (String(e.message).includes('UNIQUE')) throw new HttpError(409, 'Esiste già un\'azienda con questo nome'); throw e; }
}, A);
route('PUT', '/api/admin/companies/:id', (req, res, ctx) => {
  try {
    db.prepare('UPDATE companies SET name=?,location=?,contact_name=?,contact_email=?,contact_phone=?,monthly_quota_hours=?,active=? WHERE id=?').run(...companyFields(ctx.body), +ctx.params.id);
  } catch (e) { if (String(e.message).includes('UNIQUE')) throw new HttpError(409, 'Esiste già un\'azienda con questo nome'); throw e; }
  audit(ctx.user.id, 'azienda_modificata', ctx.params.id); broadcast(); send(res, 200, { ok: true });
}, A);
route('DELETE', '/api/admin/companies/:id', (req, res, ctx) => {
  const id = +ctx.params.id; const n = now();
  // cancella le prenotazioni future, disattiva gli utenti, mantiene lo storico
  db.prepare(`UPDATE bookings SET status='cancellata' WHERE company_id=? AND status='confermata' AND date>=?`).run(id, n.date);
  db.prepare('UPDATE users SET active=0 WHERE company_id=?').run(id);
  db.prepare('UPDATE companies SET active=0 WHERE id=?').run(id);
  audit(ctx.user.id, 'azienda_disattivata', id); broadcast(); send(res, 200, { ok: true });
}, A);

route('GET', '/api/admin/users', (req, res) => {
  send(res, 200, db.prepare(`SELECT u.id,u.name,u.email,u.role,u.company_id,u.active,u.last_login,u.must_change_password,u.email_verified,u.self_registered,u.gym_waiver_status,u.gender,c.name company_name FROM users u LEFT JOIN companies c ON c.id=u.company_id ORDER BY c.name COLLATE NOCASE, u.name COLLATE NOCASE`).all());
}, A);
function userFields(b) {
  const name = str(b.name, 120); const email = str(b.email, 200).toLowerCase();
  need(name, 400, 'Nome obbligatorio'); need(/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email), 400, 'Email non valida');
  const role = ['admin', 'referente', 'utente'].includes(b.role) ? b.role : 'utente';
  const companyId = b.company_id ? parseInt(b.company_id, 10) : null;
  need(companyId || role === 'admin', 400, 'Seleziona l\'azienda dell\'utente');
  return { name, email, role, companyId, active: b.active === false || b.active === 0 ? 0 : 1 };
}
route('POST', '/api/admin/users', (req, res, ctx) => {
  const f = userFields(ctx.body); const pw = ctx.body.password ? String(ctx.body.password) : randomPassword();
  try {
    const r = db.prepare('INSERT INTO users(company_id,name,email,password_hash,role,active,must_change_password) VALUES (?,?,?,?,?,?,1)').run(f.companyId, f.name, f.email, hashPassword(pw), f.role, f.active);
    audit(ctx.user.id, 'utente_creato', f.email); send(res, 201, { id: Number(r.lastInsertRowid), password: pw });
  } catch (e) { if (String(e.message).includes('UNIQUE')) throw new HttpError(409, 'Email già registrata'); throw e; }
}, A);
route('PUT', '/api/admin/users/:id', (req, res, ctx) => {
  const f = userFields(ctx.body); const id = +ctx.params.id;
  need(!(id === ctx.user.id && (f.role !== 'admin' || !f.active)), 400, 'Non puoi togliere i permessi di amministratore a te stesso');
  try {
    db.prepare('UPDATE users SET company_id=?,name=?,email=?,role=?,active=? WHERE id=?').run(f.companyId, f.name, f.email, f.role, f.active, id);
    if (f.active) db.prepare("UPDATE users SET email_verified=1, verify_token=NULL, approval='approvato' WHERE id=? AND (email_verified=0 OR approval<>'approvato')").run(id);
  } catch (e) { if (String(e.message).includes('UNIQUE')) throw new HttpError(409, 'Email già registrata'); throw e; }
  if (!f.active) db.prepare('DELETE FROM sessions WHERE user_id=?').run(id);
  audit(ctx.user.id, 'utente_modificato', id); send(res, 200, { ok: true });
}, A);
// --- iscrizioni da approvare
function adminRecipients() {
  const n = String(getSettings().admin_notify_email || '').trim();
  if (n) return [n];
  return db.prepare("SELECT email FROM users WHERE role='admin' AND active=1").all().map((r) => r.email).filter((e) => EMAIL_RE.test(e) && !e.endsWith('.local'));
}
route('GET', '/api/admin/registrations', (req, res) => {
  const rows = db.prepare(`SELECT u.id,u.name,u.first_name,u.last_name,u.email,u.role,u.created_at,u.company_id,c.name company_name,
      (SELECT COUNT(*) FROM users x WHERE x.company_id=u.company_id AND x.id<>u.id AND x.active=1) members
    FROM users u LEFT JOIN companies c ON c.id=u.company_id WHERE u.approval='in_attesa' AND u.email_verified=1 ORDER BY u.id`).all();
  const unconfirmed = db.prepare("SELECT COUNT(*) c FROM users WHERE approval='in_attesa' AND email_verified=0").get().c;
  send(res, 200, { pending: rows.map((r) => ({ ...r, new_company: !r.members })), unconfirmed });
}, A);
route('POST', '/api/admin/registrations/:id/approve', (req, res, ctx) => {
  const u = db.prepare('SELECT u.*, c.name company_name FROM users u LEFT JOIN companies c ON c.id=u.company_id WHERE u.id=?').get(+ctx.params.id);
  need(u && u.approval === 'in_attesa', 404, 'Richiesta non trovata o già gestita');
  need(u.email_verified, 400, "L'utente non ha ancora confermato la sua email");
  const pw = randomPassword();
  const hasMembers = u.company_id && db.prepare('SELECT 1 FROM users WHERE company_id=? AND id<>? AND active=1').get(u.company_id, u.id);
  const role = u.role === 'admin' ? 'admin' : hasMembers ? u.role : 'referente';
  db.prepare("UPDATE users SET password_hash=?, active=1, approval='approvato', must_change_password=0, role=? WHERE id=?").run(hashPassword(pw), role, u.id);
  if (u.company_id) db.prepare('UPDATE companies SET active=1 WHERE id=?').run(u.company_id);
  sendMail(u.email, 'welcome', { name: u.first_name || u.name, company: u.company_name || '', email: u.email, password: pw, quota: u.company_id ? effectiveQuota(u.company_id) : null });
  audit(ctx.user.id, 'iscrizione_approvata', u.email); broadcast();
  send(res, 200, { ok: true });
}, A);
route('POST', '/api/admin/registrations/:id/reject', (req, res, ctx) => {
  const u = db.prepare('SELECT u.*, c.name company_name FROM users u LEFT JOIN companies c ON c.id=u.company_id WHERE u.id=?').get(+ctx.params.id);
  need(u && u.approval === 'in_attesa', 404, 'Richiesta non trovata o già gestita');
  const note = str(ctx.body.note, 500);
  if (u.email_verified) sendMail(u.email, 'registrationRejected', { name: u.first_name || u.name, company: u.company_name || '', note });
  db.exec('BEGIN');
  try {
    db.prepare('DELETE FROM sessions WHERE user_id=?').run(u.id);
    db.prepare('DELETE FROM users WHERE id=?').run(u.id);
    // un'azienda creata solo da questa richiesta viene rimossa
    if (u.company_id && !db.prepare('SELECT 1 FROM users WHERE company_id=?').get(u.company_id) && !db.prepare('SELECT 1 FROM bookings WHERE company_id=?').get(u.company_id)) {
      db.prepare('DELETE FROM companies WHERE id=?').run(u.company_id);
    }
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  audit(ctx.user.id, 'iscrizione_rifiutata', { email: u.email, note }); broadcast();
  send(res, 200, { ok: true });
}, A);
route('POST', '/api/admin/users/:id/reset-password', (req, res, ctx) => {
  const pw = randomPassword(); const id = +ctx.params.id;
  db.prepare('UPDATE users SET password_hash=?, must_change_password=1 WHERE id=?').run(hashPassword(pw), id);
  db.prepare('DELETE FROM sessions WHERE user_id=?').run(id);
  audit(ctx.user.id, 'reset_password', id); send(res, 200, { password: pw });
}, A);
route('DELETE', '/api/admin/users/:id', (req, res, ctx) => {
  const id = +ctx.params.id; need(id !== ctx.user.id, 400, 'Non puoi eliminare te stesso');
  db.prepare('UPDATE users SET active=0 WHERE id=?').run(id); db.prepare('DELETE FROM sessions WHERE user_id=?').run(id);
  audit(ctx.user.id, 'utente_disattivato', id); send(res, 200, { ok: true });
}, A);
// Import CSV: azienda;nome;email;ruolo  (separatore ; oppure ,)
route('POST', '/api/admin/import', (req, res, ctx) => {
  const text = String(ctx.body.csv || '');
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  need(lines.length, 400, 'File vuoto');
  const sep = (lines[0].match(/;/g) || []).length >= (lines[0].match(/,/g) || []).length ? ';' : ',';
  const out = { companies_created: 0, users_created: [], errors: [] };
  const header = lines[0].toLowerCase();
  const startIdx = header.includes('azienda') || header.includes('email') ? 1 : 0;
  db.exec('BEGIN');
  try {
    for (let i = startIdx; i < lines.length; i++) {
      const [company, name, email, role] = lines[i].split(sep).map((x) => x.trim().replace(/^"|"$/g, ''));
      if (!company) { out.errors.push(`Riga ${i + 1}: azienda mancante`); continue; }
      let c = db.prepare('SELECT id FROM companies WHERE name=? COLLATE NOCASE').get(company);
      if (!c) { const r = db.prepare('INSERT INTO companies(name) VALUES (?)').run(company); c = { id: Number(r.lastInsertRowid) }; out.companies_created++; }
      if (!email) continue;
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { out.errors.push(`Riga ${i + 1}: email non valida (${email})`); continue; }
      if (db.prepare('SELECT 1 FROM users WHERE email=?').get(email)) { out.errors.push(`Riga ${i + 1}: ${email} già presente`); continue; }
      const pw = randomPassword();
      const rl = ['referente', 'utente'].includes((role || '').toLowerCase()) ? role.toLowerCase() : 'utente';
      db.prepare('INSERT INTO users(company_id,name,email,password_hash,role) VALUES (?,?,?,?,?)').run(c.id, name || email, email.toLowerCase(), hashPassword(pw), rl);
      out.users_created.push({ company, name: name || email, email: email.toLowerCase(), role: rl, password: pw });
    }
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  audit(ctx.user.id, 'import_csv', { companies: out.companies_created, users: out.users_created.length });
  send(res, 200, out);
}, A);

route('GET', '/api/admin/rooms', (req, res) => send(res, 200, roomsList(true)), A);
function roomFields(b) {
  const name = str(b.name, 80); need(name, 400, 'Nome sala obbligatorio');
  const cap = parseInt(b.capacity, 10); need(cap > 0, 400, 'Capienza non valida');
  const color = /^#[0-9a-f]{6}$/i.test(b.color || '') ? b.color : '#2563eb';
  const kind = ['palestra', 'reception'].includes(b.kind) ? b.kind : 'sala';
  return [name, kind === 'palestra' ? Math.min(cap, 2) : cap, str(b.location), str(b.equipment, 300), color, parseInt(b.sort_order, 10) || 0, b.active === false || b.active === 0 ? 0 : 1, kind];
}
route('POST', '/api/admin/rooms', (req, res, ctx) => {
  const r = db.prepare('INSERT INTO rooms(name,capacity,location,equipment,color,sort_order,active,kind,display_token) VALUES (?,?,?,?,?,?,?,?,?)').run(...roomFields(ctx.body), crypto.randomBytes(16).toString('hex'));
  audit(ctx.user.id, 'sala_creata', ctx.body.name); broadcast(); send(res, 201, { id: Number(r.lastInsertRowid) });
}, A);
route('PUT', '/api/admin/rooms/:id', (req, res, ctx) => {
  db.prepare('UPDATE rooms SET name=?,capacity=?,location=?,equipment=?,color=?,sort_order=?,active=?,kind=? WHERE id=?').run(...roomFields(ctx.body), +ctx.params.id);
  audit(ctx.user.id, 'sala_modificata', ctx.params.id); broadcast(); send(res, 200, { ok: true });
}, A);
route('POST', '/api/admin/rooms/:id/token', (req, res, ctx) => {
  const t = crypto.randomBytes(16).toString('hex');
  db.prepare('UPDATE rooms SET display_token=? WHERE id=?').run(t, +ctx.params.id);
  audit(ctx.user.id, 'token_display_rigenerato', ctx.params.id); send(res, 200, { token: t });
}, A);
route('POST', '/api/admin/lobby-token', (req, res, ctx) => {
  const t = crypto.randomBytes(16).toString('hex');
  db.prepare("UPDATE settings SET value=? WHERE key='lobby_token'").run(t);
  audit(ctx.user.id, 'token_atrio_rigenerato', ''); send(res, 200, { token: t });
}, A);

route('GET', '/api/admin/closures', (req, res) => send(res, 200, db.prepare('SELECT * FROM closures ORDER BY date').all()), A);
route('POST', '/api/admin/closures', (req, res, ctx) => {
  const from = ctx.body.date; const to = ctx.body.to || from; const reason = str(ctx.body.reason, 120);
  need(isDate(from) && isDate(to) && to >= from && daysBetween(from, to) <= 366, 400, 'Date non valide');
  let d = from; let affected = 0;
  while (d <= to) {
    db.prepare('INSERT OR REPLACE INTO closures(date,reason) VALUES (?,?)').run(d, reason);
    if (ctx.body.cancel_bookings) affected += Number(db.prepare(`UPDATE bookings SET status='cancellata' WHERE date=? AND status='confermata'`).run(d).changes);
    else affected += db.prepare(`SELECT COUNT(*) c FROM bookings WHERE date=? AND status='confermata'`).get(d).c;
    d = addDays(d, 1);
  }
  audit(ctx.user.id, 'chiusura_aggiunta', { from, to, reason }); broadcast();
  send(res, 201, { ok: true, bookings_on_dates: affected, cancelled: !!ctx.body.cancel_bookings });
}, A);
route('DELETE', '/api/admin/closures/:date', (req, res, ctx) => {
  db.prepare('DELETE FROM closures WHERE date=?').run(ctx.params.date);
  audit(ctx.user.id, 'chiusura_rimossa', ctx.params.date); broadcast(); send(res, 200, { ok: true });
}, A);

const EDITABLE_SETTINGS = ['building_name', 'open_time', 'close_time', 'slot_minutes', 'max_hours_per_booking', 'max_advance_days', 'max_active_per_company', 'max_repeat_weeks', 'checkin_required', 'checkin_grace_minutes', 'show_titles_to_others', 'display_show_title', 'display_show_company',
  'default_monthly_quota_hours', 'registration_enabled', 'registration_approval', 'gym_saturday', 'gym_weekly_hours', 'admin_notify_email', 'reminders_enabled', 'penalties_enabled', 'penalty_amount', 'cancel_notice_hours', 'gym_rule', 'gym_waiver_email'];
route('GET', '/api/admin/settings', (req, res) => send(res, 200, { ...getSettings(), smtp_configured: mailer.isConfigured(), gym_template_custom: fs.existsSync(path.join(DATA_DIR, 'modulo-palestra.pdf')) }), A);
route('PUT', '/api/admin/settings', (req, res, ctx) => {
  const b = ctx.body;
  if (b.open_time !== undefined || b.close_time !== undefined) {
    const o = b.open_time ?? getSettings().open_time; const c = b.close_time ?? getSettings().close_time;
    need(isTime(o) && isTime(c) && toMin(c) > toMin(o), 400, 'Orari di apertura non validi');
  }
  if (b.slot_minutes !== undefined) need(['15', '30', '60'].includes(String(b.slot_minutes)), 400, 'Durata slot ammessa: 15, 30 o 60 minuti');
  if (b.gym_rule !== undefined) need(['uno_per_sesso', 'stesso_sesso', 'misto'].includes(b.gym_rule), 400, 'Regola palestra non valida');
  for (const k of ['gym_waiver_email', 'admin_notify_email']) if (b[k]) need(EMAIL_RE.test(String(b[k]).trim()), 400, 'Indirizzo email non valido');
  if (b.checkin_required === '1' && getSettings().checkin_required !== '1') db.prepare("UPDATE settings SET value=CURRENT_TIMESTAMP WHERE key='checkin_enabled_at'").run();
  for (const k of EDITABLE_SETTINGS) if (b[k] !== undefined) db.prepare('UPDATE settings SET value=? WHERE key=?').run(String(b[k]), k);
  audit(ctx.user.id, 'impostazioni', b); broadcast(); send(res, 200, getSettings());
}, A);

function report(month) {
  need(/^\d{4}-\d{2}$/.test(month), 400, 'Mese non valido');
  const s = getSettings();
  const rows = db.prepare(`${BOOKING_SELECT} WHERE substr(b.date,1,7)=? AND b.status IN ('confermata','liberata')`).all(month);
  // giorni lavorativi nel mese
  let d = month + '-01'; let workdays = 0;
  while (d.slice(0, 7) === month) { if (![0, 6].includes(weekday(d)) && !db.prepare('SELECT 1 FROM closures WHERE date=?').get(d)) workdays++; d = addDays(d, 1); }
  const dayHours = (toMin(s.close_time) - toMin(s.open_time)) / 60;
  const byCompany = {}; const byRoom = {};
  for (const r of roomsList()) byRoom[r.id] = { room: r.name, hours: 0, bookings: 0, no_show: 0 };
  for (const b of rows) {
    const h = (toMin(b.end) - toMin(b.start)) / 60;
    const key = b.company_name || '(senza azienda)';
    byCompany[key] ??= { company: key, hours: 0, bookings: 0, no_show: 0 };
    byRoom[b.room_id] ??= { room: b.room_name, hours: 0, bookings: 0, no_show: 0 };
    if (b.status === 'liberata') { byCompany[key].no_show++; byRoom[b.room_id].no_show++; continue; }
    byCompany[key].hours += h; byCompany[key].bookings++;
    byRoom[b.room_id].hours += h; byRoom[b.room_id].bookings++;
  }
  const rooms = Object.values(byRoom).map((r) => ({ ...r, hours: +r.hours.toFixed(2), occupancy: workdays ? +(100 * r.hours / (workdays * dayHours)).toFixed(1) : 0 }));
  const companies = Object.values(byCompany).map((c) => ({ ...c, hours: +c.hours.toFixed(2) })).sort((a, b) => b.hours - a.hours);
  return { month, workdays, hours_available_per_room: workdays * dayHours, rooms, companies, bookings: rows.filter((b) => b.status === 'confermata').length };
}
route('GET', '/api/admin/report', (req, res, ctx) => send(res, 200, report(ctx.query.get('month') || now().date.slice(0, 7))), A);
const csvCell = (v) => { const s = String(v ?? ''); return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
route('GET', '/api/admin/export.csv', (req, res, ctx) => {
  const month = ctx.query.get('month') || now().date.slice(0, 7);
  need(/^\d{4}-\d{2}$/.test(month), 400, 'Mese non valido');
  const rows = db.prepare(`${BOOKING_SELECT} WHERE substr(b.date,1,7)=? ORDER BY b.date,b.start`).all(month);
  const head = ['ID', 'Data', 'Inizio', 'Fine', 'Ore', 'Sala', 'Azienda', 'Utente', 'Titolo', 'Partecipanti', 'Stato', 'Check-in', 'Creata il'];
  const lines = [head.join(';')].concat(rows.map((b) => [b.id, b.date, b.start, b.end, ((toMin(b.end) - toMin(b.start)) / 60).toFixed(2).replace('.', ','), b.room_name, b.company_name, b.user_name, b.title, b.attendees, b.status, b.checked_in_at || '', b.created_at].map(csvCell).join(';')));
  send(res, 200, '﻿' + lines.join('\r\n'), { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="prenotazioni-${month}.csv"` });
}, A);
route('GET', '/api/admin/bookings', (req, res, ctx) => {
  const from = ctx.query.get('from'); const to = ctx.query.get('to');
  need(isDate(from) && isDate(to), 400, 'Date non valide');
  const params = [from, to]; let where = 'b.date BETWEEN ? AND ?';
  if (ctx.query.get('company')) { where += ' AND b.company_id=?'; params.push(+ctx.query.get('company')); }
  if (ctx.query.get('room')) { where += ' AND b.room_id=?'; params.push(+ctx.query.get('room')); }
  if (ctx.query.get('status')) { where += ' AND b.status=?'; params.push(ctx.query.get('status')); }
  const rows = db.prepare(`${BOOKING_SELECT} WHERE ${where} ORDER BY b.date,b.start LIMIT 2000`).all(...params);
  send(res, 200, rows.map((b) => ({ id: b.id, date: b.date, start: b.start, end: b.end, room_name: b.room_name, company_name: b.company_name, user_name: b.user_name, title: b.title, attendees: b.attendees, status: b.status, checked_in: !!b.checked_in_at, series_id: b.series_id })));
}, A);
route('GET', '/api/admin/audit', (req, res) => {
  send(res, 200, db.prepare(`SELECT a.*, u.name user_name FROM audit a LEFT JOIN users u ON u.id=a.user_id ORDER BY a.id DESC LIMIT 300`).all());
}, A);
route('GET', '/api/admin/backup', (req, res, ctx) => {
  const file = path.join(DATA_DIR, `backup-${Date.now()}.db`);
  db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
  const buf = fs.readFileSync(file); fs.unlinkSync(file);
  audit(ctx.user.id, 'backup_scaricato', '');
  send(res, 200, buf, { 'Content-Type': 'application/octet-stream', 'Content-Disposition': `attachment; filename="sale-backup-${now().date}.db"` });
}, A);

// ---------------------------------------------------------------- registrazione autonoma
const normCompany = (n) => String(n || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/\b(s\.?r\.?l\.?s?|s\.?p\.?a\.?|s\.?n\.?c\.?|s\.?a\.?s\.?|s\.?c\.?a\.?r\.?l\.?|soc(ieta)?|coop(erativa)?)\b/g, ' ').replace(/[^a-z0-9]+/g, '');
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const VERIFY_HOURS = 48;
route('GET', '/api/public-info', (req, res) => {
  const s = getSettings();
  send(res, 200, { building_name: s.building_name, registration_enabled: s.registration_enabled === '1', default_quota: s.default_monthly_quota_hours, open_time: s.open_time, close_time: s.close_time });
}, { public: true });
route('POST', '/api/register', (req, res, ctx) => {
  const s = getSettings();
  need(s.registration_enabled === '1', 403, "Le iscrizioni online non sono attive: contatta l'amministrazione dello stabile.");
  checkRate('reg|' + req.socket.remoteAddress);
  const first = str(ctx.body.first_name, 60); const last = str(ctx.body.last_name, 60);
  const companyName = str(ctx.body.company, 120).replace(/\s+/g, ' '); const email = str(ctx.body.email, 200).toLowerCase();
  need(first.length >= 2 && last.length >= 2, 400, 'Inserisci nome e cognome');
  need(companyName.length >= 2 && normCompany(companyName).length >= 2, 400, "Inserisci il nome dell'azienda");
  need(EMAIL_RE.test(email), 400, 'Indirizzo email non valido');
  need(ctx.body.privacy === true, 400, 'Per registrarti devi accettare il trattamento dei dati');
  const existing = db.prepare('SELECT * FROM users WHERE email=?').get(email);
  need(!(existing && existing.email_verified && existing.approval === 'in_attesa'), 409, "Hai già confermato l'iscrizione: è in attesa di approvazione da parte dell'amministrazione. Riceverai un'email con la password appena sarà approvata.");
  need(!(existing && existing.email_verified), 409, 'Questa email è già registrata: accedi oppure usa "Password dimenticata".');
  // azienda: si aggancia a una esistente con lo stesso nome, altrimenti viene creata
  const key = normCompany(companyName);
  let company = db.prepare('SELECT * FROM companies').all().find((c) => normCompany(c.name) === key);
  need(!(company && !company.active), 403, "Questa azienda risulta disattivata: contatta l'amministrazione dello stabile.");
  let newCompany = false;
  if (!company) {
    const r = db.prepare('INSERT INTO companies(name,contact_name,contact_email) VALUES (?,?,?)').run(companyName, `${first} ${last}`, email);
    company = { id: Number(r.lastInsertRowid), name: companyName }; newCompany = true;
    audit(null, 'azienda_registrata', companyName);
  }
  const hasMembers = db.prepare('SELECT COUNT(*) c FROM users WHERE company_id=? AND active=1').get(company.id).c > 0;
  const token = crypto.randomBytes(24).toString('hex');
  const expires = Date.now() + VERIFY_HOURS * 3600e3;
  if (existing) {
    db.prepare("UPDATE users SET first_name=?,last_name=?,name=?,company_id=?,verify_token=?,verify_expires=?,approval=? WHERE id=?").run(first, last, `${first} ${last}`, company.id, token, expires, s.registration_approval === '1' ? 'in_attesa' : 'approvato', existing.id);
  } else {
    db.prepare(`INSERT INTO users(company_id,name,first_name,last_name,email,password_hash,role,must_change_password,active,email_verified,verify_token,verify_expires,self_registered,approval)
      VALUES (?,?,?,?,?,?,?,0,0,0,?,?,1,?)`).run(company.id, `${first} ${last}`, first, last, email, hashPassword(crypto.randomBytes(24).toString('hex')), hasMembers ? 'utente' : 'referente', token, expires, s.registration_approval === '1' ? 'in_attesa' : 'approvato');
  }
  sendMail(email, 'confirmRegistration', { name: first, company: company.name, link: `${BASE()}/conferma.html?token=${token}`, hours: VERIFY_HOURS });
  audit(null, 'registrazione', { email, company: company.name, nuova_azienda: newCompany });
  send(res, 201, { ok: true, email });
}, { public: true });
route('POST', '/api/register/confirm', (req, res, ctx) => {
  const token = str(ctx.body.token, 100);
  need(token, 400, 'Link non valido');
  const u = db.prepare('SELECT u.*, c.name company_name FROM users u LEFT JOIN companies c ON c.id=u.company_id WHERE verify_token=?').get(token);
  need(u, 404, 'Questo link non è valido o è già stato usato. Se hai già confermato, accedi con la password ricevuta via email.');
  need(u.verify_expires > Date.now(), 410, 'Il link è scaduto: registrati di nuovo con la stessa email per riceverne uno nuovo.');
  if (u.approval === 'in_attesa') {
    // email verificata: ora serve l'approvazione dell'amministrazione, la password arriva dopo
    db.prepare('UPDATE users SET email_verified=1, verify_token=NULL, verify_expires=NULL, active=0 WHERE id=?').run(u.id);
    sendMail(u.email, 'registrationPending', { name: u.first_name || u.name, company: u.company_name || '' });
    const newCompany = !db.prepare("SELECT 1 FROM users WHERE company_id=? AND id<>? AND active=1").get(u.company_id, u.id);
    for (const to of adminRecipients()) sendMail(to, 'adminApprovalNeeded', { name: u.name, email: u.email, company: u.company_name || '', newCompany });
    audit(u.id, 'iscrizione_da_approvare', u.email);
    broadcast();
    return send(res, 200, { ok: true, pending: true, name: u.first_name || u.name, email: u.email, company: u.company_name });
  }
  const pw = randomPassword();
  db.prepare('UPDATE users SET password_hash=?, active=1, email_verified=1, verify_token=NULL, verify_expires=NULL, must_change_password=0 WHERE id=?').run(hashPassword(pw), u.id);
  sendMail(u.email, 'welcome', { name: u.first_name || u.name, company: u.company_name || '', email: u.email, password: pw, quota: u.company_id ? effectiveQuota(u.company_id) : null });
  const notify = getSettings().admin_notify_email;
  if (notify) sendMail(notify, 'adminNewUser', { name: u.name, email: u.email, company: u.company_name || '', newCompany: u.role === 'referente' });
  audit(u.id, 'iscrizione_confermata', u.email);
  broadcast();
  send(res, 200, { ok: true, name: u.first_name || u.name, email: u.email, company: u.company_name, password: pw });
}, { public: true });
route('POST', '/api/password/forgot', (req, res, ctx) => {
  checkRate('forgot|' + req.socket.remoteAddress);
  const email = str(ctx.body.email, 200).toLowerCase();
  const u = EMAIL_RE.test(email) ? db.prepare('SELECT * FROM users WHERE email=? AND active=1 AND email_verified=1').get(email) : null;
  if (u) {
    const token = crypto.randomBytes(24).toString('hex');
    db.prepare('UPDATE users SET reset_token=?, reset_expires=? WHERE id=?').run(token, Date.now() + 2 * 3600e3, u.id);
    sendMail(u.email, 'passwordReset', { name: u.first_name || u.name, link: `${BASE()}/conferma.html?reset=${token}` });
    audit(u.id, 'richiesta_password', '');
  }
  // risposta identica in ogni caso, per non rivelare quali email sono registrate
  send(res, 200, { ok: true });
}, { public: true });
route('POST', '/api/password/reset', (req, res, ctx) => {
  const token = str(ctx.body.token, 100);
  const u = token ? db.prepare('SELECT * FROM users WHERE reset_token=?').get(token) : null;
  need(u, 404, 'Questo link non è valido o è già stato usato.');
  need(u.reset_expires > Date.now(), 410, 'Il link è scaduto: richiedi di nuovo una nuova password.');
  const pw = randomPassword();
  db.prepare('UPDATE users SET password_hash=?, reset_token=NULL, reset_expires=NULL, must_change_password=0 WHERE id=?').run(hashPassword(pw), u.id);
  db.prepare('DELETE FROM sessions WHERE user_id=?').run(u.id);
  sendMail(u.email, 'newPassword', { name: u.first_name || u.name, email: u.email, password: pw });
  audit(u.id, 'password_rigenerata', '');
  send(res, 200, { ok: true, email: u.email, password: pw });
}, { public: true });

// ---------------------------------------------------------------- palestra: modulo di responsabilità
const WAIVER_TYPES = { pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png' };
function waiverTemplatePath() {
  const custom = path.join(DATA_DIR, 'modulo-palestra.pdf');
  return fs.existsSync(custom) ? custom : path.join(PUBLIC_DIR, 'modulo-palestra.pdf');
}
route('GET', '/api/gym/template', (req, res) => {
  send(res, 200, fs.readFileSync(waiverTemplatePath()), { 'Content-Type': 'application/pdf', 'Content-Disposition': 'attachment; filename="modulo-responsabilita-palestra.pdf"' });
});
route('POST', '/api/gym/waiver', (req, res, ctx) => {
  const u = ctx.user;
  need(u.company_id || u.role === 'admin', 400, 'Utente non associato a un\'azienda');
  need(['M', 'F'].includes(ctx.body.gender), 400, "Indica se l'accesso è per uomo o per donna");
  need(ctx.body.accept === true, 400, 'Conferma di aver letto e firmato il modulo');
  const ext = String(ctx.body.filename || '').toLowerCase().split('.').pop();
  need(WAIVER_TYPES[ext], 400, 'Carica il modulo firmato in PDF, JPG o PNG');
  const data = Buffer.from(String(ctx.body.data || ''), 'base64');
  need(data.length > 1000, 400, 'Il file sembra vuoto');
  need(data.length <= 10 * 1024 * 1024, 413, 'Il file è troppo grande (massimo 10 MB)');
  const sig = data.subarray(0, 4).toString('hex');
  need((ext === 'pdf' && sig === '25504446') || (ext === 'png' && sig === '89504e47') || (['jpg', 'jpeg'].includes(ext) && sig.startsWith('ffd8')), 400, "Il file non è un PDF o un'immagine valida");
  const dir = path.join(UPLOAD_DIR, 'moduli-palestra'); fs.mkdirSync(dir, { recursive: true });
  const fname = `${u.id}-${Date.now()}.${ext === 'jpeg' ? 'jpg' : ext}`;
  fs.writeFileSync(path.join(dir, fname), data);
  db.prepare("UPDATE users SET gym_waiver_status='in_attesa', gym_waiver_file=?, gym_waiver_at=CURRENT_TIMESTAMP, gym_waiver_note='', gender=? WHERE id=?").run(fname, ctx.body.gender, u.id);
  const s = getSettings();
  const company = u.company_name || '';
  const stamp = new Intl.DateTimeFormat('it-IT', { timeZone: TZ, dateStyle: 'short', timeStyle: 'short' }).format(new Date());
  const safe = `${u.name}`.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '-');
  sendMail(s.gym_waiver_email, 'waiverToOffice', { name: u.name, email: u.email, company, gender: ctx.body.gender, uploaded: stamp },
    { attachments: [{ filename: `modulo-palestra-${safe}.${ext === 'jpeg' ? 'jpg' : ext}`, contentType: WAIVER_TYPES[ext], content: data }] });
  audit(u.id, 'modulo_palestra_caricato', fname);
  broadcast();
  send(res, 200, { ok: true, status: 'in_attesa' });
});

// ---------------------------------------------------------------- promemoria 24 ore prima
function sendReminders() {
  const s = getSettings();
  if (s.reminders_enabled !== '1') return;
  const n = now();
  const pc = penaltyCfg();
  const rows = db.prepare(`SELECT b.*, u.email, u.name user_name, u.first_name, r.name room_name, r.kind FROM bookings b JOIN users u ON u.id=b.user_id JOIN rooms r ON r.id=b.room_id
    WHERE b.status='confermata' AND b.reminder_sent_at IS NULL AND b.date BETWEEN ? AND ?`).all(n.date, addDays(n.date, 3));
  for (const b of rows) {
    const mu = minutesUntil(b.date, b.start);
    if (mu > 0 && mu <= 24 * 60) {
      db.prepare('UPDATE bookings SET reminder_sent_at=CURRENT_TIMESTAMP WHERE id=?').run(b.id);
      sendMail(b.email, 'reminder', { name: b.first_name || b.user_name, room: b.room_name, title: b.title, date: b.date, start: b.start, end: b.end, gym: b.kind === 'palestra', notice: pc.notice, penalty: pc.on ? pc.amount : 0 });
    } else if (mu <= 0) {
      db.prepare("UPDATE bookings SET reminder_sent_at='scaduto' WHERE id=?").run(b.id);
    }
  }
}
setInterval(sendReminders, 60 * 1000);
setTimeout(sendReminders, 5000);

// ---------------------------------------------------------------- amministrazione: funzioni aggiuntive
route('GET', '/api/admin/live', (req, res) => {
  const s = getSettings(); const n = now();
  send(res, 200, { now: n, rooms: roomsList().map((r) => roomState(r, s, n)), pending_waivers: db.prepare("SELECT COUNT(*) c FROM users WHERE gym_waiver_status='in_attesa'").get().c, pending_registrations: db.prepare("SELECT COUNT(*) c FROM users WHERE approval='in_attesa' AND email_verified=1").get().c,
    open_penalties: db.prepare("SELECT COUNT(*) c FROM penalties WHERE status='da_addebitare'").get().c });
}, A);
route('GET', '/api/admin/waivers', (req, res) => {
  send(res, 200, db.prepare(`SELECT u.id,u.name,u.email,u.gender,u.gym_waiver_status status,u.gym_waiver_at uploaded_at,u.gym_waiver_note note,u.gym_waiver_file file,c.name company_name
    FROM users u LEFT JOIN companies c ON c.id=u.company_id WHERE u.gym_waiver_status<>'nessuno' ORDER BY CASE u.gym_waiver_status WHEN 'in_attesa' THEN 0 ELSE 1 END, u.gym_waiver_at DESC`).all());
}, A);
route('GET', '/api/admin/waivers/:id/file', (req, res, ctx) => {
  const u = db.prepare('SELECT gym_waiver_file f, name FROM users WHERE id=?').get(+ctx.params.id);
  need(u && u.f, 404, 'Modulo non trovato');
  const file = path.join(UPLOAD_DIR, 'moduli-palestra', path.basename(u.f));
  need(fs.existsSync(file), 404, 'File non trovato');
  const ext = path.extname(file).slice(1);
  send(res, 200, fs.readFileSync(file), { 'Content-Type': WAIVER_TYPES[ext] || 'application/octet-stream', 'Content-Disposition': `inline; filename="modulo-${u.name.replace(/[^A-Za-z0-9]+/g, '-')}.${ext}"` });
}, A);
route('POST', '/api/admin/waivers/:id', (req, res, ctx) => {
  const u = db.prepare('SELECT * FROM users WHERE id=?').get(+ctx.params.id);
  need(u, 404, 'Utente non trovato');
  const approved = ctx.body.decision === 'approvato';
  need(approved || ctx.body.decision === 'rifiutato', 400, 'Decisione non valida');
  const note = str(ctx.body.note, 500);
  db.prepare('UPDATE users SET gym_waiver_status=?, gym_waiver_note=? WHERE id=?').run(approved ? 'approvato' : 'rifiutato', note, u.id);
  sendMail(u.email, 'waiverDecision', { name: u.first_name || u.name, approved, note });
  audit(ctx.user.id, approved ? 'modulo_palestra_approvato' : 'modulo_palestra_rifiutato', u.id);
  broadcast(); send(res, 200, { ok: true });
}, A);
route('POST', '/api/admin/gym-template', (req, res, ctx) => {
  const data = Buffer.from(String(ctx.body.data || ''), 'base64');
  need(data.subarray(0, 4).toString('hex') === '25504446', 400, 'Carica un file PDF');
  fs.writeFileSync(path.join(DATA_DIR, 'modulo-palestra.pdf'), data);
  audit(ctx.user.id, 'modello_modulo_palestra_aggiornato', ''); send(res, 200, { ok: true });
}, A);
route('DELETE', '/api/admin/gym-template', (req, res, ctx) => {
  const f = path.join(DATA_DIR, 'modulo-palestra.pdf'); if (fs.existsSync(f)) fs.unlinkSync(f);
  audit(ctx.user.id, 'modello_modulo_palestra_ripristinato', ''); send(res, 200, { ok: true });
}, A);
const PENALTY_SELECT = `SELECT p.*, c.name company_name, u.name user_name, u.email user_email, b.date, b.start, b.end, r.name room_name FROM penalties p
  LEFT JOIN companies c ON c.id=p.company_id LEFT JOIN users u ON u.id=p.user_id LEFT JOIN bookings b ON b.id=p.booking_id LEFT JOIN rooms r ON r.id=b.room_id`;
route('GET', '/api/admin/penalties', (req, res, ctx) => {
  const st = ctx.query.get('status');
  send(res, 200, db.prepare(`${PENALTY_SELECT} ${st ? 'WHERE p.status=?' : ''} ORDER BY p.id DESC LIMIT 1000`).all(...(st ? [st] : [])));
}, A);
route('PUT', '/api/admin/penalties/:id', (req, res, ctx) => {
  need(['da_addebitare', 'addebitata', 'annullata'].includes(ctx.body.status), 400, 'Stato non valido');
  db.prepare('UPDATE penalties SET status=?, note=?, updated_at=CURRENT_TIMESTAMP WHERE id=?').run(ctx.body.status, str(ctx.body.note, 500), +ctx.params.id);
  audit(ctx.user.id, 'penale_' + ctx.body.status, ctx.params.id); send(res, 200, { ok: true });
}, A);
route('GET', '/api/admin/penalties.csv', (req, res) => {
  const rows = db.prepare(`${PENALTY_SELECT} ORDER BY p.id DESC`).all();
  const head = ['ID', 'Registrata il', 'Azienda', 'Utente', 'Email', 'Sala', 'Data', 'Orario', 'Motivo', 'Importo', 'Stato', 'Note'];
  const lines = [head.join(';')].concat(rows.map((p) => [p.id, p.created_at, p.company_name, p.user_name, p.user_email, p.room_name, p.date, `${p.start}-${p.end}`, p.reason === 'cancellazione_tardiva' ? 'Annullamento tardivo' : 'Mancato utilizzo', String(p.amount.toFixed(2)).replace('.', ','), p.status, p.note].map(csvCell).join(';')));
  send(res, 200, '﻿' + lines.join('\r\n'), { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="penali.csv"' });
}, A);
route('GET', '/api/admin/outbox', (req, res) => {
  send(res, 200, { configured: mailer.isConfigured(), from: process.env.SMTP_FROM || process.env.SMTP_USER || '', rows: db.prepare('SELECT id,to_addr,subject,kind,status,attempts,last_error,created_at,sent_at FROM outbox ORDER BY id DESC LIMIT 300').all() });
}, A);
route('GET', '/api/admin/outbox/:id', (req, res, ctx) => {
  const m = db.prepare('SELECT id,to_addr,subject,html,status FROM outbox WHERE id=?').get(+ctx.params.id); need(m, 404, 'Email non trovata'); send(res, 200, m);
}, A);
route('POST', '/api/admin/outbox/:id/retry', (req, res, ctx) => { mailer.retry(+ctx.params.id); send(res, 200, { ok: true }); }, A);
route('POST', '/api/admin/test-email', (req, res, ctx) => {
  const to = str(ctx.body.to, 200) || ctx.user.email; need(EMAIL_RE.test(to), 400, 'Email non valida');
  sendMail(to, 'test', {}); send(res, 200, { ok: true, configured: mailer.isConfigured() });
}, A);
route('POST', '/api/admin/users/:id/resend-confirmation', (req, res, ctx) => {
  const u = db.prepare('SELECT u.*, c.name company_name FROM users u LEFT JOIN companies c ON c.id=u.company_id WHERE u.id=?').get(+ctx.params.id);
  need(u && !u.email_verified, 400, 'Questo utente ha già confermato');
  const token = crypto.randomBytes(24).toString('hex');
  db.prepare('UPDATE users SET verify_token=?, verify_expires=? WHERE id=?').run(token, Date.now() + VERIFY_HOURS * 3600e3, u.id);
  sendMail(u.email, 'confirmRegistration', { name: u.first_name || u.name, company: u.company_name || '', link: `${BASE()}/conferma.html?token=${token}`, hours: VERIFY_HOURS });
  send(res, 200, { ok: true });
}, A);

// ---------------------------------------------------------------- static
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8', '.pdf': 'application/pdf', '.jpg': 'image/jpeg' };
function serveStatic(req, res, pathname) {
  if (pathname === '/') pathname = '/index.html';
  if (pathname === '/display') pathname = '/display.html';
  if (pathname === '/admin') pathname = '/admin.html';
  if (pathname === '/registrazione') pathname = '/registrazione.html';
  const file = path.normalize(path.join(PUBLIC_DIR, pathname));
  if (!file.startsWith(PUBLIC_DIR)) return send(res, 403, 'Vietato');
  fs.readFile(file, (err, data) => {
    if (err) return send(res, 404, 'Pagina non trovata');
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' });
    res.end(data);
  });
}

// ---------------------------------------------------------------- server
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  try {
    rememberBase(req);
    if (!url.pathname.startsWith('/api/')) return serveStatic(req, res, url.pathname);
    const r = routes.find((x) => x.method === req.method && x.re.test(url.pathname));
    need(r, 404, 'Endpoint non trovato');
    const m = url.pathname.match(r.re);
    const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
    if (!['GET', 'HEAD'].includes(req.method)) {
      // protezione CSRF: le richieste che modificano dati devono essere JSON
      need((req.headers['content-type'] || '').includes('application/json') || req.method === 'DELETE', 415, 'Content-Type non valido');
    }
    const body = ['POST', 'PUT'].includes(req.method) ? await readBody(req) : {};
    const user = currentUser(req);
    if (!r.opts.public && !r.opts.optionalAuth) {
      need(user, 401, 'Sessione scaduta, effettua di nuovo l\'accesso');
      need(!user.must_change_password || r.opts.allowPwChange, 403, 'Devi cambiare la password prima di continuare');
      if (r.opts.admin) need(user.role === 'admin', 403, 'Funzione riservata all\'amministrazione');
    }
    await r.handler(req, res, { params, query: url.searchParams, body, user });
  } catch (e) {
    if (e instanceof HttpError) return send(res, e.status, { error: e.message });
    console.error(e);
    send(res, 500, { error: 'Errore interno del server' });
  }
});
server.listen(PORT, () => {
  console.log(`Gestionale Sale in ascolto su http://localhost:${PORT}  (fuso orario ${TZ})`);
  autoRelease();
});
module.exports = { server };
