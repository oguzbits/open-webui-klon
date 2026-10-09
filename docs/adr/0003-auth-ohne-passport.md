# ADR 0003: Eigener Auth-Guard, Standardbausteine für die Einzelteile

Status: angenommen (2026-10-09)

## Kontext

Teilprojekt 1 authentifiziert über ein Session-Cookie und über `Authorization: Bearer sk-…` (API-Keys). Die
Frage war, ob `@nestjs/passport` den Guard ersetzen soll. Geprüft am 2026-10-09 (AGENTS.md, Regel 10):

- `@nestjs/passport` 12.0.0 passt zu Nest 12; `passport` 0.7.0 wurde zuletzt im Januar 2025 geändert,
  `passport-http-bearer` 1.0.1 seit 2022 nicht mehr; `passport-custom` 1.2.1 wird gepflegt.
- Von `AuthGuard` (111 Zeilen) bliebe bei Passport nur `authenticate()` übrig (etwa 25 Zeilen: Header lesen,
  Token auflösen, Nutzer laden). Rollen, `pending`, API-Key-Sperre für `/admin/...`, CSRF-Prüfung, Rolle aus der
  Datenbank und die Sitzungslogik bleiben unser Code. Für „Session-Token als SHA-256 in der Datenbank“ gibt es
  keine fertige Strategie.
- Passport probiert Strategien nacheinander, der erste Erfolg gewinnt. Unsere Regel „ein vorhandener
  `Authorization`-Header entscheidet allein, kein Rückfall auf das Cookie“ müsste in beiden Strategien stehen:
  eine Sicherheitsregel, verteilt auf mehrere Dateien.

## Entscheidung

1. **Der Guard bleibt eigen**, solange es nur Session und API-Key gibt.
2. **Wo es einen gepflegten Standard für ein Einzelteil gibt, wird er benutzt.** Heute: `node:crypto`
   (Zufall, SHA-256, `timingSafeEqual`), `@node-rs/argon2` (Passwort), `helmet` (Header). Der handgeschriebene
   Cookie-Parser `readCookie()` wird durch das Paket `cookie` ersetzt
   ([Plan 1c](../superpowers/plans/2026-10-09-teilprojekt-1c-cookie-parser.md)).
3. **Externe Anmeldung (OIDC, LDAP, OAuth) kommt über `@nestjs/passport`** mit der jeweiligen Strategie oder
   über `openid-client`. Protokollcode (State, PKCE, Token-Prüfung) wird nie selbst geschrieben. Das Ergebnis
   mündet in eine interne Session; der Guard bleibt unverändert.

## Folgen

- Das Auth-Modell bleibt klein und an einer Stelle lesbar; die Lieferkette um `passport` entfällt vorerst.
- Der Guard ist sicherheitskritischer Eigencode und bleibt durch die Testmatrix in `auth.guard.spec.ts`
  abgesichert; Änderungen daran brauchen dort zuerst einen Test.
- Verworfen: `express-session` für die Sitzungen. Es legt die Session-ID standardmäßig unverändert im Speicher
  ab; Hash in der Datenbank, Rotation, Sofortwiderruf und die Bindung des CSRF-Tokens an die Session müssten
  wir nachbauen.
- Kommt OIDC oder LDAP (Teilprojekt 9, siehe [BACKLOG](../BACKLOG.md)), ist dieser ADR der Ausgangspunkt und
  wird fortgeschrieben.
