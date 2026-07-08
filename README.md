# CARVILON CyberDesk

CyberDesk ist das Desktop-Frontend der CARVILON-Plattform – eine einzige
Vollbild-Anwendung im Stil eines seriösen „Cyber-Betriebssystems". Ein
speichersicherer Rust-Host rendert die Shell (festes Zonen-Layout, eine
Farbwelt, animationslastig) und bettet über das Chromium Embedded Framework
(CEF) Web-Inhalte als native Views ein. In dieser Season liefert CyberDesk das
startbare Fundament plus den Machbarkeitsbeweis, dass CEF im Rust-Host läuft.

> Proprietär – Copyright (c) 2026 Sascha Daemgen IT and More Systems.
> Alle Rechte vorbehalten. Siehe `LICENSE`.

---

## Stand nach CD-01

* **Etappe A – Shell:** Randloses Vollbild auf dem Primärmonitor, dunkler
  Hintergrund (`#04070A`), zentrierter, langsam rotierender CARVILON-Ring
  (offener Bogen + hohler Kern-Ring, `#009FE3`), `vsync`. `ESC` beendet sauber.
  Dev-Modus über `--windowed` (1600×900).
* **Etappe B – CEF:** Ein chromeloser CEF-Browser-View (nur die nackte
  Seitenfläche, kein Browser-UI) wird zentriert ins Shell-Fenster eingebettet
  und lädt eine Web-Seite. Popups werden unterdrückt bzw. in-place navigiert.

Ziel-Plattform: **Windows 11 (x64, MSVC)**. Andere Plattformen sind bewusst
nicht Teil dieses Tickets.

---

## Voraussetzungen

| Werkzeug | Zweck | Hinweis |
| --- | --- | --- |
| Rust (stable, `x86_64-pc-windows-msvc`) | Build | via `rustup` |
| Visual Studio 2022 – „Desktop development with C++" | MSVC-Linker + Windows-SDK | für Rust-MSVC und den CEF-Wrapper |
| CMake ≥ 3.29 | baut `libcef_dll_wrapper` | muss auf `PATH` sein |
| Ninja ≥ 1.12 | CMake-Generator für den Wrapper | muss auf `PATH` sein |
| Python 3 | Build-Helfer von CEF/Chromium | muss auf `PATH` sein |
| PowerShell 5.1+ | `scripts/fetch-cef.ps1` | Windows-Bordmittel |

Schnelltest, dass alles vorhanden ist:

```pwsh
rustc --version; cargo --version; cmake --version; ninja --version; python --version
```

---

## 1. CEF-Binaries holen (einmalig / bei Versionswechsel)

Die CEF-Binaries sind mehrere hundert MB groß und liegen **niemals** im Repo.
Das folgende Skript lädt die exakt gepinnte CEF-Version (siehe
`docs/cyberdesk-decisions.md`, D-0002) von der offiziellen CDN nach `vendor/cef/` und
richtet sie so ein, dass der Build sie direkt verwendet:

```pwsh
# aus dem Repo-Wurzelverzeichnis
./scripts/fetch-cef.ps1
```

Das Skript prüft die SHA1-Summe des Downloads und ist idempotent
(erneuter Aufruf ohne `-Force` erkennt eine vorhandene Installation).
`vendor/cef/` ist in `.gitignore` eingetragen.

---

## 2. Bauen & Starten

CyberDesk findet die CEF-Installation über die Umgebungsvariable `CEF_PATH`,
die bereits in `.cargo/config.toml` auf `vendor/cef/` gesetzt ist – es ist
also keine manuelle Konfiguration nötig.

```pwsh
# Vollbild (Abnahme-Modus)
cargo run --release

# Gefenstert 1600x900 (Dev-Modus)
cargo run --release -- --windowed
```

* **`ESC`** beendet die Anwendung sauber.
* Der erste Build ist langsam, weil CMake+Ninja den `libcef_dll_wrapper`
  kompilieren. Die CEF-Laufzeitdateien (`libcef.dll`, Ressourcen, `locales/`)
  werden automatisch neben die `.exe` in `target/<profil>/` kopiert.

### Optional: Render-Selbsttest ohne Fenster

Rendert einen einzelnen Ring-Frame offscreen in eine PNG-Datei (nützlich für
CI / visuelle Regression, stört keinen Desktop):

```pwsh
cargo run --release -- --capture ring.png
```

---

## Projektstruktur

```
cyberdesk/
├─ src/
│  ├─ main.rs        # Einstieg, CLI, Prozess-Modell
│  ├─ app.rs         # winit-Event-Loop, Fenster, ESC
│  ├─ renderer.rs    # wgpu-Renderer (Ring), Offscreen-Capture
│  ├─ ring.wgsl      # Shader für Hintergrund + CARVILON-Ring
│  └─ cef/           # CEF-Einbettung (Etappe B)
├─ scripts/
│  └─ fetch-cef.ps1  # lädt die gepinnte CEF-Version nach vendor/cef/
├─ docs/                         # lebende Projekt-Dokumente
│  ├─ cyberdesk-architecture.md
│  ├─ cyberdesk-decisions.md     # D-0001 … D-0007
│  ├─ cyberdesk-security.md
│  ├─ cyberdesk-wire-format.md
│  ├─ cyberdesk-feature-backlog.md
│  └─ cyberdesk-roadmap.txt
├─ .cargo/config.toml
└─ vendor/cef/       # (git-ignored) CEF-Binaries
```

---

## Fehlerbehebung

* **`CMake`/`Ninja` nicht gefunden:** In VS 2022 die Komponente „C++ CMake
  tools for Windows" installieren oder CMake/Ninja separat installieren und
  auf `PATH` legen.
* **Link-Fehler zu `libcef`:** `vendor/cef/` fehlt oder ist unvollständig –
  `./scripts/fetch-cef.ps1 -Force` erneut ausführen.
* **Schwarzer statt dunkler Hintergrund / kein Ring:** Grafiktreiber prüfen;
  wgpu benötigt einen funktionierenden D3D12- oder Vulkan-Backend-Adapter.
* **`GPU process exited unexpectedly` auf stderr:** bekannt und harmlos – CEF
  fällt auf Software-Rendering (SwiftShader) zurück, die Seite rendert korrekt.
  Details und der Plan zur Behebung stehen in `docs/cyberdesk-decisions.md`
  (D-0008). Im Release-Vollbild (kein Konsolenfenster) ist die Meldung ohnehin
  unsichtbar.
* **CEF-Profil/Cache:** liegt isoliert unter `target/<profil>/cyberdesk-cache/`
  (git-ignoriert) – die Surf-Zone teilt bewusst keinen Zustand mit einem
  separat installierten Chrome.
