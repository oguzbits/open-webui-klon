# Plan und Stand

Ziel: Nachbau von Open WebUI mit NestJS-Backend und React-Frontend. Die Gesamt-Spec steht in
[docs/superpowers/specs/2026-10-09-open-webui-nestjs-design.md](superpowers/specs/2026-10-09-open-webui-nestjs-design.md).
Pläne je Teilprojekt liegen unter [docs/superpowers/plans/](superpowers/plans/).

| #   | Teilprojekt                                   | Stand                                                                                                                       |
| --- | --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| 0   | Fundament                                     | erledigt, Plan: [Teilprojekt 0](superpowers/plans/2026-10-09-teilprojekt-0-fundament.md), Beleg: [DoD](dod/00-fundament.md) |
| 1   | Auth + Nutzer/Rollen                          | Spec in Prüfung, [Spec](superpowers/specs/2026-10-09-teilprojekt-1-auth-design.md)                                          |
| 2   | Modell-Anbindung                              | offen                                                                                                                       |
| 3   | Chat + Streaming                              | offen                                                                                                                       |
| 4   | RAG                                           | offen                                                                                                                       |
| 5   | Tools                                         | offen                                                                                                                       |
| 6   | Härtung                                       | offen                                                                                                                       |
| 7-9 | Websuche, Nutzer-Tools, Enterprise-Funktionen | optional                                                                                                                    |
| 10  | Deployment                                    | zurückgestellt                                                                                                              |

Architekturentscheidungen: [docs/adr/](adr/). Bedrohungsmodell: [docs/THREAT-MODEL.md](THREAT-MODEL.md).
Offenes und bewusst Verworfenes: [docs/BACKLOG.md](BACKLOG.md).

## Als Nächstes

1. Plan für Stufe 2 des Agentic-Setups (Stop-Hook, Bash-Guard mit Tests, DoD-Vorlage, Testregeln).
2. Brainstorming und Spec für Teilprojekt 1 (Auth + Nutzer/Rollen).
