# Scheduler esterno per gli alert Telegram

Questo servizio è separato dal rendering del sito Segnali. Ogni minuto invia a GitHub una richiesta `workflow_dispatch` per avviare lo scanner Python già presente in `scanner/scan.py`. Il sito non viene modificato e il workflow GitHub già esistente rimane come backup ogni 5 minuti.

## Stato importante

Il codice è pronto nel repository, ma **non è attivo finché il Worker non viene distribuito su un account Cloudflare e non riceve il secret GitHub**. La modifica dei file su GitHub non può creare autonomamente un Worker nel tuo account Cloudflare.

## Attivazione una tantum

1. Accedi a Cloudflare e apri **Workers & Pages**.
2. Crea un Worker chiamato `segnali-telegram-scheduler`.
3. Incolla il contenuto di `worker.js` oppure distribuisci questa cartella con Wrangler.
4. Nelle impostazioni del Worker aggiungi il secret `GITHUB_TOKEN`.
5. Crea un fine-grained personal access token GitHub limitato al solo repository `edbass1/segnali`, con permesso **Actions: Read and write**. Non inserirlo nel codice, nel sito o nei log.
6. Configura il Cron Trigger `* * * * *` (una volta al minuto), come in `wrangler.toml`.
7. Controlla i log del Worker e GitHub Actions: devono comparire dispatch e scansioni regolari.

## Cosa usa

- Il workflow esistente `.github/workflows/scan.yml`
- I secrets già configurati nel repository: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` ed eventualmente `ODDS_API_KEY`
- La stessa logica dello scanner attuale, così da evitare una seconda implementazione delle regole

## Sicurezza e limiti

- Il token GitHub va conservato solo come secret del Worker.
- La risposta HTTP del Worker non avvia scansioni manuali: gli avvii sono solo tramite cron.
- Il cron esterno migliora la frequenza dei tentativi, ma non può garantire che GitHub avvii ogni singolo job puntualmente; controllare i log dopo l'attivazione.
- La scansione continua a usare FotMob come fonte, quindi resta soggetta alla disponibilità e ai limiti della fonte dati.
