# Bedrohungsmodell (STRIDE)

Stand: Teilprojekt 0. Wird in jedem Teilprojekt fortgeschrieben. Maßstab und Maßnahmenkatalog:
[Spec Abschnitt 6.1](superpowers/specs/2026-10-09-open-webui-nestjs-design.md).

## Werte

Nutzerkonten und Sessions, Chat-Inhalte, hochgeladene Dokumente und Embeddings, API-Keys der Nutzer,
Provider-Keys der Admins, die Verfügbarkeit der API und der Modell-Anbieter (Kosten).

## Akteure und Vertrauensgrenzen

| Akteur / Quelle                              | Vertrauen      | Grenze                          |
| -------------------------------------------- | -------------- | ------------------------------- |
| Angemeldeter Nutzer                          | gering         | Browser -> Caddy -> API         |
| Admin                                        | erhöht         | konfiguriert Anbieter und Hosts |
| Sprachmodell-Ausgabe, Tool-Ergebnisse        | **unvertraut** | API <-> Anbieter                |
| Hochgeladene und abgerufene Dokumente        | **unvertraut** | Upload, `SafeFetchService`      |
| Externe Anbieter (Ollama, OpenAI-kompatibel) | teilvertraut   | ausgehende Verbindungen der API |
| Postgres                                     | vertraut       | internes Docker-Netz `backend`  |

## Bedrohungen

| STRIDE                 | Bedrohung                                       | Maßnahme (Teilprojekt)                                                                     |
| ---------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Spoofing               | Konto-Übernahme, Brute Force                    | Argon2id, Rate Limit, Session-Rotation (1); Rate Limit global (0)                          |
| Tampering              | Manipulierte Requests, Mass Assignment          | ValidationPipe mit Whitelist (0); Origin-Prüfung für schreibende Requests (0)              |
| Tampering              | Audit-Einträge nachträglich ändern              | Append-only-Trigger auf `audit_log` (0)                                                    |
| Repudiation            | Wer hat was geändert?                           | Audit-Log mit Request-ID (0), Nutzung ab (1)                                               |
| Information disclosure | IDOR, fremde Daten lesen                        | Abfragen in SQL nach Besitzer/ACL begrenzt, Test pro Endpunkt (jedes)                      |
| Information disclosure | Geheimnisse in Logs und Fehlern                 | `pino redact`, generische 500er, Env-Fehler ohne Werte (0)                                 |
| Information disclosure | Datenabfluss über Markdown-Bilder/-Links        | Sanitizing, strenge `img-src` (3)                                                          |
| Denial of service      | Anfragenflut, große Bodies, teure LLM-Aufrufe   | Throttler, Body-Limit (0); Token-Quoten (1-4)                                              |
| Elevation of privilege | SSRF auf interne Dienste und Cloud-Metadaten    | `SafeFetchService` mit IP-Sperrliste, Pinning, Redirect-Prüfung (0); Netzsegmentierung (0) |
| Elevation of privilege | Prompt Injection führt zu privilegierter Aktion | Tools mit geringsten Rechten und Bestätigung (5); Modellausgabe unvertraut (Invariante 7a) |
| Elevation of privilege | Kompromittierte Abhängigkeit                    | Lockfile, Karenzzeit, Installationsskripte nur freigegeben, Renovate, Audit, Trivy (0)     |
