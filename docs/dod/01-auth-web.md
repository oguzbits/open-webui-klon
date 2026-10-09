### DoD: Teilprojekt 1b (Auth-Web)

- [x] Vertrag: Oberfläche nutzt nur den erzeugten Client; `pnpm openapi` ohne Abweichung
- [x] Tests: 133 Web, 171 API, 162 DB grün; `pnpm check` grün; Wächter-Matrix (4 Wächter × 4 Zustände), 401 mitten in der Sitzung, Serverfehler auf `me`, Doppel-Submit in jedem Formular, HTML in Namen, Seite aus dem Vor-/Zurück-Cache
- [x] Invarianten: Server entscheidet (Wächter nur Komfort); Cache wird bei Anmeldung und Abmeldung geleert; Klartext-Schlüssel nur im Dialog (nach dem Schließen nicht mehr im DOM, in der Handprobe geprüft); keine Geheimnisse in Logs
- [x] UI: Zustände laden, Fehler mit Wiederholen, in Arbeit für jede Ansicht; „leer“ dort, wo es vorkommt (Schlüsselliste), sonst begründet nicht anwendbar (Nutzerliste enthält immer den Admin); deutsche Texte über i18n, Englisch mit gleichen Schlüsseln; im Browser über Caddy mit der echten CSP geprüft (17 Punkte aus Plan 1b, Task 6, Chrome DevTools), hell/dunkel, Telefonbreite 375 × 800, Tastatur, Escape; Konsole ohne CSP-Verstöße
- [x] Betrieb: `docker compose up` grün, Smoke-Test grün; API-Schlüssel-Punkte der Handprobe mit `ENABLE_API_KEYS=true` (Standard ist `false`)
- [x] Docs: PLAN, BACKLOG, THREAT-MODEL, README, ADR 0002 aktualisiert
- [ ] Offen: siehe docs/BACKLOG.md

Handprobe: Die Probe fand zwei Fehler, beide mit Test zuerst und eigenem Commit behoben:

- Nach „Abmelden“ zeigte die Zurück-Taste die alte Oberfläche aus dem Vor-/Zurück-Cache des Browsers (Punkt 10). Seitdem prüft die App bei `pageshow` mit `persisted` die Sitzung neu.
- Die Scroll-Sperre der Dialoge wurde bei scrollendem Dokument mit klassischer Scrollleiste von der CSP blockiert (Punkt 17): der erlaubte Hash gilt nur ohne Scrollleiste am Dokument. Seitdem scrollt nur der Inhaltsbereich ([ADR 0002](../adr/0002-csp-style-src.md)).

Nicht als Fehler gewertet: Chrome protokolliert die erwartete Antwort 401 auf `GET /api/auth/me` für Besucher ohne Sitzung als „Failed to load resource“. Hinweise des Browsers (Benutzername-Feld im Passwortformular, `id`/`name` am Rollenfeld) stehen im BACKLOG. Der Text „E-Mail-Adresse oder Passwort stimmt nicht.“ für ein gesperrtes Konto ist durch Komponententests belegt; im Browser wurde die Antwort 401 der API per `curl` bestätigt.
