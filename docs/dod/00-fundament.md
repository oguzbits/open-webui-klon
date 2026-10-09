### DoD: Teilprojekt 0 (Fundament)

- [x] Vertrag: OpenAPI aus dem Backend, Orval-Client eingecheckt, CI prüft Abweichungen
- [x] Tests: 101 API, 7 DB, 15 Web grün; `pnpm check` grün; kein echter Netzwerkzugriff außer lokalen Testservern
- [x] Invarianten: Env nur über `config/env.ts`; keine Inhalte in Logs (Redaction getestet); `SafeFetchService` getestet (SSRF-Tabelle, Weiterleitungen, Größe, Zeit); Audit-Log append-only (Trigger getestet)
- [x] UI: Zustände laden, Fehler mit Wiederholen, Erfolg; "leer" nicht anwendbar (kein Listenbild); deutsche Texte über i18n; im Browser geprüft (hell/dunkel, Telefonbreite, Tastatur)
- [x] Betrieb: `docker compose up` auf frischem Klon grün (Smoke-Test), Container als Nicht-Root mit schreibgeschütztem Dateisystem, Datenbank nur im internen Netz, geordnetes Herunterfahren
- [x] Docs: README, PLAN, BACKLOG, ADR 0001/0002, THREAT-MODEL aktualisiert
- [ ] Offen: siehe docs/BACKLOG.md (Stufe 2 Agentic-Setup, Deployment, HSTS, Logs per OTLP)
