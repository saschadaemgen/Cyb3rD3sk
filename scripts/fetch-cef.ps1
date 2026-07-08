#requires -Version 5.1
<#
.SYNOPSIS
    Lädt die für CyberDesk gepinnte Chromium-Embedded-Framework-Version herunter
    und richtet sie unter vendor/cef/ ein.

.DESCRIPTION
    Die CEF-Binaries sind mehrere hundert MB groß und liegen NIEMALS im Repo.
    Dieses Skript lädt die exakt gepinnte CEF-Distribution (siehe
    docs/decisions.md, D-0002) von der offiziellen Spotify-CDN, verifiziert die
    SHA1-Summe, entpackt sie und flacht sie in genau das Layout ab, das das
    Crate `cef-dll-sys` erwartet (Release/ + Resources/ + include/ + libcef_dll/
    + cmake/ ins Wurzelverzeichnis, plus einen archive.json-Marker). Dadurch
    verwendet der Build vendor/cef/ direkt (kein erneuter Download).

    Idempotent: ein erneuter Aufruf ohne -Force erkennt eine vorhandene, gültige
    Installation und tut nichts.

.PARAMETER Dest
    Zielverzeichnis. Standard: <repo>/vendor/cef.

.PARAMETER Force
    Vorhandene Installation entfernen und neu einrichten.

.EXAMPLE
    ./scripts/fetch-cef.ps1
.EXAMPLE
    ./scripts/fetch-cef.ps1 -Force
#>
[CmdletBinding()]
param(
    [string]$Dest = (Join-Path $PSScriptRoot '..\vendor\cef'),
    [switch]$Force
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

# --- Gepinnte CEF-Distribution (D-0002) -------------------------------------
$CdnBase          = 'https://cef-builds.spotifycdn.com'
$CefArchive       = 'cef_binary_149.0.6+g0d0eeb6+chromium-149.0.7827.201_windows64_minimal.tar.bz2'
$CefSha1          = 'fe8f461b743f03dc640e998ae08264407d8bc2c9'
$ExtractedDirName = 'cef_binary_149.0.6+g0d0eeb6+chromium-149.0.7827.201_windows64_minimal'
# ----------------------------------------------------------------------------

function Write-Step([string]$Message) { Write-Host "==> $Message" -ForegroundColor Cyan }

$Dest = [System.IO.Path]::GetFullPath($Dest)
$archiveJsonPath = Join-Path $Dest 'archive.json'

# --- Idempotenz-Prüfung -----------------------------------------------------
if ((Test-Path -LiteralPath $archiveJsonPath) -and -not $Force) {
    Write-Step "CEF ist bereits eingerichtet unter: $Dest"
    Write-Host "    (mit -Force neu einrichten)"
    exit 0
}

# --- tar (bsdtar aus Windows) auffinden; kann .tar.bz2 direkt entpacken ------
$TarExe = Join-Path $env:SystemRoot 'System32\tar.exe'
if (-not (Test-Path -LiteralPath $TarExe)) { $TarExe = 'tar' }

# --- Download in temporäres Verzeichnis -------------------------------------
$TmpRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("cyberdesk-cef-" + [System.IO.Path]::GetRandomFileName())
New-Item -ItemType Directory -Path $TmpRoot -Force | Out-Null

try {
    $ArchivePath = Join-Path $TmpRoot $CefArchive
    $Url = "$CdnBase/$CefArchive"

    Write-Step "Lade CEF herunter:"
    Write-Host "    $Url"
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    $client = New-Object System.Net.WebClient
    try {
        $client.DownloadFile($Url, $ArchivePath)
    } finally {
        $client.Dispose()
    }
    $sw.Stop()
    $sizeMb = [math]::Round((Get-Item -LiteralPath $ArchivePath).Length / 1MB, 1)
    Write-Host "    heruntergeladen: $sizeMb MB in $([math]::Round($sw.Elapsed.TotalSeconds,1)) s"

    # --- SHA1 verifizieren --------------------------------------------------
    Write-Step "Verifiziere SHA1-Summe ..."
    $actual = (Get-FileHash -Algorithm SHA1 -LiteralPath $ArchivePath).Hash.ToLowerInvariant()
    if ($actual -ne $CefSha1.ToLowerInvariant()) {
        throw "SHA1-Fehler: erwartet $CefSha1, erhalten $actual. Download beschädigt."
    }
    Write-Host "    OK ($actual)"

    # --- Entpacken ----------------------------------------------------------
    Write-Step "Entpacke Archiv ..."
    $ExtractRoot = Join-Path $TmpRoot 'extract'
    New-Item -ItemType Directory -Path $ExtractRoot -Force | Out-Null
    & $TarExe -x -f $ArchivePath -C $ExtractRoot
    if ($LASTEXITCODE -ne 0) { throw "tar-Entpacken fehlgeschlagen (Exit $LASTEXITCODE)." }
    $SrcDir = Join-Path $ExtractRoot $ExtractedDirName
    if (-not (Test-Path -LiteralPath $SrcDir)) {
        throw "Erwartetes Verzeichnis nach dem Entpacken nicht gefunden: $SrcDir"
    }

    # --- Zielverzeichnis frisch anlegen -------------------------------------
    if (Test-Path -LiteralPath $Dest) {
        Write-Step "Entferne vorhandenes Zielverzeichnis ..."
        Remove-Item -LiteralPath $Dest -Recurse -Force
    }
    New-Item -ItemType Directory -Path $Dest -Force | Out-Null

    # --- Ins von cef-dll-sys erwartete Layout abflachen ---------------------
    # Reihenfolge/Inhalt gemäß download-cef::extract_target_archive:
    #   Release/*   -> vendor/cef/      (libcef.dll, libcef.dll.lib, chrome_elf.dll, *.bin, ...)
    #   Resources/* -> vendor/cef/      (icudtl.dat, *.pak, locales/)
    #   include, libcef_dll, cmake, CMakeLists.txt, CREDITS.html -> vendor/cef/
    Write-Step "Richte Layout ein unter: $Dest"

    foreach ($sub in @('Release', 'Resources')) {
        $subPath = Join-Path $SrcDir $sub
        if (-not (Test-Path -LiteralPath $subPath)) { throw "Fehlt im Archiv: $sub" }
        Get-ChildItem -Force -LiteralPath $subPath | ForEach-Object {
            Move-Item -LiteralPath $_.FullName -Destination $Dest -Force
        }
    }

    foreach ($item in @('include', 'libcef_dll', 'cmake', 'CMakeLists.txt', 'CREDITS.html', 'LICENSE.txt', 'README.txt')) {
        $p = Join-Path $SrcDir $item
        if (Test-Path -LiteralPath $p) {
            Move-Item -LiteralPath $p -Destination $Dest -Force
        }
    }

    # --- Marker schreiben (archive.json) ------------------------------------
    # cef-dll-sys/build.rs liest diesen Marker (check_archive_json) und
    # verwendet dann vendor/cef direkt, ohne erneut herunterzuladen.
    $archiveJson = ([ordered]@{ type = 'minimal'; name = $CefArchive; sha1 = $CefSha1 } | ConvertTo-Json)
    [System.IO.File]::WriteAllText($archiveJsonPath, $archiveJson)  # UTF-8 ohne BOM

    # --- Plausibilitätsprüfung ---------------------------------------------
    $required = @('libcef.dll', 'libcef.dll.lib', 'icudtl.dat', 'CMakeLists.txt')
    $missing = @()
    foreach ($r in $required) {
        if (-not (Test-Path -LiteralPath (Join-Path $Dest $r))) { $missing += $r }
    }
    if (-not (Test-Path -LiteralPath (Join-Path $Dest 'include'))) { $missing += 'include/' }
    if (-not (Test-Path -LiteralPath (Join-Path $Dest 'libcef_dll'))) { $missing += 'libcef_dll/' }
    if (-not (Test-Path -LiteralPath (Join-Path $Dest 'locales'))) { $missing += 'locales/' }
    if ($missing.Count -gt 0) {
        throw ("Layout unvollständig, fehlend: " + ($missing -join ', '))
    }

    Write-Host ""
    Write-Step "Fertig. CEF ist eingerichtet."
    Write-Host "    Version: $ExtractedDirName"
    Write-Host "    Pfad   : $Dest"
    Write-Host "    Als Nächstes: cargo run --release   (bzw. -- --windowed)"
}
finally {
    if (Test-Path -LiteralPath $TmpRoot) {
        Remove-Item -LiteralPath $TmpRoot -Recurse -Force -ErrorAction SilentlyContinue
    }
}
