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

**Note AI personalizzate (facoltative):** la chiave resta sul server, mai nel browser.

```bash
ANTHROPIC_API_KEY='la-tua-chiave' node server.js
```

Altre variabili: `PORT` (default 4173), `SCOUT_DATA_DIR` (cartella dell'archivio, default `data/`), `SCOUT_AI_MODEL` (default `claude-opus-5-5`).

## Dove stanno i dati

Tutto in `data/scout.json` (creato al primo avvio, escluso da Git): schede, reazioni e motivi, profilo, approfondimenti, registro delle ricerche. Per un backup copia il file o usa *Fonti → Scarica una copia dell'archivio*. Le fotografie **non** vengono copiate: restano sul sito dell'annuncio.

Al primo avvio l'archivio parte da `seed/`: il profilo ricavato dal brief e 22 schede su annunci reali, aperti e verificati dal server il 14/11/2026 (pagina letta + prima foto raggiunta). Non ci sono dati dimostrativi. Quegli annunci scadranno: *Idee conservate → Ricontrolla tutte le fonti* li sposta in archivio quando spariscono.

## Cosa funziona davvero

- **Scoperte**: flusso di schede con foto dell'esemplare, titolo‑idea, "Perché te lo mostro", "Il progetto che ci vedo", dati dell'annuncio, impegno indicativo, dubbio dello scout, stato della fonte con data dell'ultimo controllo. Filtri per categoria e impegno; prezzo e distanza facoltativi.
- **Provenienza di ogni testo**: *Dalla fonte* (dati strutturati della pagina), *Dichiarato dal venditore* (descrizione), *Interpretazione AI* (con autore), *Scritto da te*.
- **Reazioni** con motivo libero, salvate; diario e conteggi nel profilo. Le reazioni spostano poco il peso delle piste (limiti 0,5–1,75): nessuna pista sparisce, e una scheda su quattro (su tre se chiedi "Sorprendimi ancora") è una sorpresa.
- **Approfondimento** solo con "Questa la considero davvero": verifiche, domande, conto del progetto (parte dal solo prezzo richiesto; nessun costo inventato), appunti.
- **Profilo e gusti** modificabile, con tre tipi distinti: detto da te, ipotesi dello scout, ancora incerto.
- **Ricerca assistita su fonti reali**: AutoScout24 Italia (auto e moto), Subito.it (gommoni), Kleinanzeigen (gommoni, Germania). Ogni candidato viene aperto: entra nel flusso solo se la pagina dell'annuncio è stata letta e la prima foto risponde. Deduplicazione per annuncio e per "stesso mezzo" (modello + prezzo + luogo); gli annunci già visti non vengono riproposti.
- **Aggiunta manuale di un link** con estrazione assistita e correzione dei dati; se il sito non si lascia leggere la scheda resta "non verificata" e fuori dalle Scoperte.
- **Link scaduti e foto mancanti**: scheda archiviata e distinta, con idea e note conservate; segnaposto quando una foto non carica.
- **Ricerca periodica facoltativa** (ogni N ore, minimo 6), reale ma attiva solo finché il server è acceso. Spenta di default.
- Rispetto di `robots.txt`, user agent dichiarato, una richiesta alla volta per sito, nessun tentativo ripetuto dopo un rifiuto. I recapiti dei venditori non vengono conservati.

## Cosa richiede collegamenti esterni

- **Note AI su nuove schede e bozza degli approfondimenti**: serve `ANTHROPIC_API_KEY`. Il codice è completo (`lib/ai.js`, SDK ufficiale) ma **non è stato provato con una chiave reale**. Senza chiave le nuove schede mostrano i dati della fonte e la motivazione della pista (a livello di modello), dichiarata come tale.
- **Subito.it**: a volte rifiuta le letture automatiche (403). La ricerca lo dichiara e ripiega una volta su un'altra fonte.
- **eBay**: servirebbero credenziali per l'API ufficiale; adattatore non scritto.
- **Car & Classic, Catawiki, Leboncoin, Facebook Marketplace**: non leggibili automaticamente. Alternativa: link incollato a mano.
- Le condizioni d'uso dei portali restano una valutazione tua: lo strumento è pensato per uso personale e a bassa frequenza.

## Cosa rimane da completare

- Auto e moto su Subito (oggi solo gommoni) e moto.it / Classic Trader (solo link manuale, lettura generica non provata).
- "Altri mezzi": nessuna pista di ricerca, solo link manuale.
- Distanza: solo in linea d'aria e solo dove la fonte fornisce coordinate (non Subito).
- Nessuna notifica, nessun accesso da fuori casa già pronto, un solo utente.
- Le piste di ricerca sono definite in `lib/trails.js`: per ora si modificano lì, non dall'interfaccia.
- Immagini rappresentative del modello: non previste (si mostrano solo foto dell'esemplare).

## Prove

```bash
npm test
```

Nove prove automatiche senza rete (persistenza dopo riavvio, apprezzamento ≠ approfondimento, link non più raggiungibili, archivio, link manuale non verificabile, doppioni, AI non configurata). In più, a mano il 14/11/2026: uso da telefono in un browser reale (nessuno scorrimento orizzontale), ricerca reale sulle tre fonti, annuncio AutoScout24 rimosso → archivio, foto non caricabile → segnaposto, accesso con parola d'accesso.
