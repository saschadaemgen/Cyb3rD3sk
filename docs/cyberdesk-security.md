# CyberDesk - Sicherheit

Projekt CARVILON CyberDesk · lebendes Dokument · Stand: 08.07.2026

## Eisernes Gesetz

Die Surf-Zone (CEF) hat by design keinen Pfad zu CARVILON-Funktionen (Türen, Kameras, Zeitstempel). Es existiert keine IPC-Route vom Web-Renderer zu Steuerkommandos. Trennung durch Architektur, nicht durch Filter.

## Prozessgrenzen und IPC

- Rust-Host und CEF-Renderer sind durch eine harte Prozessgrenze getrennt; die Chromium-Sandbox bleibt aktiv.
- IPC ausschließlich über eine explizite Allowlist benannter Kommandos (Schema in cyberdesk-wire-format.md, entsteht ab CD-02).
- Keine generischen Eval- oder Passthrough-Kanäle.

## Schlüssel und Autorisierung (geplant, Season 6)

- Start-Autorisierung: Passphrase oder Token → Argon2id → Schlüssel → verschlüsselter App-State wird entschlüsselt → erst dann rendert die Oberfläche.
- Zeroize für sämtliches Schlüsselmaterial. Keine Schlüssel vor der Authentifizierung im Speicher. Kein Schlüsselmaterial in der WebView, niemals.

## NetGuard

Deny-by-default pro Zone, Allowlist der Ziele, Certificate-Pinning (MITM-Erkennung), eigener DNS-Resolver (kein Leak am System-DNS vorbei), Kill-Switch pro Verbindung, Volumen- und Verbindungszähler. Anomalie-Signale: nie gesehenes Ziel, Beaconing-Takt, Volumensprung außerhalb der Baseline, Zertifikatswechsel am gepinnten Ziel, DNS außerhalb der Allowlist. Regelbasiert und erklärbar zuerst, Statistik später. Security-Alerts laufen als Ereignisse durch die Prioritäts-Engine - dieselbe Maschinerie wie Klingeln.

## Supply Chain

Gepinnte Dependencies, cargo-audit und cargo-deny im Workflow, keine GPL-Verlinkung (D-0005), CEF-Version exakt gepinnt, große Binaries nie im Repo (Fetch-Skript).

## CRA (Cyber Resilience Act)

Meldepflichten ab September 2026, Vollcompliance Dezember 2027. Von Anfang an eingebaut statt nachgerüstet: Update-Fähigkeit (signierte Updates geplant), SBOM-Erzeugung, Vorfalls-Protokollierung (später Hash-Chain), dokumentierter Schwachstellen-Meldeweg.

## Repo-Hygiene

Pre-Push-Grep gegen echte IPs, Hostnamen und Secrets vor jedem Push. Testdaten ausschließlich mit Platzhaltern (Dokumentations-IPs wie 203.0.113.x). Repo bleibt privat.
