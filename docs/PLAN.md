# Plan und Stand

Ziel: Nachbau von Open WebUI mit NestJS-Backend und React-Frontend. Die Gesamt-Spec steht in
[docs/superpowers/specs/2026-10-09-open-webui-nestjs-design.md](superpowers/specs/2026-10-09-open-webui-nestjs-design.md).
Pläne je Teilprojekt liegen unter [docs/superpowers/plans/](superpowers/plans/).

| #   | Teilprojekt                                     | Stand                                                                                                                                                                                                                                                                                   |
| --- | ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0   | Fundament                                       | erledigt, Plan: [Teilprojekt 0](superpowers/plans/2026-10-09-teilprojekt-0-fundament.md), Beleg: [DoD](dod/00-fundament.md)                                                                                                                                                             |
| 1   | Auth + Nutzer/Rollen                            | Backend fertig (1a), Web offen (1b): [Spec](superpowers/specs/2026-10-09-teilprojekt-1-auth-design.md), Plan [1a](superpowers/plans/2026-10-09-teilprojekt-1a-auth-backend.md), Beleg [DoD](dod/01-auth-backend.md), Plan [1b](superpowers/plans/2026-10-09-teilprojekt-1b-auth-web.md) |
| 2   | Modell-Anbindung                                | offen                                                                                                                                                                                                                                                                                   |
| 3   | Chat + Streaming                                | offen                                                                                                                                                                                                                                                                                   |
| 4   | RAG mit Hybrid-Suche                            | offen                                                                                                                                                                                                                                                                                   |
| 5   | Tools                                           | offen                                                                                                                                                                                                                                                                                   |
| 7   | Websuche                                        | offen                                                                                                                                                                                                                                                                                   |
| 11  | Workspace (eigene Modelle, Prompts)             | offen                                                                                                                                                                                                                                                                                   |
| 12  | Memory und Notizen                              | offen                                                                                                                                                                                                                                                                                   |
| 6   | Härtung                                         | offen                                                                                                                                                                                                                                                                                   |
| 8-9 | Nutzer-Tools mit Sandbox, Enterprise-Funktionen | optional                                                                                                                                                                                                                                                                                |
| 10  | Deployment                                      | zurückgestellt                                                                                                                                                                                                                                                                          |

Reihenfolge: 0, 1, 2, 3, 4, 5, 7, 11, 12, 6, danach optional 8 und 9, zuletzt 10. Die Abgrenzung zu Open WebUI
steht in der [Gesamt-Spec, Abschnitt 4.1](superpowers/specs/2026-10-09-open-webui-nestjs-design.md).

Architekturentscheidungen: [docs/adr/](adr/). Bedrohungsmodell: [docs/THREAT-MODEL.md](THREAT-MODEL.md).
Offenes und bewusst Verworfenes: [docs/BACKLOG.md](BACKLOG.md).

## Als Nächstes

1. Plan 1b (Web) umsetzen.
2. Plan für Stufe 2 des Agentic-Setups (Stop-Hook, Bash-Guard mit Tests, DoD-Vorlage, Testregeln).
