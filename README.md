# Lo Scout — quaderno privato di scoperte

Scout personale di auto, moto, gommoni e altri mezzi: un flusso di schede fotografiche costruite su **annunci reali**, con una motivazione leggibile, reazioni che affinano il profilo dei gusti e approfondimenti che si aprono solo su richiesta esplicita.

## Aprirlo

Serve Node.js 20 o più recente (22.21+ se il computer esce su Internet tramite proxy).

```bash
npm install
```

```bash
node server.js
```

Poi apri `http://localhost:4173`. Senza parola d'accesso il sito risponde **solo** dal computer su cui gira.

**Dal telefono (stessa rete Wi‑Fi):** avvia con una parola d'accesso; il server si apre alla rete locale e chiede l'accesso.

```bash
SCOUT_PASSWORD='scegli-una-frase' node server.js
```

Sul telefono apri `http://INDIRIZZO-DEL-COMPUTER:4173` (es. `http://192.168.1.20:4173`). Per usarlo fuori casa serve metterlo su un piccolo server o dietro un tunnel con HTTPS: non è incluso.

**App installabile:** quando il sito è servito in HTTPS (o da `localhost`) il browser offre "Installa app" / "Aggiungi a schermata Home": si apre a tutto schermo con la sua icona. Resta un'interfaccia verso il server: i dati non vengono copiati sul telefono e a server spento l'app lo dichiara.

**Note AI personalizzate (facoltative):** la chiave resta sul server, mai nel browser.

```bash
ANTHROPIC_API_KEY='la-tua-chiave' node server.js
```

Altre variabili: `PORT` (default 4173), `SCOUT_DATA_DIR` (cartella dell'archivio, default `data/`), `SCOUT_AI_MODEL` (default `claude-opus-5-5`).

## Vetrina online nel Faldone

Una copia di consultazione dello Scout è su https://faldone.rinaldi.build/scout/: stessa interfaccia e stessa logica (i file di `lib/` girano nel browser), archivio pubblicato cifrato. Lì non si cercano nuovi annunci e non ci sono note AI: serve questo server. La vetrina si aggiorna dal repository del Faldone con `tools/scout-vetrina.mjs` (vedi `docs/scout.md` del Faldone). Se cambiano in `public/app.js` la funzione `api()`, il collegamento a `/api/export` o la registrazione di `/sw.js`, va aggiornato anche quello strumento.

## Dove stanno i dati

Tutto in `data/scout.json` (creato al primo avvio, escluso da Git): schede, reazioni e motivi, profilo, approfondimenti, registro delle ricerche. Per un backup copia il file o usa *Fonti → Scarica una copia dell'archivio*. Le fotografie **non** vengono copiate: restano sul sito dell'annuncio.

Al primo avvio l'archivio parte da `seed/`: il profilo ricavato dal brief e 22 schede su annunci reali, aperti e verificati dal server il 14/11/2026 (pagina letta + prima foto raggiunta). Non ci sono dati dimostrativi. Quegli annunci scadranno: *Idee conservate → Ricontrolla tutte le fonti* li sposta in archivio quando spariscono.

## Cosa funziona davvero

- **Scoperte**: flusso di schede con foto dell'esemplare, titolo‑idea, "Perché te lo mostro", "Il progetto che ci vedo", dati dell'annuncio, impegno indicativo, dubbio dello scout, stato della fonte con data dell'ultimo controllo. Filtri per categoria e impegno; prezzo e distanza facoltativi.
- **Economici**: auto e moto con un *costo di partenza* entro una soglia che scegli tu (2.500 € all'inizio), ordinate dal più basso. Il costo di partenza è una stima a forbice: prezzo richiesto + passaggio di proprietà (voci fisse PRA e Motorizzazione, IPT per kW secondo il D.M. 435/1998 con la maggiorazione provinciale da 0 a 30%, IPT ridotta per gli ultratrentennali) + una revisione se scaduta. Assicurazione, bollo sotto i 30 anni e IPT delle moto più giovani non sono stimati e lo dice la scheda. La stessa stima compare su ogni scheda auto e moto. *Cerca proposte economiche* interroga 6 piste auto/moto; su AutoScout24 chiede direttamente annunci sotto soglia, sulle altre fonti filtra dopo la lettura. Gli annunci più cari non vengono segnati come visti. Le tariffe stanno in `lib/costs.js` e vanno ricontrollate ogni tanto.
- **Provenienza di ogni testo**: *Dalla fonte* (dati strutturati della pagina), *Dichiarato dal venditore* (descrizione), *Interpretazione AI* (con autore), *Scritto da te*.
- **Reazioni** con motivo libero, salvate; diario e conteggi nel profilo. Le reazioni spostano poco il peso delle piste (limiti 0,5–1,75): nessuna pista sparisce, e una scheda su quattro (su tre se chiedi "Sorprendimi ancora") è una sorpresa.
- **Approfondimento** solo con "Questa la considero davvero": verifiche, domande, conto del progetto (parte dal solo prezzo richiesto; nessun costo inventato), appunti.
- **Profilo e gusti** modificabile, con tre tipi distinti: detto da te, ipotesi dello scout, ancora incerto.
- **Ricerca assistita su fonti reali**: AutoScout24 Italia (auto e moto), Subito.it (auto, moto e gommoni), Ruote Classiche – Vendo e compro (auto d'epoca, quasi solo rivenditori), Automobile.it (auto), Kleinanzeigen (gommoni, Germania). Ogni candidato viene aperto: entra nel flusso solo se la pagina dell'annuncio è stata letta e la prima foto risponde. Deduplicazione per annuncio e per "stesso mezzo" (modello + prezzo + luogo, oppure, tra siti diversi, marca + prezzo + città + anno + km); gli annunci già visti non vengono riproposti.
- **Aggiunta manuale di un link** con estrazione assistita e correzione dei dati; se il sito non si lascia leggere la scheda resta "non verificata" e fuori dalle Scoperte.
- **Link scaduti e foto mancanti**: scheda archiviata e distinta, con idea e note conservate; segnaposto quando una foto non carica.
- **Ricerca periodica facoltativa** (ogni N ore, minimo 6), reale ma attiva solo finché il server è acceso. Spenta di default.
- Rispetto di `robots.txt`, user agent dichiarato, una richiesta alla volta per sito, nessun tentativo ripetuto dopo un rifiuto. I recapiti dei venditori non vengono conservati.

## Cosa richiede collegamenti esterni

- **Note AI su nuove schede e bozza degli approfondimenti**: serve `ANTHROPIC_API_KEY`. Il codice è completo (`lib/ai.js`, SDK ufficiale) ma **non è stato provato con una chiave reale**. Senza chiave le nuove schede mostrano i dati della fonte e la motivazione della pista (a livello di modello), dichiarata come tale.
- **Subito.it**: a volte rifiuta le letture automatiche (403). La ricerca lo dichiara e ripiega una volta su un'altra fonte.
- **eBay**: servirebbero credenziali per l'API ufficiale; adattatore non scritto.
- **Motoclassiche.it**: non è una fonte di annunci (negozio di ricambi per moto inglesi).
- **Car & Classic, Catawiki, Leboncoin**: non leggibili automaticamente. Alternativa: link incollato a mano.
- **Facebook Marketplace**: il robots.txt esclude ricerca e singoli annunci, e serve un account. Lo Scout non lo aggira: un link incollato resta "non verificato" e i dati li compili tu.
- Le condizioni d'uso dei portali restano una valutazione tua: lo strumento è pensato per uso personale e a bassa frequenza.

## Cosa rimane da completare

- Moto.it / Classic Trader (solo link manuale, lettura generica non provata).
- "Altri mezzi": nessuna pista di ricerca, solo link manuale.
- Distanza: solo in linea d'aria e solo dove la fonte fornisce coordinate (non Subito, Ruote Classiche e Automobile.it).
- Nessuna notifica, nessun accesso da fuori casa già pronto, un solo utente.
- Le piste di ricerca sono definite in `lib/trails.js`: per ora si modificano lì, non dall'interfaccia.
- Immagini rappresentative del modello: non previste (si mostrano solo foto dell'esemplare).

## Prove

```bash
npm test
```

Nove prove automatiche senza rete (persistenza dopo riavvio, apprezzamento ≠ approfondimento, link non più raggiungibili, archivio, link manuale non verificabile, doppioni, AI non configurata). In più, a mano il 14/11/2026: uso da telefono in un browser reale (nessuno scorrimento orizzontale), ricerca reale sulle tre fonti, annuncio AutoScout24 rimosso → archivio, foto non caricabile → segnaposto, accesso con parola d'accesso.
