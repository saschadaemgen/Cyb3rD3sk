//! File logging (CD-15 HOTFIX) — a windowed release build has no visible stderr,
//! so all diagnostics go to a **rolling daily** log file in the app data dir. One
//! `tracing` subscriber captures BOTH our own lifecycle logs (`tracing::info!` /
//! `debug!` across the shell) AND arti's internal bootstrap / directory-manager
//! events, which is exactly the diagnostic the Tor stall needs. This is general
//! debugging infrastructure for all future work, not a Tor-only throwaway.
//!
//! Never log secrets. The default filter keeps our lifecycle at debug and arti's
//! bootstrap at info; `RUST_LOG` overrides it (e.g. `RUST_LOG=debug`).

use std::path::PathBuf;
use std::sync::OnceLock;

use tracing_appender::non_blocking::WorkerGuard;

/// The logs directory: `%LOCALAPPDATA%\CyberDesk\logs\` (created if missing).
fn logs_dir() -> PathBuf {
    let base = std::env::var("LOCALAPPDATA")
        .or_else(|_| std::env::var("APPDATA"))
        .unwrap_or_else(|_| ".".to_string());
    let dir = PathBuf::from(base).join("CyberDesk").join("logs");
    let _ = std::fs::create_dir_all(&dir);
    dir
}

/// The human-facing log location to tell Sascha about (the rolling appender adds a
/// date suffix, e.g. `cyberdesk.log.2026-07-10`).
pub fn log_location() -> String {
    logs_dir().join("cyberdesk.log*").display().to_string()
}

/// Install the file subscriber once (browser process only, before anything logs).
/// The non-blocking writer's `WorkerGuard` is kept for the process lifetime so
/// buffered lines are flushed.
pub fn init() {
    static GUARD: OnceLock<WorkerGuard> = OnceLock::new();
    if GUARD.get().is_some() {
        return;
    }
    let dir = logs_dir();
    let appender = tracing_appender::rolling::daily(&dir, "cyberdesk.log");
    let (writer, guard) = tracing_appender::non_blocking(appender);

    let filter = tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| {
        // Our lifecycle at debug; arti's bootstrap / dir / guard / channel managers
        // at info (bootstrap milestones + errors); everything else quiet.
        tracing_subscriber::EnvFilter::new(
            "info,cyberdesk=debug,arti_client=info,tor_dirmgr=info,tor_guardmgr=info,tor_chanmgr=info,tor_proto=info",
        )
    });

    let installed = tracing_subscriber::fmt()
        .with_writer(writer)
        .with_ansi(false)
        .with_env_filter(filter)
        .with_target(true)
        .try_init()
        .is_ok();

    if installed {
        let _ = GUARD.set(guard);
        tracing::info!(location = %log_location(), "logging initialised (rolling daily cyberdesk.log)");
    }
}
