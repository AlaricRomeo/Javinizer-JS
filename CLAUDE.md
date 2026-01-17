# Claude Code Project Rules

## Project Context
K.I.S.S.

- **Stile di programmazione:** Preferisci componenti funzionali, usa TypeScript rigoroso.

## Efficienza e Risparmio Hit (Cruciale)
- **No Verbosity:** Non spiegare il codice e fai riassunti brevi a meno che non venga chiesto esplicitamente.
- **Direct Fixes:** Quando identifichi un bug, proponi direttamente le modifiche ai file coinvolti.
- **Context Awareness:** Prima di modificare, leggi sempre le definizioni dei tipi (T) se coinvolte.
- **State Management:** Assicurati che i componenti UI siano reattivi alle props; evita stati locali (`useState`) sincronizzati male che causano bug di "stale data".
- Non fare commit o push a meno che non venga chiesto esplicitamente.

## TypeScript Preferences
- Utilizza TypeScript per tutti i nuovi file e refactoring.
- Preferisci le `interface` ai `type` per definire la forma degli oggetti.
- Evita l'uso di `any`; se un tipo è sconosciuto, usa `unknown` o definisci un tipo parziale.
- Mantieni i tipi definiti vicino a dove vengono usati o in un file `.types.ts` dedicato se condivisi.
- Nessun messaggio di output nella webUI deve essere hardcoded. Devono essere tutti in i18n. I messaggi nel websocket devono essere in inglese