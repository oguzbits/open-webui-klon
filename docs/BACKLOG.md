# Backlog

Hier steht, was offen ist oder bewusst nicht gebaut wird. Erledigtes steht in der Git-Historie.

## Offen

| Thema                            | Notiz                                                                                                                                                                       |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Stufe 2 des Agentic-Setups       | Stop-Hook, Bash-Guard (mit Tests), DoD-Vorlage, Testregeln; eigener Plan direkt nach Teilprojekt 0.                                                                         |
| `compose.dev.yml` mit Hot Reload | Spec Abschnitt 7 sieht Container mit Hot Reload vor; Teilprojekt 0 liefert nur Postgres-Port und Test-DB. Entwicklung: `pnpm db:up`, dann `pnpm dev`.                       |
| OpenAPI-Breaking-Change-Prüfung  | `oasdiff` in der CI, sobald es einen ersten stabilen API-Stand gibt (Teilprojekt 1).                                                                                        |
| Parallele Migrationen            | Der API-Container führt Migrationen beim Start aus; bei mehreren Instanzen braucht es eine Sperre.                                                                          |
| CSRF-Token                       | Kommt mit den Sessions in Teilprojekt 1; bis dahin schützt die Origin-Prüfung.                                                                                              |
| knip, jscpd, Magic-String-Audit  | ab Teilprojekt 1.                                                                                                                                                           |
| Strengere `style-src`            | siehe [ADR 0002](adr/0002-csp-style-src.md).                                                                                                                                |
| Telemetrie: Logs und Dev-Modus   | Logs per OTLP exportieren (im Fundament: Traces und Metriken; Logzeilen tragen `trace_id`); Telemetrie im Dev-Modus (`nest start --watch` lädt die Instrumentierung nicht). |
