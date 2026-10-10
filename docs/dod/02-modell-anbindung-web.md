### DoD: Teilprojekt 2b (Modell-Anbindung, Web)

- [x] Vertrag: Oberfläche nutzt nur den erzeugten Client; `pnpm openapi` ohne Abweichung
- [x] Tests: 218 Web, 434 API, 214 DB grün; `pnpm check` grün; Zustände jeder Ansicht, Schlüsselfeld (nie vorbefüllt, Ersetzen, Entfernen, Rückgängig), Test-Schaltfläche (Grund je Fehlerart, gesperrt während der Anfrage und bei ungespeicherten Änderungen), Doppelklick in jedem Formular, HTML in Namen, vollständige Ausblendliste inklusive fremder Einträge
- [x] Invarianten: Schlüssel nur als Eingabe im offenen Dialog, nach dem Schließen nicht mehr im DOM (Handprobe, Punkt 5); keine Antwort trägt den Schlüssel (Punkt 4); Server entscheidet über Rechte (Wächter nur Komfort; Punkt 16: die Verwaltungsliste antwortet dem Nutzer mit 403); Anbieter- und Modellnamen werden nicht als HTML gerendert (Punkt 12)
- [x] UI: Zustände laden, Fehler mit Wiederholen, in Arbeit für jede Ansicht; „leer“ für Modellliste, Verbindungsliste und Modelldialog; deutsche Texte über i18n („Anbieter“ statt „Provider“), Englisch mit gleichen Schlüsseln; im Browser über Caddy mit der echten CSP geprüft (Probe 1 bis 18 aus Plan 2b, Task 7, Chrome DevTools), dunkel, Telefonbreite 375 × 800, Tastatur (Tab bleibt im Dialog), Escape; Konsole ohne CSP-Verstöße
- [x] Betrieb: `docker compose up` grün mit `scripts/fake-provider.mjs` als Anbieter (eigenes Compose-Projekt mit frischer Datenbank, danach `down -v`)
- [x] Docs: PLAN, BACKLOG, THREAT-MODEL, Spec-Status, README aktualisiert
- [ ] Offen: siehe docs/BACKLOG.md

Handprobe: Die Probe fand eine Abweichung, mit Test zuerst und eigenem Commit behoben:

- Ist ein Anbieter verbunden, antwortet aber nicht (Punkt 8 und 15), zeigte `/models` neben dem Hinweis „Nicht alle Anbieter antworten“ den Text „Ein Administrator muss zuerst einen Anbieter verbinden“. Das war falsch, denn der Anbieter ist verbunden. Seitdem steht dort „Im Moment ist kein Modell erreichbar.“ (Commit `fix(web): do not ask to connect a provider when all connected providers are down`).

Nicht oder nur teilweise im Browser geprüft, durch Komponententests belegt:

- Die Sperre der Schaltflächen während einer laufenden Anfrage (Punkte 7 und 13): die Anfragen an den Fake sind zu schnell für einen Schnappschuss.
- Punkt 15: Bei beendetem Fake zeigte `/models` den Hinweis mit dem Grund „nicht erreichbar“, und nach dem Neustart war er weg. Die Verwaltungsliste wurde in diesem Zustand nicht angesehen; „Nicht erreichbar“ mit Grund zeigte sie bei dem abgelehnten Schlüssel (Punkt 8).
- Punkt 17: „hell“ wurde nicht gesondert angesehen; geprüft wurden dunkel und Telefonbreite.

Nicht als Fehler gewertet: Chrome protokolliert erwartete 4xx-Antworten als „Failed to load resource“: 422 beim Speichern der Adresse `169.254.169.254` (Punkt 11), 403 beim Abruf der Verwaltungsliste als Nutzer (Punkt 16, von Hand per `fetch`) und 401 auf `GET /api/auth/me` ohne Sitzung. Eine CSP-Meldung („Refused to …“) trat nirgends auf. Das englische „Close“ der Dialog-Schaltfläche (shadcn) steht im BACKLOG.

Aufräumen: Die Probe lief in einem eigenen Compose-Projekt (`owui-probe`); `docker compose -p owui-probe down -v` entfernte nur dessen Volumes.
