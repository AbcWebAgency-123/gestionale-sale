'use strict';
/* Modelli delle email (HTML con stili in linea, compatibili con i principali client) */
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const GIORNI = ['domenica', 'lunedì', 'martedì', 'mercoledì', 'giovedì', 'venerdì', 'sabato'];
const MESI = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];
const dateLong = (d) => { const x = new Date(d + 'T12:00:00Z'); return `${GIORNI[x.getUTCDay()]} ${x.getUTCDate()} ${MESI[x.getUTCMonth()]} ${x.getUTCFullYear()}`; };
const euro = (n) => `${Number(n || 0).toFixed(2).replace('.', ',')} €`;

function layout({ base, building, title, intro, blocks = [], cta, outro }) {
  const logo = base ? `<img src="${esc(base)}/brand/logo-bianco.png" alt="${esc(building)}" height="44" style="display:block;height:44px;border:0">` : `<span style="color:#fff;font:700 22px Georgia,serif">${esc(building)}</span>`;
  const blocksHtml = blocks.map((b) => (b.rows
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:18px 0;background:#f6f4ef;border-radius:12px;border-left:4px solid ${b.color || '#0a615f'}"><tr><td style="padding:16px 20px">${b.heading ? `<div style="font:700 17px Georgia,serif;color:#074b49;margin-bottom:8px">${esc(b.heading)}</div>` : ''}${b.rows.map(([k, v]) => `<div style="font:14px/1.6 Arial,sans-serif;color:#13201f"><span style="color:#6b7775">${esc(k)}:</span> <b>${esc(v)}</b></div>`).join('')}</td></tr></table>`
    : `<p style="font:15px/1.6 Arial,sans-serif;color:#13201f;margin:0 0 14px">${b.html ?? esc(b.text)}</p>`)).join('');
  const ctaHtml = cta ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0"><tr><td style="background:#a7406b;border-radius:10px"><a href="${esc(cta.url)}" style="display:inline-block;padding:14px 26px;font:700 15px Arial,sans-serif;color:#ffffff;text-decoration:none">${esc(cta.label)}</a></td></tr></table><p style="font:12px/1.5 Arial,sans-serif;color:#8b9593;margin:0 0 14px">Se il pulsante non funziona, copia questo indirizzo nel browser:<br><a href="${esc(cta.url)}" style="color:#0a615f;word-break:break-all">${esc(cta.url)}</a></p>` : '';
  const html = `<!doctype html><html lang="it"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>
<body style="margin:0;padding:0;background:#efebe3">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#efebe3"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:16px;overflow:hidden">
<tr><td style="background:#0a615f;padding:22px 28px;border-bottom:3px solid #a7406b">${logo}</td></tr>
<tr><td style="padding:30px 28px 10px">
<h1 style="font:700 26px/1.2 Georgia,'Times New Roman',serif;color:#074b49;margin:0 0 16px">${esc(title)}</h1>
${intro ? `<p style="font:15px/1.6 Arial,sans-serif;color:#13201f;margin:0 0 14px">${intro}</p>` : ''}
${blocksHtml}${ctaHtml}
${outro ? `<p style="font:14px/1.6 Arial,sans-serif;color:#4a5856;margin:0 0 14px">${outro}</p>` : ''}
</td></tr>
<tr><td style="padding:18px 28px 26px;border-top:1px solid #efebe3;font:12px/1.5 Arial,sans-serif;color:#8b9593">${esc(building)} · Sale riunioni<br>Email automatica, non rispondere a questo messaggio.</td></tr>
</table></td></tr></table></body></html>`;
  const strip = (h) => String(h || '').replace(/<br\s*\/?>/g, '\n').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  const text = [title, '', strip(intro),
    ...blocks.map((b) => (b.rows ? [(b.heading || ''), ...b.rows.map(([k, v]) => `${k}: ${v}`)].join('\n') : strip(b.html ?? b.text))),
    cta ? `${cta.label}: ${cta.url}` : '', strip(outro), '', `${building} · Sale riunioni`].filter((x) => x !== undefined).join('\n\n');
  return { html, text };
}

const T = {
  confirmRegistration: ({ base, building, name, company, link, hours }) => ({
    subject: `Conferma la tua iscrizione — ${building}`,
    ...layout({ base, building, title: 'Conferma la tua iscrizione',
      intro: `Ciao ${esc(name)}, grazie per esserti registrato al sistema di prenotazione delle sale di ${esc(building)} per <b>${esc(company)}</b>.`,
      blocks: [{ text: "Per prima cosa conferma il tuo indirizzo email cliccando sul pulsante qui sotto. L'amministrazione dello stabile verificherà poi la richiesta: appena approvata riceverai una seconda email con la password per accedere." }],
      cta: { label: 'Conferma iscrizione', url: link },
      outro: `Il link è valido ${hours} ore. Se non hai richiesto tu l'iscrizione, ignora questa email.` }),
  }),
  welcome: ({ base, building, name, company, email, password, quota }) => ({
    subject: `Iscrizione confermata — le tue credenziali`,
    ...layout({ base, building, title: 'Benvenuto!',
      intro: `Ciao ${esc(name)}, la tua iscrizione per <b>${esc(company)}</b> è confermata. Ecco le credenziali per accedere:`,
      blocks: [{ heading: 'Le tue credenziali', rows: [['Indirizzo', base || ''], ['Email', email], ['Password', password]] },
        { text: `Puoi cambiare la password in qualsiasi momento dal menu in alto a destra.${quota != null ? ` La tua azienda ha a disposizione ${quota} ore di sala al mese.` : ''}` }],
      cta: base ? { label: 'Accedi e prenota', url: base } : null,
      outro: 'Conserva questa email in un posto sicuro e non inoltrarla.' }),
  }),
  passwordReset: ({ base, building, name, link }) => ({
    subject: `Nuova password — ${building}`,
    ...layout({ base, building, title: 'Richiesta di nuova password',
      intro: `Ciao ${esc(name)}, abbiamo ricevuto una richiesta per generare una nuova password.`,
      cta: { label: 'Genera una nuova password', url: link },
      outro: "Il link è valido 2 ore. Se non l'hai richiesta tu, ignora questa email: la password attuale resta valida." }),
  }),
  newPassword: ({ base, building, name, email, password }) => ({
    subject: `La tua nuova password — ${building}`,
    ...layout({ base, building, title: 'Ecco la tua nuova password',
      intro: `Ciao ${esc(name)}, la password del tuo account è stata rigenerata.`,
      blocks: [{ heading: 'Credenziali', rows: [['Email', email], ['Password', password]] }],
      cta: base ? { label: 'Accedi', url: base } : null }),
  }),
  bookingConfirmed: ({ base, building, name, room, title, dates, start, end, gym, gender, notice, penalty }) => ({
    subject: `${gym ? 'Palestra prenotata' : 'Prenotazione confermata'}: ${room}, ${dates.length > 1 ? dates.length + ' date' : dateLong(dates[0])} ${start}`,
    ...layout({ base, building, title: gym ? 'Palestra prenotata' : 'Prenotazione confermata',
      intro: `Ciao ${esc(name)}, la tua prenotazione è registrata.`,
      blocks: [{ heading: room, rows: [...(gym ? [['Accesso', gender === 'F' ? 'Donna' : 'Uomo']] : [['Riunione', title]]), ['Orario', `${start} – ${end}`], ...dates.map((d, i) => [dates.length > 1 ? `Data ${i + 1}` : 'Data', dateLong(d)])] },
        { text: `Riceverai un promemoria 24 ore prima. All'arrivo conferma la presenza sul tablet davanti alla ${gym ? 'palestra' : 'sala'}.` },
        ...(penalty ? [{ html: `<b>Importante:</b> se non ti serve più, annulla almeno <b>${notice} ore prima</b>. In caso di mancato utilizzo o annullamento tardivo verrà addebitata una penale di <b>${euro(penalty)}</b>.` }] : [])],
      cta: base ? { label: 'Gestisci le tue prenotazioni', url: `${base}/#mie` } : null }),
  }),
  reminder: ({ base, building, name, room, title, date, start, end, gym, notice, penalty }) => ({
    subject: `Promemoria: domani ${start} — ${room}`,
    ...layout({ base, building, title: 'Promemoria prenotazione',
      intro: `Ciao ${esc(name)}, ti ricordiamo la prenotazione di domani.`,
      blocks: [{ heading: room, rows: [...(gym ? [] : [['Riunione', title]]), ['Data', dateLong(date)], ['Orario', `${start} – ${end}`]] },
        { text: `Al tuo arrivo conferma la presenza sul tablet davanti alla ${gym ? 'palestra' : 'sala'}.` },
        ...(penalty ? [{ html: `Se non ti serve più, annullala subito dalla piattaforma: in caso di mancato utilizzo è prevista una penale di <b>${euro(penalty)}</b>.` }] : [])],
      cta: base ? { label: 'Vedi o annulla la prenotazione', url: `${base}/#mie` } : null }),
  }),
  penalty: ({ base, building, name, company, room, date, start, end, reason, amount }) => ({
    subject: `Penale per ${reason === 'cancellazione_tardiva' ? 'annullamento tardivo' : 'mancato utilizzo'} — ${room} ${dateLong(date)}`,
    ...layout({ base, building, title: 'Comunicazione penale',
      intro: `Ciao ${esc(name)}, ti informiamo che è stata registrata una penale a carico di <b>${esc(company)}</b>.`,
      blocks: [{ heading: room, color: '#a7406b', rows: [['Data', dateLong(date)], ['Orario', `${start} – ${end}`], ['Motivo', reason === 'cancellazione_tardiva' ? 'Annullamento senza il preavviso richiesto' : 'Prenotazione non utilizzata (nessuna conferma di presenza al tablet)'], ['Importo', euro(amount)]] },
        { text: "Se ritieni che si tratti di un errore, contatta l'amministrazione dello stabile." }] }),
  }),
  waiverToOffice: ({ base, building, name, email, company, gender, uploaded }) => ({
    subject: `Modulo palestra firmato — ${name} (${company})`,
    ...layout({ base, building, title: 'Nuovo modulo di responsabilità palestra',
      intro: 'Un utente ha caricato il modulo di responsabilità firmato per accedere alla palestra. Il documento è allegato a questa email.',
      blocks: [{ heading: 'Dati utente', rows: [['Nome', name], ['Email', email], ['Azienda', company], ['Accesso', gender === 'F' ? 'Donna' : 'Uomo'], ['Caricato il', uploaded]] },
        { text: "Dopo aver verificato il modulo, approvalo dalla piattaforma: l'utente riceverà una email e potrà prenotare." }],
      cta: base ? { label: 'Approva o rifiuta', url: `${base}/admin.html#palestra` } : null }),
  }),
  waiverDecision: ({ base, building, name, approved, note }) => ({
    subject: approved ? 'Palestra: modulo approvato, puoi prenotare' : 'Palestra: modulo da ricaricare',
    ...layout({ base, building, title: approved ? 'Puoi prenotare la palestra' : 'Il modulo non è stato approvato',
      intro: approved ? `Ciao ${esc(name)}, il tuo modulo di responsabilità è stato approvato. Da ora puoi prenotare la palestra.` : `Ciao ${esc(name)}, il modulo di responsabilità che hai caricato non è stato approvato.`,
      blocks: note ? [{ heading: 'Nota dell\'amministrazione', rows: [['Nota', note]] }] : [],
      cta: base ? { label: approved ? 'Prenota la palestra' : 'Carica di nuovo il modulo', url: base } : null }),
  }),
  registrationPending: ({ base, building, name, company }) => ({
    subject: `Iscrizione ricevuta, in attesa di approvazione — ${building}`,
    ...layout({ base, building, title: 'Email confermata',
      intro: `Ciao ${esc(name)}, grazie: il tuo indirizzo email è confermato.`,
      blocks: [{ html: `La richiesta di iscrizione per <b>${esc(company)}</b> è ora all'esame dell'amministrazione dello stabile. Appena sarà approvata riceverai una email con la password per accedere e prenotare le sale.` }],
      outro: 'Non devi fare altro: ti scriveremo noi.' }),
  }),
  registrationRejected: ({ base, building, name, company, note }) => ({
    subject: `Richiesta di iscrizione non approvata — ${building}`,
    ...layout({ base, building, title: 'Iscrizione non approvata',
      intro: `Ciao ${esc(name)}, la richiesta di iscrizione per <b>${esc(company)}</b> non è stata approvata dall'amministrazione dello stabile.`,
      blocks: note ? [{ heading: "Nota dell'amministrazione", rows: [['Nota', note]] }] : [],
      outro: "Per informazioni contatta la reception dello stabile." }),
  }),
  adminApprovalNeeded: ({ base, building, name, email, company, newCompany }) => ({
    subject: `Iscrizione da approvare: ${name} (${company})`,
    ...layout({ base, building, title: 'Nuova iscrizione da approvare',
      intro: "Un utente ha confermato la sua email e attende l'approvazione per poter accedere e prenotare.",
      blocks: [{ rows: [['Nome', name], ['Email', email], ['Azienda', company + (newCompany ? ' (nuova azienda)' : '')]] }],
      cta: base ? { label: 'Approva o rifiuta', url: `${base}/admin.html#iscrizioni` } : null }),
  }),
  adminNewUser: ({ base, building, name, email, company, newCompany }) => ({
    subject: `Nuova iscrizione: ${name} (${company})`,
    ...layout({ base, building, title: 'Nuova iscrizione confermata',
      blocks: [{ rows: [['Nome', name], ['Email', email], ['Azienda', company + (newCompany ? ' (nuova azienda)' : '')]] }],
      cta: base ? { label: 'Vedi utenti', url: `${base}/admin.html#utenti` } : null }),
  }),
  test: ({ base, building }) => ({ subject: `Email di prova — ${building}`, ...layout({ base, building, title: 'Funziona!', intro: "Se leggi questa email, l'invio dal gestionale sale è configurato correttamente." }) }),
};

module.exports = { T, dateLong, euro };
