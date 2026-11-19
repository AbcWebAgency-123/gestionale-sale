'use strict';
/*
 * Invio email via SMTP senza dipendenze esterne + coda persistente (tabella outbox).
 * Configurazione tramite variabili d'ambiente:
 *   SMTP_HOST, SMTP_PORT (465 = TLS implicito, 587 = STARTTLS), SMTP_USER, SMTP_PASS,
 *   SMTP_FROM (es. "CARDO Centro Uffici <noreply@ufficicardo.com>"), SMTP_SECURE=1 per forzare TLS
 */
const net = require('node:net');
const tls = require('node:tls');
const os = require('node:os');
const crypto = require('node:crypto');

const cfg = () => ({
  host: process.env.SMTP_HOST,
  port: parseInt(process.env.SMTP_PORT || '587', 10),
  user: process.env.SMTP_USER,
  pass: process.env.SMTP_PASS,
  from: process.env.SMTP_FROM || process.env.SMTP_USER,
  secure: process.env.SMTP_SECURE === '1' || process.env.SMTP_PORT === '465',
});
const isConfigured = () => !!(cfg().host && cfg().from);

const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');
const encHeader = (s) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${b64(s)}?=`);
const wrap76 = (s) => s.replace(/.{1,76}/g, '$&\r\n');
const addrOf = (s) => { const m = String(s).match(/<([^>]+)>/); return (m ? m[1] : String(s)).trim(); };
function encAddress(s) {
  const m = String(s).match(/^\s*"?([^"<]*)"?\s*<([^>]+)>\s*$/);
  return m && m[1].trim() ? `${encHeader(m[1].trim())} <${m[2].trim()}>` : addrOf(s);
}

function buildMessage({ from, to, subject, text, html, attachments = [], replyTo }) {
  const boundaryMix = 'mix_' + crypto.randomBytes(8).toString('hex');
  const boundaryAlt = 'alt_' + crypto.randomBytes(8).toString('hex');
  const domain = addrOf(from).split('@')[1] || 'localhost';
  const head = [
    `From: ${encAddress(from)}`,
    `To: ${[].concat(to).map(encAddress).join(', ')}`,
    `Subject: ${encHeader(subject)}`,
    `Date: ${new Date().toUTCString().replace('GMT', '+0000')}`,
    `Message-ID: <${crypto.randomUUID()}@${domain}>`,
    'MIME-Version: 1.0',
  ];
  if (replyTo) head.push(`Reply-To: ${encAddress(replyTo)}`);
  const alt = [
    `--${boundaryAlt}`, 'Content-Type: text/plain; charset=utf-8', 'Content-Transfer-Encoding: base64', '', wrap76(b64(text || '')),
    `--${boundaryAlt}`, 'Content-Type: text/html; charset=utf-8', 'Content-Transfer-Encoding: base64', '', wrap76(b64(html || text || '')),
    `--${boundaryAlt}--`, '',
  ].join('\r\n');
  if (!attachments.length) return head.concat([`Content-Type: multipart/alternative; boundary="${boundaryAlt}"`, '', alt]).join('\r\n');
  const parts = [`--${boundaryMix}`, `Content-Type: multipart/alternative; boundary="${boundaryAlt}"`, '', alt];
  for (const a of attachments) {
    const data = Buffer.isBuffer(a.content) ? a.content : Buffer.from(a.content, a.encoding || 'utf8');
    parts.push(`--${boundaryMix}`, `Content-Type: ${a.contentType || 'application/octet-stream'}; name="${encHeader(a.filename)}"`,
      'Content-Transfer-Encoding: base64', `Content-Disposition: attachment; filename="${encHeader(a.filename)}"`, '', wrap76(data.toString('base64')));
  }
  parts.push(`--${boundaryMix}--`, '');
  return head.concat([`Content-Type: multipart/mixed; boundary="${boundaryMix}"`, '', parts.join('\r\n')]).join('\r\n');
}

/* Dialogo SMTP minimale: EHLO, STARTTLS, AUTH PLAIN/LOGIN, MAIL, RCPT, DATA */
function smtpSend(msg) {
  const c = cfg();
  return new Promise((resolve, reject) => {
    let sock; let buf = ''; let waiter = null; let done = false;
    const timer = setTimeout(() => fail(new Error('Timeout SMTP')), 45000);
    const fail = (e) => { if (done) return; done = true; clearTimeout(timer); try { sock.destroy(); } catch { /* */ } reject(e); };
    const onData = (d) => {
      buf += d.toString('utf8');
      if (!waiter) return;
      const lines = buf.split('\r\n');
      for (let i = 0; i < lines.length - 1; i++) {
        if (/^\d{3} /.test(lines[i])) {
          const reply = lines.slice(0, i + 1).join('\n'); buf = lines.slice(i + 1).join('\r\n');
          const w = waiter; waiter = null; if (w) w(reply); return onData('');
        }
      }
    };
    const read = () => new Promise((r) => { waiter = r; if (buf) onData(''); });
    const attach = (s) => { s.on('data', onData); s.on('error', fail); s.on('close', () => { if (!done) fail(new Error('Connessione SMTP chiusa')); }); };
    const cmd = async (line, expect) => {
      if (line != null) sock.write(line + '\r\n');
      const r = await read();
      if (expect && !expect.includes(parseInt(r.slice(0, 3), 10))) throw new Error(`SMTP: ${line ? line.split(' ')[0] : 'saluto'} → ${r}`);
      return r;
    };
    const run = async () => {
      await cmd(null, [220]);
      const name = os.hostname() || 'localhost';
      let ehlo = await cmd(`EHLO ${name}`, [250]);
      if (!c.secure && /STARTTLS/i.test(ehlo)) {
        await cmd('STARTTLS', [220]);
        sock.removeAllListeners('data'); sock.removeAllListeners('close'); sock.removeAllListeners('error');
        sock = tls.connect({ socket: sock, servername: c.host }); attach(sock);
        await new Promise((r, j) => { sock.once('secureConnect', r); sock.once('error', j); });
        ehlo = await cmd(`EHLO ${name}`, [250]);
      }
      if (c.user) {
        if (/AUTH[^\n]*PLAIN/i.test(ehlo)) await cmd(`AUTH PLAIN ${Buffer.from(`\0${c.user}\0${c.pass || ''}`).toString('base64')}`, [235]);
        else { await cmd('AUTH LOGIN', [334]); await cmd(Buffer.from(c.user).toString('base64'), [334]); await cmd(Buffer.from(c.pass || '').toString('base64'), [235]); }
      }
      await cmd(`MAIL FROM:<${addrOf(c.from)}>`, [250]);
      for (const t of [].concat(msg.to)) await cmd(`RCPT TO:<${addrOf(t)}>`, [250, 251]);
      await cmd('DATA', [354]);
      const body = buildMessage({ ...msg, from: c.from }).replace(/\r?\n/g, '\r\n').replace(/^\./gm, '..');
      sock.write(body + '\r\n.\r\n');
      await cmd(null, [250]);
      try { sock.write('QUIT\r\n'); } catch { /* */ }
      done = true; clearTimeout(timer); sock.end(); resolve();
    };
    sock = c.secure ? tls.connect({ host: c.host, port: c.port, servername: c.host }) : net.connect({ host: c.host, port: c.port });
    attach(sock);
    sock.once(c.secure ? 'secureConnect' : 'connect', () => run().catch(fail));
  });
}

/* Coda persistente */
function createMailer(db, { log = console } = {}) {
  db.exec(`CREATE TABLE IF NOT EXISTS outbox (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    to_addr TEXT NOT NULL, subject TEXT NOT NULL, text TEXT, html TEXT, attachments TEXT,
    kind TEXT DEFAULT '', status TEXT NOT NULL DEFAULT 'in_coda', attempts INTEGER NOT NULL DEFAULT 0,
    last_error TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP, sent_at TEXT
  )`);
  let running = false;
  const queue = ({ to, subject, text, html, attachments = [], kind = '' }) => {
    const att = attachments.map((a) => ({ filename: a.filename, contentType: a.contentType, content: (Buffer.isBuffer(a.content) ? a.content : Buffer.from(a.content)).toString('base64') }));
    const r = db.prepare('INSERT INTO outbox(to_addr,subject,text,html,attachments,kind) VALUES (?,?,?,?,?,?)').run([].concat(to).join(','), subject, text || '', html || '', JSON.stringify(att), kind);
    setTimeout(flush, 50);
    return Number(r.lastInsertRowid);
  };
  async function flush() {
    if (running || !isConfigured()) return;
    running = true;
    try {
      const rows = db.prepare(`SELECT * FROM outbox WHERE status IN ('in_coda','errore') AND attempts < 6 ORDER BY id LIMIT 20`).all();
      for (const m of rows) {
        // attesa crescente tra un tentativo e l'altro
        if (m.attempts > 0 && m.status === 'errore') {
          const last = db.prepare('SELECT strftime(\'%s\',\'now\') - strftime(\'%s\', COALESCE(sent_at, created_at)) d FROM outbox WHERE id=?').get(m.id).d;
          if (last < 60 * 2 ** m.attempts) continue;
        }
        try {
          const attachments = JSON.parse(m.attachments || '[]').map((a) => ({ ...a, content: Buffer.from(a.content, 'base64') }));
          await smtpSend({ to: m.to_addr.split(','), subject: m.subject, text: m.text, html: m.html, attachments });
          db.prepare(`UPDATE outbox SET status='inviata', attempts=attempts+1, sent_at=CURRENT_TIMESTAMP, last_error=NULL WHERE id=?`).run(m.id);
        } catch (e) {
          db.prepare(`UPDATE outbox SET status='errore', attempts=attempts+1, last_error=?, sent_at=CURRENT_TIMESTAMP WHERE id=?`).run(String(e.message).slice(0, 500), m.id);
          log.error(`Email ${m.id} a ${m.to_addr} non inviata: ${e.message}`);
        }
      }
    } finally { running = false; }
  }
  setInterval(flush, 30 * 1000).unref();
  setTimeout(flush, 2000).unref();
  return { queue, flush, isConfigured, smtpSend, retry: (id) => { db.prepare(`UPDATE outbox SET status='in_coda', attempts=0 WHERE id=?`).run(id); setTimeout(flush, 50); } };
}

module.exports = { createMailer, buildMessage, isConfigured };
