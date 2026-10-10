### DoD: Stufe 2 des Agentic-Setups

Vorgabe: [Gesamt-Spec](../superpowers/specs/2026-10-09-open-webui-nestjs-design.md), Abschnitt 5, Stufe 2.

- [x] Stop-Hook: [stop-check.mjs](../../.claude/hooks/stop-check.mjs), Regeln in `stop-check-core.mjs`; läuft `pnpm check` nur bei geändertem Stand (Hash über geänderte, neue und gelöschte Dateien ohne ignorierte), merkt sich ein Bestehen in `.git/claude-stop-check.json`, blockiert höchstens einmal je Zug (`stop_hook_active`); Handprobe: Lauf auf dem Repo mit Änderungen endete mit Exit 0 und schrieb den Hash
- [x] Bash-Guard: [bash-guard.mjs](../../.claude/hooks/bash-guard.mjs), Regeln in `bash-guard-core.mjs`; blockiert Force-Push (auch `+Refspec`, `--force-with-lease`, `--mirror`), `--no-verify`, `commit -n`, das Abschalten von Husky per Umgebungsvariable, `core.hooksPath` und Zugriffe auf `.env*` (außer `.env.example`), SSH-Schlüssel, `.aws/credentials`, `.netrc`; erkennt Ketten, `bash -c`, `$(...)` und Backticks; unlesbare Eingabe wird blockiert (Exit 2). Handprobe: der Guard war in dieser Sitzung sofort aktiv und blockierte einen Befehl, dessen Heredoc-Text den Husky-Schalter nannte (gewollt strenge Auslegung, in AGENTS.md vermerkt)
- [x] Tests: `pnpm test:hooks` mit 108 Fällen grün (Teil von `pnpm test`); Mutationsprobe: ohne die Force-Regel 21, ohne die Secret-Regel 29, ohne die `--no-verify`-Regel 8 rote Tests
- [x] DoD-Vorlage: [TEMPLATE.md](TEMPLATE.md); Pre-Flight steht schon in AGENTS.md, Abschnitt 4
- [x] Testregeln: AGENTS.md, Abschnitt 4
- [x] Docs: AGENTS, PLAN, BACKLOG aktualisiert
- [ ] Offen: der Guard ist ein Sicherheitsnetz, keine Sandbox (Variablen und kodierte Befehle umgehen ihn)

Nicht geprüft: der Stop-Hook in einer frischen Sitzung mit rotem `pnpm check` (nur über `decideStop` getestet; das Hook-Format `Stop` mit `decision: block` folgt der Claude-Code-Doku nach meiner Kenntnis und wurde nicht erneut online geprüft).
