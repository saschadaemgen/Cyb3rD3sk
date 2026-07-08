# CyberDesk - Entscheidungen

Neueste Entscheidung oben. Format: D-Nummer · Datum · Entscheidung · Begründung.

## D-0008 · 2026-07-08 · CD-01: CEF ohne OS-Sandbox (befristet), isolierte Profil-Root, GPU-Fallback

Für den CD-01-Machbarkeitsbeweis läuft die CEF-Einbettung **ohne** Windows-OS-
Sandbox (`Settings.no_sandbox = 1`, cef-rs `sandbox`-Feature aus).

**Warum (befristete, bewusste Abweichung von „Sandbox bleibt aktiv", D-0001 / security.md):**
Der Windows-Sandbox-Pfad von cef-rs erfordert das **`bootstrap.exe`/cdylib-Modell**
(mit aktiviertem `sandbox`-Feature verweigert das `bin`-Target den Start und
verlangt eine `bootstrap.exe`-Bündelung via `bundle-cef-app`). Das würde den
Abnahme-Pfad `cargo run --release` durch einen gebündelten Exe-Start ersetzen.
CD-01 ist ein Feasibility-Spike (lädt google.com im Dev-Kontext), kein Produktiv-
Browser. Ich benenne die Spannung zu **D-0006** (der schwerere Weg schlägt den
Kompromiss) offen: dies **ist** ein Kompromiss, aber ein zeitlich begrenzter und
umfangsbezogener — die Sandbox gehört in die Sicherheits-Etappe.

**Auflage (hart):** Vor echtem/ungetrautem Browser-Einsatz (Season 5) und
spätestens vor Krypto/Autorisierung (Season 6) wird die OS-Sandbox über das
bootstrap-Modell **wieder aktiviert** (die gepinnte CEF-Distribution enthält
`bootstrap.exe`/`bootstrapc.exe`). Die Chromium-**Multiprozess**-Trennung
(Renderer/GPU in eigenen Prozessen) ist bereits jetzt aktiv; „no_sandbox"
entfernt nur die OS-Härtung dieser Prozesse.

**Zusätzlich – isolierte Profil-Root:** CEF erhält ein eigenes
`root_cache_path` (`<exe>/cyberdesk-cache`), damit die Surf-Zone **niemals**
Profil/Session mit einem separat installierten Chrome teilt (Prozess-Singleton-
Isolation; behob u. a. einen Fall, in dem der eingebettete View eine fremde
Session lud). Deckt sich mit dem „Eisernen Gesetz" der Trennung.

**Bekannte Einschränkung:** Im Release-Build beendet sich der CEF-**GPU-
Unterprozess** wiederholt (STATUS_BREAKPOINT); CEF fällt auf das mitgelieferte
**SwiftShader** (Software-Rendering) zurück und die Seite rendert korrekt
(verifiziert: google.com erscheint chromelos im Vollbild-Release). Die stderr-
Meldungen sind im GUI-Subsystem-Release unsichtbar. Ursachenanalyse ist nach
CD-02 (OSR) vorgemerkt, das den GPU-Pfad ohnehin neu aufsetzt.

## D-0007 · 2026-07-08 · Bearbeiten-Modus statt freier Fenster

Festes Layout ist der Normalzustand. Positionswechsel nur in einem expliziten Bearbeiten-Modus und nur innerhalb der Rastervorgaben (erlaubte Slots, Snapping). Danach wird wieder verriegelt. Begründung: Vorhersehbarkeit ist Produktkern; kontrollierte Anpassung ja, Layout-Anarchie nein.

## D-0006 · 2026-07-08 · High-Performance-Doktrin

Bei Abwägungen gewinnt der bessere, schwerere Weg gegen Kompromiss und Abkürzung (Vorgabe Sascha, bindend). Gilt für Architektur- und Qualitätsentscheidungen. Leitplanke: Die Doktrin betrifft die Qualität des Wegs, nicht den Umfang - gebaut wird weiterhin in Etappen.

## D-0005 · 2026-07-08 · Keine GPL-Verlinkung im proprietären Kern

libsigrok u. ä. (GPLv3) werden nicht gelinkt. Logik-Analyzer: eigener FX2-Treiber via rusb, eigene Decoder (zuerst UART, I2C, SPI). Unveränderte GPL-Firmware (fx2lafw) darf als separate Datei mit Quellenhinweis ausgeliefert werden - sie läuft auf dem Gerät, nicht in unserem Prozess.

## D-0004 · 2026-07-08 · NetGuard-Prinzip

Kein Netzwerkzugriff außer durch die zentrale NetGuard-Schicht. Deny-by-default pro Zone, Certificate-Pinning pro Ziel, eigener DNS-Resolver, Kill-Switch, Protokollierung (später Hash-Chain). Ab CD-02 bindend in jedem Briefing.

## D-0003 · 2026-07-08 · Debian 13 "Trixie" als OS-Fundament (Fernziel)

Für das spätere CARVILON OS: Debian stable statt Ubuntu - markenrechtlich neutral, schlanker Start ohne Fremd-Branding, live-build ist Debians eigenes Werkzeug, Updates weiter aus Debian-Quellen (kein Fork). CyberDesk wird dessen Shell.

## D-0002 · 2026-07-08 · CEF-Binding: cef-rs, gepinnt auf CEF 149.0.6

Gewählt: das cef-Crate (tauri-apps/cef-rs), exakt gepinnt auf `cef = "=149.3.0"` (= `149.3.0+149.0.6`) → CEF-Distribution `149.0.6+g0d0eeb6+chromium-149.0.7827.201`, windows64, Variante `minimal` (SHA1 `fe8f461b743f03dc640e998ae08264407d8bc2c9`, offizielle CDN `cef-builds.spotifycdn.com`). Cargo.lock committet → transitive Pins. Gründe: vorgenerierte Bindings (kein libclang zur Build-Zeit), Wrapper-Build reproduzierbar via CMake+Ninja, und ein chromeloser Child-Browser-View über `RuntimeStyle::ALLOY` + `WindowInfo::set_as_child` (passt zur Vorgabe „kein Browser-UI"; der Chrome-Runtime-Stil würde eine Omnibox zeigen). Die gepinnte Distribution wird per `scripts/fetch-cef.ps1` nach `vendor/cef/` geholt (nie im Repo). Begründete Alternative (direkte C-API via Bindgen) bliebe zulässig. Build-Voraussetzungen: CMake ≥ 3.29, Ninja, Python 3, VS 2022 C++ (Wrapper mit statischer CRT). Zur Sandbox siehe D-0008 (für CD-01 befristet deaktiviert, mit harter Wieder-Aktivierungs-Auflage).

## D-0001 · 2026-07-08 · Rust-Host + CEF statt Electron/Tauri

Krypto und Start-Autorisierung gehören in den speichersicheren Rust-Prozess: Argon2id und Zeroize sind in einer JS-Runtime (V8, Garbage Collector) praktisch nicht sauber umsetzbar. Die Surf-Zone braucht Offscreen-Rendering (Seite als GPU-Textur mit weichen Rändern) - das kann Tauris System-WebView nicht. CEF ist Chromium ohne Node und ohne npm-Kette; die Chromium-Sandbox bleibt aktiv. Fairness-Anmerkung: modernes Electron ist mit korrekten Defaults besser als sein Ruf, erfüllt aber weder die Zeroize- noch die OSR-Anforderung.
