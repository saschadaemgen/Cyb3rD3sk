# CyberDesk - Architektur

Projekt CARVILON CyberDesk · lebendes Dokument · Stand: 08.07.2026 (vor Abschluss CD-01)
Proprietär · Copyright (c) 2026 Sascha Daemgen IT and More Systems. All rights reserved.

## Was CyberDesk ist

Eine einzige Vollbild-Anwendung im Stil eines seriösen Cyber-Betriebssystems: festes Zonen-Layout, eine Farbwelt (Grund #04070A, Markenblau #009FE3), stark animiert, optimiert für Ultrawide-Displays (Zielbild ca. 1,20 m Bildbreite, 16:9 als Fallback). Es laufen ausschließlich CARVILON-eigene Anwendungen plus eine Surf-Zone. Keine frei verschiebbaren Fenster - Vorhersehbarkeit ist der Produktkern.

## Schichtenmodell

1. **Zonen (fest):** Spine links, Hauptbereich (drei Größen S/M/L mit Reflow der Nachbarzonen), Videozone, Terminalzone, rechte Reiter-Zone (Status, Dateien, FTP, Musik, ...). Positionen sind Gesetz. Änderungen nur im Bearbeiten-Modus innerhalb der Rastervorgaben (D-0007).
2. **Modi (Layout-Presets):** Standard, Admin (Hauptbereich größer), Nicht-stören u. a. Ein Modus lädt ein Preset desselben festen Layouts - er erfindet kein neues.
3. **Ereignis-Prioritäts-Engine:** Ereignisse (Klingeln, Anruf, Alarm, Security-Alert) tragen Prioritäten, Zonen tragen Ränge, der Modus ist das Gate. Entscheidung pro Ereignis: überschreiben, einblenden oder unterdrücken. Auch Störungen sind reglementiert.

## Prozess- und Technikmodell

- **Rust-Host:** Fensterverwaltung (winit), Rendering (wgpu), Zonen/Modi/Ereignis-Engine, später Krypto (Argon2id, Zeroize) und Start-Autorisierung.
- **CEF (Chromium Embedded Framework):** liefert ausschließlich Pixel der Surf-Zone. CD-01: windowed Embed als Feasibility-Beweis; ab CD-02 Offscreen-Rendering in eine GPU-Textur, danach Feathering/Compositing im eigenen Frame (weiche, ins Design blutende Ränder).
- **Harte Prozessgrenze Host↔CEF**, IPC nur über explizite Allowlist. Kein Electron, kein Node, keine npm-Kette im Kern. Chromium-Sandbox bleibt aktiv.
- **NetGuard:** Kein Modul öffnet selbst Verbindungen; alles läuft durch die zentrale Netz-Schicht (deny-by-default pro Zone, Certificate-Pinning, eigener DNS-Resolver, Kill-Switch, Zähler). Browser-Traffic hängt über den CefRequestHandler am selben Monitor.

## Plattform-Pfad

Entwicklung: Windows 11 (MSVC). Später: Linux-Appliance. Fernziel: CARVILON OS (Debian 13 "Trixie"), das direkt in CyberDesk als Shell bootet - die App ist erste Lieferung und späteres Herz des OS. Nichts aus dem App-Weg ist Wegwerfarbeit.

## Status

CD-01 (Shell-Skeleton + CEF-Feasibility) bei CC in Arbeit. Dieses Dokument wird nach jeder Season, bei Bedarf auch zwischendurch, aktualisiert.
