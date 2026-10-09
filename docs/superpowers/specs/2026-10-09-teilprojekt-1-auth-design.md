# Teilprojekt 1: Auth und Nutzer/Rollen

Stand: 2026-10-09. Status: zur Prüfung durch Oguz. Übergeordnet:
[Gesamt-Spec](2026-10-09-open-webui-nestjs-design.md), Abschnitt 4, Zeile 1.

## 1. Ziel und Rahmen

Eine selbst betriebene Instanz mit Anmeldung, Rollen und Nutzerverwaltung, **so nah an Open WebUI wie möglich**.
Wo Open WebUI gegen unsere Sicherheitsvorgaben (Invarianten 1 bis 7a, Gesamt-Spec Abschnitt 6) verstößt, gilt
unsere Vorgabe. Diese Abweichungen stehen in Abschnitt 3.

**Erfolg ist belegbar:**

- Ohne Anmeldung liefert keine Route Daten außer `@Public()`-Routen.
- Ein `pending`-Konto erreicht nur `GET /auth/me` und `POST /auth/logout`.
- Nutzer A kann Schlüssel und Sessions von Nutzer B nicht sehen, ändern oder löschen.
- Admin-Routen und die Schlüsselverwaltung sind nur per Session erreichbar, nie per API-Key.
- Jeder Fehlerfall (falsches Passwort, abgelaufene Session, gesperrtes oder wartendes Konto) ist getestet.

**Nicht im Umfang:** Passwort-Reset per Mail (kein Mailversand), MFA, OIDC, LDAP, Trusted Header, SCIM,
Gruppen und Rechte-Oberfläche (alles Teilprojekt 9), Websockets (kommen mit dem Chat in Teilprojekt 3; die
Session-Prüfung dort wird dann nachgezogen).

## 2. Vergleich mit Open WebUI

Quelle: Recherche am 2026-10-09 in Code und Doku von Open WebUI (`routers/auths.py`, `utils/auth.py`,
`models/*.py`, `env.py`, docs.openwebui.com). Unsicher geblieben: Standard-Lebensdauer des JWT (Quellen
widersprechen sich), Speicherort im Frontend, Klartextspeicherung der Keys (Vermutung).

| Bereich          | Open WebUI                                                                          | Hier                                                       |
| ---------------- | ----------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| Registrierung    | `ENABLE_SIGNUP` (Standard an), neue Konten per `DEFAULT_USER_ROLE` (Standard `pending`) | gleich, Env `ENABLE_SIGNUP`, `DEFAULT_USER_ROLE`           |
| Rollen           | `pending`, `user`, `admin`                                                          | gleich                                                     |
| Erster Admin     | erste Registrierung, Prüfung nach dem Insert; optional Admin per Env beim Start     | gleich, race-sicher in einer Transaktion; Env `ADMIN_*`    |
| Session          | JWT im httpOnly-Cookie, Bearer möglich, Widerruf über Redis                         | **abweichend:** Cookie-Session in Postgres (Abschnitt 3)    |
| Passwort-Hash    | bcrypt, Argon2 optional                                                             | **abweichend:** Argon2id                                   |
| Login-Limit      | 15 Versuche je 180 s pro E-Mail                                                     | **strenger:** pro Konto und pro IP                         |
| API-Keys         | `sk-…`, Aktivierung per Env, Admin-Keys erreichen Admin-Routen                      | Format und Schalter gleich; **abweichend:** gehasht, keine Admin-Routen |
| Admin-Verwaltung | Rolle ändern, Nutzer löschen                                                        | gleich, zusätzlich sperren und Passwort setzen             |

## 3. Bewusste Abweichungen (Begründung)

1. **Cookie-Session statt JWT:** sofort widerrufbar (Sperren, Logout, Passwortwechsel löschen die Zeile), kein
   Redis nötig, kein Token im JavaScript. Entscheidung aus der Gesamt-Spec.
2. **Argon2id statt bcrypt:** kein 72-Byte-Limit, aktuelle OWASP-Empfehlung.
3. **API-Keys gehasht und ohne Admin-Rechte:** schließt den Missbrauch eines gestohlenen Admin-Keys und die
   Klasse von Lücken, bei denen eine Key-Beschränkung nur für einen Header-Pfad galt.
4. **Kein stilles Admin-Konto** (`admin@localhost`) wie bei ausgeschalteter Auth: Auth lässt sich nicht abschalten.

## 4. Datenmodell

Migrationen werden generiert (Invariante 9); Entities in `database/entities.ts` eintragen.

- **`User`:** `id` (uuid), `email` (eindeutiger Index auf `lower(email)`), `name`, `passwordHash`, `role`
  (`pending` | `user` | `admin`), `disabledAt` (nullable), `createdAt`, `updatedAt`.
- **`Session`:** `id`, `userId` (FK, `ON DELETE CASCADE`), `tokenHash` (SHA-256, eindeutig), `csrfToken`,
  `expiresAt`, `lastUsedAt`, `createdAt`. Der Klartext-Token existiert nur im Cookie.
- **`ApiKey`:** `id`, `userId` (FK, `ON DELETE CASCADE`), `name`, `keyHash` (SHA-256, eindeutig), `prefix`
  (erste 8 Zeichen zur Anzeige), `expiresAt` (nullable), `revokedAt` (nullable), `lastUsedAt`, `createdAt`.
- **Wörterbücher** (`as const`, Invariante „Werte als Wörterbuch"): `USER_ROLE`, `AUDIT_ACTION`-Erweiterung um
  `login`, `login_failed`, `logout`, `signup`, `role_changed`, `user_disabled`, `user_deleted`,
  `password_changed`, `api_key_created`, `api_key_revoked`.

## 5. Schnittstellen

Alle Eingaben per DTO mit Whitelist. Fehler als Problem Details. Alle Routen außer `@Public()` brauchen eine
Session; `GET /auth/me` ist die einzige Route außer Logout, die `pending` erreicht.

**`auth` (Modul):**

| Route                       | Zugriff                  | Verhalten                                                                                                                  |
| --------------------------- | ------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| `POST /auth/signup`         | `@Public()`              | 403 bei `ENABLE_SIGNUP=false`, außer es existiert noch kein Nutzer. Rolle `DEFAULT_USER_ROLE`; der erste Nutzer wird `admin`. |
| `POST /auth/login`          | `@Public()`, Rate Limit  | Rotiert die Session. Einheitliche Antwort und Dauer bei unbekannter E-Mail (Dummy-Hash).                                   |
| `POST /auth/logout`         | Session                  | Löscht die Session-Zeile, löscht das Cookie.                                                                               |
| `GET /auth/me`              | Session (auch `pending`) | Nutzer, Rolle und `csrfToken`.                                                                                             |
| `POST /auth/password`       | Session                  | Altes Passwort prüfen; löscht alle anderen Sessions des Nutzers.                                                           |
| `GET/POST/DELETE /auth/api-keys` | Session, `ENABLE_API_KEYS` | Eigene Keys listen, anlegen (Klartext einmalig in der Antwort), widerrufen. Nie per API-Key erreichbar.               |

**`users` (Modul, nur Admin, nur per Session):** `GET /users`, `POST /users` (Admin legt Konto an),
`PATCH /users/:id` (Rolle, Name, `disabled`), `POST /users/:id/password` (Admin setzt Passwort),
`DELETE /users/:id`. Pending-Konten werden durch `PATCH` auf `user` freigeschaltet.

## 6. Regeln

- **Erster Admin:** `signup` zählt nach dem Insert in einer Transaktion unter Advisory-Lock; ist der neue Nutzer
  der einzige, wird er `admin`. Zwei gleichzeitige Aufrufe ergeben genau einen Admin. Alternativ legt die API
  beim Start den Admin aus `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `ADMIN_NAME` an, **nur wenn noch kein Nutzer
  existiert**; das Passwort wird nie geloggt, nach dem ersten Start ist die Variable zu entfernen (Hinweis im
  `.env.example`).
- **Guard:** global, geschlossen per Standard. Löst Cookie oder `Authorization: Bearer sk-…` auf, nie
  `x-api-key` oder Query-Parameter. Ein Key handelt mit der Rolle seines Nutzers; er scheitert an `@Roles(admin)`
  und an der Key-Verwaltung. Gesperrte (`disabledAt`) und wartende Nutzer werden bei jeder Anfrage abgewiesen,
  die Rolle wird nie aus dem Cookie, sondern aus der DB gelesen.
- **Sperren, Löschen, Passwortwechsel:** löschen alle Sessions des Nutzers in derselben Transaktion. Der letzte
  aktive Admin kann sich nicht herabstufen, sperren oder löschen.
- **Cookie:** `httpOnly`, `SameSite=Lax`, `Secure` unter HTTPS (aus `PUBLIC_ORIGIN` abgeleitet), `Path=/`. Token
  256 Bit zufällig. Lebensdauer fest per Env `SESSION_LIFETIME_HOURS` (Standard 168); `lastUsedAt` wird
  höchstens einmal pro Minute geschrieben.
- **CSRF:** Schreibende Requests mit Cookie brauchen Header `X-CSRF-Token` (Wert aus `GET /auth/me`, Vergleich
  zeitkonstant) zusätzlich zum vorhandenen Origin-Check. Bearer-Anfragen sind ausgenommen.
- **Passwort:** mindestens 12 Zeichen, höchstens 128; nie leer. Argon2id mit den Parametern der
  OWASP-Empfehlung, vor dem Einsatz gegen die aktuelle Doku der Bibliothek zu prüfen (Invariante 10).
- **Rate Limit:** `login` und `signup` begrenzt pro IP und pro E-Mail, getrennt von der globalen Grenze.
- **Logs:** nie Passwörter, Tokens oder Keys; nur IDs. Audit-Einträge für die Aktionen aus Abschnitt 4.
- **Env** nur über `config/env.ts`: `ENABLE_SIGNUP` (Standard `true`), `DEFAULT_USER_ROLE` (`pending` oder
  `user`, Standard `pending`), `ENABLE_API_KEYS` (Standard `false`), `SESSION_LIFETIME_HOURS`, `ADMIN_*`.

## 7. Web (`apps/web`)

- **Seiten:** `/login` (mit Registrieren, wenn `ENABLE_SIGNUP`), `/pending` („Dein Konto wartet auf
  Freischaltung"), `/settings/account` (Passwort, eigene API-Keys), `/admin/users` (Liste, Anlegen, Rolle,
  Sperren, Passwort setzen, Löschen, Freischalten).
- **Zustand:** `useMe()` über TanStack Query mit dem generierten Client (`pnpm openapi`). Der Router-Wächter
  leitet Anonyme auf `/login`, `pending` auf `/pending` und Nicht-Admins weg von `/admin`; er ist nur Komfort,
  durchgesetzt wird im Server. Der Fetcher sendet den CSRF-Header automatisch.
- **Ansichten:** jede mit leer, laden, Fehler mit Retry und „in Arbeit" (Invariante 8). Ein neuer API-Key wird
  einmal mit Kopieren-Button und Warnung gezeigt.
- **Texte** nur über i18n-Schlüssel, Deutsch zuerst, ohne Fachbegriffe wie „JWT" oder „CSRF".

## 8. Tests

Jeder Fehlerfall zuerst als roter Test (Gesamt-Spec, Abschnitt 5).

- **Pro Controller:** anonym, falsche Rolle, `pending`, gesperrt; dazu „A kann Key und Session von B nicht
  lesen, ändern, löschen" (BOLA).
- **Aus bekannten Open-WebUI-Lücken:** `pending` kommt auch per API-Key nirgends durch; Rolle wird bei Keys
  geprüft; ein widerrufener Key oder eine gelöschte Session wirkt sofort; leeres Passwort wird abgelehnt;
  Key per `x-api-key` oder Query-Parameter wird ignoriert; Admin-Route per Key liefert 403.
- **DB-Tests:** Setup-Wettlauf (zwei parallele Signups, ein Admin), Session-Ablauf, Rotation beim Login,
  Sperren löscht Sessions, letzter Admin geschützt, `ADMIN_*` greift nur ohne Nutzer.
- **Web:** Zustände jeder Ansicht, Router-Wächter für alle drei Fälle. Danach Sicht im Browser und Konsole auf
  CSP-Meldungen prüfen.
- **Mutation:** Wer den Guard auf „offen" stellt, sieht rote Tests.

## 9. Aufteilung in Pläne

1. **1a Backend:** Entities, Migrationen, `auth`, `users`, API-Keys, CSRF, Env, Tests.
2. **1b Web:** Client neu erzeugen, Seiten, Wächter, i18n, Browser-Prüfung.

Jeder Plan endet mit Beleg unter `docs/dod/` nach dem Muster von [DoD 00](../../dod/00-fundament.md).
