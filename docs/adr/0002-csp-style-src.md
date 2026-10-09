# ADR 0002: CSP erlaubt Inline-Stile nur als Attribut

## Kontext

Die Oberfläche (shadcn/ui, Radix) setzt Layout-Werte wie `--sidebar-width` als `style`-Attribut. Eine CSP mit
`style-src 'self'` blockiert das; `style-src 'unsafe-inline'` würde zusätzlich eingeschleuste `<style>`-Blöcke
erlauben.

Zusätzlich fügt `react-remove-scroll-bar` (von Radix-Dialogen, also auch vom mobilen Seitenmenü) beim Öffnen
ein `<style>`-Element mit fest verdrahtetem Inhalt ein. Der Browser meldete die Verletzung in der Konsole
(`Applying inline style violates ... style-src 'self'`).

## Entscheidung

`style-src 'self' 'sha256-nzTgYzXYDNe6BAHiiI7NNlfK8n/auuOAhh2t92YvuXo='; style-src-attr 'unsafe-inline'`.
Skripte bleiben auf `'self'` beschränkt (kein `'unsafe-inline'` und kein `eval`). Fremde `<style>`-Elemente
sind blockiert; erlaubt ist genau das eine Element mit diesem Hash. `style`-Attribute sind erlaubt.

## Folgen

- Ein Angreifer mit HTML-Injection kann Aussehen verändern (zum Beispiel Inhalte überdecken), aber keine
  Skripte ausführen.
- Der Text des Elements enthält die Breite der Dokument-Scrollleiste (`margin-right: 15px`), der Hash gilt also
  nur ohne Scrollleiste am Dokument. Deshalb scrollt in `AppLayout` nur der Inhaltsbereich (`h-svh`,
  `overflow-y-auto` am `main`), nie das Dokument; ein Test sichert das. Eine neue Seite außerhalb von
  `AppLayout`, die Dialoge öffnet und das Dokument scrollen lässt, hätte den Fehler wieder (Fund der
  Browser-Prüfung in Teilprojekt 1b).
- Ändert ein Update von `react-remove-scroll-bar` den Inhalt des Elements, ändert sich der Hash: die Konsole
  meldet dieselbe Verletzung, das mobile Menü funktioniert dann ohne Scroll-Sperre. Den neuen Hash nennt die
  Konsolenmeldung; er wird im `Caddyfile` ersetzt.
- Eine neue Komponente, die `<style>`-Elemente einfügt, fällt in der Browser-Prüfung durch und wird ersetzt
  oder bewusst per Hash oder Nonce gelöst.
- Ein automatischer Browser-Test, der Dialoge öffnet und CSP-Meldungen sammelt, steht im BACKLOG.
