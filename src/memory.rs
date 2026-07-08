//! History + favorites domain layer over the shared SQLite [`Store`].
//!
//! History records every surf-view page visit (URL + title, a visit count and a
//! last-visit time); favorites are the user's Ctrl+D / star toggles. Both live
//! only in the local `state.db` (D-0014) — no sync, no export. Internal
//! `cyberdesk://` pages and blank navigations never enter either table.

use crate::store::{self, Suggestion};

/// URLs that must never be recorded or favorited: the internal scheme and blank
/// navigations. Only real web pages from the surf view enter history/favorites.
fn is_recordable(url: &str) -> bool {
    !url.is_empty() && url != "about:blank" && !url.starts_with("cyberdesk://")
}

/// Record a visit to `url` (bumping its visit count). No-op for internal/blank.
pub fn record_visit(url: &str, title: &str) {
    if is_recordable(url) {
        store::shared().lock().unwrap().record_visit(url, title);
    }
}

/// Refresh the stored title of `url`'s history row (the title arrives after the
/// address commit). No-op for internal/blank or an empty title.
pub fn update_title(url: &str, title: &str) {
    if is_recordable(url) && !title.is_empty() {
        store::shared()
            .lock()
            .unwrap()
            .update_history_title(url, title);
    }
}

/// Is `url` currently a favorite?
pub fn is_favorite(url: &str) -> bool {
    is_recordable(url) && store::shared().lock().unwrap().is_favorite(url)
}

/// Toggle `url`'s favorite state; returns the new state. No-op (returns false)
/// for internal/blank URLs.
pub fn toggle_favorite(url: &str, title: &str) -> bool {
    is_recordable(url) && store::shared().lock().unwrap().toggle_favorite(url, title)
}

/// Command-palette suggestions for `input` (favorites first, then history by
/// frecency), capped at `limit`. Empty input returns the top favorites.
pub fn query_suggestions(input: &str, limit: usize) -> Vec<Suggestion> {
    store::shared().lock().unwrap().query_suggestions(input, limit)
}
