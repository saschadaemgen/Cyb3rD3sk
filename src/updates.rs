//! Update awareness (CD-13, D-0023) — the host's FIRST intentional outbound
//! connection, and its only one: a single pinned CARVILON manifest fetched over
//! HTTPS. NetGuard doctrine (D-0004) survives via exactly this documented
//! exception; the client queries nobody else. A background worker checks on
//! startup and every `check_interval_hours`, with a hard per-fetch timeout, so
//! the shell never blocks and a 404 / unreachable feed is silent (quiet idle
//! glyph, cached last-known info if any — never an error in the user's face).
//!
//! This is deliberately the seed of the future notification rail (Season 7): the
//! info items are a generic model, only update items exist in V1. V1 **informs**;
//! it never downloads or installs (that arrives with the signed pipeline,
//! Season 6+).

// The info-panel surface (update_count / info_snapshot_json / request_check /
// dismiss) is wired by the CD-13 Stage B glyph + panel; keep the API complete.
#![allow(dead_code)]

use std::collections::HashMap;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::mpsc::{self, RecvTimeoutError, Sender};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::Deserialize;

/// The manifest schema this build understands. A higher `schema` is read
/// best-effort (serde ignores unknown fields); if the known fields are missing it
/// fails to parse and we stay quiet on the last-known / no data.
const SCHEMA_SUPPORTED: u32 = 1;

/// Hard caps on the one outbound fetch, so the worker thread can never hang.
const CONNECT_TIMEOUT: Duration = Duration::from_secs(5);
const READ_TIMEOUT: Duration = Duration::from_secs(8);

// --- Version parsing / comparison -------------------------------------------

/// A tolerant dotted-numeric version: the digits before any `+build` metadata,
/// component by component. Handles our semver (`0.9.0`) and CEF's
/// `major.minor.patch+chromium-...` (only the `major.minor.patch` head matters).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Version(Vec<u64>);

impl Version {
    pub fn parse(s: &str) -> Version {
        // Drop CEF/semver build metadata after '+', a leading 'v', and take the
        // leading digits of each dotted component (so `7827` from `7827.201`
        // survives and any trailing `-rc1` etc. is ignored).
        let head = s.split('+').next().unwrap_or("").trim();
        let head = head.strip_prefix('v').unwrap_or(head);
        let parts = head
            .split('.')
            .map(|p| {
                let digits: String = p.chars().take_while(|c| c.is_ascii_digit()).collect();
                digits.parse::<u64>().unwrap_or(0)
            })
            .collect();
        Version(parts)
    }

    fn cmp(&self, other: &Version) -> std::cmp::Ordering {
        let n = self.0.len().max(other.0.len());
        for i in 0..n {
            let a = self.0.get(i).copied().unwrap_or(0);
            let b = other.0.get(i).copied().unwrap_or(0);
            match a.cmp(&b) {
                std::cmp::Ordering::Equal => continue,
                non_eq => return non_eq,
            }
        }
        std::cmp::Ordering::Equal
    }

    /// True when `self` is strictly older than `other` (an update is available).
    pub fn is_older_than(&self, other: &Version) -> bool {
        self.cmp(other) == std::cmp::Ordering::Less
    }
}

// --- Manifest ---------------------------------------------------------------

#[derive(Debug, Clone, Deserialize)]
pub struct Manifest {
    pub schema: u32,
    pub cyberdesk: Product,
    #[serde(default)]
    pub components: HashMap<String, Component>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct Product {
    pub latest: String,
    #[serde(default)]
    pub notes_url: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct Component {
    pub recommended: String,
    #[serde(default)]
    pub reason: Option<String>,
    #[serde(default)]
    pub notes_url: Option<String>,
}

impl Manifest {
    /// Parse a manifest JSON. Tolerant of extra fields (forward-compatible with a
    /// higher `schema`); returns an error only if the known shape is absent.
    pub fn parse(json: &str) -> Result<Manifest, String> {
        serde_json::from_str::<Manifest>(json).map_err(|e| e.to_string())
    }
}

// --- Info items (the generic notification model) ----------------------------

/// One info item — the seed of the future notification rail. V1 only produces
/// update items, but the shape is deliberately generic (id, severity, title,
/// body, optional action).
#[derive(Debug, Clone, PartialEq)]
pub struct InfoItem {
    /// Stable id per source (e.g. `cyberdesk-update`, `cef-update`) — the dismissal key.
    pub id: String,
    /// `info` | `recommended` | `security` — drives the accent, not behavior.
    pub severity: String,
    pub title: String,
    pub body: String,
    /// The target version this item is about (raw string), for dismissal + display.
    pub target_version: String,
    pub action: Option<Action>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Action {
    pub label: String,
    pub url: String,
}

fn normalize_severity(reason: Option<&str>) -> String {
    match reason.map(|r| r.trim().to_lowercase()).as_deref() {
        Some("security") => "security".to_string(),
        Some("info") => "info".to_string(),
        _ => "recommended".to_string(),
    }
}

/// Build the NEW (non-dismissed) info items from a manifest and the running
/// versions. Pure and unit-tested — no network, no store. An item is suppressed
/// when it was dismissed at a version the manifest has not advanced past.
pub fn build_items(
    m: &Manifest,
    cur_cyberdesk: &str,
    cur_cef: &str,
    cur_tor: &str,
    dismissed: &HashMap<String, String>,
) -> Vec<InfoItem> {
    let mut out = Vec::new();

    // CyberDesk (the product itself).
    let latest = Version::parse(&m.cyberdesk.latest);
    if Version::parse(cur_cyberdesk).is_older_than(&latest)
        && !is_dismissed(dismissed, "cyberdesk-update", &latest)
    {
        out.push(InfoItem {
            id: "cyberdesk-update".to_string(),
            severity: "recommended".to_string(),
            title: "CyberDesk update available".to_string(),
            body: format!(
                "You are running {cur_cyberdesk}. Version {} is available.",
                m.cyberdesk.latest
            ),
            target_version: m.cyberdesk.latest.clone(),
            action: m.cyberdesk.notes_url.clone().map(|url| Action {
                label: "Release notes".to_string(),
                url,
            }),
        });
    }

    // The CEF core component (first tracked component).
    if let Some(cef) = m.components.get("cef") {
        let rec = Version::parse(&cef.recommended);
        if Version::parse(cur_cef).is_older_than(&rec)
            && !is_dismissed(dismissed, "cef-update", &rec)
        {
            let reason = cef.reason.as_deref().unwrap_or("recommended");
            out.push(InfoItem {
                id: "cef-update".to_string(),
                severity: normalize_severity(cef.reason.as_deref()),
                title: "CEF core update recommended".to_string(),
                body: format!(
                    "The bundled CEF core is {cur_cef}. {} is recommended ({reason}).",
                    cef.recommended
                ),
                target_version: cef.recommended.clone(),
                action: cef.notes_url.clone().map(|url| Action {
                    label: "Release notes".to_string(),
                    url,
                }),
            });
        }
    }

    // The Tor engine component (arti-client, CD-15). An outdated Tor client is
    // security-critical (arti can even declare itself obsolete), so it is tracked
    // exactly like CEF. Absent `tor` key (older manifest / no feed) → skipped.
    if let Some(tor) = m.components.get("tor") {
        let rec = Version::parse(&tor.recommended);
        if Version::parse(cur_tor).is_older_than(&rec)
            && !is_dismissed(dismissed, "tor-update", &rec)
        {
            let reason = tor.reason.as_deref().unwrap_or("recommended");
            out.push(InfoItem {
                id: "tor-update".to_string(),
                severity: normalize_severity(tor.reason.as_deref()),
                title: "Tor engine update recommended".to_string(),
                body: format!(
                    "The embedded Tor engine (arti) is {cur_tor}. {} is recommended ({reason}).",
                    tor.recommended
                ),
                target_version: tor.recommended.clone(),
                action: tor.notes_url.clone().map(|url| Action {
                    label: "Release notes".to_string(),
                    url,
                }),
            });
        }
    }

    out
}

/// Hidden when the item was dismissed at a version the manifest has not advanced
/// past (dismissed_version >= target → still dismissed).
fn is_dismissed(dismissed: &HashMap<String, String>, id: &str, target: &Version) -> bool {
    dismissed
        .get(id)
        .map(|v| !Version::parse(v).is_older_than(target))
        .unwrap_or(false)
}

// --- Version self-awareness -------------------------------------------------

/// This CyberDesk build's version (from Cargo).
pub fn current_cyberdesk_version() -> &'static str {
    env!("CARGO_PKG_VERSION")
}

/// The running CEF core version, `major.minor.patch`, from the pinned crate's
/// compile-time constants (verified against `cef 149.3.0`; there is no runtime
/// `cef_version_info` in this binding — the constants are the source of truth).
pub fn current_cef_version() -> String {
    format!(
        "{}.{}.{}",
        cef::sys::CEF_VERSION_MAJOR,
        cef::sys::CEF_VERSION_MINOR,
        cef::sys::CEF_VERSION_PATCH
    )
}

/// The running Chromium version, `major.minor.build.patch`.
pub fn current_chromium_version() -> String {
    format!(
        "{}.{}.{}.{}",
        cef::sys::CHROME_VERSION_MAJOR,
        cef::sys::CHROME_VERSION_MINOR,
        cef::sys::CHROME_VERSION_BUILD,
        cef::sys::CHROME_VERSION_PATCH
    )
}

/// The embedded Tor engine (arti-client) version. Unlike CEF, arti-client exposes
/// NO compile-time version constant (verified against the pinned crate), so
/// `build.rs` reads the resolved version from the committed `Cargo.lock` and injects
/// it as `ARTI_CLIENT_VERSION` (D-0029) — the authoritative running version, not a
/// hand-restated literal that would drift on `cargo update`. This is the
/// arti-client CRATE version (the engine CyberDesk links), not the standalone
/// `arti` CLI nor the Tor network protocol version. `"unknown"` if the build script
/// could not read the lockfile.
pub fn current_tor_version() -> &'static str {
    env!("ARTI_CLIENT_VERSION")
}

// --- Shared runtime state (read by the glyph + the info panel IPC) ----------

/// Number of NEW (non-dismissed) update items — the glyph reads this lock-free.
static COUNT: AtomicUsize = AtomicUsize::new(0);

#[derive(Default)]
struct State {
    items: Vec<InfoItem>,
    have_feed: bool,
    last_check: Option<i64>,
    cyberdesk_latest: Option<String>,
    cef_recommended: Option<String>,
    tor_recommended: Option<String>,
}

fn state() -> &'static Mutex<State> {
    static S: OnceLock<Mutex<State>> = OnceLock::new();
    S.get_or_init(|| Mutex::new(State::default()))
}

/// The "Check now" / worker nudge channel.
fn nudge() -> &'static Mutex<Option<Sender<()>>> {
    static T: OnceLock<Mutex<Option<Sender<()>>>> = OnceLock::new();
    T.get_or_init(|| Mutex::new(None))
}

/// The number of pending update items — drives the info glyph (fill + count).
pub fn update_count() -> usize {
    COUNT.load(Ordering::Relaxed)
}

// --- Configuration ----------------------------------------------------------

/// The one allowlisted outbound URL: the `CYBERDESK_UPDATE_FEED` override (a test
/// affordance, documented like the capture knobs) else the `updates.feed_url`
/// config token. This is the ONLY argument `fetch` is ever called with.
fn feed_url() -> String {
    if let Ok(over) = std::env::var("CYBERDESK_UPDATE_FEED")
        && !over.trim().is_empty()
    {
        return over;
    }
    crate::theme::Theme::load().updates.feed_url
}

fn check_interval() -> Duration {
    let hours = crate::theme::Theme::load().updates.check_interval_hours.max(1);
    Duration::from_secs(hours as u64 * 3600)
}

fn now_secs() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

// --- The one outbound fetch -------------------------------------------------

/// Fetch the manifest body. A local path / `file:` URL (the test override) is read
/// from disk; otherwise the single pinned HTTPS endpoint is fetched with hard
/// timeouts. This is the host's ONLY network client (NetGuard exception D-0023).
fn fetch(url: &str) -> Result<String, String> {
    if is_local(url) {
        let path = url
            .strip_prefix("file://")
            .or_else(|| url.strip_prefix("file:"))
            .unwrap_or(url);
        return std::fs::read_to_string(path).map_err(|e| e.to_string());
    }
    let agent = ureq::AgentBuilder::new()
        .timeout_connect(CONNECT_TIMEOUT)
        .timeout_read(READ_TIMEOUT)
        .build();
    let resp = agent.get(url).call().map_err(|e| e.to_string())?;
    resp.into_string().map_err(|e| e.to_string())
}

fn is_local(url: &str) -> bool {
    url.starts_with("file:") || !url.contains("://")
}

// --- Worker + state rebuild -------------------------------------------------

/// Start the background update worker (browser process only): load the cached
/// last-known state so the glyph reflects it immediately, then spawn the thread
/// that checks on startup and every `check_interval`, nudged by "Check now".
pub fn init() {
    rebuild_from_cache();

    let (tx, rx) = mpsc::channel::<()>();
    *nudge().lock().unwrap() = Some(tx);

    std::thread::Builder::new()
        .name("update-checker".to_string())
        .spawn(move || {
            loop {
                run_check();
                match rx.recv_timeout(check_interval()) {
                    // A "Check now" nudge or the interval elapsed → check again.
                    Ok(()) | Err(RecvTimeoutError::Timeout) => continue,
                    Err(RecvTimeoutError::Disconnected) => break,
                }
            }
        })
        .ok();
}

/// Nudge the worker to check now (the info panel's "Check now" button).
pub fn request_check() {
    if let Some(tx) = nudge().lock().unwrap().as_ref() {
        let _ = tx.send(());
    }
}

/// One check: fetch the pinned feed, parse, cache a good manifest, record the
/// attempt time, and rebuild the shared state. On any failure (404, unreachable,
/// malformed) the last-known cached manifest is kept — never an error surfaced.
fn run_check() {
    let live = match fetch(&feed_url()) {
        Ok(json) => match Manifest::parse(&json) {
            Ok(m) => {
                // Only cache a parseable manifest (never overwrite good with junk).
                store().lock().unwrap().set_cached_manifest(&json);
                Some(m)
            }
            Err(_) => None,
        },
        Err(_) => None,
    };
    let now = now_secs();
    store().lock().unwrap().set_last_update_check(now);

    // Fall back to the last-known cached manifest if the live fetch gave nothing.
    let manifest = live.or_else(cached_manifest);
    rebuild_state(manifest, Some(now));
}

fn store() -> &'static Mutex<crate::store::Store> {
    crate::store::shared()
}

fn cached_manifest() -> Option<Manifest> {
    store()
        .lock()
        .unwrap()
        .cached_manifest()
        .and_then(|json| Manifest::parse(&json).ok())
}

fn dismissed_map() -> HashMap<String, String> {
    store().lock().unwrap().dismissed_updates().into_iter().collect()
}

/// Rebuild the shared state (items + glyph count) from the cached manifest and
/// the persisted last-check time — used at startup before the first live check.
fn rebuild_from_cache() {
    let last = store().lock().unwrap().last_update_check();
    rebuild_state(cached_manifest(), last);
}

fn rebuild_state(manifest: Option<Manifest>, last_check: Option<i64>) {
    let cur_cd = current_cyberdesk_version();
    let cur_cef = current_cef_version();
    let cur_tor = current_tor_version();
    let dismissed = dismissed_map();

    let new_state = match &manifest {
        Some(m) => {
            let items = build_items(m, cur_cd, &cur_cef, cur_tor, &dismissed);
            State {
                items,
                have_feed: true,
                last_check,
                cyberdesk_latest: Some(m.cyberdesk.latest.clone()),
                cef_recommended: m.components.get("cef").map(|c| c.recommended.clone()),
                tor_recommended: m.components.get("tor").map(|c| c.recommended.clone()),
            }
        }
        None => State {
            items: Vec::new(),
            have_feed: false,
            last_check,
            cyberdesk_latest: None,
            cef_recommended: None,
            tor_recommended: None,
        },
    };

    let ids: Vec<&str> = new_state.items.iter().map(|i| i.id.as_str()).collect();
    tracing::info!(
        count = new_state.items.len(),
        items = ?ids,
        have_feed = new_state.have_feed,
        cur_tor,
        "update state rebuilt"
    );
    COUNT.store(new_state.items.len(), Ordering::Relaxed);
    *state().lock().unwrap() = new_state;
}

/// Dismiss info item `id` (persist the version it was dismissed at, then rebuild
/// so the glyph calms). No-op if the item isn't currently present.
pub fn dismiss(id: &str) {
    let target = state()
        .lock()
        .unwrap()
        .items
        .iter()
        .find(|i| i.id == id)
        .map(|i| i.target_version.clone());
    if let Some(version) = target {
        store().lock().unwrap().dismiss_update(id, &version);
        rebuild_from_cache();
    }
}

// --- Info panel IPC payload -------------------------------------------------

/// The `get_info_items` reply: the NEW items, the calm component status, and an
/// honest "checked X ago". Built from the shared state + the running versions.
pub fn info_snapshot_json() -> String {
    let st = state().lock().unwrap();
    let cur_cd = current_cyberdesk_version();
    let cur_cef = current_cef_version();
    let cur_tor = current_tor_version();

    let items: Vec<serde_json::Value> = st
        .items
        .iter()
        .map(|i| {
            serde_json::json!({
                "id": i.id,
                "severity": i.severity,
                "title": i.title,
                "body": i.body,
                "action": i.action.as_ref().map(|a| serde_json::json!({ "label": a.label, "url": a.url })),
            })
        })
        .collect();

    let cd_up_to_date = st
        .cyberdesk_latest
        .as_ref()
        .map(|l| !Version::parse(cur_cd).is_older_than(&Version::parse(l)))
        .unwrap_or(true);
    let cef_up_to_date = st
        .cef_recommended
        .as_ref()
        .map(|r| !Version::parse(&cur_cef).is_older_than(&Version::parse(r)))
        .unwrap_or(true);
    let tor_up_to_date = st
        .tor_recommended
        .as_ref()
        .map(|r| !Version::parse(cur_tor).is_older_than(&Version::parse(r)))
        .unwrap_or(true);

    let checked_ago = st.last_check.map(|t| relative_ago(now_secs() - t));

    serde_json::json!({
        "have_feed": st.have_feed,
        "checked_ago": checked_ago,
        "items": items,
        "cyberdesk": {
            "version": cur_cd,
            "latest": st.cyberdesk_latest,
            "up_to_date": cd_up_to_date,
        },
        "cef": {
            "version": cur_cef,
            "chromium": current_chromium_version(),
            "recommended": st.cef_recommended,
            "up_to_date": cef_up_to_date,
        },
        "tor": {
            "version": cur_tor,
            "recommended": st.tor_recommended,
            "up_to_date": tor_up_to_date,
        },
    })
    .to_string()
}

/// A short honest "checked X ago" string (never negative; clamps to "just now").
fn relative_ago(secs_ago: i64) -> String {
    let s = secs_ago.max(0);
    if s < 60 {
        "just now".to_string()
    } else if s < 3600 {
        let n = s / 60;
        format!("{n} minute{} ago", plural(n))
    } else if s < 86400 {
        let n = s / 3600;
        format!("{n} hour{} ago", plural(n))
    } else {
        let n = s / 86400;
        format!("{n} day{} ago", plural(n))
    }
}

fn plural(n: i64) -> &'static str {
    if n == 1 { "" } else { "s" }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn dismissed(pairs: &[(&str, &str)]) -> HashMap<String, String> {
        pairs.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect()
    }

    #[test]
    fn version_parses_semver_and_cef_formats() {
        assert!(Version::parse("0.1.0").is_older_than(&Version::parse("0.9.0")));
        assert!(!Version::parse("0.9.0").is_older_than(&Version::parse("0.9.0")));
        assert!(!Version::parse("1.0.0").is_older_than(&Version::parse("0.9.9")));
        // CEF format: only the head before '+' matters.
        let cur = "149.0.6";
        let rec = "150.0.1+chromium-150.0.7900.100";
        assert!(Version::parse(cur).is_older_than(&Version::parse(rec)));
        assert!(!Version::parse("150.0.1").is_older_than(&Version::parse(rec)));
        // Uneven component counts compare as if zero-padded.
        assert!(Version::parse("150").is_older_than(&Version::parse("150.0.1")));
        assert!(!Version::parse("150.0.0").is_older_than(&Version::parse("150")));
        // A leading 'v' and trailing junk are tolerated.
        assert_eq!(Version::parse("v2.3.4-rc1"), Version::parse("2.3.4"));
    }

    const GOOD: &str = r#"{
        "schema": 1,
        "cyberdesk": { "latest": "0.9.0", "notes_url": "https://carvilon.example/notes/0.9.0.html" },
        "components": {
            "cef": { "recommended": "150.0.1+chromium-150.0.7900.100", "reason": "security", "notes_url": "https://carvilon.example/notes/cef-150.html" },
            "tor": { "recommended": "0.45.0", "reason": "security", "notes_url": "https://carvilon.example/notes/tor-0.45.html" }
        }
    }"#;

    const MALFORMED: &str = r#"{ "schema": 1, "cyberdesk": { }"#; // truncated + missing latest

    // A higher schema with extra unknown fields — must still read the known shape.
    const FUTURE_SCHEMA: &str = r#"{
        "schema": 2,
        "cyberdesk": { "latest": "0.9.0", "notes_url": "x", "channel": "stable" },
        "components": { "cef": { "recommended": "150.0.1", "reason": "security", "severity_hint": 3 } },
        "banners": [ { "id": "hello" } ]
    }"#;

    #[test]
    fn good_manifest_parses_and_yields_all_items() {
        let m = Manifest::parse(GOOD).expect("good manifest parses");
        assert_eq!(m.schema, 1);
        let items = build_items(&m, "0.1.0", "149.0.6", "0.44.0", &dismissed(&[]));
        assert_eq!(items.len(), 3);
        assert_eq!(items[0].id, "cyberdesk-update");
        assert_eq!(items[1].id, "cef-update");
        assert_eq!(items[1].severity, "security");
        assert!(items[1].action.is_some());
        assert_eq!(items[2].id, "tor-update");
        assert_eq!(items[2].severity, "security");
        assert!(items[2].action.is_some());
    }

    #[test]
    fn malformed_manifest_is_an_error_not_a_panic() {
        assert!(Manifest::parse(MALFORMED).is_err());
    }

    #[test]
    fn future_schema_still_reads_known_fields() {
        let m = Manifest::parse(FUTURE_SCHEMA).expect("future schema is read best-effort");
        assert!(m.schema > SCHEMA_SUPPORTED);
        let items = build_items(&m, "0.1.0", "149.0.6", "0.44.0", &dismissed(&[]));
        // The CEF item has no notes_url in this fixture → no action. No `tor` key
        // here either, so no tor item (absent-component safety).
        assert_eq!(items.len(), 2);
        assert!(items[1].action.is_none());
        assert!(!items.iter().any(|i| i.id == "tor-update"));
    }

    #[test]
    fn up_to_date_yields_no_items() {
        let m = Manifest::parse(GOOD).unwrap();
        // Running exactly the latest / recommended (incl. arti) → nothing to show.
        let items = build_items(&m, "0.9.0", "150.0.1", "0.45.0", &dismissed(&[]));
        assert!(items.is_empty());
    }

    #[test]
    fn dismissal_hides_until_the_manifest_advances_past_it() {
        let m = Manifest::parse(GOOD).unwrap();
        // Dismissed at exactly the offered version → hidden.
        let hidden = build_items(&m, "0.1.0", "149.0.6", "0.44.0", &dismissed(&[("cyberdesk-update", "0.9.0")]));
        assert!(!hidden.iter().any(|i| i.id == "cyberdesk-update"));
        // Dismissed at an OLDER version than now offered → re-appears.
        let shown = build_items(&m, "0.1.0", "149.0.6", "0.44.0", &dismissed(&[("cyberdesk-update", "0.8.0")]));
        assert!(shown.iter().any(|i| i.id == "cyberdesk-update"));
    }

    #[test]
    fn tor_component_tracked_like_cef() {
        let m = Manifest::parse(GOOD).unwrap();
        // Running arti older than recommended → a security tor item with a link.
        let items = build_items(&m, "0.9.0", "150.0.1", "0.44.0", &dismissed(&[]));
        let tor = items
            .iter()
            .find(|i| i.id == "tor-update")
            .expect("tor item present when arti is behind");
        assert_eq!(tor.severity, "security");
        assert_eq!(tor.target_version, "0.45.0");
        assert!(tor.action.is_some());
        // Running exactly the recommended arti → no tor item.
        let none = build_items(&m, "0.9.0", "150.0.1", "0.45.0", &dismissed(&[]));
        assert!(!none.iter().any(|i| i.id == "tor-update"));
        // Dismissed at the offered version → hidden until the manifest advances.
        let hidden = build_items(&m, "0.9.0", "150.0.1", "0.44.0", &dismissed(&[("tor-update", "0.45.0")]));
        assert!(!hidden.iter().any(|i| i.id == "tor-update"));
    }

    #[test]
    fn manifest_without_tor_component_yields_no_tor_item() {
        // An older manifest with no `tor` key must produce no tor item, no panic
        // (offline / pre-tor cached manifest safety).
        let m = Manifest::parse(FUTURE_SCHEMA).unwrap(); // only a `cef` component
        let items = build_items(&m, "0.1.0", "149.0.6", "0.44.0", &dismissed(&[]));
        assert!(!items.iter().any(|i| i.id == "tor-update"));
    }

    #[test]
    fn relative_ago_is_honest_and_pluralized() {
        assert_eq!(relative_ago(-5), "just now");
        assert_eq!(relative_ago(10), "just now");
        assert_eq!(relative_ago(60), "1 minute ago");
        assert_eq!(relative_ago(180), "3 minutes ago");
        assert_eq!(relative_ago(3600), "1 hour ago");
        assert_eq!(relative_ago(90000), "1 day ago");
    }
}
