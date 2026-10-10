# Eval der Dokumentensuche

Misst von Hand, wie gut die Suche mit dem **echten** Embedding-Modell die richtigen Dokumente findet. Nicht Teil von
`pnpm check`, `pnpm test` oder CI (es braucht ein laufendes Modell).

Voraussetzungen: eine laufende Datenbank (`pnpm db:up` oder die des Stacks), darin eine Modell-Verbindung (zum
Beispiel Ollama) und gesetzte Umgebungsvariablen `DATABASE_URL`, `PROVIDER_KEY_ENCRYPTION_KEYS` und
`EMBEDDING_MODEL_ID` (`<Verbindungs-ID>:<Modell>`, wie in `GET /api/models`), dazu `FILE_STORAGE_PATH` auf ein
schreibbares Verzeichnis. Vorlage für die Werte ist `.env.example`.

```sh
LOG_LEVEL=warn pnpm eval:rag
```

Auf der Datenbank darf keine andere API-Instanz laufen: sie würde die Aufträge zum Verarbeiten der Dokumente
übernehmen, kann die Dateien aber nicht lesen (Status `failed`, Grund `unreadable`). Das Skript selbst läuft ohne
HTTP und ohne Anmeldung.

Das Skript legt einen Wegwerf-Nutzer an, lädt die Dokumente aus `fixtures/`, wartet bis sie `ready` sind, stellt jede
Frage aus `questions.json` (Feld `expect` ist der Dateiname, optional `page`) und druckt hit@1, hit@K (K ist
`RAG_TOP_K`) und MRR. Danach räumt es den Nutzer samt Dokumenten wieder auf. Ist ein Dokument `failed`, endet es mit
Code 1. Die Dokumente sind frei erfunden.
