# CyberDesk - Wire-Format

Projekt CARVILON CyberDesk · lebendes Dokument · Stand: 08.07.2026

Noch bewusst dünn - die Formate entstehen ab CD-02. Regel: Jede Schnittstellen-Änderung wird hier dokumentiert, bevor sie in main landet.

## Host↔CEF IPC (geplant)

- Explizite Allowlist benannter Kommandos. Pro Kommando dokumentiert: Name, Richtung, Felder, Fehlerfälle.
- Keine generischen Eval- oder Passthrough-Kanäle.
- Erste Kommandos entstehen mit CD-02: Frame-Übergabe (OSR-Textur), Input-Weiterleitung (Maus/Tastatur), Navigation (URL laden, zurück/vor).

## NetGuard-Policy (Skizze)

- Pro Zone: erlaubte Ziele (Host, Port, Protokoll), optionaler Pinning-Fingerprint, Limits (Rate, Volumen).
- Default: deny. Policy-Änderungen sind versioniert und werden protokolliert.
- Format-Entscheidung (Datei vs. SQLite) fällt mit dem NetGuard-Grundausbau.

## CARVILON-Protokolle

- Die Anbindung an Edge und VPS folgt in Season 7. Maßgeblich bleiben die Server-Dokumente (carvilon-server-wire-format.md); dieses Dokument hält dann nur die CyberDesk-Sicht (welche Endpunkte, welche Richtung, welche Auth).
