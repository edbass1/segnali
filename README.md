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

I minuti dei gol stanno in `data/fotmob/`. L'archivio prende i campionati nazionali delle ultime giornate, Serie C compresa, e da quei minuti calcola fasce, secondo tempo e ultimi 30 minuti per ogni squadra. Non serve una chiave. Se una partita è più nuova dell'archivio, il browser la chiede a FotMob.

SoccerStats resta solo di riserva, quando un campionato non è ancora nell'archivio. In pubblico quella fonte mostra 5 squadre sui campionati minori, e il browser non può leggerla da solo.

Sofascore blocca le richieste automatiche. football-data.org senza chiave non apre le partite. Understat ha gli xG solo dei grandi campionati. Per questo i minuti restano quelli di FotMob: è la fonte che risponde anche in Serie C. Gli xG, se il campionato non li pubblica, la pagina lo dice e calcola lo stesso ritardi e quote sui gol.

Lo storico degli alert automatici su Telegram è in `live/`.
