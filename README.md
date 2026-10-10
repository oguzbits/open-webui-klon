# Open-WebUI-Klon

Ein Lernprojekt: Nachbau von [Open WebUI](https://github.com/open-webui/open-webui) mit einem NestJS-Backend und
einem React-Frontend (Vite, shadcn/ui). Aktueller Stand: **Fundament (Teilprojekt 0)**. Es gibt ein abgesichertes
Grundgerüst mit Statusanzeige, aber noch keinen Chat. Die Gesamt-Spec steht in
[docs/superpowers/specs/2026-10-09-open-webui-nestjs-design.md](docs/superpowers/specs/2026-10-09-open-webui-nestjs-design.md),
der Fahrplan in [docs/PLAN.md](docs/PLAN.md).

## Schnellstart

Voraussetzung: Docker.

```bash
docker compose up --build
```

Dann http://localhost:8080 öffnen. Beim ersten Start legt das erste Konto (Registrierung auf `/login`) den
Administrator an; weitere Konten wartet der Administrator unter „Nutzer“ frei (Standard). Stoppen mit `docker compose down` (die Daten bleiben erhalten), vollständig
löschen mit `docker compose down -v`. Prüfen, ob der laufende Stack richtig konfiguriert ist:
`node scripts/smoke.mjs`.

Unter „Modell-Anbindungen“ verbindet ein Administrator Ollama oder einen OpenAI-kompatiblen Anbieter; private Adressen (zum Beispiel `ollama`) müssen vorher über `PROVIDER_ALLOWED_HOSTS` freigegeben sein. Der Schlüsselbund `PROVIDER_KEY_ENCRYPTION_KEYS` (Beispielwert in `.env.example`) muss gesetzt sein, sonst startet der Stack nicht.

## Entwickeln

Voraussetzung: Node 24 (siehe `.nvmrc`) und pnpm (die Version steht in `package.json`, `corepack enable` genügt).

```bash
pnpm install
cp .env.example .env
pnpm db:up      # Postgres auf 127.0.0.1:5433
pnpm dev        # API auf :3000, Web auf :5173
```

- Tests: `pnpm test` (ohne Datenbank), `pnpm test:db` (braucht `pnpm db:up`)
- Prüfung (Typen, Lint, Format, Abhängigkeitsregeln): `pnpm check`
- API-Client neu erzeugen, nachdem sich ein Controller geändert hat: `pnpm openapi` (schreibt
  `apps/api/openapi.json` und den Orval-Client unter `apps/web/src/api/generated`; beides wird eingecheckt, die CI
  prüft, dass nichts abweicht)
- Läuft auf Port 3000 schon etwas anderes: `PORT=3999` für die API setzen und für Vite `API_PROXY_TARGET=http://localhost:3999`.

## Beobachtbarkeit

Tracing ist ausgeschaltet, solange `OTEL_EXPORTER_OTLP_ENDPOINT` leer ist. Mit Grafana, Tempo, Loki und Prometheus:

```bash
OTEL_EXPORTER_OTLP_ENDPOINT=http://lgtm:4318 docker compose --profile observability up --build
```

Danach Grafana auf http://localhost:3001 öffnen (Explore, Datenquelle Tempo, Suche `service.name = owui-api`).
Logzeilen der API tragen `trace_id` und `span_id`.

## Sicherheit in Kürze

- Eine einzige Origin über Caddy; das Frontend und `/api` teilen sich Host und Port.
- Strenge CSP (Skripte nur von `self`), API-Antworten mit `default-src 'none'`, Helmet-Header.
- CORS-Whitelist und Origin-Prüfung für alle Methoden, die etwas ändern.
- Rate Limit, Validierung mit Whitelist, Fehler als Problem Details (RFC 9457) mit Request-ID.
- `SafeFetchService`: der einzige Weg für ausgehende HTTP-Anfragen (SSRF-Schutz, gepinnte Verbindung, Größen- und
  Zeitlimit, Weiterleitungen werden neu geprüft).
- Audit-Log, das die Datenbank per Trigger nur anhängen lässt.
- Container als Nicht-Root mit schreibgeschütztem Dateisystem, ohne Capabilities; die Datenbank liegt in einem
  internen Netz.

Das Bedrohungsmodell steht in [docs/THREAT-MODEL.md](docs/THREAT-MODEL.md).

## Weitere Dokumente

- [AGENTS.md](AGENTS.md): Arbeitsregeln für Coding-Agenten (und für mich selbst)
- [docs/adr/](docs/adr/): Architekturentscheidungen
- [docs/BACKLOG.md](docs/BACKLOG.md): Offenes und bewusst Verworfenes
- [docs/dod/](docs/dod/): Belege, dass ein Teilprojekt fertig ist
