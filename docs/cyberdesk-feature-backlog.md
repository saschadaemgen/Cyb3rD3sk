# CyberDesk - Feature-Backlog

Weiche Season-Zuordnung - Chat-Füllstand und Realität entscheiden über die echten Schnitte. Erledigtes wandert ins jeweilige Season-Protokoll.

## Fundament (Season 1, laufend)

- CD-01 Shell-Skeleton (winit/wgpu, Vollbild, rotierender Ring, ESC, --windowed) + CEF windowed mit google.com [bei CC]
- CD-02 OSR-PoC: Webseite als GPU-Textur im eigenen Frame
- CD-03 Feathering/Compositing: weiche Ränder, animierter Grund hinter dem Inhalt

## Design (Season 2)

- Design-Gesetz: Farbwelt, Bewegungssprache, Hintergrund-Shader - Referenzdateien von CD (Claude Design) sind bindend, CC setzt 1:1 um
- Drag-and-Drop als globale Design-Sprache: Ghost-Element, Zonen-Highlight beim Überfahren, magnetisches Andocken, Feder-Animation (Spezifikation CD, Implementierung CC)
- Start-Animation der App (Logo-Rotation); Plymouth-Theme bleibt für den OS-Pfad vorgemerkt

## Zonen-Engine (Season 3)

- Festes Raster: Spine, Hauptbereich S/M/L mit Reflow, Videozone, Terminalzone, rechte Reiter-Zone (Status, Dateien, FTP, Musik)
- Ultrawide-Layout als Primärziel, 16:9 als Fallback
- Bearbeiten-Modus (D-0007): erlaubte Slots, Snapping, Verriegelung danach

## Modi + Ereignisse (Season 4)

- Modi: Standard, Admin (Hauptbereich größer), Nicht-stören
- Prioritäts-Engine: Ereignis x Zonen-Rang x Modus → überschreiben, einblenden oder unterdrücken; zunächst mit simulierten Ereignissen

## Browser wird CARVILON (Season 5)

- Favoriten und Verlauf in SQLite, eigene Buttons abseits des Inhalts
- Downloads landen in der Dateien-Zone; Kontextmenü, JS-Dialoge und Popups im eigenen Design
- Request-Filter als Adblock-Fundament (Filterlisten auf Netzwerkebene)
- Später: Widevine für Streaming-DRM (Lizenzprozess bei Google einplanen), Autofill über den Rust-Passwortkern

## Krypto + Autorisierung (Season 6)

- Argon2id, Zeroize, verschlüsselter App-State, Start-Freigabe, Schlüsselverwaltung

## CARVILON-Anbindung (Season 7)

- Kameras (Streams), Türsteuerung, Status vom Edge, Zeitstempel
- NetGuard-Regeln für Edge und VPS; Security-Alerts in die Ereignis-Engine

## Werkzeuge (danach, offen geschnitten)

- Terminal, Code-Editor, Datei-Explorer, FTP-Client
- Logik-Analyzer: FX2-Treiber (rusb), Firmware-Upload, Decoder UART/I2C/SPI (später 1-Wire, PWM), wgpu-Wellenform-Rendering, Hotplug → Reiter erwacht am festen Platz
- NetGuard-Monitor: Flow-Karte, Live-Zähler, Kill-Switch, Anomalie-Alerts

## Alltag (danach)

- Musik, Nachrichten (SimpleX-Client), E-Mail, Telefonie/Videotelefonie, Kalender + Tagesplaner, News/Status
- Office-Einheit: EIN Werkzeug für Text und Tabellen statt zwei Programmen - Textdokumente mit echten Tabellen- und Formelblöcken inline ("was ein normaler Mensch braucht"). Export PDF zuerst, docx/xlsx-Import und -Export später. Keine Office-Feature-Parität als Ziel.

## Fernziel

- CARVILON OS: Debian 13, gebrandeter Calamares-Installer, CyberDesk bootet als Shell
- NetGuard-Ausbau zur Geräte-Firewall auf der Appliance (nftables-Regeln aus derselben Policy, eBPF-Monitoring via aya)
