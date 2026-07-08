// Command bar logic. Talks to the Rust host over the CEF message router
// (window.cefQuery) only — no network, no fetch. The host decides URL vs search
// and performs the navigation on the surf view. Wire format: see
// docs/cyberdesk-wire-format.md.

(function () {
  "use strict";

  function query(req) {
    return new Promise(function (resolve, reject) {
      if (!window.cefQuery) {
        reject("command IPC unavailable");
        return;
      }
      window.cefQuery({
        request: JSON.stringify(req),
        persistent: false,
        onSuccess: function (r) { resolve(r); },
        onFailure: function (c, m) { reject(m || ("error " + c)); }
      });
    });
  }

  var input = document.getElementById("url");
  var scheme = document.getElementById("scheme");
  var star = document.getElementById("star");

  // The current surf page (from nav state) — the star and Ctrl+D act on this,
  // not on the typed input.
  var currentUrl = "";
  var currentTitle = "";

  function applyScheme(s) {
    var cls = s === "https" ? "secure" : (s === "http" ? "insecure" : "neutral");
    scheme.className = "scheme " + cls;
  }

  function paintStar(fav) {
    star.classList.toggle("on", !!fav);
    star.setAttribute("aria-pressed", fav ? "true" : "false");
  }

  // Apply a nav-state snapshot: scheme hint, current page, star state.
  function applyNavState(s) {
    currentUrl = s.url || "";
    currentTitle = s.title || "";
    applyScheme(s.scheme);
    paintStar(s.favorite);
  }

  function refreshState() {
    return query({ cmd: "get_nav_state" }).then(function (r) {
      return JSON.parse(r);
    });
  }

  // Toggle the current page's favorite; the reply carries the new state.
  function toggleFavorite() {
    if (!currentUrl) return;
    query({ cmd: "toggle_favorite", url: currentUrl, title: currentTitle })
      .then(function (r) {
        try { paintStar(JSON.parse(r).favorite); } catch (e) { /* ignore */ }
      })
      .catch(function () { /* ignore */ });
  }

  // Load the current nav state: prefill + select the URL, set scheme + star.
  refreshState()
    .then(function (s) {
      applyNavState(s);
      input.value = s.url || "";
      input.focus();
      input.select();
    })
    .catch(function () { input.focus(); });

  input.addEventListener("keydown", function (e) {
    if (e.key === "Enter") {
      e.preventDefault();
      query({ cmd: "navigate", input: input.value });
      // The host closes the bar and navigates the surf view.
    }
  });

  star.addEventListener("click", toggleFavorite);

  // Ctrl+D toggles the current page's favorite while the bar is open (the
  // surf-view Ctrl+D is handled host-side). The star updates live.
  document.addEventListener("keydown", function (e) {
    if ((e.ctrlKey || e.metaKey) && (e.key === "d" || e.key === "D")) {
      e.preventDefault();
      toggleFavorite();
    }
  });

  // Back / Forward / Reload glyphs (surf-view navigation), then refresh state.
  var buttons = document.querySelectorAll(".nav .glyph");
  for (var i = 0; i < buttons.length; i++) {
    (function (b) {
      b.addEventListener("click", function () {
        query({ cmd: b.dataset.act }).then(function () {
          refreshState().then(applyNavState).catch(function () {});
        }).catch(function () {});
      });
    })(buttons[i]);
  }
})();
