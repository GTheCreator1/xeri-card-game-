# XERI · ΞΕΡΗ

Ein Browser-Kartenspiel mit euren Xeri-Regeln. Spiele allein gegen eine KI oder öffne einen privaten Tisch für ein Online-Duell oder ein 2-gegen-2. Im Teamspiel kann der Host freie Plätze mit Bots besetzen. Die Oberfläche ist auf Deutsch und funktioniert mit Maus, Tastatur und Touch.

## Lokal starten

Öffne ein Terminal im Projektordner. Starte mit Python 3 einen lokalen HTTP-Server.

```sh
python3 -m http.server 4173
```

Öffne [http://localhost:4173](http://localhost:4173). Unter Windows kann der Python-Befehl `py -m http.server 4173` heißen. Das Spiel verwendet JavaScript-Module, daher öffne es über eine HTTP-Adresse statt per Doppelklick auf `index.html`.

## Auf GitHub Pages veröffentlichen

1. Öffne dein GitHub-Repository. Wähle **Add file → Upload files** oder lade die Änderungen mit Git auf den von dir verwendeten Branch hoch.
2. Lege `index.html`, `style.css`, `script.js`, `package.json` und `README.md` direkt in die Wurzel des Repositorys. Lade auch die Ordner `assets/`, `game/` und `tests/` mit ihrer Struktur hoch. Erstelle den Commit.
3. Öffne im Repository **Settings → Pages**. Wähle unter **Build and deployment** die Quelle **Deploy from a branch**.
4. Wähle den Branch mit deinen Dateien (meist `main`) und den Ordner **/ (root)**. Klicke auf **Save**.
5. Sobald GitHub die Adresse anzeigt, öffne sie und starte zur Kontrolle eine Solo-Partie. Verwende diese öffentliche Adresse, um Einladungslinks für Freunde zu erstellen. Ein Link mit `localhost` verweist jeweils auf das Gerät, auf dem er geöffnet wird.

Für die Veröffentlichung auf GitHub Pages ist ein öffentliches Repository im kostenlosen GitHub-Tarif ausreichend. Xeri benötigt keinen Build und kein eigenes Backend. [GitHub-Pages-Dokumentation](https://docs.github.com/en/pages/getting-started-with-github-pages/creating-a-github-pages-site)

## Einen privaten Raum öffnen

1. Wähle auf der veröffentlichten Spielseite **Online 1 vs. 1** oder **Online 2 vs. 2**, gib deinen Namen ein und klicke auf **Raum erstellen**.
2. Klicke auf **Link kopieren** und schicke den Link z. B. per Messenger an deine Mitspieler. Sie öffnen ihn, geben ihren Namen ein und wählen **Raum beitreten**.
3. Im Teammodus bilden die Plätze 1 und 3 Team A und die Plätze 2 und 4 Team B. Die Plätze werden in Beitrittsreihenfolge besetzt. Lasse deine Partnerin oder deinen Partner zum gewünschten Zeitpunkt beitreten oder fülle davor einen freien Platz mit einem Bot.
4. Sobald alle Plätze bereit sind, klickt der Host auf **Partie starten**. Klicke oder tippe auf eine deiner Karten, sobald du an der Reihe bist. Nach der Endwertung kommt der Host über **Zur Lobby** zu denselben Spielern zurück.

### Verbindung und Wiedereinstieg

PeerJS lädt in einer festgelegten Version vom jsDelivr-CDN. Der öffentliche PeerJS-Dienst vermittelt die WebRTC-Verbindung. Die Browser tauschen den Spielzustand über verschlüsselte Datenkanäle aus. Die Standardkonfiguration von PeerJS verwendet STUN und angebotene TURN-Relays. Ein eingeschränktes Netzwerk, eine Firewall oder ein Ausfall des Dienstes kann den Verbindungsaufbau trotzdem verhindern. Versucht **Erneut verbinden** oder testet ein anderes Netzwerk, z. B. einen mobilen Hotspot.

Der Host hält die Partie im offenen Tab. Wenn ein Gast getrennt wird, pausiert das Spiel. Der Gast kann im selben Tab **Erneut verbinden** wählen oder dort den ursprünglichen Einladungslink erneut öffnen und beitreten. Für die Zuordnung zum gleichen Sitz nutzt der Browser einen Sitzungsschlüssel im Tab. In der Lobby kann der Host einen getrennten Sitz freigeben. Das Schließen oder Neuladen des Host-Tabs beendet die Partie. Danach erstellt der Host einen neuen Raum.

## Regeln und Tests

Die **Spielregeln** sind in der Kopfzeile erreichbar. Jede eingesammelte Karte zählt einen Punkt. Eine Xeri gibt 10 Bonuspunkte, Bube auf einzelnem Buben gibt 20. Der laufende Punktestand zeigt Karten und Bonus getrennt. Pro Spiel kommen genau 52 Karten zum Einsatz.

Führe die automatisierten Tests mit Node.js 22 oder neuer aus. Es sind keine npm-Abhängigkeiten erforderlich.

```sh
npm test
```

Die Tests prüfen einzelne Regelfälle und 120 komplette Partien mit festen Zufallsfolgen. Die Online-Tests verbinden getrennte Sitzungen über einen simulierten Datenkanal. Sie prüfen Einladungen, Lobby, Zugvalidierung, getrennte Kartenansichten, Abbruch und Rückkehr, 1-gegen-1 und 2-gegen-2 bis zur Endwertung.

Für den Praxistest nach dem Veröffentlichen öffne den Link auf getrennten Geräten oder in getrennten Browserprofilen. Spiele ein Duell und ein 2-gegen-2, prüfe die eigene Hand und die Sitzordnung auf jedem Gerät, und unterbrich kurz die Verbindung eines Gastes. Prüfe den Wiedereinstieg und die Fortsetzung. Spiele zusätzlich mit einem oder mehreren Bots und teste über verschiedene Netzwerke, beispielsweise WLAN und Mobilfunk. Diese Schritte betreffen den realen PeerJS-Dienst, WebRTC und die jeweiligen Geräte und Netze.

## Fehler beheben und erweitern

| Bereich | Datei |
| --- | --- |
| Karten, Austeilen, Züge und Wertung | `game/engine.js` |
| Zufall und Taktik der Bots | `game/ai.js` |
| Sitzplätze, geprüfte Spielzüge, Kartenansichten | `game/room.js` |
| Einladung, PeerJS, Verbindungsaufbau und Wiederverbindung | `game/online.js` |
| Spielansichten, Bedienung und Regeldialog | `script.js`, `index.html` |
| Kartenlayout, responsive Gestaltung und Animation | `style.css` |
| Soundeffekte | `game/audio.js` |
| Regel- und Netzwerkregressionen | `tests/` |

Reproduziere Fehler zunächst lokal. Bei einer leeren Seite prüfe die Konsole und den Netzwerk-Tab der Browser-Entwicklerwerkzeuge auf fehlende Dateien. Bei einem Online-Problem notiere die Fehlermeldung und prüfe, ob der Host seinen Tab noch geöffnet hat. Bei Regel- oder Netzwerkänderungen ergänze einen passenden Test in `tests/` und führe `npm test` vor dem nächsten Upload aus.

## Schriften

DM Sans und Playfair Display werden lokal geladen. Ihre SIL Open Font Licenses liegen im Ordner `assets/fonts/`.
