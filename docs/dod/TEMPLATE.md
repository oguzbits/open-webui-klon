# DoD-Vorlage

Kopieren nach `docs/dod/NN-thema.md` (Teilprojekt `NN`, bei zwei Plänen `a` und `b`). Jeder Punkt nennt den Beleg
(Befehl, Testdatei, Handprobe), nicht nur ein Häkchen. Ein Punkt, der nicht gilt, steht mit Grund da, statt zu
fehlen. Was nur durch Komponententests und nicht im Browser belegt ist, steht unter „Nicht oder nur teilweise
geprüft“.

### Kurzform

Für kleine Pläne ohne neuen Vertrag und ohne neue Angriffsfläche (Regel in [AGENTS.md](../../AGENTS.md), Abschnitt 4).
Höchstens 15 Zeilen, jeder Punkt mit Beleg:

- [ ] Tests: Zahlen aus `pnpm test` und `pnpm check` (grün); Mutationsprobe für betroffene Schutzregeln
- [ ] Invarianten: betroffene Nummern aus AGENTS.md Abschnitt 2 mit Beleg
- [ ] Offen: Einträge im [BACKLOG](../BACKLOG.md)

### DoD: Teilprojekt N (Name, Backend oder Web)

- [ ] Vertrag: DTOs und OpenAPI; `pnpm openapi` ohne Abweichung; Web nutzt nur den erzeugten Client
- [ ] Tests: Zahlen aus `pnpm test`, `pnpm test:db` und `pnpm check` (alle grün); Auth und Not-Found je Controller;
      Verhalten statt Markup; Mutationsprobe für die Sicherheitsregeln (Befund nennen)
- [ ] Invarianten: je betroffene Nummer aus [AGENTS.md](../../AGENTS.md) Abschnitt 2 mit Beleg (Test oder Probe)
- [ ] UI: Zustände leer, laden, Fehler mit Wiederholen, in Arbeit für jede Ansicht; deutsche Texte über i18n; im
      Browser über Caddy mit der echten CSP geprüft (Konsole ohne CSP-Meldung), dunkel, Telefonbreite, Tastatur
- [ ] Betrieb: `docker compose up` und `node scripts/smoke.mjs http://localhost:8080` grün
- [ ] Docs: PLAN, BACKLOG, THREAT-MODEL, Spec-Status, README, ADR aktualisiert, soweit betroffen
- [ ] Offen: siehe [BACKLOG](../BACKLOG.md)

Handprobe: Abweichungen, die die Probe fand, mit Test zuerst und eigenem Commit behoben (Commit nennen).

Nicht oder nur teilweise im Browser geprüft, durch Komponententests belegt: …

Aufräumen: was die Probe angelegt hat (Compose-Projekt, Volumes) und dass es entfernt ist.
