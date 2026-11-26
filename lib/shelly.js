'use strict';
// Apertura porte tramite Shelly Cloud Control API.
// Configurazione (variabili d'ambiente, mai nel browser):
//   SHELLY_SERVER    es. shelly-123-eu.shelly.cloud  (da app Shelly → Impostazioni utente → Chiave di autorizzazione cloud)
//   SHELLY_AUTH_KEY  la chiave di autorizzazione cloud
// Il cloud accetta circa una richiesta al secondo: le chiamate vengono messe in fila.

const SPACING_MS = 1100;
let chain = Promise.resolve();
let last = 0;

function config() {
  const raw = String(process.env.SHELLY_SERVER || '').trim().replace(/\/+$/, '');
  const key = String(process.env.SHELLY_AUTH_KEY || '').trim();
  if (!raw || !key) return null;
  const base = /^https?:\/\//.test(raw) ? raw : `https://${raw}`;
  return { base, key };
}
const configured = () => !!config();

function queued(fn) {
  const run = chain.then(async () => {
    const wait = last + SPACING_MS - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    last = Date.now();
    return fn();
  });
  chain = run.catch(() => {});
  return run;
}

async function relay(deviceId, channel, turn) {
  const cfg = config();
  if (!cfg) throw new Error('Apertura porte non configurata (manca la chiave Shelly Cloud)');
  return queued(async () => {
    const body = new URLSearchParams({ id: String(deviceId), channel: String(channel || 0), turn, auth_key: cfg.key });
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 9000);
    let res, text;
    try {
      res = await fetch(`${cfg.base}/device/relay/control`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body, signal: ctrl.signal });
      text = await res.text();
    } catch (e) {
      throw new Error(e.name === 'AbortError' ? 'Il cloud Shelly non risponde: riprova tra qualche secondo' : 'Impossibile contattare il cloud Shelly');
    } finally { clearTimeout(t); }
    let j = null; try { j = JSON.parse(text); } catch { /* risposta non JSON */ }
    if (!res.ok || !j || j.isok !== true) {
      const err = j && j.errors ? Object.entries(j.errors).map(([k, v]) => `${k}: ${v}`).join('; ') : `HTTP ${res.status}`;
      if (/offline|not_online|device_not_found/i.test(err)) throw new Error('La serratura risulta offline: avvisa la reception');
      if (/unauthorized|auth/i.test(err)) throw new Error('Chiave Shelly Cloud non valida o scaduta');
      throw new Error(`Comando non riuscito (${err})`);
    }
    return j;
  });
}

// Apre la porta: impulso "on" e, se richiesto, "off" dopo pulseSec secondi
async function openDoor(deviceId, channel, pulseSec = 0) {
  await relay(deviceId, channel, 'on');
  if (pulseSec > 0) setTimeout(() => relay(deviceId, channel, 'off').catch((e) => console.error('Shelly off:', e.message)), pulseSec * 1000);
  return true;
}

module.exports = { configured, openDoor };
