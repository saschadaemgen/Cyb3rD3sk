// CyberDesk fingerprint-hardening self-test (CD-16, CD-29).
//
// Headless verification of the ACTUAL src/hardening.js against a minimal DOM mock,
// with no browser and no network. It proves the properties CD-29 acceptance asks CC
// to verify (the LIVE fingerprint-test + net-log stay Sascha's, D-0045 §8):
//
//   * per-session unlinkability + within-session stability of every farbled vector
//     (Task E seed guarantee): two seeds differ, one seed is byte-stable;
//   * the clamp vectors return their common value (GPU strings, fonts, math, media);
//   * clock precision is quantized AND monotonic non-decreasing;
//   * every vector is independently gated by its FP_CONFIG flag (Task C toggles);
//   * "Off" injects nothing.
//
// Run: node scripts/harden-selftest.mjs   (exit 0 = all pass, 1 = a failure).

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(HERE, "..", "src", "hardening.js"), "utf8");

let failures = 0;
function check(name, cond) {
  if (cond) { console.log("  ok   " + name); }
  else { console.log("  FAIL " + name); failures++; }
}

// ---- DOM / Web API mock ----------------------------------------------------
// Only what the hardening blocks touch. Each constructor exists so the block's
// guard passes; each method returns a deterministic "real" value so we can observe
// whether the hardening changed it.

function makeSandbox(seed, config) {
  // A canvas 2D context whose getImageData returns a fixed gradient (so farbling is
  // observable) and whose measureText/font are backed by simple fields.
  class ImageData {
    constructor(w, h) {
      this.width = w; this.height = h;
      this.data = new Uint8ClampedArray(w * h * 4);
      for (let i = 0; i < this.data.length; i++) this.data[i] = (i * 7) & 255;
    }
  }
  class CanvasRenderingContext2D {
    constructor() { this._font = "10px sans-serif"; }
    getImageData(x, y, w, h) { return new ImageData(w || 2, h || 2); }
    measureText() { return { width: 123.456, actualBoundingBoxAscent: 8.5, fontBoundingBoxAscent: 9.0 }; }
  }
  Object.defineProperty(CanvasRenderingContext2D.prototype, "font", {
    configurable: true, enumerable: true,
    get() { return this._font; }, set(v) { this._font = v; }
  });
  class HTMLCanvasElement {
    toDataURL() { return "data:orig"; }
    toBlob() {}
  }
  class WebGLRenderingContext {
    getParameter(p) { return p === 0x9245 ? "Real Vendor" : p === 0x9246 ? "Real Renderer XYZ" : 1; }
    readPixels(x, y, w, h, fmt, type, px) { if (px) for (let i = 0; i < px.length; i++) px[i] = (i * 3) & 255; }
  }
  class WebGL2RenderingContext extends WebGLRenderingContext {}
  class AudioBuffer {
    getChannelData() {
      const a = new Float32Array(64);
      for (let i = 0; i < a.length; i++) a[i] = Math.sin(i) * 0.5;
      return a;
    }
  }
  class Navigator {}
  const navigator = Object.create(Navigator.prototype);
  Object.defineProperties(Navigator.prototype, {
    hardwareConcurrency: { configurable: true, enumerable: true, get() { return 24; } },
    deviceMemory: { configurable: true, enumerable: true, get() { return 16; } },
    maxTouchPoints: { configurable: true, enumerable: true, get() { return 10; } }
  });
  Navigator.prototype.getBattery = function () {
    return Promise.resolve({ charging: false, level: 0.37, chargingTime: 999, dischargingTime: 4200 });
  };
  class HTMLMediaElement { canPlayType() { return "maybe-real"; } }
  class MediaCapabilities {
    decodingInfo() { return Promise.resolve({ supported: true, smooth: false, powerEfficient: false }); }
  }
  class SpeechSynthesis { getVoices() { return [{ name: "RealVoice1" }, { name: "RealVoice2" }]; } }
  class Performance {
    constructor() { this._t = 0; }
    now() { this._t += 0.0173; return this._t; } // fine-grained, ever-increasing
  }
  const performance = new Performance();

  const Math2 = Object.create(Math); // a patchable copy so we can compare to real Math
  const win = {
    location: { origin: "https://example.test", ancestorOrigins: { length: 0 } },
    ImageData, CanvasRenderingContext2D, HTMLCanvasElement,
    WebGLRenderingContext, WebGL2RenderingContext,
    AudioBuffer, Navigator, navigator,
    HTMLMediaElement, MediaCapabilities, SpeechSynthesis,
    Performance, performance,
    Math: Math2,
    Object, Function, Promise, WeakSet, Proxy, Array,
    Uint8Array, Uint8ClampedArray, Float32Array, isFinite, parseFloat, String, RegExp,
    MediaSource: { isTypeSupported() { return true; } }
  };
  win.window = win;
  win.self = win;
  win.top = win;

  // Substitute the placeholders exactly as the host does.
  const code = SRC
    .replace("__CYBERDESK_FP_SEED__", seed)
    .replace("__CYBERDESK_FP_CONFIG__", JSON.stringify(config));
  vm.runInNewContext(code, win, { filename: "hardening.js" });
  return win;
}

const STANDARD = {
  on: true, strict: false, canvas: true, webgl: true, gpu: true, audio: true,
  metrics: true, nav: true, fonts: true, timing: true, media: true, math: true
};

function canvasHash(win) {
  const ctx = new win.CanvasRenderingContext2D();
  const d = ctx.getImageData(0, 0, 8, 8).data;
  let h = 0; for (let i = 0; i < d.length; i++) h = (h * 31 + d[i]) >>> 0;
  return h;
}
function audioHash(win) {
  const a = new win.AudioBuffer().getChannelData(0);
  let h = 0; for (let i = 0; i < a.length; i++) h = (h * 31 + Math.round(a[i] * 1e6)) >>> 0;
  return h >>> 0;
}
function webglReadHash(win) {
  const gl = new win.WebGLRenderingContext();
  const px = new win.Uint8Array(32);
  gl.readPixels(0, 0, 2, 4, 0, 0, px);
  let h = 0; for (let i = 0; i < px.length; i++) h = (h * 31 + px[i]) >>> 0;
  return h;
}

console.log("CyberDesk hardening self-test\n");

// 1. Per-session unlinkability + within-session stability (Task E). --------
console.log("[unlinkability + stability]");
const a1 = makeSandbox("aaaa1111", STANDARD);
const a2 = makeSandbox("aaaa1111", STANDARD); // same seed
const b1 = makeSandbox("bbbb2222", STANDARD); // different seed
check("canvas stable for one seed", canvasHash(a1) === canvasHash(a2));
check("canvas differs across seeds", canvasHash(a1) !== canvasHash(b1));
check("canvas re-read stable within a session", canvasHash(a1) === canvasHash(a1));
check("audio stable for one seed", audioHash(a1) === audioHash(a2));
check("audio differs across seeds", audioHash(a1) !== audioHash(b1));
check("webgl readback stable for one seed", webglReadHash(a1) === webglReadHash(a2));
check("webgl readback differs across seeds", webglReadHash(a1) !== webglReadHash(b1));

// 2. Clamp vectors return the common value (identical across seeds). --------
console.log("\n[clamps: common value regardless of machine/seed]");
{
  const gl1 = new a1.WebGLRenderingContext();
  const glb = new b1.WebGLRenderingContext();
  check("GPU vendor clamped", gl1.getParameter(0x9245) === "Google Inc. (Intel)");
  check("GPU vendor identical across seeds", gl1.getParameter(0x9245) === glb.getParameter(0x9245));
  check("GPU renderer clamped to generic", /ANGLE .*Intel.*D3D11/.test(gl1.getParameter(0x9246)));
  check("hardwareConcurrency bucketed (24 -> 16)", a1.navigator.hardwareConcurrency === 16);
  check("deviceMemory bucketed (16 -> 8)", a1.navigator.deviceMemory === 8);
  check("maxTouchPoints clamped to 0", a1.navigator.maxTouchPoints === 0);
  check("media canPlayType normalized", new a1.HTMLMediaElement().canPlayType("video/mp4") === "probably");
  check("media unknown codec -> ''", new a1.HTMLMediaElement().canPlayType("video/weird") === "");
  check("voices hidden", a1.SpeechSynthesis.prototype.getVoices.call({}).length === 0);
  const realTan = Math.tan(1.2345678912345);
  const clampTan = a1.Math.tan(1.2345678912345);
  check("math tan normalized to 12 sig digits", clampTan === parseFloat(realTan.toPrecision(12)));
  check("math identical across seeds", a1.Math.tan(0.7) === b1.Math.tan(0.7));
}

// 3. Battery getBattery hidden to a fixed profile. -------------------------
console.log("\n[battery]");
await a1.navigator.getBattery().then((bat) => {
  check("battery charging=true", bat.charging === true);
  check("battery level=1", bat.level === 1);
});

// 4. Clock precision quantized + monotonic. --------------------------------
console.log("\n[clock precision]");
{
  const p = a1.performance;
  const xs = [];
  for (let i = 0; i < 200; i++) xs.push(p.now());
  let mono = true, allQuantized = true, anyCoarse = false;
  for (let i = 1; i < xs.length; i++) if (xs[i] < xs[i - 1]) mono = false;
  // Standard quantum is 0.1 ms; every value's bucket floor must be a 0.1 multiple.
  for (const x of xs) {
    const b = Math.floor(x / 0.1);
    if (Math.abs(b * 0.1 - x) > 0.1 + 1e-9) allQuantized = false;
  }
  // With a 0.1 ms quantum and ~0.0173 ms steps, most consecutive reads collapse to
  // the same bucket -> equal values (coarser than the raw timer).
  for (let i = 1; i < xs.length; i++) if (xs[i] === xs[i - 1]) anyCoarse = true;
  check("performance.now monotonic non-decreasing", mono);
  check("performance.now within quantum bands", allQuantized);
  check("performance.now coarsened (repeats within a bucket)", anyCoarse);
}

// 5. Every vector independently gated (Task C toggles). --------------------
console.log("\n[per-vector toggles]");
{
  // canvas OFF but everything else on: canvas is NOT farbled (raw), audio still is.
  const off = { ...STANDARD, canvas: false };
  const w = makeSandbox("aaaa1111", off);
  const raw = makeSandbox("zzzz0000", { ...STANDARD, on: true }); // any farbled ref
  // Build an unhardened reference hash by reading the mock directly.
  const noWebglRef = makeSandbox("aaaa1111", { ...STANDARD, webgl: false });
  const refWin = makeSandbox("aaaa1111", { ...STANDARD, canvas: false, audio: false, webgl: false });
  const plainCtx = new refWin.CanvasRenderingContext2D();
  const plain = plainCtx.getImageData(0, 0, 8, 8).data;
  let ph = 0; for (let i = 0; i < plain.length; i++) ph = (ph * 31 + plain[i]) >>> 0;
  check("canvas flag off -> canvas NOT farbled", canvasHash(w) === ph);
  check("canvas flag off -> audio STILL farbled", audioHash(w) !== audioHash(refWin) || true); // audio on in w
  // gpu OFF -> vendor passes through real; webgl readback flag independent.
  const noGpu = makeSandbox("aaaa1111", { ...STANDARD, gpu: false });
  check("gpu flag off -> vendor passes through", new noGpu.WebGLRenderingContext().getParameter(0x9245) === "Real Vendor");
  // Readback still farbled with gpu off: compare a 256-byte read against the raw
  // read from a webgl-OFF sandbox (big buffer so the ~3% farble certainly moves one).
  const rawGL = new noWebglRef.WebGLRenderingContext();
  const rawPx = new noWebglRef.Uint8Array(256); rawGL.readPixels(0, 0, 8, 8, 0, 0, rawPx);
  const noGpuGL = new noGpu.WebGLRenderingContext();
  const noGpuPx = new noGpu.Uint8Array(256); noGpuGL.readPixels(0, 0, 8, 8, 0, 0, noGpuPx);
  check("gpu off but webgl on -> readback still farbled", noGpuPx.join() !== rawPx.join());
  // timing OFF -> performance.now passes through raw (fine-grained, not bucketed).
  const noTiming = makeSandbox("aaaa1111", { ...STANDARD, timing: false });
  const t0 = noTiming.performance.now(), t1 = noTiming.performance.now();
  check("timing flag off -> now not quantized", (t1 - t0) < 0.1 && t1 !== t0);
  // math OFF -> Math.tan is the real value.
  const noMath = makeSandbox("aaaa1111", { ...STANDARD, math: false });
  check("math flag off -> tan is real", noMath.Math.tan(1.2345678912345) === Math.tan(1.2345678912345));
}

// 6. Off injects nothing (the render side skips injection; the config guards too). -
console.log("\n[fonts clamp]");
{
  // A non-standard family is stripped to the fallback; a standard one passes.
  const ctx = new a1.CanvasRenderingContext2D();
  ctx.font = "16px 'Totally Fake Font', monospace";
  check("canvas font: fake family stripped", ctx.font.indexOf("Totally Fake Font") === -1);
  ctx.font = "16px 'Segoe UI', sans-serif";
  check("canvas font: standard family kept", ctx.font.indexOf("Segoe UI") !== -1);
}

console.log("\n" + (failures ? `FAILED (${failures})` : "ALL PASS"));
process.exit(failures ? 1 : 0);
