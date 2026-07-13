# CyberDesk - Security

Project CARVILON CyberDesk - living document - Status: 2026-07-13

## Iron law

The surf zone (CEF) has no path to CARVILON functions (doors, cameras, time clock) by design. No IPC route exists from the web renderer to control commands. Separation by architecture, not by filter.

## Process boundaries and IPC

- Rust host and CEF renderers are separated by a hard process boundary; the Chromium sandbox stays active.
- IPC exclusively through an explicit allowlist of named commands (schema in cyberdesk-wire-format.md, emerging from CD-02).
- No generic eval or passthrough channels.

## Keys and authorization (planned, Season 6)

- Start authorization: passphrase or token -> Argon2id -> key -> encrypted app state is decrypted -> only then does the UI render.
- Zeroize for all key material. No keys in memory before authentication. No key material in the WebView, ever.

## NetGuard

Deny-by-default per zone, destination allowlist, certificate pinning (MITM detection), own DNS resolver (no leak past the system DNS), kill switch per connection, volume and connection counters. Anomaly signals: never-seen destination, beaconing cadence, volume spike outside the baseline, certificate change on a pinned destination, DNS outside the allowlist. Rule-based and explainable first, statistics later. Security alerts run as events through the Priority Engine - the same machinery as the doorbell.

## De-Googled by measurement (CD-17, D-0041)

The host opens no HTTP client of its own (D-0036). CD-17 silences the second
source of unsolicited traffic: the **Chromium engine's own phone-home to Google**.
Every phone-home vector - Safe Browsing (feature + per-navigation lookups),
component updater, variations/Finch seed fetch, connectivity/captive-portal
probes, network prediction, search suggest, domain reliability/NEL, translate,
enhanced spell check, autofill + password leak-check, navigation-error
link-doctor, optimization hints, GCM/push - is disabled via CEF command-line
switches and preferences, applied to **clearnet and Tor slots alike**. Secure DNS
(DoH) is pinned `off` so clearnet uses the OS resolver deterministically; Tor
slots resolve DNS remotely through the tunnel (CD-15). Switch/preference names are
verified against the pinned Chromium `149.0.7827.201` source (the enforcement
table is `src/degoogle.rs`).

**The claim is bounded and measured.** "De-Googled" here means the engine makes
**no unsolicited connection to Google or telemetry**, proven by a net-log capture
on idle and while browsing (the recipe is `cyberdesk-degoogle-audit.md`; the live
run is the maintainer's). It does **not** mean the user's own navigation is hidden
(that traffic goes where the user navigates), nor that zero bytes ever leave.
Necessary TLS infrastructure (OCSP/CRL to a **visited site's own CA**) is **not**
phone-home and is **not** disabled - certificate verification stays on. Metrics
(UMA) and crash upload are off by default (no `crash_reporter.cfg` ships, so no
`ServerURL` and no upload). CD-17 is the precursor and proof for the NetGuard
analyzer epic: host silent + engine silenced + proven.

## Anonymity-set scope note (CD-28, D-0044)

**Internal engineering scope - never surface in product UI, marketing, or demos.**

A large shared crowd (Tor Browser's uniformity model) structurally helps only
against a **global passive network adversary** that correlates fingerprints
across the whole network: with millions of users reporting identical values,
no fingerprint singles one of them out. CyberDesk's coherent per-session
farbling (CD-16, D-0039) takes the other workable strategy: it breaks
**cross-site and cross-session linkage** - a tracker cannot match today's
fingerprint to tomorrow's - but it does not place the user inside a large
identical crowd. Against the adversaries the product targets (commercial
trackers, cross-site profilers, fingerprint-linkage across sessions), the
farbling model holds on its own merits.

Engineering consequence, not product copy: solve every fingerprint vector
(clamp stable signals, farble measured ones - the CD-29 sweep), and market
each solved vector. The two axes no software can build are crowd size (mass)
and audit reputation (time); they are scope notes here, nothing more.

## CD-29 bounded limits (internal engineering scope, D-0045/D-0046)

**Never surface in product UI, marketing, or demos** (D-0044). These are honest
implementation boundaries recorded for engineering, not product limitations.

- **Fonts are enforced at the JS measurement surface, not the DirectWrite
  backend.** A CEF embedder cannot restrict Chromium's system-font backend, so the
  standard-font guarantee is enforced by stripping non-standard families to the
  generic fallback (canvas `font`, CSS `font-family`/`font`/`setProperty`,
  `FontFaceSet.check`) and reporting no local fonts via `queryLocalFonts`. This
  covers the scripted canvas-measure AND the element-layout (`offsetWidth`) probes
  because both resolve families through `CSSStyleDeclaration`. The pinned standard set
  is the stock-Windows-11 font list; on the sole target platform every user returns
  the same answer. **Remaining step:** bundle the actual font bytes so the guarantee
  holds on a stripped Windows install or a future non-Win11 target (today it relies on
  those fonts being OS-present). A page's own `@font-face` web font (served from its
  origin) is intentionally untouched — only the user's LOCAL fonts are hidden.
- **Automatic rotation is presentation + basis re-seed, not a live-page reset.** It
  re-seeds the global identity for subsequent loads / new windows and drives the Pulse
  Grid countdown, but does not reload live pages (mid-page re-rolling is cosmetic; a
  live document keeps its create-time seed until it is respawned). The manual "new
  identity now" and on-restart are the immediate cross-session-linkage killers. This is
  stated accurately in the UI's honesty copy, so it is not a hidden limit.
- **Screen size cannot be smaller than the real viewport.** An unusually large
  single-column layout on a large monitor reports a larger common ladder rung
  (1440p/2160p) rather than the preset — the exact monitor pixels are withheld, but a
  very large window cannot be made to look small (that would be a detectable decoy).

## Supply chain

Pinned dependencies, cargo-audit and cargo-deny in the workflow, no GPL linking (D-0005), CEF version pinned exactly, large binaries never in the repo (fetch script).

## CRA (Cyber Resilience Act)

Reporting obligations from September 2026, full compliance December 2027. Built in from the start instead of retrofitted: update capability (signed updates planned), SBOM generation, incident logging (hash chain later), documented vulnerability disclosure path.

## Repo hygiene

Pre-push grep against real IPs, hostnames, and secrets before every push. Test data uses placeholders only (documentation IPs such as 203.0.113.x). Repo stays private.
