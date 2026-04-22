# Estinzione di un rapporto bancario — brief funzionale

## Obiettivo

Aiutare l'operatore di filiale ad avviare la pratica di estinzione di un rapporto bancario di un cliente, fino alla generazione del modulo firmabile e all'invio della pratica al sistema centrale. L'operatore deve poter concludere la pratica in una singola conversazione con l'assistente, senza aprire altri applicativi. Il bot guida l'operatore passo-passo, chiede solo le informazioni che non ha già, evita riconferme inutili e produce un modulo PDF pronto per la firma prima dell'invio definitivo.

## Utenti e canale

Il servizio è usato dagli operatori di filiale di una banca tradizionale. Interagiscono via chat in italiano, con linguaggio bancario professionale e cortese. Non sono sviluppatori: parlano in termini di "cliente", "rapporto", "motivazione di chiusura", "data di efficacia". Il bot deve usare lo stesso registro. L'operatore può digitare in qualsiasi ordine e stile (frasi complete, lista di dati, messaggi batched che contengono tutto in una volta). Il bot è in grado di riconoscere e riutilizzare informazioni già presenti nel discorso senza richiederle una seconda volta.

## Dati necessari

L'operatore parte con poche informazioni, di solito il cognome del cliente. Durante la conversazione, il bot deve raccogliere e confermare in ordine logico:

1. **Nominativo del cliente** (cognome o nome+cognome). Il bot lo usa per cercare il cliente nel sistema e, se ne trova più di uno con lo stesso nome, chiede di scegliere.
2. **Identificativo univoco del cliente** (un codice numerico di 6-10 cifre fornito dal sistema bancario). Di solito viene scelto indirettamente: quando c'è un solo cliente corrispondente, il bot lo seleziona da solo; se ce ne sono più, l'operatore sceglie quale.
3. **Rapporto specifico da estinguere** (identificativo del rapporto con formato a tre blocchi numerici XX-XXX-XXXXXXXX, ad esempio 01-034-00392400). Il cliente può avere più rapporti attivi: il bot mostra la lista dei rapporti del cliente e l'operatore sceglie quello da chiudere.
4. **Motivazione di estinzione** (codice a due cifre da un catalogo ufficiale della banca, ad esempio 01, 02, 03). Il catalogo è caricato a runtime dal sistema bancario; non si inventa. Se l'operatore cita la motivazione a parole ("trasferimento estero", "trasloco"), la descrizione testuale viene tenuta accanto al codice, ma il codice deve appartenere al catalogo.
5. **Data di efficacia desiderata** (data in formato italiano o ISO, ad esempio 26/04/2026 o 2026-04-26). Deve essere una data da oggi in poi e non oltre 5 anni nel futuro.

## Passi della conversazione

Il flusso ideale, con tutti i dati già corretti, richiede una singola risposta del bot che mostra il modulo PDF e chiede conferma. In assenza di qualche dato, il bot chiede i mancanti uno per volta. Le interazioni previste sono:

1. **Identificazione del cliente**. Appena il bot ha un nominativo, interroga il sistema bancario per trovare tutti i clienti corrispondenti. Se ne trova uno solo, memorizza l'identificativo univoco senza chiedere nulla. Se ne trova diversi (omonimia), mostra i risultati in una tabella e chiede all'operatore di selezionare quello corretto. Se non ne trova alcuno, chiede di ripetere il nome.

2. **Selezione del rapporto**. Una volta identificato il cliente, il bot carica il profilo completo e la lista dei rapporti attivi. Se l'operatore ha già indicato un identificativo di rapporto valido, il bot lo usa. Se l'identificativo indicato non appartiene al cliente, il bot segnala educatamente che quel rapporto non risulta e mostra la lista di quelli effettivamente disponibili. Se l'operatore non ha indicato nulla, il bot mostra la tabella dei rapporti e chiede quale estinguere.

3. **Scelta della motivazione**. Il bot carica dal sistema il catalogo ufficiale delle motivazioni di estinzione. Accetta un codice a due cifre presente nel catalogo. Se l'operatore descrive la motivazione a parole, il bot memorizza la descrizione testuale e chiede di scegliere il codice corretto dalla lista. Se il codice indicato non è nel catalogo, il bot mostra il catalogo e chiede di sceglierne uno valido.

4. **Indicazione della data di efficacia**. Il bot accetta una data esplicita (formato italiano o ISO) purché sia da oggi in avanti e non oltre cinque anni. Non accetta date relative come "domani" o "fine mese". Se la data indicata non è valida, il bot spiega perché e chiede una data diversa.

5. **Conferma del modulo**. Quando ha tutti i dati, il bot genera un modulo PDF di richiesta di estinzione e lo mostra all'operatore insieme ai pulsanti "Confermo invio" e "Annulla". L'operatore deve confermare esplicitamente: non basta un "ok" conversazionale generico.

6. **Invio della pratica**. Alla conferma esplicita, il bot invia la pratica al sistema centrale della banca, riceve un identificativo della pratica creata e comunica all'operatore che l'invio è andato a buon fine.

## Vincoli business

- **Il catalogo delle motivazioni è autoritativo**: non si inventano codici né si scelgono codici che non esistono nel catalogo caricato a runtime.
- **Il rapporto deve appartenere al cliente**: un identificativo di rapporto che non risulta tra quelli del cliente selezionato non viene accettato.
- **L'identificativo univoco del cliente deve corrispondere a un cliente reale**: non viene accettato un identificativo inventato.
- **Data massima**: la data di efficacia non può superare i cinque anni dal giorno corrente e non può essere nel passato.
- **Conferma obbligatoria esplicita** prima dell'invio: il bot non invia mai la pratica senza un "sì confermo" (o equivalente) dell'operatore, oppure un click sul pulsante di conferma. Ogni altra risposta generica non basta.
- **Nessuna invenzione di dati**: se qualche informazione manca, il bot chiede. Non deduce cognomi, codici, date o identificativi per ipotesi.

## Tono

Italiano, bancario professionale, cortese. Frasi brevi. Il bot dà del lei all'operatore. Le richieste sono chiare e focalizzate: una domanda per volta quando serve, riepilogo conciso quando si passa alla conferma. Le tabelle mostrate (clienti, rapporti, motivazioni) hanno intestazioni in italiano e contengono solo i campi utili all'operatore per scegliere. I messaggi di errore spiegano il problema in termini business ("il rapporto 99-999-99999999 non risulta tra quelli del cliente; selezioni uno dei rapporti elencati qui sotto") e non fanno trapelare linguaggio tecnico.
