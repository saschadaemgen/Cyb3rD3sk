// Floating HUD strip (CD-30 Task B). Talks to the Rust host over the CEF message
// router (window.cefQuery) only — no network, no fetch, no external resources.
// The host pushes state on change via window.cdHud(json) (like cdFrame); this
// page pulls once on load (get_hud_state) and only ticks the CLOCK and the
// rotation COUNTDOWN locally between pushes. Every displayed value is real
// (CD-30 rule 0.1) — the countdown/age anchors are absolute timestamps computed
// from the push, so a stale cache can never show a wrong deadline. Wire format
// in docs/cyberdesk-wire-format.md.

(function () {
  "use strict";

  function query(req) {
    return new Promise(function (resolve, reject) {
      if (!window.cefQuery) { reject("hud IPC unavailable"); return; }
      window.cefQuery({
        request: JSON.stringify(req),
        persistent: false,
        onSuccess: function (r) { resolve(r); },
        onFailure: function (code, msg) { reject(msg || ("error " + code)); }
      });
    });
  }

  var clockEl = document.getElementById("clock");
  var levelField = document.getElementById("f-level");
  var levelV = document.getElementById("level-v");
  var vectorsV = document.getElementById("vectors-v");
  var routeK = document.getElementById("route-k");
  var routeV = document.getElementById("route-v");
  var identityK = document.getElementById("identity-k");
  var identityV = document.getElementById("identity-v");

  var state = null;      // last pushed payload (parsed)
  var deadline = null;   // absolute ms (unix) of the next automatic rotation
  var bornAbs = null;    // absolute ms (unix) the current identity was minted

  function two(n) { return n < 10 ? "0" + n : "" + n; }

  // Re-anchor the countdown / age to ABSOLUTE times at receive time: the payload
  // carries elapsed-based fields stamped with the host's send time, so the page
  // never accumulates drift and a re-pulled cache stays correct.
  function anchor() {
    var sent = state && typeof state.sent_ms === "number" ? state.sent_ms : Date.now();
    var r = state && state.rotate;
    deadline = r && r.auto
      ? sent + Math.max(0, r.interval_min * 60000 - (r.elapsed_ms || 0))
      : null;
    bornAbs = sent - ((state && state.identity_age_ms) || 0);
  }

  // Sascha's digital clock: local wall-clock time. The PROCESS runs under TZ=UTC
  // (the CD-16 timezone clamp, honest and global), so local time is derived from
  // the host-supplied UTC offset — never from getHours(), which would silently
  // show UTC mislabeled as local.
  function paintClock() {
    if (!state || typeof state.tz_offset_min !== "number") { clockEl.textContent = "--:--:--"; return; }
    var d = new Date(Date.now() + state.tz_offset_min * 60000);
    clockEl.textContent = two(d.getUTCHours()) + ":" + two(d.getUTCMinutes()) + ":" + two(d.getUTCSeconds());
  }

  function fmtCountdown(ms) {
    var s = Math.max(0, Math.round(ms / 1000));
    var h = Math.floor(s / 3600);
    var m = Math.floor((s % 3600) / 60);
    var sec = s % 60;
    return h > 0 ? h + ":" + two(m) + ":" + two(sec) : m + ":" + two(sec);
  }

  function fmtAge(ms) {
    var s = Math.max(0, Math.floor(ms / 1000));
    if (s < 60) return s + " s";
    var m = Math.floor(s / 60);
    if (m < 60) return m + " min";
    var h = Math.floor(m / 60);
    if (h < 48) return h + " h " + two(m % 60) + " min";
    return Math.floor(h / 24) + " d";
  }

  // The identity field ticks locally between pushes (countdown / age).
  function paintIdentity() {
    if (!state) { identityV.textContent = "—"; return; }
    if (deadline != null) {
      identityK.textContent = "New identity in";
      identityV.textContent = fmtCountdown(deadline - Date.now());
    } else {
      identityK.textContent = "Identity age";
      identityV.textContent = bornAbs != null ? fmtAge(Date.now() - bornAbs) : "—";
    }
  }

  function paint() {
    if (!state) return;
    // Protection level — the Ampel state in text, with the honest tint rules:
    // warn when genuinely reduced/off, accent when strict.
    var level = (state.level || "").toUpperCase() || "—";
    levelV.textContent = level;
    levelField.classList.toggle("warn", !!state.reduced || state.level === "off");
    levelField.classList.toggle("good", state.level === "strict" && !state.reduced);
    // Honest live vector count (N/N) — the global effective config.
    var on = state.vectors_on | 0;
    var total = state.vectors_total | 0;
    vectorsV.textContent = total ? on + "/" + total + " active" : "—";
    // The ACTIVE window's route (CD-15 state, surfaced as text).
    var r = state.route || {};
    routeK.textContent = "Route W" + (r.window || 1);
    routeV.textContent = r.tor ? "Tor" : "Clearnet";
    routeV.parentElement.classList.toggle("on", !!r.tor);
    paintIdentity();
    paintClock();
  }

  // Host push entry point (on change, never per frame).
  window.cdHud = function (json) {
    try { state = JSON.parse(json); } catch (e) { return; }
    anchor();
    paint();
  };

  // Local ticker: clock + countdown/age only (all other fields are push-driven).
  setInterval(function () { paintClock(); paintIdentity(); }, 500);

  // Pull once on load (the host may have pushed before this page existed).
  query({ cmd: "get_hud_state" }).then(function (json) {
    if (!state) { window.cdHud(json); }
  }).catch(function () {});
})();
