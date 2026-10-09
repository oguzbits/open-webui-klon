### DoD: Teilprojekt 1a (Auth-Backend)

- [x] Vertrag: OpenAPI enthält Auth-, API-Key- und Nutzerrouten, Orval-Client neu erzeugt, CI-Drift-Prüfung grün
- [x] Tests: 171 API, 162 DB, 15 Web grün; `pnpm check` grün; Guard-Mutation ("immer erlauben") macht 23 von 25 Guard-Tests rot
- [x] Invarianten: jede Route außer `@Public()` geschlossen; Rolle aus der DB; Keys nie auf Admin-/Key-Routen und nie für `pending`; Passwörter Argon2id, Sessions und Keys nur als SHA-256; keine Geheimnisse in Logs und Audit
- [x] Betrieb: `docker compose up` grün, Smoke-Test inklusive Auth-Prüfungen, Handprobe (Signup als Admin, `me`, Logout ohne CSRF-Header 403, mit Header 204, danach `me` 401); die Handprobe fand einen Fehler (leere `ADMIN_*`-Variablen aus Compose legten einen Admin ohne E-Mail an), behoben mit Test
- [x] Docs: PLAN, BACKLOG, THREAT-MODEL, Spec aktualisiert
- [ ] Offen: Web (Teilprojekt 1b), siehe docs/BACKLOG.md
