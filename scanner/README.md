# Segnali live (cartella da copiare in edbass1/segnali)

- `live/index.html` – pagina storico (https://edbass1.github.io/segnali/live/)
- `live/data/signals.json` – storico segnali (scritto dallo scanner)
- `live/data/state.json` – ultima scansione, regole, partite già notificate
- `scanner/scan.py` – scanner FotMob (solo stdlib). Config in cima al file.
- `.github/workflows/scan.yml` – cron ogni 5 minuti + avvio manuale

Segreti del repo: `TELEGRAM_BOT_TOKEN` (obbligatorio), `TELEGRAM_CHAT_ID` (facoltativo, default 621551511).
In Settings > Actions > General > Workflow permissions: "Read and write permissions".

Test locali:
    python3 scanner/scan.py --dry-run            # scansione senza Telegram né salvataggi
    python3 scanner/scan.py --test 5781783       # valuta forzatamente una partita
    python3 scanner/scan.py --test 5781783 --send  # + invia 1 messaggio 🧪 TEST
