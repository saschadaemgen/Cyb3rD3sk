// CyberDesk — fingerprinting hardening (CD-16, D-0039; CD-29, D-0045).
//
// COHERENT, PER-SESSION TRACKING-RESISTANCE — NOT anonymity, NOT OS/UA/platform
// spoofing (binding constraint EC-01). The goal is to break a site's ability to
// LINK this browser across sites and across sessions, without introducing a single
// cross-surface contradiction. We deliberately do NOT touch the User-Agent,
// navigator.platform / oscpu, CPU/OS strings, or language — leaving them real and
// mutually consistent. Timezone normalization is done natively by the host
// (TZ=UTC before Chromium init), not here, so Date and Intl agree by construction.
//
// Injected at document-start into every WEB frame (never a cyberdesk:// UI frame),
// so it runs before any page script. The seed placeholder on the SESSION_SEED line
// below is replaced by the host with a fresh random per-BROWSER-SESSION seed (hex);
// a new launch => a new seed => a different fingerprint (cross-session unlinkable),
// while within one launch the seed is fixed (stable readback, no breakage/flicker).
// CD-29 (D-0046) rotation re-injects with a fresh seed on a "new identity" event.
//
// Two solving techniques, applied per vector (CD-29):
//   * CLAMP  — report a common/standard value so the machine looks ordinary
//     (fonts -> a fixed standard set; GPU vendor/renderer strings; math rounding;
//     media/codec answers; device buckets). Everyone converges on one value.
//   * FARBLE — add fresh per-session noise to a MEASURED signal so sessions are
//     unlinkable while the site still works (canvas, WebGL readback, audio,
//     client rects / text metrics, high-resolution clock).
//
// Determinism is the crux of "stable within a session": every farble is a PURE
// FUNCTION of (origin key, input), re-seeded per call and walked in a fixed order,
// so repeated reads in one session are byte-identical (a site cannot detect the
// noise by reading twice, and nothing flickers), yet a fresh session's different
// seed yields a different — hence unlinkable — result.

(function () {
  "use strict";

  var SESSION_SEED = "__CYBERDESK_FP_SEED__";

  // The per-window EFFECTIVE config (CD-25/CD-29): which vectors run, and whether to
  // use the tighter "strict" buckets — substituted by the host per browser (the seed
  // stays session-global). Each vector block is gated on its flag; Standard resolves
  // to every flag true / strict false. "Off" is never injected at all (the render
  // process skips injection), so by the time this file runs at least one vector is on.
  var FP_CONFIG = __CYBERDESK_FP_CONFIG__;

  // The page global. Referenced explicitly (and every DOM constructor is looked up
  // via `W.` and guarded) so a missing global degrades to a no-op instead of
  // throwing and aborting the rest of the hardening — and so the exact same file
  // is exercisable under a headless (Node vm) mock. Built-ins (Math, Object,
  // Function, Promise, WeakSet, Proxy, Array, typed arrays, isFinite) are always
  // present and used bare.
  var W = (typeof window !== "undefined") ? window
        : (typeof self !== "undefined") ? self
        : (typeof globalThis !== "undefined") ? globalThis : this;

  // ---- deterministic primitives ---------------------------------------------

  // FNV-1a (32-bit): mixes strings into the seed. Not cryptographic — the secret
  // is SESSION_SEED; this only decorrelates origins/tags cheaply.
  function fnv1a(str) {
    var h = 0x811c9dc5;
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return h >>> 0;
  }

  // Mulberry32: a tiny, fast, well-distributed PRNG. Re-seeding it from the same
  // value reproduces the same stream — the property that makes readback stable.
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // First-party origin — keys the noise per top-level site. A tracker embedded as
  // a third-party iframe on two DIFFERENT first parties therefore reads DIFFERENT
  // noise on each, so it cannot correlate the two visits by fingerprint. For a
  // cross-origin iframe (window.top unreadable) we recover the top origin from
  // location.ancestorOrigins (Blink exposes the full chain even cross-origin).
  function firstPartyOrigin() {
    try {
      if (W.top === W) return String(W.location.origin);
      return String(W.top.location.origin); // same-origin ancestors: readable
    } catch (e) {
      try {
        var ao = W.location.ancestorOrigins;
        if (ao && ao.length) return String(ao[ao.length - 1]);
      } catch (e2) { /* fall through */ }
      try { return String(W.location.origin); } catch (e3) { return "null"; }
    }
  }

  var ORIGIN_KEY = fnv1a(SESSION_SEED + "|" + firstPartyOrigin());

  // Per-vector seed: independent noise streams that are all stable within a session.
  function vseed(tag) { return (ORIGIN_KEY ^ fnv1a(tag)) | 0; }

  // Stable per-value scalar jitter (for metrics: rect edges, text width). Keyed on
  // the value itself, so the SAME measured value always perturbs the SAME way —
  // stable within a session, and (because ORIGIN_KEY changes) different across
  // sessions. Magnitude is a small RELATIVE fraction: sub-visual for layout, but it
  // moves the low significant digits that a full-precision fingerprint hashes.
  function jitter(v, tag, rel) {
    if (typeof v !== "number" || !isFinite(v) || v === 0) return v;
    var r = mulberry32((ORIGIN_KEY ^ fnv1a(tag) ^ fnv1a(String(v))) | 0)();
    var mag = Math.abs(v) < 1 ? 1 : Math.abs(v);
    return v + (r - 0.5) * rel * mag;
  }

  // Replace a method non-enumerably (methods stay writable/configurable in Blink).
  function def(obj, name, value) {
    try {
      Object.defineProperty(obj, name, {
        value: value, writable: true, enumerable: false, configurable: true
      });
      return true;
    } catch (e) { return false; }
  }

  // Replace an accessor (get/set) non-enumerably. Used where the fingerprint reads
  // an ATTRIBUTE (navigator.*, a CSS/canvas font property) rather than calls a method.
  function defGetSet(obj, name, getter, setter) {
    try {
      var desc = { configurable: true, enumerable: true };
      if (getter) desc.get = getter;
      if (setter) desc.set = setter;
      Object.defineProperty(obj, name, desc);
      return true;
    } catch (e) { return false; }
  }

  // ---- pixel farbling --------------------------------------------------------

  // RGBA-aware: nudge ~4.7% of pixels by ±1 in ONE of R/G/B (never alpha, never
  // more than 1/255) — invisible, but it changes the serialized bytes and thus the
  // hash. Re-seeded per call + walked in order => identical output on repeat reads.
  function farbleRGBA(u8, seed) {
    var rnd = mulberry32(seed | 0);
    var n = u8.length;
    for (var i = 0; i + 3 < n; i += 4) {
      var r = rnd();
      if (r < 0.047) {
        var pick = (r * 100000) | 0;
        var c = pick % 3;                 // R, G or B
        var d = (pick & 1) ? 1 : -1;
        var v = u8[i + c] + d;
        u8[i + c] = v < 0 ? 0 : (v > 255 ? 255 : v);
      }
    }
  }

  // Generic byte farble (WebGL readPixels: format/type not assumed). Nudges a small
  // fraction of bytes by ±1.
  function farbleU8(u8, seed) {
    var rnd = mulberry32(seed | 0);
    for (var i = 0; i < u8.length; i++) {
      if (rnd() < 0.032) {
        var d = rnd() < 0.5 ? -1 : 1;
        var v = u8[i] + d;
        u8[i] = v < 0 ? 0 : (v > 255 ? 255 : v);
      }
    }
  }

  // ============ Canvas 2D readback ===========================================
  if (FP_CONFIG.canvas) (function canvas() {
    var HCE = W.HTMLCanvasElement, C2D = W.CanvasRenderingContext2D;
    var _getImageData = C2D && C2D.prototype.getImageData;
    var _toDataURL = HCE && HCE.prototype.toDataURL;
    var _toBlob = HCE && HCE.prototype.toBlob;
    if (!C2D || !_getImageData) return;
    var SEED = vseed("canvas");

    // getImageData IS readback — farble the returned pixels in place.
    def(C2D.prototype, "getImageData", function () {
      var img = _getImageData.apply(this, arguments);
      try { farbleRGBA(img.data, SEED); } catch (e) {}
      return img;
    });

    // toDataURL / toBlob serialize the backing store directly (not via the hooked
    // getImageData), so farble a private COPY and serialize that — never the live
    // canvas (no visible change). drawImage works from a 2D OR a WebGL source, so
    // this covers WebGL canvases too. The original getImageData is used internally
    // to avoid double-farbling.
    function farbledCopy(canvasEl) {
      try {
        var w = canvasEl.width, h = canvasEl.height;
        if (!w || !h || !W.document) return null;
        var tmp = W.document.createElement("canvas");
        tmp.width = w; tmp.height = h;
        var ctx = tmp.getContext("2d");
        if (!ctx) return null;
        ctx.drawImage(canvasEl, 0, 0);
        var img = _getImageData.call(ctx, 0, 0, w, h);
        farbleRGBA(img.data, SEED);
        ctx.putImageData(img, 0, 0);
        return tmp;
      } catch (e) { return null; }
    }
    if (_toDataURL) def(HCE.prototype, "toDataURL", function () {
      var snap = farbledCopy(this);
      return _toDataURL.apply(snap || this, arguments);
    });
    if (_toBlob) def(HCE.prototype, "toBlob", function () {
      var snap = farbledCopy(this);
      return _toBlob.apply(snap || this, arguments);
    });

    // OffscreenCanvas (also used for fingerprinting in the document context).
    var OSC = W.OffscreenCanvas;
    var OSC2D = W.OffscreenCanvasRenderingContext2D;
    var _oscGID = OSC2D && OSC2D.prototype.getImageData;
    if (OSC2D && _oscGID) def(OSC2D.prototype, "getImageData", function () {
      var img = _oscGID.apply(this, arguments);
      try { farbleRGBA(img.data, SEED); } catch (e) {}
      return img;
    });
    var _convert = OSC && OSC.prototype.convertToBlob;
    if (OSC && _convert) def(OSC.prototype, "convertToBlob", function () {
      try {
        var w = this.width, h = this.height;
        if (w && h) {
          var tmp = new OSC(w, h);
          var ctx = tmp.getContext("2d");
          if (ctx) {
            ctx.drawImage(this, 0, 0);
            var img = (_oscGID || _getImageData).call(ctx, 0, 0, w, h);
            farbleRGBA(img.data, SEED);
            ctx.putImageData(img, 0, 0);
            return _convert.apply(tmp, arguments);
          }
        }
      } catch (e) {}
      return _convert.apply(this, arguments);
    });
  })();

  // ============ WebGL readback (farble) ======================================
  // Only the pixel READBACK is farbled here; the vendor/renderer IDENTITY clamp is
  // the separate `gpu` vector below, so noise and identity are independently settable
  // (CD-29 Task B/C).
  if (FP_CONFIG.webgl) (function webglReadback() {
    var SEED = vseed("webgl");
    function patch(GL) {
      if (!GL || !GL.prototype) return;
      var _readPixels = GL.prototype.readPixels;
      if (_readPixels) def(GL.prototype, "readPixels", function () {
        var ret = _readPixels.apply(this, arguments);
        try {
          var px = arguments[6]; // pixels: ArrayBufferView
          if (px && (px instanceof Uint8Array || px instanceof Uint8ClampedArray)) {
            farbleU8(px, SEED);
          }
        } catch (e) {}
        return ret;
      });
    }
    patch(W.WebGLRenderingContext);
    patch(W.WebGL2RenderingContext);
  })();

  // ============ GPU identity (clamp) =========================================
  // Clamp the UNMASKED vendor/renderer strings AND the WebGPU adapter info to a
  // single common, Windows-COHERENT generic GPU so the render fingerprint collapses
  // to one value without contradicting the real (untouched) Windows UA/platform.
  if (FP_CONFIG.gpu) (function gpuIdentity() {
    var VENDOR = 0x9245, RENDERER = 0x9246; // UNMASKED_*_WEBGL (debug_renderer_info)
    // ANGLE + D3D11 is a Windows render path, so it agrees with the real Windows UA.
    var STD_VENDOR = "Google Inc. (Intel)";
    var STD_RENDERER =
      "ANGLE (Intel, Intel(R) UHD Graphics 630 Direct3D11 vs_5_0 ps_5_0, D3D11)";
    function patch(GL) {
      if (!GL || !GL.prototype) return;
      var _getParameter = GL.prototype.getParameter;
      if (_getParameter) def(GL.prototype, "getParameter", function (p) {
        if (p === VENDOR) return STD_VENDOR;
        if (p === RENDERER) return STD_RENDERER;
        return _getParameter.apply(this, arguments);
      });
    }
    patch(W.WebGLRenderingContext);
    patch(W.WebGL2RenderingContext);

    // WebGPU adapter identity (behind a flag in many builds; guard everything).
    // Normalize the adapter info to a generic vendor/architecture so a present
    // WebGPU stack does not re-leak the exact GPU the WebGL clamp just hid.
    try {
      var GA = W.GPUAdapter;
      if (GA && GA.prototype) {
        var STD_INFO = { vendor: "intel", architecture: "", device: "", description: "" };
        var _reqInfo = GA.prototype.requestAdapterInfo;
        if (_reqInfo) def(GA.prototype, "requestAdapterInfo", function () {
          return Promise.resolve(STD_INFO);
        });
        // Newer spec: a synchronous `info` accessor.
        try {
          if ("info" in GA.prototype) {
            defGetSet(GA.prototype, "info", function () { return STD_INFO; }, undefined);
          }
        } catch (e) {}
      }
    } catch (e) {}
  })();

  // ============ AudioContext readback ========================================
  if (FP_CONFIG.audio) (function audio() {
    // Inaudible, deterministic perturbation. Additive with a small floor so silent
    // samples (and dB-scale frequency bins) are still moved; magnitude ~1e-4
    // relative is far below the audible threshold but shifts the significant digits
    // a full-precision audio fingerprint sums.
    function farbleFloat(arr, seed) {
      var rnd = mulberry32(seed | 0);
      for (var i = 0; i < arr.length; i++) {
        var s = arr[i];
        arr[i] = s + (rnd() - 0.5) * 1e-4 * (Math.abs(s) + 1e-3);
      }
    }
    function farbleByte(arr, seed) {
      var rnd = mulberry32(seed | 0);
      for (var i = 0; i < arr.length; i++) {
        if (rnd() < 0.02) {
          var d = rnd() < 0.5 ? -1 : 1;
          var v = arr[i] + d;
          arr[i] = v < 0 ? 0 : (v > 255 ? 255 : v);
        }
      }
    }

    var AB = W.AudioBuffer;
    if (AB && AB.prototype) {
      var _getChannelData = AB.prototype.getChannelData;
      var _copyFromChannel = AB.prototype.copyFromChannel;
      // getChannelData hands back the LIVE backing Float32Array. Farble each such
      // array exactly ONCE (WeakSet) so repeated reads are stable AND playback is
      // never re-perturbed; the change is inaudible either way.
      var seen = new WeakSet();
      if (_getChannelData) def(AB.prototype, "getChannelData", function (ch) {
        var data = _getChannelData.apply(this, arguments);
        try {
          if (data && !seen.has(data)) {
            seen.add(data);
            farbleFloat(data, vseed("audio") ^ ((ch | 0) + 1));
          }
        } catch (e) {}
        return data;
      });
      // copyFromChannel copies into a caller buffer (source untouched → playback
      // safe); farble the copy deterministically per call.
      if (_copyFromChannel) def(AB.prototype, "copyFromChannel", function (dest, ch) {
        _copyFromChannel.apply(this, arguments);
        try { farbleFloat(dest, vseed("audio") ^ ((ch | 0) + 1)); } catch (e) {}
      });
    }

    var AN = W.AnalyserNode;
    if (AN && AN.prototype) {
      ["getFloatFrequencyData", "getFloatTimeDomainData"].forEach(function (m) {
        var orig = AN.prototype[m];
        if (orig) def(AN.prototype, m, function (arr) {
          orig.apply(this, arguments);
          try { farbleFloat(arr, vseed("audio:" + m)); } catch (e) {}
        });
      });
      ["getByteFrequencyData", "getByteTimeDomainData"].forEach(function (m) {
        var orig = AN.prototype[m];
        if (orig) def(AN.prototype, m, function (arr) {
          orig.apply(this, arguments);
          try { farbleByte(arr, vseed("audio:" + m)); } catch (e) {}
        });
      });
    }
  })();

  // ============ Client rects + text metrics ==================================
  if (FP_CONFIG.metrics) (function metrics() {
    var DOMRectCtor = W.DOMRect;
    function jitterRect(r) {
      if (!r || !DOMRectCtor) return r;
      try {
        return new DOMRectCtor(
          jitter(r.x, "rect:x", 3e-3), jitter(r.y, "rect:y", 3e-3),
          jitter(r.width, "rect:w", 3e-3), jitter(r.height, "rect:h", 3e-3)
        );
      } catch (e) { return r; }
    }
    // Element and Range both expose getBoundingClientRect / getClientRects. The
    // jitter is keyed on the value, so a single-rect element's bounding rect and
    // its getClientRects()[0] receive the SAME perturbation — they stay mutually
    // consistent (no self-contradiction a script could detect).
    [W.Element, W.Range].forEach(function (Ctor) {
      if (!Ctor || !Ctor.prototype) return;
      var _bcr = Ctor.prototype.getBoundingClientRect;
      if (_bcr) def(Ctor.prototype, "getBoundingClientRect", function () {
        return jitterRect(_bcr.apply(this, arguments));
      });
      var _cr = Ctor.prototype.getClientRects;
      if (_cr) def(Ctor.prototype, "getClientRects", function () {
        var list = _cr.apply(this, arguments);
        try {
          var out = [];
          for (var i = 0; i < list.length; i++) out.push(jitterRect(list[i]));
          out.item = function (n) { return this[n] || null; };
          return out;
        } catch (e) { return list; }
      });
    });

    // measureText width is THE text/font-metric fingerprint. We wrap the returned
    // TextMetrics in a Proxy that jitters every numeric field (width plus the
    // bounding-box metrics) while preserving the prototype (instanceof still holds).
    var C2D = W.CanvasRenderingContext2D;
    var _measureText = C2D && C2D.prototype.measureText;
    if (_measureText) def(C2D.prototype, "measureText", function () {
      var m = _measureText.apply(this, arguments);
      try {
        return new Proxy(m, {
          get: function (t, k) {
            var v = t[k];
            if (typeof v === "number") return jitter(v, "text:" + String(k), 3e-3);
            return (typeof v === "function") ? v.bind(t) : v;
          }
        });
      } catch (e) { return m; }
    });
  })();

  // ============ Device profile (clamp) =======================================
  if (FP_CONFIG.nav) (function navAttrs() {
    var Nav = W.Navigator, nav = W.navigator;
    // hardwareConcurrency → nearest common bucket AT OR BELOW the real value (never
    // over-report cores; floor 2). Collapses many machines onto {2,4,8,16}.
    try {
      if (Nav && Nav.prototype) {
        var real = (nav && nav.hardwareConcurrency) || 4;
        var buckets = [2, 4, 8, 16], cores = 2;
        for (var i = 0; i < buckets.length; i++) if (buckets[i] <= real) cores = buckets[i];
        // Strict collapses everyone toward a single common value (max anonymity set)
        // — but never ABOVE the standard bucket, so it never over-reports cores.
        if (FP_CONFIG.strict && cores > 4) cores = 4;
        defGetSet(Nav.prototype, "hardwareConcurrency", function () { return cores; });
      }
    } catch (e) {}
    // deviceMemory is already spec-bucketed {0.25..8}; collapse further to {4,8}
    // (the common desktop buckets) so it stops distinguishing exact RAM tiers.
    try {
      if (Nav && Nav.prototype && nav && ("deviceMemory" in nav)) {
        var mem = ((nav.deviceMemory || 8) >= 4) ? 8 : 4;
        // Strict collapses to the single low common value (never over-reports RAM).
        if (FP_CONFIG.strict) mem = 4;
        defGetSet(Nav.prototype, "deviceMemory", function () { return mem; });
      }
    } catch (e) {}
    // maxTouchPoints → 0 (the common desktop value; coherent with the real Windows
    // desktop UA). A touch-capable laptop stops standing out by its touch count.
    try {
      if (Nav && Nav.prototype && nav && ("maxTouchPoints" in nav)) {
        defGetSet(Nav.prototype, "maxTouchPoints", function () { return 0; });
      }
    } catch (e) {}
    // Network Information API → a single common profile (fast broadband). rtt/downlink
    // are otherwise fine-grained, machine- and moment-specific entropy.
    try {
      var CI = W.NetworkInformation;
      if (CI && CI.prototype) {
        defGetSet(CI.prototype, "effectiveType", function () { return "4g"; });
        defGetSet(CI.prototype, "rtt", function () { return 50; });
        defGetSet(CI.prototype, "downlink", function () { return 10; });
        defGetSet(CI.prototype, "saveData", function () { return false; });
      }
    } catch (e) {}
    // Battery Status → a stable "plugged in, full" profile so charge level / timing
    // cannot be used as a rolling identifier. Resolve the same object every call.
    try {
      if (Nav && Nav.prototype && typeof Nav.prototype.getBattery === "function") {
        var battery = {
          charging: true, level: 1, chargingTime: 0, dischargingTime: Infinity,
          addEventListener: function () {}, removeEventListener: function () {},
          dispatchEvent: function () { return false; },
          onchargingchange: null, onlevelchange: null,
          onchargingtimechange: null, ondischargingtimechange: null
        };
        def(Nav.prototype, "getBattery", function () { return Promise.resolve(battery); });
      }
    } catch (e) {}
  })();

  // ============ Standard font set (clamp) ====================================
  // Chromium is historically the most font-revealing engine, so this is the
  // highest-value clamp (CD-29 Task A). We cannot patch Chromium's DirectWrite
  // backend from an embedder, so we standardize the JS MEASUREMENT SURFACE instead:
  // any font-family a page requests that is NOT in the pinned standard set is
  // stripped to the generic fallback, so it renders — and therefore MEASURES —
  // exactly as it would on a machine that lacks it. Standard-set families (all
  // present on a stock Windows 11, the sole target platform) always measure present.
  // Net effect: every CyberDesk user returns the SAME font answer regardless of what
  // is installed locally, and enumeration is neutralized outright. A page's OWN
  // @font-face web font (loaded from its server) is untouched — only the user's
  // LOCAL fonts are hidden. Combined with the per-session text-metric farble
  // (metrics vector) so measured glyph dimensions also vary per session.
  if (FP_CONFIG.fonts) (function fonts() {
    // The pinned standard set: families shipped with a stock Windows 11. Lower-cased
    // for matching. Generic families are always allowed (they never reveal a font).
    var STD = {};
    ["arial", "arial black", "bahnschrift", "calibri", "cambria", "cambria math",
     "candara", "comic sans ms", "consolas", "constantia", "corbel", "courier new",
     "ebrima", "franklin gothic medium", "gabriola", "gadugi", "georgia", "impact",
     "ink free", "javanese text", "leelawadee ui", "lucida console",
     "lucida sans unicode", "malgun gothic", "marlett", "microsoft himalaya",
     "microsoft jhenghei", "microsoft new tai lue", "microsoft phagspa",
     "microsoft sans serif", "microsoft tai le", "microsoft yahei",
     "microsoft yi baiti", "mingliu", "mongolian baiti", "ms gothic", "mv boli",
     "myanmar text", "nirmala ui", "palatino linotype", "segoe mdl2 assets",
     "segoe print", "segoe script", "segoe ui", "segoe ui emoji",
     "segoe ui historic", "segoe ui symbol", "segoe ui variable", "simsun",
     "sitka", "sylfaen", "symbol", "tahoma", "times new roman", "trebuchet ms",
     "verdana", "webdings", "wingdings", "yu gothic"
    ].forEach(function (n) { STD[n] = true; });
    var GENERICS = {
      "serif": 1, "sans-serif": 1, "monospace": 1, "cursive": 1, "fantasy": 1,
      "system-ui": 1, "ui-serif": 1, "ui-sans-serif": 1, "ui-monospace": 1,
      "ui-rounded": 1, "math": 1, "emoji": 1, "fangsong": 1, "inherit": 1,
      "initial": 1, "unset": 1, "revert": 1, "default": 1, "-webkit-body": 1
    };

    // Is a single family token (quotes/whitespace stripped) allowed to pass through?
    // Allowed => it is standard/generic and measures as present on every machine.
    // Blocked => a non-standard (locally installed) font we hide by dropping it.
    function familyAllowed(tok) {
      var f = String(tok).trim().replace(/^["']|["']$/g, "").toLowerCase();
      if (!f) return false;
      return GENERICS[f] === 1 || STD[f] === true;
    }

    // Strip a comma-separated family list down to its allowed families; always keep
    // a trailing generic so the element still has a coherent fallback.
    function sanitizeFamilyList(list) {
      var parts = String(list).split(",");
      var kept = [];
      for (var i = 0; i < parts.length; i++) {
        if (familyAllowed(parts[i])) kept.push(parts[i].trim());
      }
      if (!kept.length) return "sans-serif";
      // Ensure a generic terminator so a blocked custom font falls back predictably.
      var lastRaw = kept[kept.length - 1].replace(/^["']|["']$/g, "").toLowerCase();
      if (GENERICS[lastRaw] !== 1) kept.push("sans-serif");
      return kept.join(", ");
    }

    // The CSS `font` shorthand carries the family after the size; sanitize only the
    // family tail (everything after the last size-ish token is hard to parse safely,
    // so we take the conservative route: if a non-standard family name appears in the
    // shorthand, rebuild the family portion). We keep the non-family parts intact.
    function sanitizeFontShorthand(val) {
      var s = String(val);
      // Family list is whatever follows the final numeric size/line-height group.
      // Match "<pre> <familylist>" where <pre> ends at the last occurrence of a
      // size token (digits + unit) optionally followed by "/lineheight".
      var m = s.match(/^(.*?\b\d[\d.]*(?:px|pt|em|rem|%|ex|ch|vw|vh|vmin|vmax)?(?:\s*\/\s*[^\s]+)?\s+)(.+)$/i);
      if (!m) return s; // no size token → leave as-is (e.g. a keyword-only value)
      return m[1] + sanitizeFamilyList(m[2]);
    }

    // ---- CSSStyleDeclaration: the element-layout probe path -----------------
    // Font detection libraries set style.fontFamily / style.font on a hidden element
    // and read offsetWidth. Sanitizing the setter makes a blocked font resolve to the
    // fallback, so the element measures identically to a machine without that font.
    var CSD = W.CSSStyleDeclaration;
    if (CSD && CSD.prototype) {
      var famDesc = Object.getOwnPropertyDescriptor(CSD.prototype, "fontFamily");
      if (famDesc && famDesc.set) {
        var _famSet = famDesc.set, _famGet = famDesc.get;
        defGetSet(CSD.prototype, "fontFamily",
          _famGet ? function () { return _famGet.call(this); } : undefined,
          function (v) { _famSet.call(this, sanitizeFamilyList(v)); });
      }
      var fontDesc = Object.getOwnPropertyDescriptor(CSD.prototype, "font");
      if (fontDesc && fontDesc.set) {
        var _fontSet = fontDesc.set, _fontGet = fontDesc.get;
        defGetSet(CSD.prototype, "font",
          _fontGet ? function () { return _fontGet.call(this); } : undefined,
          function (v) { _fontSet.call(this, sanitizeFontShorthand(v)); });
      }
      var _setProp = CSD.prototype.setProperty;
      if (_setProp) def(CSD.prototype, "setProperty", function (prop, value, prio) {
        try {
          var p = String(prop).toLowerCase();
          if (p === "font-family") value = sanitizeFamilyList(value);
          else if (p === "font") value = sanitizeFontShorthand(value);
        } catch (e) {}
        return _setProp.call(this, prop, value, prio);
      });
    }

    // ---- Canvas 2D font: the measureText probe path -------------------------
    var C2D = W.CanvasRenderingContext2D;
    if (C2D && C2D.prototype) {
      var cDesc = Object.getOwnPropertyDescriptor(C2D.prototype, "font");
      if (cDesc && cDesc.set) {
        var _cSet = cDesc.set, _cGet = cDesc.get;
        defGetSet(C2D.prototype, "font",
          _cGet ? function () { return _cGet.call(this); } : undefined,
          function (v) { _cSet.call(this, sanitizeFontShorthand(v)); });
      }
    }

    // ---- FontFaceSet.check(): the direct availability query -----------------
    // document.fonts.check("12px 'X'") returns whether X can render. Answer strictly
    // from the standard-set membership so it agrees with the measurement clamp above.
    try {
      var FFS = W.FontFaceSet;
      if (FFS && FFS.prototype && FFS.prototype.check) {
        def(FFS.prototype, "check", function (font) {
          try {
            var m = String(font).match(/^(.*?\b\d[\d.]*(?:px|pt|em|rem|%)?(?:\s*\/\s*[^\s]+)?\s+)(.+)$/i);
            var famList = m ? m[2] : String(font);
            var parts = famList.split(",");
            for (var i = 0; i < parts.length; i++) if (familyAllowed(parts[i])) return true;
            return false;
          } catch (e) { return true; }
        });
      }
    } catch (e) {}

    // ---- Local Font Access enumeration: report none -------------------------
    function noFonts() { return Promise.resolve([]); }
    try { if (W.queryLocalFonts) def(W, "queryLocalFonts", noFonts); } catch (e) {}
    try {
      if (W.Navigator && W.Navigator.prototype && ("queryLocalFonts" in W.Navigator.prototype)) {
        def(W.Navigator.prototype, "queryLocalFonts", noFonts);
      }
    } catch (e) {}
  })();

  // ============ Clock / timing precision (farble) ============================
  // Blunt high-resolution timers so CPU-speed / micro-benchmark patterns cannot be
  // measured finely. Quantize to a coarse step, then add a deterministic sub-step
  // offset per bucket (so the values are not detectably "always a multiple of the
  // step") while keeping the sequence MONOTONIC NON-DECREASING (a hard requirement:
  // sites break if performance.now() ever goes backwards).
  if (FP_CONFIG.timing) (function timing() {
    var quantum = FP_CONFIG.strict ? 1.0 : 0.1; // ms (0.1 ms standard, 1 ms strict)
    var base = vseed("timing");
    function coarsen(t) {
      if (typeof t !== "number" || !isFinite(t) || t <= 0) return t;
      var b = Math.floor(t / quantum);
      // sub-step offset in [0, quantum): deterministic per bucket. Because it is
      // < quantum and each bucket adds a full quantum, value(b+1) > value(b) always.
      var off = mulberry32((base ^ b) >>> 0)() * quantum;
      return b * quantum + off;
    }
    var P = W.Performance;
    if (P && P.prototype && P.prototype.now) {
      var _now = P.prototype.now;
      def(P.prototype, "now", function () { return coarsen(_now.apply(this, arguments)); });
    }
  })();

  // ============ Media / codec profile (clamp) ================================
  // Normalize codec / media-capability answers to a fixed common table so the exact,
  // device-specific codec fingerprint is not exposed; hide the OS voice list (a
  // strong, cleanly-removable signal like local fonts).
  if (FP_CONFIG.media) (function media() {
    // A common baseline of container/codec types a stock desktop Chromium supports.
    // Anything outside the table answers "not supported" — identical on every machine.
    function common(type) {
      var t = String(type || "").toLowerCase();
      if (!t) return "";
      if (t.indexOf("video/mp4") === 0 || t.indexOf("audio/mp4") === 0) return "probably";
      if (t.indexOf("video/webm") === 0 || t.indexOf("audio/webm") === 0) return "probably";
      if (t.indexOf("audio/mpeg") === 0 || t.indexOf("audio/mp3") === 0) return "probably";
      if (t.indexOf("audio/ogg") === 0 || t.indexOf("video/ogg") === 0) return "maybe";
      if (t.indexOf("audio/aac") === 0 || t.indexOf("audio/x-m4a") === 0) return "probably";
      if (t.indexOf("audio/wav") === 0 || t.indexOf("audio/x-wav") === 0) return "maybe";
      return "";
    }
    var HME = W.HTMLMediaElement;
    if (HME && HME.prototype && HME.prototype.canPlayType) {
      def(HME.prototype, "canPlayType", function (type) { return common(type); });
    }
    try {
      if (W.MediaSource && typeof W.MediaSource.isTypeSupported === "function") {
        def(W.MediaSource, "isTypeSupported", function (type) { return common(type) !== ""; });
      }
    } catch (e) {}
    // mediaCapabilities.decodingInfo / encodingInfo → a fixed answer keyed on the
    // container/codec support only (no device-specific smooth/powerEfficient tell).
    try {
      var MC = W.MediaCapabilities;
      if (MC && MC.prototype) {
        function info(cfg) {
          var supported = false;
          try {
            var c = cfg && (cfg.audio || cfg.video);
            supported = c ? common(c.contentType) !== "" : false;
          } catch (e) {}
          return Promise.resolve({ supported: supported, smooth: supported, powerEfficient: supported });
        }
        if (MC.prototype.decodingInfo) def(MC.prototype, "decodingInfo", info);
        if (MC.prototype.encodingInfo) def(MC.prototype, "encodingInfo", info);
      }
    } catch (e) {}
    // Speech-synthesis voices reveal the exact installed voice packs — hide them
    // (report none), like local fonts. Sites fall back to the default voice.
    try {
      var SS = W.SpeechSynthesis;
      if (SS && SS.prototype && SS.prototype.getVoices) {
        def(SS.prototype, "getVoices", function () { return []; });
      }
    } catch (e) {}
  })();

  // ============ Math rounding (clamp) ========================================
  // Transcendental functions differ in their last ULPs between CPU/libm builds — a
  // known fingerprint. Round every fingerprintable result to 12 significant digits
  // so those low-bit differences vanish and every machine returns the SAME value.
  // 12 digits is far beyond any real precision need, so pages are unaffected.
  if (FP_CONFIG.math) (function mathFp() {
    var M = W.Math;
    if (!M) return;
    function norm(x) {
      if (typeof x !== "number" || !isFinite(x)) return x;
      if (x === 0) return x;
      return parseFloat(x.toPrecision(12));
    }
    ["sin", "cos", "tan", "asin", "acos", "atan", "sinh", "cosh", "tanh",
     "asinh", "acosh", "atanh", "exp", "expm1", "log", "log1p", "log10",
     "log2", "cbrt", "atan2", "pow", "hypot"].forEach(function (name) {
      var orig = M[name];
      if (typeof orig !== "function") return;
      def(M, name, function () { return norm(orig.apply(M, arguments)); });
    });
  })();

})();
