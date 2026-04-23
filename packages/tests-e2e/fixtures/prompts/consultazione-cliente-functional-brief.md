# Consultazione cliente e generazione report — brief funzionale

## Obiettivo

Aiutare l'operatore di filiale a consultare la posizione complessiva di un cliente della banca e a produrre un report PDF riassuntivo che raccoglie profilo anagrafico e lista rapporti, da condividere poi direttamente col cliente (via email, stampa, ecc.). L'operatore deve poter concludere la consultazione in una singola conversazione con l'assistente, senza aprire altri applicativi.

Il bot NON compie operazioni dispositive sul conto: è un flow di sola consultazione + generazione documento informativo. Alla fine l'operatore conferma di aver condiviso il report col cliente; non c'è invio al sistema centrale né modifica dei dati bancari.

## Utenti e canale

Il servizio è usato dagli operatori di filiale di una banca tradizionale. Interagiscono via chat in italiano, con linguaggio bancario professionale e cortese. Non sono sviluppatori: parlano in termini di "cliente", "posizione", "rapporti aperti", "report riepilogativo". Il bot deve usare lo stesso registro. L'operatore può digitare in qualsiasi ordine e stile.

## Dati necessari

L'operatore parte con poche informazioni, tipicamente il cognome del cliente. Durante la consultazione il bot raccoglie e visualizza:

1. **Nominativo del cliente** (cognome o nome+cognome, testo libero). Il bot lo usa per cercare il cliente nel sistema e, se ne trova più di uno con lo stesso nome, chiede di scegliere.
2. **Identificativo univoco del cliente** (un codice numerico di 6-10 cifre fornito dal sistema bancario). Di solito viene scelto indirettamente: se c'è un solo cliente corrispondente lo seleziona il bot; se ce ne sono più l'operatore sceglie.
3. **Profilo anagrafico** (dati completi del cliente caricati dal sistema). Non è chiesto all'operatore: viene restituito automaticamente dal sistema bancario dopo l'identificazione.
4. **Lista rapporti** (elenco dei conti/rapporti attivi del cliente). Anche questo è caricato dal sistema, non chiesto all'operatore.
5. **Report PDF** (documento generato aggregando profilo + lista rapporti). Prodotto dal servizio di generazione documenti; non si inventa.

## Passi della conversazione

Il flusso ideale è più breve rispetto a una pratica dispositiva: non c'è scelta di motivazioni, non c'è calendario, non c'è submit finale. Le interazioni previste sono:

1. **Identificazione del cliente**. Appena il bot ha un nominativo, interroga il sistema bancario per trovare tutti i clienti corrispondenti. Se ne trova uno solo, memorizza l'identificativo univoco senza chiedere nulla. Se ne trova diversi (omonimia), mostra i risultati in una tabella e chiede all'operatore di selezionare quello corretto. Se non ne trova alcuno, chiede di ripetere il nome.

2. **Caricamento profilo e rapporti**. Una volta identificato il cliente, il bot carica dal sistema in modo indipendente (i due dati non dipendono l'uno dall'altro): il profilo anagrafico completo e la lista dei rapporti attivi del cliente. Entrambi vengono memorizzati come dati di contesto; il bot non chiede nulla all'operatore in questa fase.

3. **Generazione del report PDF**. Il bot assembla profilo e lista rapporti e chiama il servizio di generazione documenti, che ritorna un PDF base64 del report riepilogativo.

4. **Conferma condivisione**. Il bot mostra il report PDF generato e chiede all'operatore di confermare di averlo condiviso col cliente (via email, stampa cartacea, chat, whatever — il canale è esterno al bot). L'operatore risponde "sì ho condiviso", "confermo", "fatto" o simili; il bot considera accettata la conferma solo a questo step esplicito. Con la conferma il flow si chiude: non c'è invio al sistema centrale, non c'è pratica aperta. Il report è già stato generato, la condivisione è responsabilità dell'operatore.

## Vincoli business

- Il flow è di **sola consultazione**: nessun tool che modifichi lo stato dei conti può essere chiamato.
- Il report PDF è obbligatorio (non è possibile chiudere la consultazione senza generarlo).
- La conferma esplicita dell'operatore al passo 4 è obbligatoria: chiude il flow lato assistente anche se l'azione di condivisione avviene fuori dalla chat.
- Tutta l'interazione avviene in italiano.

## Tono

Bancario professionale, cortese, asciutto. Niente smile, niente linguaggio colloquiale. Il bot non deve mai inventare dati: se un'informazione non è disponibile o se il sistema centrale non la restituisce, chiede all'operatore o segnala l'impedimento.
