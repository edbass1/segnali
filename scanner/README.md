# Segnali live (cartella da copiare in edbass1/segnali)

- `live/index.html` – pagina storico (https://edbass1.github.io/segnali/live/)
- `live/data/signals.json` – storico segnali (scritto dallo scanner)
- `live/data/state.json` – ultima scansione, regole, partite già notificate
- `live/data/today.json` – "📅 Partite del giorno": partite di campionato di oggi che soddisfano già i requisiti prematch di almeno un segnale (generato ogni notte a mezzanotte italiana)
- `scanner/scan.py` – scanner FotMob (solo stdlib). Config in cima al file.
- `.github/workflows/scan.yml` – cron ogni 5 minuti + avvio manuale
- `.github/workflows/daily.yml` – partite del giorno: cron 22:00 e 23:00 UTC, lavora solo quando a Roma è mezzanotte (gestisce ora legale/solare) + avvio manuale (opzionale una data YYYYMMDD). Calcolo senza bloccare lo scanner, commit nello stesso concurrency group dello scanner. Niente Telegram, niente The Odds API.

Regola 🚫 Mai 0-0 (solo campionato in corso, minimo 9 partite per squadra): una squadra con over 0.5 gol totali (nessuno 0-0) nel 100% delle partite e l'altra in almeno il 90%; inoltre una squadra deve aver segnato almeno 1 gol nel 100% delle partite e l'altra deve aver subito almeno 1 gol nel 100% delle partite (vale in entrambi i versi: casa segna sempre e ospite subisce sempre, oppure ospite segna sempre e casa subisce sempre). I segnali già salvati in `signals.json` restano invariati.

Segreti del repo: `TELEGRAM_BOT_TOKEN` (obbligatorio), `TELEGRAM_CHAT_ID` (facoltativo, default 621551511). `ODDS_API_KEY` (facoltativo: quota live Over 0.5 al momento del segnale, 1 credito The Odds API per partita segnalata; senza chiave la riga mostra "non disponibile").
In Settings > Actions > General > Workflow permissions: "Read and write permissions".

Test locali:
    python3 scanner/scan.py --dry-run            # scansione senza Telegram né salvataggi
    python3 scanner/scan.py --daily              # genera live/data/today.json per oggi (ora italiana)
    python3 scanner/scan.py --daily --date 20261028 --out /tmp/domani.json   # altra data / altro file
    python3 scanner/scan.py --test 5781783       # valuta forzatamente una partita
    python3 scanner/scan.py --test 5781783 --send  # + invia 1 messaggio 🧪 TEST
