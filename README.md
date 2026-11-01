# Segnali

Sito per chi riceve gli alert al 45′ e al 60′ e li incolla qui. Testo in italiano, sfondo nero, numeri grandi.

Apri la pagina, incolla l'alert così com'è e premi **Analizza**. In alternativa usa i pulsanti «Esempio 45′» e «Esempio 60′».

Cosa calcola, solo sul campionato nazionale della stagione in corso (coppe escluse):

- Ritardo 0-0 di ciascuna squadra, se il punteggio è 0-0.
- Ritardo dei risultati 1-0 e 0-1. Il riquadro diventa un segnale solo da 10 partite in su.
- All'alert del 60′: ritardo over 0,5 negli ultimi 30 minuti (gol dal 61′ al 90′+), più lo stesso conto per i gol segnati e per i gol subiti da quella squadra.
- All'intervallo: lo stesso conto sul secondo tempo, dal 46′.
- xG di campionato (fatti e subiti, in casa e in trasferta) confrontati con gli xG live dell'alert, con un consiglio e una spiegazione per chi parte da zero.
- Quota equa, soglia per il back Over e, sullo 0-0, soglia per il lay del pareggio. La commissione si cambia nel campo in alto (predefinita 5%).

I minuti dei gol e gli xG stanno in `data/fotmob/`, aggiornati da soli insieme alle tabelle. Se una partita è più nuova dell'archivio, il browser la chiede a FotMob. SoccerStats non si può leggere dal browser: la stessa azione automatica salva le sue tabelle in `data/soccerstats/`. Sui campionati minori la pagina pubblica di SoccerStats elenca solo 5 squadre: in quel caso restano validi i numeri di FotMob.

Lo storico degli alert automatici su Telegram è in `live/`.
