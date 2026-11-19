# Gestionale Sale Riunioni

Applicazione web per prenotare le **5 sale riunioni condivise** di uno stabile con molte aziende (pensata per 60, ma senza limiti).

- Gli utenti delle aziende prenotano **dal proprio ufficio**, da PC o smartphone, tramite browser.
- Accanto a ogni sala un **tablet** mostra in tempo reale se è libera o occupata, la riunione in corso e il programma della giornata.
- Un **display atrio** opzionale mostra lo stato di tutte le sale in un'unica schermata.
- Prenotazioni **dal lunedì al venerdì, dalle 08:00 alle 18:00** (orari modificabili), festività nazionali già inserite.

Nessun database esterno e nessuna libreria da installare: basta Node.js 22 (oppure Docker).

---

## 1. Installazione

### Opzione A — Docker (consigliata)

```bash
docker compose up -d
docker compose logs sale     # qui trovi la password iniziale dell'amministratore
```

L'applicazione risponde su `http://<indirizzo-del-server>:3000`. I dati sono salvati nella cartella `./data`.

### Opzione B — Node.js

Serve Node.js **22.13 o superiore**.

```bash
npm start
```

Variabili d'ambiente utili:

| Variabile | Default | Significato |
|---|---|---|
| `PORT` | `3000` | Porta HTTP |
| `DATA_DIR` | `./data` | Cartella del database (`sale.db`) |
| `TIMEZONE` | `Europe/Rome` | Fuso orario dello stabile |
| `ADMIN_EMAIL` | `admin@sale.local` | Email dell'amministratore creato al primo avvio |
| `ADMIN_PASSWORD` | generata | Password iniziale dell'amministratore (se omessa viene stampata nei log) |
| `COOKIE_SECURE` | — | Impostare `1` quando il sito è in HTTPS |
| `SEED_DEMO` | — | Impostare `1` per caricare 60 aziende e prenotazioni di prova |

**Prova rapida con dati demo:** `npm run demo`, poi accedi con `referente@alfaconsulting.it` / `demo1234`.
Non usare i dati demo in produzione: cancella la cartella `data` prima di partire davvero.

### Dove installarlo

- **Server/PC nello stabile** (anche un mini-PC o un NAS con Docker): i tablet e gli uffici lo raggiungono dalla rete interna.
- **Hosting cloud** (VPS, Railway, Render, Fly.io…): raggiungibile anche da casa/smartphone. In questo caso mettilo dietro **HTTPS** (es. Caddy o Nginx come reverse proxy) e imposta `COOKIE_SECURE=1`.

Esempio di Caddyfile per HTTPS automatico:

```
sale.tuostabile.it {
    reverse_proxy localhost:3000
}
```

---

## 2. Primo avvio (amministrazione dello stabile)

1. Accedi con l'email dell'amministratore e la password mostrata nei log; ti verrà chiesto di sceglierne una nuova.
2. **Amministrazione → Sale e display**: rinomina le 5 sale, indica capienza, piano, dotazioni e colore.
3. **Amministrazione → Aziende / Utenti → Importa da CSV**: carica le 60 aziende e i loro utenti in un colpo solo (vedi `esempio-import.csv`). Al termine scarichi un CSV con le **password temporanee** da consegnare a ciascuno.
4. **Regole e impostazioni**: scegli durata massima, anticipo massimo, limiti per azienda, check-in, privacy.
5. **Chiusure e festività**: aggiungi patrono, chiusure estive o natalizie.
6. Configura i tablet (sezione 3).

### Formato CSV di importazione

```
azienda;nome;email;ruolo
Alfa Srl;Mario Rossi;mario.rossi@alfa.it;referente
Alfa Srl;Laura Bianchi;laura.bianchi@alfa.it;utente
```

Separatore `;` o `,`. Il ruolo può essere `referente` o `utente`. Una riga con solo il nome dell'azienda crea l'azienda senza utenti.

### Ruoli

| Ruolo | Cosa può fare |
|---|---|
| **Utente** | Prenota, modifica e annulla le **proprie** prenotazioni |
| **Referente aziendale** | Come l'utente, più gestire **tutte** le prenotazioni della propria azienda |
| **Amministratore** | Gestisce tutto lo stabile, può prenotare per conto di un'azienda e superare i limiti |

---

## 3. Tablet accanto alle sale

Ogni sala ha un **link personale** (Amministrazione → Sale e display → *Copia*).

1. Usa un tablet qualsiasi (Android economico o iPad) con supporto a parete e alimentazione fissa.
2. Apri il link della sala nel browser.
3. Bloccalo sulla pagina:
   - **Android**: app *Fully Kiosk Browser* (imposta il link come Start URL, attiva "Keep screen on").
   - **iPad**: Impostazioni → Accessibilità → *Accesso guidato*, poi apri Safari sul link; Impostazioni → Schermo → Blocco automatico: *Mai*.
4. Il display si aggiorna da solo appena qualcuno prenota o annulla (e comunque ogni 20 secondi).

Colori del display: **verde** libera · **arancione** riunione in arrivo entro 15 minuti · **rosso** occupata · **grigio** chiusa/fuori orario.

Dal tablet si può:
- **Conferma presenza** (se il check-in è attivo): se nessuno conferma entro N minuti dall'inizio, la sala torna libera automaticamente.
- **Libera la sala ora**: chiude in anticipo la riunione e rende la sala di nuovo prenotabile.

Se un tablet viene rubato o perso, premi **Rigenera link**: il vecchio indirizzo smette di funzionare.

Il **display atrio** (link nella stessa pagina) mostra tutte le sale insieme: ideale per uno schermo TV all'ingresso.

---

## 4. Regole di prenotazione applicate

- Solo lunedì–venerdì, nell'orario di apertura, esclusi i giorni di chiusura.
- Orari a blocchi di 30 minuti (configurabile 15/30/60).
- Nessuna sovrapposizione nella stessa sala.
- Niente prenotazioni nel passato.
- Durata massima e anticipo massimo configurabili.
- Opzionali: numero massimo di prenotazioni attive per azienda, **monte ore mensile** per singola azienda.
- Prenotazioni ricorrenti settimanali: le date non disponibili vengono saltate e segnalate.
- Annullando una riunione già iniziata, la sala viene chiusa in quel momento (resta nello storico).

Ogni prenotazione si può aggiungere al proprio calendario (Outlook, Google, Apple) con il pulsante **Calendario** (file .ics).

---

## 5. Report, backup e sicurezza

- **Panoramica**: occupazione per sala, ore per azienda, mancati check-in, mese per mese. **Esporta CSV** per la contabilità o il riaddebito.
- **Backup dati**: scarica una copia completa del database. In alternativa copia periodicamente `data/sale.db` (es. con un cron notturno).
- **Registro attività**: chi ha creato, modificato o annullato cosa, utile in caso di contestazioni.
- Password salvate in forma cifrata (scrypt), sessioni con cookie HttpOnly, blocco dopo troppi tentativi di accesso falliti.

Per ripristinare un backup: ferma l'applicazione, sostituisci `data/sale.db` con il file di backup, riavvia.

---

## 6. Novità: registrazione, monte ore, palestra, penali

### Email (obbligatorie per la registrazione)
Il gestionale invia email per: conferma iscrizione, credenziali, conferma prenotazione (con file calendario), promemoria 24 ore prima, penali, modulo palestra e relativo esito, recupero password.
Configura queste variabili d'ambiente (su Railway: servizio → Variables):

| Variabile | Esempio |
|---|---|
| `SMTP_HOST` | `smtp.tuoprovider.it` |
| `SMTP_PORT` | `587` (STARTTLS) oppure `465` (SSL) |
| `SMTP_USER` | `noreply@ufficicardo.com` |
| `SMTP_PASS` | password della casella o "password per app" |
| `SMTP_FROM` | `CARDO Centro Uffici <noreply@ufficicardo.com>` |
| `PUBLIC_URL` | `https://sale.ufficicardo.com` (facoltativo: indirizzo usato nei link delle email) |

Finché l'SMTP non è configurato le email restano in coda (Amministrazione → Email inviate) e partono da sole appena lo configuri.
Gmail/Google Workspace: `smtp.gmail.com`, porta 465, con una "password per le app". Microsoft 365: `smtp.office365.com`, porta 587.

### Registrazione autonoma
Pagina `/registrazione`: nome, cognome, azienda, email. L'utente riceve un link di conferma (valido 48 ore); cliccandolo l'account si attiva e riceve via email la password generata dal sistema. Se l'azienda esiste già (anche scritta in modo leggermente diverso, es. "Alfa S.r.l." / "ALFA srl") l'utente viene aggiunto ai colleghi; altrimenti l'azienda viene creata e il primo iscritto diventa referente.

### Monte ore
Ogni azienda ha 10 ore di sala riunioni al mese (modificabile in Regole e impostazioni o per singola azienda). Superata la soglia non può più prenotare fino al mese successivo. Il contatore è visibile in alto nel calendario. La palestra non scala dal monte ore.

### Promemoria e penali
- Promemoria via email 24 ore prima di ogni prenotazione.
- Check-in obbligatorio sul tablet entro 15 minuti dall'inizio: senza check-in la prenotazione viene liberata e si registra una **penale per mancato utilizzo**.
- Annullare con meno di 24 ore di preavviso registra una **penale per annullamento tardivo**.
- Importo e preavviso si impostano in Regole e impostazioni. Le penali si gestiscono in Amministrazione → Penali (segna addebitata / annulla, esporta CSV).

### Palestra
Una sala può essere impostata come **Palestra** (Sale e display → Modifica → Tipo). Si prenota un'ora alla volta indicando Uomo o Donna; regola predefinita: massimo 1 uomo + 1 donna per ora.
Alla prima prenotazione l'utente scarica il modulo di responsabilità, lo firma e lo carica: il file viene inviato automaticamente a info@ufficicardo.com (modificabile) e compare in Amministrazione → Palestra e moduli, dove va approvato. Dopo l'approvazione l'utente riceve un'email e può prenotare.
Il modello di modulo incluso è una bozza standard: fallo verificare dal vostro legale o caricate il vostro PDF dalla stessa pagina.

---

## Struttura del progetto

```
server.js          server, database, regole e API
lib/mailer.js      invio email SMTP con coda e tentativi automatici
lib/templates.js   modelli delle email
public/registrazione.html, conferma.html   iscrizione e conferma
public/modulo-palestra.pdf                 modello del modulo di responsabilità
public/
  index.html       accesso e prenotazione per gli utenti
  app.js
  admin.html       pannello di amministrazione
  admin.js
  display.html     schermata per i tablet (sala singola o atrio)
  display.js
  common.js        funzioni condivise
  style.css        stile grafico
Dockerfile, docker-compose.yml
esempio-import.csv
```
