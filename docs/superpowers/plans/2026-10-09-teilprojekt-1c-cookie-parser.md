# Teilprojekt 1c: Cookie-Parser durch `cookie` ersetzen Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Der handgeschriebene Parser für den `Cookie`-Header in `apps/api/src/auth/cookies.ts` wird durch das gepflegte Paket `cookie` ersetzt; Verhalten und Signatur von `readCookie()` bleiben, bis auf eine bewusst dokumentierte Abweichung (Anführungszeichen).

**Architecture:** `readCookie(header, name)` behält seine Signatur, damit `AuthGuard` und `AuthController` unverändert bleiben. Intern ruft die Funktion `parseCookie` aus `cookie` 2.x auf (RFC 6265, erstes Cookie gleichen Namens gewinnt, Objekt ohne Prototyp) und behandelt einen leeren Wert wie „nicht vorhanden“.

**Tech Stack:** `cookie` 2.0.1 (ESM, Node ≥ 22, Provenance und Trusted Publisher vorhanden), Vitest, Supertest.

**Spec:** Entscheidung in [ADR 0003](../../adr/0003-auth-ohne-passport.md); Rahmen: [Teilprojekt 1](../specs/2026-10-09-teilprojekt-1-auth-design.md). Kein eigener Beleg unter `docs/dod/`: Es wird eine Funktion ersetzt; die Ergebnisse von Step 6 stehen in der Commit-Nachricht.

## Global Constraints

- `pnpm`, nie `npm` oder `yarn`. Befehle aus `AGENTS.md`: `pnpm check`, `pnpm test`, `pnpm db:up`, `pnpm test:db`.
- Lieferkettenregeln in `pnpm-workspace.yaml` (`minimumReleaseAge: 10080`, `trustPolicy: no-downgrade`, `allowBuilds`) werden **nie** umgangen. Scheitert die Installation daran, melden, nicht ausnehmen.
- Kein `any`, kein `@ts-ignore`, kein `as unknown as`, kein `export *`.
- Das Cookie-Verhalten nach außen bleibt: Name `session`, `httpOnly`, `SameSite=Lax`, `Path=/`; nur das Lesen des Headers ändert sich. `sessionCookieOptions()` und `SESSION_COOKIE` bleiben unberührt.
- Git: direkt auf `main`, ein Thema pro Commit, Conventional Commits, Imperativ. Hooks nie mit `--no-verify` umgehen. Jede Commit-Nachricht endet mit `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- Nach einem Push: `gh run list --branch main --limit 1` prüfen, rote CI vor neuer Arbeit beheben.

## Review Focus

Eingaben, die der Parser im Alltag und bei Angriffen bekommt. Jede Zeile hat einen Test in Task 1.

1. **Zwei Cookies gleichen Namens** (`session=first; session=second`, auch `session=; session=tok`): das erste zählt, ein leeres erstes ist „kein Cookie“, kein Rückfall auf das zweite.
2. **Kaputte Teile neben einem gültigen** (`bad%=1; ;; =x; session=abc`): das gültige wird gefunden. Ein kaputtes Prozent-Zeichen im Wert (`session=%ZZ`) bleibt wie es ist und führt zu 401, nie zu 500.
3. **Anführungszeichen** (`session="tok-user"`): Der Wert bleibt unverändert, ist also keiner unserer Tokens (Base64url) und ergibt 401. Das ist eine bewusste Abweichung vom alten Parser, der sie entfernte; der Server setzt das Cookie nie mit Anführungszeichen.
4. **Namen wie `__proto__` und `constructor`**: ohne Wirkung; das Ergebnis des Parsers hat keinen Prototyp, `constructor` als gesuchter Name liefert nichts.
5. **Fehlender oder leerer Header**: wie bisher „kein Cookie“, 401.

---

## Dateistruktur

```
apps/api/
  package.json                      (ändern) Abhängigkeit cookie
  src/auth/cookies.ts               (ändern) readCookie über parseCookie
  src/auth/cookies.spec.ts          (ändern) Tests für das Verhalten des Standardparsers
  src/auth/auth.guard.spec.ts       (ändern) drei weitere Cookie-Kopfzeilen, die 401 ergeben
pnpm-lock.yaml                      (ändern)
```

---

### Task 1: `readCookie()` über das Paket `cookie`

**Files:**
- Modify: `apps/api/package.json`, `pnpm-lock.yaml`, `apps/api/src/auth/cookies.ts`, `apps/api/src/auth/cookies.spec.ts`, `apps/api/src/auth/auth.guard.spec.ts`

**Interfaces:**
- Consumes: bestehendes `readCookie(header: string | undefined, name: string): string | undefined` (Aufrufer: `auth.guard.ts`, `auth.controller.ts`).
- Produces: dieselbe Signatur, neue Umsetzung. Neue Abhängigkeit `cookie` (`parseCookie`).

- [ ] **Step 1: Abhängigkeit hinzufügen und prüfen**

Run: `pnpm --filter @owui/api add cookie@^2.0.1`
Expected: Installation erfolgreich. Meldet pnpm einen Verstoß gegen `minimumReleaseAge` oder `trustPolicy` (zum Beispiel `ERR_PNPM_TRUST_DOWNGRADE`), nicht umgehen: Fehler melden und anhalten. Version 2.0.1 ist seit 2026-06-30 veröffentlicht, trägt Provenance und kommt von einem Trusted Publisher.

Run: `cd apps/api && node --input-type=module -e "import('cookie').then((m) => { console.log(typeof m.parseCookie); })"`
Expected: `function`. (Im Paket `cookie` 2.x heißt die Funktion `parseCookie`; das `parse` aus 1.x gibt es dort nicht.)

- [ ] **Step 2: Failing tests schreiben**

In `apps/api/src/auth/cookies.spec.ts` den Block `describe('readCookie', …)` (alles bis vor `describe('sessionCookieOptions'`) ersetzen durch:

```ts
describe('readCookie', () => {
  it('reads the value among other cookies', () => {
    expect(readCookie('theme=dark; session=abc123; lang=de', 'session')).toBe('abc123');
  });

  it('takes the first of two cookies with the same name', () => {
    expect(readCookie('session=first; session=second', 'session')).toBe('first');
  });

  it('does not fall back to a later cookie when the first one is empty', () => {
    expect(readCookie('session=; session=tok', 'session')).toBeUndefined();
  });

  it('keeps an equals sign inside the value', () => {
    expect(readCookie('a=b=c', 'a')).toBe('b=c');
  });

  it('finds a valid cookie next to malformed parts', () => {
    expect(readCookie('bad%=1; ;; =x; session=abc', 'session')).toBe('abc');
  });

  it('does not unquote: a quoted value is not one of our tokens', () => {
    expect(readCookie('session="abc"', 'session')).toBe('"abc"');
  });

  it('decodes percent escapes and leaves a broken escape as it is', () => {
    expect(readCookie('session=a%20b', 'session')).toBe('a b');
    expect(readCookie('session=%ZZ', 'session')).toBe('%ZZ');
  });

  it('lets names like __proto__ and constructor do nothing', () => {
    expect(readCookie('__proto__=x; constructor=y; session=1', 'session')).toBe('1');
    expect(readCookie('theme=dark', 'constructor')).toBeUndefined();
    expect(readCookie('theme=dark', '__proto__')).toBeUndefined();
  });

  it.each([undefined, '', ';', ';;', 'session', 'session=', '=x', 'other=1', 'sessionx=1'])(
    'finds nothing in %j',
    (header) => {
      expect(readCookie(header, 'session')).toBeUndefined();
    }
  );
});
```

In `apps/api/src/auth/auth.guard.spec.ts` die Liste der Kopfzeilen im Test „answers 401, never 500, for the cookie header %j“ ergänzen: nach `'other=1',` einfügen

```ts
      'session="tok-user"',
      'session=; session=tok-user',
      'session=%ZZ',
```

- [ ] **Step 3: Tests laufen lassen, Fehlschlag prüfen**

Run: `pnpm --filter @owui/api exec vitest run src/auth/cookies.spec.ts src/auth/auth.guard.spec.ts`
Expected: FAIL in „does not unquote …“ (der alte Parser liefert `abc`), in „decodes percent escapes …“ (der alte Parser liefert `a%20b`) und im Guard-Test mit `session="tok-user"` (der alte Parser entfernt die Anführungszeichen und lässt die Anfrage mit `200` durch). Das ist der erwartete Ausgangszustand.

- [ ] **Step 4: Implementieren**

`apps/api/src/auth/cookies.ts`: den Kopf der Datei (Import und `readCookie`) ersetzen, `sessionCookieOptions` bleibt:

```ts
import { parseCookie } from 'cookie';
import type { CookieOptions } from 'express';

export const SESSION_COOKIE = 'session';

/**
 * Value of the first cookie with that name; an empty value counts as missing. Parsing follows RFC 6265 (package
 * `cookie`): no unquoting, percent escapes are decoded, a broken escape stays as it is, and the result has no
 * prototype, so names like `constructor` find nothing.
 */
export function readCookie(header: string | undefined, name: string): string | undefined {
  if (header === undefined) return undefined;
  const value = parseCookie(header)[name];
  return value === undefined || value === '' ? undefined : value;
}
```

(die Funktion `sessionCookieOptions` darunter unverändert lassen). Meldet ESLint die Reihenfolge der Importe, `pnpm exec eslint --fix apps/api/src/auth/cookies.ts`.

- [ ] **Step 5: Tests laufen lassen**

Run: `pnpm --filter @owui/api exec vitest run src/auth && pnpm check`
Expected: PASS (alle Auth-Tests ohne Datenbank), `pnpm check` grün.

- [ ] **Step 6: Mutation und Gegenprobe mit Datenbank**

Die Datei sichern: `cp apps/api/src/auth/cookies.ts /tmp/cookies.ts.bak` (nur diese Kopie, außerhalb des Repos). Dann in `cookies.ts` die Bedingung `value === undefined || value === ''` auf `value === undefined` kürzen und `pnpm --filter @owui/api exec vitest run src/auth/cookies.spec.ts` ausführen.
Expected: „finds nothing in "session="“ und „does not fall back to a later cookie when the first one is empty“ werden rot. Danach `cp /tmp/cookies.ts.bak apps/api/src/auth/cookies.ts` und den Lauf wiederholen: wieder grün.

Run: `pnpm db:up && pnpm test:db`
Expected: grün (`auth.db.spec.ts` meldet an, ruft `/auth/me` mit dem echten Set-Cookie-Header auf und meldet ab). Die Zahlen für die Commit-Nachricht notieren.

- [ ] **Step 7: Commit, Push, CI**

```bash
git add apps/api/package.json pnpm-lock.yaml apps/api/src/auth
git commit -m "refactor(api): read the session cookie with the cookie package" -m "Replaces the hand-written Cookie header parser (ADR 0003). One deliberate change: surrounding quotes are no longer stripped; the server never sets quoted cookies, so a quoted value stays an unknown token and answers 401. Tests: <API-Zahl> API, <DB-Zahl> DB grün; mutation (empty value counts as a cookie) turns two tests red." -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
git push
gh run list --branch main --limit 1
```

Die spitzen Klammern in der Commit-Nachricht durch die gemessenen Zahlen ersetzen. Expected: die CI läuft an; rote CI vor neuer Arbeit beheben (AGENTS.md, Abschnitt 4).
