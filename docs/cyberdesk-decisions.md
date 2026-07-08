# CyberDesk - Entscheidungen

Neueste Entscheidung oben. Format: D-Nummer · Datum · Entscheidung · Begründung.

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

Gewählt: das cef-Crate (tauri-apps/cef-rs), exakt gepinnt auf `cef = "=149.3.0"` (= `149.3.0+149.0.6`) → CEF-Distribution `149.0.6+g0d0eeb6+chromium-149.0.7827.201`, windows64, Variante `minimal` (SHA1 `fe8f461b743f03dc640e998ae08264407d8bc2c9`, offizielle CDN `cef-builds.spotifycdn.com`). Cargo.lock committet → transitive Pins. Gründe: vorgenerierte Bindings (kein libclang zur Build-Zeit), Wrapper-Build reproduzierbar via CMake+Ninja, und ein chromeloser Child-Browser-View über `RuntimeStyle::ALLOY` + `WindowInfo::set_as_child` (passt zur Vorgabe „kein Browser-UI"; der Chrome-Runtime-Stil würde eine Omnibox zeigen). Die gepinnte Distribution wird per `scripts/fetch-cef.ps1` nach `vendor/cef/` geholt (nie im Repo). Begründete Alternative (direkte C-API via Bindgen) bliebe zulässig. Build-Voraussetzungen: CMake ≥ 3.29, Ninja, Python 3, VS 2022 C++ (Wrapper mit statischer CRT). Anmerkung zur Sandbox (D-0001, security.md „Sandbox bleibt aktiv"): der Windows-Sandbox-Pfad von cef-rs erfordert eine `bootstrap.exe`-Bündelung; die konkrete Umsetzung wird in Etappe B (CEF-Einbettung) entschieden und hier nachgetragen.

## D-0001 · 2026-07-08 · Rust-Host + CEF statt Electron/Tauri

Krypto und Start-Autorisierung gehören in den speichersicheren Rust-Prozess: Argon2id und Zeroize sind in einer JS-Runtime (V8, Garbage Collector) praktisch nicht sauber umsetzbar. Die Surf-Zone braucht Offscreen-Rendering (Seite als GPU-Textur mit weichen Rändern) - das kann Tauris System-WebView nicht. CEF ist Chromium ohne Node und ohne npm-Kette; die Chromium-Sandbox bleibt aktiv. Fairness-Anmerkung: modernes Electron ist mit korrekten Defaults besser als sein Ruf, erfüllt aber weder die Zeroize- noch die OSR-Anforderung.
