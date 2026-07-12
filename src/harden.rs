//! Fingerprinting-hardening configuration model (CD-25, D-0040).
//!
//! CD-16 (D-0039) ships the hardening MECHANICS (`src/hardening.js`); this module is
//! the CONFIGURATION *over* them: the Off / Standard / Strict preset levels, the
//! per-vector custom flags, resolution of an effective per-window config, and the
//! weaken/strengthen classification the safety gate keys on. It never introduces a
//! new spoofing vector — the config only ENABLES/DISABLES and tunes the existing
//! coherent CD-16 vectors, so EC-01 (no OS/UA/platform spoofing, coherence) holds
//! for every reachable configuration.
//!
//! The [`Config`] is serialized to the exact JSON `hardening.js` reads at its
//! `__CYBERDESK_FP_CONFIG__` placeholder, and the SAME JSON rides the CreateBrowser
//! `extra_info` dictionary that carries a slot's effective config to its render
//! process (per-window; the seed stays session-global). Timezone normalization
//! (`TZ=UTC`, CD-16 `main.rs`) is process-global and is deliberately NOT part of this
//! config — it stays always-on and is surfaced honestly as such.

use serde::{Deserialize, Serialize};

/// A hardening preset level. `Custom` is a global-only per-vector configuration
/// (the per-window control offers presets + Inherit, never per-vector — the
/// floating-law surface stays small; custom lives in Settings).
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Level {
    Off,
    Standard,
    Strict,
    Custom,
}

impl Level {
    pub fn parse(s: &str) -> Option<Level> {
        match s {
            "off" => Some(Level::Off),
            "standard" => Some(Level::Standard),
            "strict" => Some(Level::Strict),
            "custom" => Some(Level::Custom),
            _ => None,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Level::Off => "off",
            Level::Standard => "standard",
            Level::Strict => "strict",
            Level::Custom => "custom",
        }
    }
}

/// The resolved, per-window effective hardening config. `on` gates injection
/// entirely (Off => the render process injects nothing); the six vector flags gate
/// the matching IIFEs in `hardening.js`; `strict` tightens the entropy-reduction
/// buckets (single common value instead of a small set). Field names match the JSON
/// keys `hardening.js` reads.
#[derive(Clone, Copy, PartialEq, Eq, Debug, Serialize, Deserialize)]
pub struct Config {
    pub on: bool,
    pub strict: bool,
    pub canvas: bool,
    pub webgl: bool,
    pub audio: bool,
    pub metrics: bool,
    pub nav: bool,
    pub fonts: bool,
}

impl Config {
    /// Standard preset — identical to CD-16's always-on behavior (all vectors,
    /// moderate buckets). This is the fail-safe default everywhere.
    pub const STANDARD: Config = Config {
        on: true,
        strict: false,
        canvas: true,
        webgl: true,
        audio: true,
        metrics: true,
        nav: true,
        fonts: true,
    };

    /// Strict preset — all vectors plus the tighter entropy buckets.
    pub const STRICT: Config = Config { strict: true, ..Config::STANDARD };

    /// Off — no injection at all.
    pub const OFF: Config = Config {
        on: false,
        strict: false,
        canvas: false,
        webgl: false,
        audio: false,
        metrics: false,
        nav: false,
        fonts: false,
    };

    pub fn any_vector(&self) -> bool {
        self.canvas || self.webgl || self.audio || self.metrics || self.nav || self.fonts
    }

    /// Serialize to the compact JSON `hardening.js` reads / `extra_info` carries.
    /// Never fails in practice; falls back to the Standard literal.
    pub fn to_json(self) -> String {
        serde_json::to_string(&self).unwrap_or_else(|_| STANDARD_JSON.to_string())
    }

    /// Parse a config JSON (from `extra_info`). Fail-safe: a malformed/absent config
    /// resolves to Standard, so a browser we somehow failed to configure is still
    /// PROTECTED, never silently Off.
    pub fn from_json(s: &str) -> Config {
        serde_json::from_str(s).unwrap_or(Config::STANDARD)
    }
}

/// The Standard config as a JSON literal (the fail-safe fallback / render default).
pub const STANDARD_JSON: &str =
    "{\"on\":true,\"strict\":false,\"canvas\":true,\"webgl\":true,\"audio\":true,\"metrics\":true,\"nav\":true,\"fonts\":true}";

/// Resolve a level (+ the global custom flags, used only when `level == Custom`)
/// into an effective [`Config`].
pub fn resolve(level: Level, custom: Config) -> Config {
    match level {
        Level::Off => Config::OFF,
        Level::Standard => Config::STANDARD,
        Level::Strict => Config::STRICT,
        // Custom is Standard-strength (never `strict`) with the user's chosen vectors;
        // `on` follows whether any vector survives.
        Level::Custom => Config {
            on: custom.any_vector(),
            strict: false,
            ..custom
        },
    }
}

/// Is moving from `current` to `target` a WEAKENING (any vector protection removed,
/// or hardening turned off)? This is what the safety gate keys on: a weakening needs
/// the honest warning + two confirmations; strengthening (re-enabling a vector,
/// moving toward Strict, turning protection on) is ungated.
///
/// Loosening `strict` -> non-strict is NOT a weakening: Standard is the safe floor,
/// and Strict is *above* it, so relaxing to Standard stays safe.
pub fn is_weakening(current: &Config, target: &Config) -> bool {
    (current.on && !target.on)
        || (current.canvas && !target.canvas)
        || (current.webgl && !target.webgl)
        || (current.audio && !target.audio)
        || (current.metrics && !target.metrics)
        || (current.nav && !target.nav)
        || (current.fonts && !target.fonts)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn standard_resolve_equals_cd16() {
        // The Standard preset must be byte-identical to the fail-safe literal and to
        // CD-16's all-on behavior, so an unchanged install behaves exactly as CD-16.
        assert_eq!(resolve(Level::Standard, Config::OFF).to_json(), STANDARD_JSON);
        assert!(resolve(Level::Standard, Config::OFF).on);
        assert!(!resolve(Level::Standard, Config::OFF).strict);
    }

    #[test]
    fn off_resolves_to_no_injection() {
        assert!(!resolve(Level::Off, Config::STANDARD).on);
        assert!(!resolve(Level::Off, Config::STANDARD).any_vector());
    }

    #[test]
    fn strict_tightens_buckets() {
        let s = resolve(Level::Strict, Config::OFF);
        assert!(s.on && s.strict && s.any_vector());
    }

    #[test]
    fn custom_is_standard_strength_with_chosen_vectors() {
        let custom = Config { canvas: false, ..Config::STANDARD };
        let r = resolve(Level::Custom, custom);
        assert!(r.on); // some vectors still on
        assert!(!r.strict); // custom is never strict
        assert!(!r.canvas && r.webgl);
    }

    #[test]
    fn custom_all_off_is_effectively_off() {
        let r = resolve(Level::Custom, Config::OFF);
        assert!(!r.on); // no vector survives -> nothing to inject
    }

    #[test]
    fn weakening_classification() {
        // Off from anything-on = weaken.
        assert!(is_weakening(&Config::STANDARD, &Config::OFF));
        // Dropping a single vector = weaken.
        let drop_canvas = Config { canvas: false, ..Config::STANDARD };
        assert!(is_weakening(&Config::STANDARD, &drop_canvas));
        // Re-enabling a vector = strengthen (not weaken).
        assert!(!is_weakening(&drop_canvas, &Config::STANDARD));
        // Standard -> Strict = strengthen.
        assert!(!is_weakening(&Config::STANDARD, &Config::STRICT));
        // Strict -> Standard (loosen strict only) = NOT a weaken (safe floor).
        assert!(!is_weakening(&Config::STRICT, &Config::STANDARD));
        // Off -> Standard = strengthen.
        assert!(!is_weakening(&Config::OFF, &Config::STANDARD));
    }

    #[test]
    fn from_json_failsafe_is_standard() {
        assert_eq!(Config::from_json("garbage"), Config::STANDARD);
        assert_eq!(Config::from_json(STANDARD_JSON), Config::STANDARD);
    }
}
