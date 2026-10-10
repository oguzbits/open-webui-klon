# ADR 0004: Chat-Streaming als UI-Message-Stream über POST-SSE, der Server besitzt den Verlauf

Status: angenommen (2026-10-10)

## Kontext

Teilprojekt 3 braucht eine Kopplung zwischen dem NestJS-Backend und der Chatansicht: Antworten erscheinen live,
der Nutzer kann stoppen, neu erzeugen und eine Nachricht bearbeiten (Äste). Geprüft am 2026-10-10 (AGENTS.md,
Regel 10) in den installierten Typen von `ai` 7.0.127 und per Vertragstest
([ai-stream.contract.spec.ts](../../apps/api/src/chats/ai-stream.contract.spec.ts)):

- `streamText` liefert einen Strom, den `toUIMessageStream` in das UI-Message-Format des AI SDK übersetzt;
  `pipeUIMessageStreamToResponse` schreibt ihn als Server-Sent Events. `useChat` aus `@ai-sdk/react` liest genau
  dieses Format.
- Der `onEnd`-Callback von `toUIMessageStream` meldet `isAborted`, `outcome` und den **Teiltext** einer
  abgebrochenen Antwort. Ein Fehler im Modellstrom wird vom Strom geworfen, nicht als Fehler-Teil gesendet.
- Der Standard-Transport von `useChat` schickt **alle** Nachrichten bei jeder Anfrage. Mit
  `prepareSendMessagesRequest` lässt sich das auf eine Nachricht begrenzen.

## Entscheidung

1. **Protokoll:** `POST /api/chats/:id/stream` und `POST /api/chats/:id/messages/:messageId/regenerate` antworten
   als UI-Message-Stream über SSE. Kein WebSocket, kein eigenes Format: Caddy, Browser und `useChat` verstehen
   POST-SSE ohne Zusatz.
2. **Der Server besitzt den Verlauf.** Der Client sendet nur `{ parentId, text }` (und Parameter), nie die
   Nachrichtenliste. Der Verlauf wird aus der Datenbank gebaut (Pfad von der Wurzel zur neuen Nachricht), mit
   Kürzung auf `CHAT_CONTEXT_MAX_CHARS`. Damit kann ein Client weder fremde Nachrichten einschleusen noch den
   Kontext aufblasen, und Äste (Bearbeiten, Regenerieren) sind eine Eigenschaft des Baums in der Datenbank.
3. **Die Antwort wird immer gespeichert.** Der Strom wird geteilt: ein Zweig geht zum Client, ein zweiter wird
   immer leergelesen. Verlässt der Client die Seite, steht die Teilantwort trotzdem mit Status `aborted` in der
   Datenbank.
4. **Metadaten im ersten Teil:** `{ userMessageId, assistantMessageId }`, damit der Client die nächste
   `parentId` kennt, ohne die Liste neu zu laden.
5. **Fehler** gehen als fester Fehler-Teil (`stream_failed`) zum Client, nie als Text des Anbieters.

## Folgen

- Kein Wiederaufnehmen eines laufenden Streams nach einem Verbindungsabbruch (Resumable Streams stehen im
  [Backlog](../BACKLOG.md)). Der Nutzer sieht die gespeicherte Teilantwort und kann neu erzeugen.
- Der Wechsel zwischen Ästen läuft über `PATCH /api/chats/:id` mit `activeMessageId`; der Client hält keinen
  eigenen Baum.
- Der Web-Client bildet mit `prepareSendMessagesRequest` das Senden auf `{ parentId, text }` und `regenerate` auf die
  Route der Antwort ab. Geprüft in Plan 3b (2026-10-10): `regenerate({ messageId })` entfernt die Antwort und alles
  danach aus der Liste und ruft den Transport mit dem Auslöser `regenerate-message` und der `messageId` auf; die
  Metadaten der entfernten Antwort sind dann weg. Der Client erlaubt Neu erzeugen, Bearbeiten und Ast-Wechsel darum
  nur für Nachrichten, die der Server kennt (aus dem geladenen Chat), und lädt den Chat nach jedem Ende eines
  Streams neu. Belegt durch `chat-transport.spec.ts` und `chat-page.spec.tsx`, Handprobe im
  [DoD 3b](../dod/03-chat-web.md).
- Proxys dürfen die Antwort nicht puffern. Belegt für Caddy durch die Handprobe von Plan 3a (Chunks kommen
  zeitlich versetzt an).
- Die Antwort ist erst gespeichert, wenn der Stream **schließt**: der `finish`-Teil und `[DONE]` gehen an den
  Client, bevor `onEnd` die Antwort in die Datenbank geschrieben hat. Ein Client darf den Chat also nicht beim
  `finish`-Teil neu laden, sondern erst, wenn der Stream beendet ist (Hinweis für Plan 3b).
- Der Stream-Platz pro Nutzer ist ein Zähler im Prozess und gilt für einen Knoten.
