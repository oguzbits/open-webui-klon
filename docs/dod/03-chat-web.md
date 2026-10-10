### DoD: Teilprojekt 3b (Chat und Streaming, Web)

- [x] Vertrag: Oberfläche nutzt den erzeugten Client; die einzige Ausnahme ist der Stream über den `useChat`-Transport
      (Body-Typ `StreamChatDto` aus dem Client). `ChatParams` ist im OpenAPI-Schema typisiert (Task 1);
      `pnpm openapi` erzeugt `apps/api/openapi.json` und `apps/web/src/api/generated/**` ohne Abweichung
      (`git diff --exit-code` ohne Unterschied, 2026-10-10).
- [x] Tests: `pnpm test` grün (35 Web-Dateien, 400 Tests; API unverändert bis auf einen neuen Test für
      `ChatParams` im Schema: 36 Dateien, 479 Tests; Hook-Tests 108), `pnpm check` grün (Typen, ESLint, Prettier,
      dependency-cruiser ohne Verstoß, 367 Module). Mutationsproben, jeweils rot gesehen:
  - Task 3 (Transport): `parentId` fest auf `null` gesetzt, zwei Tests rot.
  - Task 4 (Markdown): `img` aus den Komponenten entfernt (2 rot), `javascript:` in die erlaubten Schemata (7 rot),
    `urlTransform` entfernt (1 rot: relativer Link wird zum Link).
  - Task 5 (Chatliste): Entprellung der Suche entfernt, `invalidateQueries` beim Löschen entfernt (je rot; die
    Suche zählte zuerst falsch und wurde nachgeschärft).
  - Task 6 (Einstellungen): Prüfung `!value` nach dem Parsen (Null bleibt Null), Sperre gegen doppeltes Speichern
    (der Test aus dem Plan blieb grün und wurde durch ein zweites `submit`-Ereignis ersetzt, danach rot).
  - Task 7 (Eingabe, Nachricht): Sperren von Senden, Neu erzeugen, Bearbeiten und Versionswechsel einzeln entfernt;
    drei zusätzliche Tests, weil Versionswechsel, Bearbeiten-Knopf und „Als neue Version senden“ ungeprüft blieben.
  - Task 8 (Titel): Obergrenze der Versuche, Prüfung „Antwort läuft“, Rollen-, Status- und Titelquellen-Prüfung,
    `clearInterval` (je Tests rot).
  - Task 9 (Chatansicht): Neuladen nach Fehler, Wartezeit nach dem Stopp, Sperre gegen doppeltes Senden, Sperre des
    Versionswechsels, Rückgabe von Text bei Fehler vor dem Stream, `settling`-Schutz gegen ein zu früh geladenes
    Chat-Objekt (jeweils rot). Zwei Proben bleiben grün, weil der Schutz dort doppelt vorhanden ist (der Ref `firstSent` neben `sending`, die Prüfung auf „beschäftigt“ neben `settling`); beide Schutzteile bleiben als zweite Absicherung.
    Nach der Abschlussprüfung: gerenderte statt SDK-Nachrichten in `onFinish` (1 rot), Rückgabe in `onError` bzw.
    `onFinish` entfernt (4 bzw. 1 rot), `settling`-Prüfung und Wartezeit 0 mit festgehaltenem Timer (1 bzw. 3 rot),
    Schließ-Sperre und `fieldset` des Einstellungsdialogs (je rot), 422- und 404-Zuordnung beim Anlegen (je rot). Die
    Prüfung `isStreamFailure` in `onFinish` ist jetzt doppelt (ein Fehler im Stream kommt erst nach den IDs), Probe grün.
  - Task 10 (Neuer Chat): Sperre des Feldes und der Modellauswahl (die zweite war zuerst nicht abgedeckt, Assertion
    ergänzt), `onError`, Router-State der ersten Nachricht, Einstellungen im Body (je rot).
  - Task 11: `zod-config.spec.ts` rot vor, grün nach dem Fix `45d182d`.
- [x] Invarianten ([AGENTS.md](../../AGENTS.md) Abschnitt 2): 1 und 4: keine Inhalte in `console` (Suche in
      `apps/web/src` ohne Treffer außer einem Codebeispiel als Testdaten in `markdown-content.spec.tsx`; kein
      Aufruf), Identität nie vom Client (der Transport sendet nur `parentId` und Text); 7a: Markdown ohne HTML und ohne
      Bilder, Links mit festen Schemata, Tests und Handprobe Punkt 10; 8: Zustände jeder Ansicht (laden, leer,
      Fehler mit Wiederholen, in Arbeit) für Chatliste, Chatansicht und neuen Chat; 10: `ai` 7.0.127,
      `@ai-sdk/react` 4.0.130 (Optionen gegen die installierten Typen geprüft, `throttle` ist `number`
      in Millisekunden), `react-markdown` 10.1.0, `remark-gfm` 4.0.1, `rehype-highlight` 7.0.2, `zod` 4.6.5; 12: Texte
      nur über i18n (`locales.spec.ts` prüft gleiche Schlüssel in `de` und `en`).
- [x] Abhängigkeiten: neu `ai` ^7.0.127, `@ai-sdk/react` ^4.0.130, `react-markdown` ^10.1.0, `remark-gfm` ^4.0.1,
      `rehype-highlight` ^7.0.2 und `zod` 4.6.5 (direkt, damit die CSP-Einstellung `jitless` dieselbe Instanz trifft
      wie `ai`). `@ai-sdk/react` steht auf 4.0.130 statt 4.0.140, weil `minimumReleaseAge` (7 Tage) die neuere Version
      sperrt; `ai` und `@ai-sdk/react` werden zusammen angehoben, sobald es erlaubt ist (Backlog). Die Lockfile zog über
      `@ai-sdk/react` die optionalen Zusätze `swr`, `@orval/swr` und `@ai-sdk/mcp` mit. `pnpm audit --prod`: keine
      bekannten Schwachstellen (2026-10-10). Größe der Hauptdatei (`index-*.js`): 341,21 kB gzip, roh 1132,8 kB
      (vorher 185,33 kB gzip, roh 605,1 kB; also +155,9 kB gzip und +527,7 kB roh); CSS 74,68 kB (gzip 13,12 kB, vorher
      72,59 kB und 12,64 kB). Nachladen der Markdown-Bausteine steht im Backlog.
- [x] UI: Handprobe im Browser über Caddy (siehe unten) mit der echten CSP; Konsole ohne CSP-Meldung und ohne
      Fehler nach den drei Korrekturen (zuvor eine `eval`-Verletzung, siehe unten); dunkles Thema und Telefonbreite
      (375 x 812) angesehen.
- [x] Betrieb: `docker compose -p owui-probe up --build -d`, `node scripts/smoke.mjs http://localhost:8080` grün,
      danach `down -v`.
- [x] Docs: PLAN, BACKLOG, THREAT-MODEL, Spec 3, ADR 0004, README aktualisiert.
- [ ] Offen: siehe [BACKLOG](../BACKLOG.md).

Handprobe (Punkte aus Task 11; Fake-Anbieter `scripts/fake-provider.mjs` auf dem Host, Verbindung „Probe“ mit zwei
Modellen):

1. Einstieg: bestanden. „Chat starten“ öffnet `/chats` mit Modellauswahl, Einstellungen, Eingabefeld und leerer Liste.
2. Erste Nachricht: bestanden. Genau ein `POST /api/chats` und ein `POST …/stream`; die Antwort wuchs in drei Stufen,
   während der Antwort stand nur „Stoppen“ da; nach dem Neuladen nur `GET`s; kein Text im URL oder Hash.
3. Titel: bestanden. Der erzeugte Titel erschien nach etwa 8,4 s in Überschrift und Liste zugleich; in 29 s nur
   drei `GET`s, danach keine mehr.
4. Stopp: bestanden. Der Teiltext (124 Zeichen) schrumpfte nie, nach etwa 530 ms stand der Hinweis „abgebrochen“
   da, nach dem Neuladen derselbe Text und Hinweis.
5. Neu erzeugen und Versionen: bestanden („2/2“, zurück „1/2“, nach dem Neuladen bleibt „1/2“; Bearbeiten legt einen
   neuen Ast an). Beobachtung: beim Zurückwechseln in den älteren Ast zeigt die Antwort die neueste Version dieses Asts
   (Wahl des aktiven Blatts durch den Server), die erste bleibt erreichbar.
6. Fehler im Stream (`server_error`): bestanden. Im Verlauf steht „Die Antwort ist leer.“ mit dem Hinweis „fehlgeschlagen,
   wird dem Modell nicht mitgeschickt“; „Neu erzeugen“ liefert danach die Antwort; der Text des Anbieters erscheint
   nirgends. Die kurze Meldung „Die Antwort wurde unterbrochen.“ steht nur etwa 7 ms da (Backlog).
7. Fehler vor dem Stream (25 000 Zeichen): bestanden. `422`, Meldung „Die Nachricht ist zu lang.“, der Text blieb im
   Feld, keine Geisternachricht.
8. Doppelaktionen: bestanden. Zweimal Enter (in getrennten Tasks), Doppelklick auf Neu erzeugen, Versionspfeil und
   „Als neue Version senden“ ergaben je genau eine Anfrage. Einschränkung: zwei `keydown`-Ereignisse im selben
   JavaScript-Task auf der Seite „Neuer Chat“ legten zwei Chats an; eine echte Tastatur kann das nicht, die
   Härtung ist im Backlog.
9. Liste: bestanden. Entprellte Suche (eine Anfrage `?limit=30&q=…`), „Keine Chats gefunden.“, Löschen mit Bestätigung,
   Löschen des offenen Chats führt nach `/chats`, während des Löschens (Slow 3G) sind alle Löschknöpfe gesperrt.
10. Markdown aus unvertrauter Quelle: bestanden. Kein `<img>`, kein `<script>`, `window.__pwned` nicht gesetzt, das
    Bild erscheint als Link (`rel="noopener noreferrer"`), der Hilfsserver sah keine Anfrage, relative und
    `javascript:`-Links sind kein Link, rohes HTML steht als Text; Codeblock mit Hervorhebung und „Kopieren“; die
    400 Zeichen lange Zeile scrollt im Block (`scrollWidth` 3012 gegen `clientWidth` 766), die Seite nicht; der Titel
    ist Text.
11. Darstellung: bestanden nach zwei CSS-Korrekturen (dunkel und 375 x 812: kein waagerechtes Scrollen, Eingabefeld
    unten, Seitenleiste als Blatt).
12. Größe: gemessen, siehe Abhängigkeiten (+155,9 kB gzip, unter der Linie von etwa 300 kB; roh darüber).
13. Entwicklungsmodus (StrictMode): bewusst nicht im Browser geprüft (siehe unten).

Abweichungen, die die Probe fand, jeweils mit eigenem Commit behoben:

- `45d182d` (Test zuerst): Chrome meldete bei jedem Laden eine `eval`-Verletzung der CSP (`kEvalViolation`), weil `ai`
  über zod 4 `new Function('')` probiert. Fix: `config({ jitless: true })` von zod, in `main.tsx` zuerst importiert;
  `zod` als direkte Abhängigkeit.
- `55e9746`: Strings im Code hatten im dunklen Thema 3,19:1 Kontrast; jetzt `--muted-foreground` (5,86:1 gemessen).
- `faf18f9`: native Scrollleisten und Steuerelemente hell im dunklen Thema; `color-scheme` für `:root` und `.dark`.
- `48ccbb1`: der Fake-Anbieter bekam einstellbare Antwort und Tempo (Standard unverändert).

Nicht oder nur teilweise geprüft:

- Entwicklungsmodus mit StrictMode (die erste Nachricht genau einmal): nur durch den Test mit dem Ref belegt.
- Wartezeit nach dem Stopp (500 ms): in einem Lauf der Handprobe ohne Verlust des Teiltexts; eine Heuristik (Backlog).
  In den Tests halten die beiden Fälle „keeps the partial answer …“/„keeps the question and the partial answer …“
  den Timer der Wartezeit fest, statt real im Fenster von 500 ms zu warten (siehe Abschlussprüfung).
- Helles Thema: nicht angesehen (nur dunkel und Telefonbreite).
- Zwischenablage: geprüft wurde das Argument von `writeText` (der Code ohne den letzten Zeilenumbruch des Zauns),
  nicht das Zurücklesen aus der System-Zwischenablage (hing an einer Berechtigungsabfrage).
- „Neu erzeugen“ während eines Streams: an der gerade entstehenden Antwort fehlt der Knopf, ältere Antworten zeigen
  ihn gesperrt (Unit-Test „locks the actions while something is running“ in `message-item.spec.tsx`); im Browser
  nicht eigens geprüft.
- Echter Anbieter (Ollama, OpenAI-kompatibel): alles gegen den Fake-Anbieter.
- Bildschirmleser: nur Rollen und Namen in Tests, kein Lauf mit einem Bildschirmleser.
- Chrome meldet für das Nachrichtenfeld und das Suchfeld einen Autofill-Hinweis (kein `name`); kein Fehler, im Backlog.

Abschlussprüfung des ganzen Zweigs (2026-10-10): Der unabhängige Prüfer fand zwei wichtige Funde und keinen
kritischen. Erstens las `questionIsStored` den gedrosselten React-Zustand: Brach die Verbindung in den ersten etwa
50 ms nach dem ersten Teil des Streams ab, kam der Text zurück ins Eingabefeld, obwohl der Server die Frage schon
gespeichert hatte. Das war auch die Ursache des Flakes von „does not give the text back …“. Die Entscheidung fällt
jetzt in `onFinish` anhand der Nachrichten des SDK, mit einem Test, der vorher rot war (`f387da9`). Zweitens hing der
Test „keeps the partial answer when a reload finishes while the stopped answer is being stored“ an einem echten
Fenster von 500 ms und schlug unter paralleler Last in 8 von 10 Läufen fehl; die Wartezeit wird jetzt im Test
gesteuert (`9165817`; eigene Messung mit fünf parallelen Läufen der Web-Tests: vorher 5 von 5 rot, danach 0 von 5).
Außerdem lässt sich der Einstellungsdialog während des Speicherns nicht mehr schließen und nicht mehr bearbeiten,
sodass ein Fehler beim Speichern sichtbar bleibt (`2a34f32`); beim Anlegen eines Chats nennt ein 422 jetzt die
Anweisung statt der Nachricht (`684d0c3`). Die übrigen kleinen Funde (Markdown-Randfälle, Chatliste, Eingabefeld
beim Anlegen) bleiben bewusst offen und stehen im Backlog. Weiter zurückgestellt aus den Prüfungen je Task:
`isDisconnect` erkennt nur `TypeError` von `fetch`; die Sperre in `handleRegenerate` stirbt nur an einer
unbehandelten Ablehnung des SDK; `main.tsx` hat keinen Test für die Reihenfolge des zod-Imports (die Konsolenprobe
ist der Wächter). Unter paralleler Last scheitern außerdem Tests anderer Dateien an Zeitgrenzen (etwa „lists the
chats of the user as links to them“); einzeln und im normalen Lauf grün.

Aufräumen: Compose-Projekt `owui-probe` samt Volume, Fake-Anbieter und Hilfsserver beendet, Wegwerf-Dateien und der
Scratch-Worktree für die Größenmessung gelöscht; `git status` war danach sauber.
