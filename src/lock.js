// Vault lock page logic (CD-40/CD-42/CD-43; flow + ergonomics CD-44 A1/A2).
// Renders the vault state the host pushes (window.cdVault) / serves on load
// (get_vault_state). Two modes from the same push: unlock (a vault exists)
// and mandatory first-launch setup (none does). No secret ever reaches this
// page: the host consumes the keyboard while capturing and this page draws
// dots from a character COUNT. The entry is ALWAYS focused while this page
// is up (the host owns the keyboard); the UI shows that instead of
// pretending to be an input. Wire format: docs/cyberdesk-wire-format.md.

(function () {
  "use strict";

  var titleEl = document.getElementById("title");
  var subtitleEl = document.getElementById("subtitle");
  var hintEl = document.getElementById("hint");
  var entryEl = document.getElementById("entry");
  var dotsEl = document.getElementById("dots");
  var statusEl = document.getElementById("status");
  var consequenceEl = document.getElementById("consequence");
  var placeholderEl = document.getElementById("placeholder");
  var footEl = document.getElementById("foot");
  var quitEl = document.getElementById("quit");
  var meterEl = document.getElementById("meter");
  var meterFill = document.getElementById("meter-fill");
  var meterLabel = document.getElementById("meter-label");
  var critLen = document.getElementById("crit-len");
  var weakEl = document.getElementById("weak");
  var weakWhy = document.getElementById("weak-why");
  var weakUse = document.getElementById("weak-use");
  var stepEl = document.getElementById("step");
  var stepBadge = document.getElementById("step-badge");
  var chosenEl = document.getElementById("chosen");
  var chosenNote = document.getElementById("chosen-note");
  var goEl = document.getElementById("go");
  var backEl = document.getElementById("back");
  var offerEl = document.getElementById("offer");
  var offerAdd = document.getElementById("offer-add");
  var offerSkip = document.getElementById("offer-skip");

  var coreEl = document.getElementById("core");
  var ringEls = ["ring-a", "ring-b", "ring-c"].map(function (id) {
    return document.getElementById(id);
  });

  // The host's zxcvbn score 0..4, verbalized (D-0044: confident, accurate).
  var SCORE_LABELS = ["Very weak", "Weak", "Fair", "Strong", "Very strong"];

  // --- The Energy Core (CD-47 Stage B) --------------------------------------
  // The motif is driven from the state the host pushes and from events the
  // host fires. It never depicts anything it was not told: the charge is the
  // real strength score, the flare follows a real unlock. It also shows no
  // MORE than the meter and the dot count already do.

  // The product's motion setting, published with the theme tokens by the host
  // (appearance.rs). The media query for the system preference lives in the
  // stylesheet; this is the product switch.
  function motionOn() {
    // The system preference counts as well as the product setting: whichever
    // asks for less motion wins. The media query in the stylesheet handles
    // the CSS side; this is the same rule for the scripted side.
    if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return false;
    }
    var v = getComputedStyle(document.documentElement).getPropertyValue("--motion");
    return String(v).trim() !== "0";
  }

  // The rings rotate through the Web Animations API rather than CSS keyframes
  // for one reason: changing a CSS animation-duration restarts the timing and
  // the ring visibly jumps, while playbackRate ramps the same animation. The
  // periods match the start page, so both screens are the same machine.
  var RING_MS = [34000, 23000, 15000];
  var ringAnims = ringEls.map(function (el, i) {
    if (!el || !el.animate) return null;
    var dir = i === 1 ? "reverse" : "normal";
    var a = el.animate(
      [{ transform: "rotate(0deg)" }, { transform: "rotate(360deg)" }],
      { duration: RING_MS[i], iterations: Infinity, easing: "linear", direction: dir }
    );
    return a;
  });

  function applyRingRate(rate) {
    for (var i = 0; i < ringAnims.length; i++) {
      var a = ringAnims[i];
      if (!a) continue;
      if (!motionOn()) {
        // Motion off: hold a still frame. The composition stays whole, it
        // simply stops moving (never a broken or empty core).
        a.pause();
        continue;
      }
      if (a.playState === "paused") a.play();
      if (a.updatePlaybackRate) a.updatePlaybackRate(rate);
      else a.playbackRate = rate;
    }
  }

  // Charge: "idle" wherever nothing is being measured, otherwise the host's
  // own score. Spin follows the same truth.
  var RATE_BY_CHARGE = { idle: 1, "0": 0.8, "1": 1.05, "2": 1.35, "3": 1.75, "4": 2.2 };

  // Apply the idle rate once at startup. Without this, `setCharge` would
  // never run on a page that opens idle and stays idle (the unlock screen),
  // so with motion OFF the rings would keep spinning: the setting would be
  // ignored on the most common screen of all.
  applyRingRate(RATE_BY_CHARGE.idle);

  function setCharge(charge) {
    if (coreEl.dataset.charge === charge) return;
    coreEl.dataset.charge = charge;
    applyRingRate(RATE_BY_CHARGE[charge] || 1);
  }

  // One-shot effects. Each is removed again so it can fire a second time, and
  // each is a class the stylesheet owns - no inline animation here.
  var fxTimer = null;
  function playFx(kind, ms) {
    coreEl.classList.remove("fx-accept", "fx-unlock", "fx-reject");
    void coreEl.offsetWidth;                 // restart even on a repeat
    coreEl.classList.add("fx-" + kind);
    if (fxTimer) clearTimeout(fxTimer);
    // The unlock flare is left standing: the shell replaces this view.
    if (kind === "unlock") return;
    fxTimer = setTimeout(function () {
      coreEl.classList.remove("fx-" + kind);
    }, ms);
  }

  // The vault-opening moment, fired by the HOST after a real unlock (the page
  // cannot know: it is about to be replaced by the workspace).
  window.cdLockFx = function (kind) {
    // The page guards itself rather than trusting the caller to have checked
    // (measured: a zero-length `forwards` fade snaps straight to its end
    // frame, so with motion off the panel would vanish instantly instead of
    // simply not animating). The shell skips the flare for the same reason,
    // but a guard that lives in only one of the two is one caller away from
    // a blank screen.
    if (!motionOn()) return;
    if (kind === "unlock") {
      playFx("unlock", 620);
      document.querySelector(".panel").classList.add("fx-unlock");
    }
  };

  function query(req) {
    return new Promise(function (resolve, reject) {
      if (!window.cefQuery) {
        reject("vault IPC unavailable");
        return;
      }
      window.cefQuery({
        request: JSON.stringify(req),
        persistent: false,
        onSuccess: function (response) { resolve(response); },
        onFailure: function (code, message) { reject(message || ("error " + code)); }
      });
    });
  }

  function renderDots(n) {
    // Cap the DOM at a sane count; past 64 the count alone is shown.
    var cap = Math.min(n, 64);
    while (dotsEl.children.length > cap) dotsEl.removeChild(dotsEl.lastChild);
    while (dotsEl.children.length < cap) {
      var d = document.createElement("span");
      d.className = "dot";
      dotsEl.appendChild(d);
    }
  }

  function setStatus(text, isInfo) {
    if (!text) {
      statusEl.hidden = true;
      return;
    }
    statusEl.hidden = false;
    statusEl.textContent = text;
    statusEl.className = isInfo ? "status info" : "status";
  }

  // Render the live meter from the HOST-computed snapshot (score, criteria,
  // canned feedback). The password itself never reaches this page. The weak
  // block follows ONLY the host's staged weak_pending, so the meter, the
  // criteria and the warning can never disagree (CD-44 A2).
  function renderMeter(s) {
    var st = s.strength;
    // The meter belongs to the CHOICE step only. The confirm step checks a
    // match, it measures nothing, so it shows no meter (CD-46 Stage A).
    var show = !!st && (s.capture === "setup_pass" || s.capture === "change_pass");
    meterEl.hidden = !show;
    // The warning lives at the decision point and only while the decision is
    // still open: never over a choice already made.
    weakEl.hidden = !(show && s.weak_pending);
    if (!show) return;
    meterEl.className = "meter s" + st.score;
    meterFill.style.width = s.chars ? (((st.score + 1) * 20) + "%") : "0";
    meterLabel.textContent = s.chars ? SCORE_LABELS[st.score] : " ";
    critLen.textContent = (st.len_ok ? "✓ " : "") + st.target_len + "+ characters";
    critLen.className = st.len_ok ? "crit met" : "crit";
    // The host's own reasons go INSIDE the warning block, so the verdict is
    // stated once instead of twice in two different registers.
    var fb = [];
    if (st.warning) fb.push(st.warning);
    if (st.suggestions && st.suggestions.length) fb = fb.concat(st.suggestions);
    weakWhy.hidden = !fb.length;
    weakWhy.textContent = fb.join(" ");
  }

  // Which step the panel is on, so a real step CHANGE can animate in place
  // rather than the panel jumping to a new size (CD-46 Stage A).
  var lastStep = null;

  function markStep(step) {
    if (step === lastStep) return;
    lastStep = step;
    stepEl.classList.remove("turn");
    void stepEl.offsetWidth;   // restart the animation
    stepEl.classList.add("turn");
  }

  // What the last push said, so a real CHANGE can be told apart from a repeat
  // render: the effects fire on transitions, never on every state push.
  var lastCapture = null;
  var lastError = null;
  // The host's last real reading for the password currently banked (CD-47).
  var heldCharge = "idle";

  function render(s) {
    // The core's charge IS the host's score: it is shown only while a
    // password is actually being measured, and it idles calmly otherwise
    // (the unlock prompt measures nothing, so it must not pretend to).
    var stc = s.strength;
    var measuring = !!stc && (s.capture === "setup_pass" || s.capture === "change_pass");
    var confirming = s.capture === "setup_confirm" || s.capture === "change_confirm";
    if (measuring) heldCharge = (s.chars || 0) > 0 ? String(stc.score) : "idle";
    // At the confirm step the host is measuring nothing (there is nothing to
    // measure yet), but the chosen password is real and so was its score:
    // the core HOLDS that reading while the choice is banked, rather than
    // falling back to idle and reading as charge lost right after the step
    // was accepted. Going back or finishing clears it.
    if (!confirming || !s.has_choice) {
      if (!measuring) heldCharge = "idle";
    }
    setCharge(measuring || (confirming && s.has_choice) ? heldCharge : "idle");

    // An accepted step gets its own confirmation, felt as well as read
    // (CD-47 A2): the one thing missing when an empty confirm field read as
    // a failed submission.
    var advanced =
      (lastCapture === "setup_pass" && s.capture === "setup_confirm") ||
      (lastCapture === "change_pass" && s.capture === "change_confirm");
    if (advanced) playFx("accept", 620);

    // A refusal (a mismatch, a failed unlock, a too-short entry) answers in
    // its own register: the core settles back and the field marks the error
    // colour. Short, controlled, never punishing.
    var errNow = s.error || null;
    if (errNow && errNow !== lastError) {
      playFx("reject", 520);
      entryEl.classList.remove("reject");
      void entryEl.offsetWidth;
      entryEl.classList.add("reject");
    }
    lastCapture = s.capture || null;
    lastError = errNow;

    renderDots(s.chars || 0);
    entryEl.classList.toggle("busy", !!s.busy);
    // The entry is live (host-captured, focused) whenever a capture is open
    // and no worker is running - the visual focus never lies (CD-44 A1).
    entryEl.classList.toggle("live", !!s.capture && !s.busy);
    renderMeter(s);

    // The first-run passkey offer (CD-44 D1): the vault is already set up,
    // so the entry and the meter step aside for one optional question.
    if (s.offer_passkey) {
      markStep("offer");
      offerEl.hidden = false;
      entryEl.hidden = true;
      meterEl.hidden = true;
      weakEl.hidden = true;
      chosenEl.hidden = true;
      stepBadge.hidden = true;
      consequenceEl.hidden = true;
      placeholderEl.hidden = true;
      titleEl.textContent = "Master password set";
      subtitleEl.textContent = "First launch - optional step";
      hintEl.textContent =
        "Your vault is ready. One optional extra: a passkey as the second factor.";
      footEl.textContent = "";
      goEl.hidden = true;
      backEl.hidden = true;
      var busyHello = s.hello === "enroll";
      var wa = s.webauthn || {};
      // Honest about this machine (CD-46 Stage B): when Windows Hello has no
      // PIN, fingerprint or face yet, the offer says so and names the next
      // step rather than presenting an action that cannot succeed.
      var ready = wa.hello_ready !== false;
      offerAdd.hidden = !ready;
      offerAdd.disabled = busyHello;
      offerAdd.textContent = busyHello ? "Follow Windows Hello…" : "Set up passkey";
      offerSkip.disabled = busyHello;
      offerSkip.textContent = ready ? "Not now" : "Continue";
      document.getElementById("offer-text").textContent = ready
        ? "Windows Hello can act as a second factor: with two-factor unlock on, " +
          "CyberDesk asks for your master password and a Hello confirmation. It is " +
          "optional, and you can add or remove it later in Settings."
        : "Windows Hello is not set up on this device yet, so there is nothing to " +
          "enrol right now. Add a PIN, fingerprint or face in Windows Settings > " +
          "Accounts > Sign-in options, then add the passkey any time in Settings.";
      setStatus(s.error || (busyHello
        ? "Confirm twice with Windows Hello: once to create the passkey, once to derive its vault secret."
        : null), !s.error);
      return;
    }
    offerEl.hidden = true;
    entryEl.hidden = false;

    if (s.broken) {
      titleEl.textContent = "Vault unavailable";
      subtitleEl.textContent = "Start authorization";
      hintEl.textContent =
        "The vault file failed to validate. CyberDesk stays locked rather than " +
        "guessing; the details below say what to do.";
      setStatus(s.broken, false);
      consequenceEl.hidden = true;
      placeholderEl.hidden = true;
      meterEl.hidden = true;
      weakEl.hidden = true;
      chosenEl.hidden = true;
      stepBadge.hidden = true;
      goEl.hidden = true;
      backEl.hidden = true;
      footEl.textContent = "";
      return;
    }

    var twofa = s.required === 2;
    var placeholder = "";
    var chosen = false;
    // The primary action names what it DOES at this step, not "OK" (D-0044).
    var goLabel = "Continue";
    var canBack = false;
    var foot = "Enter continues · Backspace edits · Esc clears the entry · Ctrl+V pastes";

    switch (s.capture) {
      case "setup_pass":
        markStep("setup1");
        titleEl.textContent = "Choose your master password";
        subtitleEl.textContent = "First launch";
        stepBadge.hidden = false;
        stepBadge.textContent = "Step 1 of 2";
        hintEl.textContent =
          "This password protects CyberDesk. The field below is already " +
          "focused: what you type goes straight into the CyberDesk core, " +
          "never to any page.";
        consequenceEl.hidden = false;
        placeholder = "Type your master password";
        goLabel = "Continue";
        break;
      case "setup_confirm":
        markStep("setup2");
        titleEl.textContent = "Confirm your master password";
        subtitleEl.textContent = "First launch";
        stepBadge.hidden = false;
        stepBadge.textContent = "Step 2 of 2";
        // Say plainly that step 1 landed (CD-47 A2). An empty confirm field
        // with no acknowledgement reads as "that never submitted, type it
        // again" rather than as the next step - the exact confusion reported.
        hintEl.textContent =
          "Your first entry was accepted. Type it once more, so a typo " +
          "cannot lock you out of your own vault.";
        // The choice is stated, not re-warned about, and never as a second
        // field (CD-46 Stage A).
        chosen = true;
        consequenceEl.hidden = true;
        placeholder = "Re-type your master password";
        goLabel = "Create vault";
        canBack = true;
        foot = "Enter creates the vault · Esc goes back to step 1";
        break;
      case "change_pass":
        markStep("change1");
        titleEl.textContent = "Choose a new master password";
        subtitleEl.textContent = "Change";
        stepBadge.hidden = false;
        stepBadge.textContent = "Step 1 of 2";
        hintEl.textContent = "Type the new master password.";
        consequenceEl.hidden = true;
        placeholder = "Type the new master password";
        goLabel = "Continue";
        break;
      case "change_confirm":
        markStep("change2");
        titleEl.textContent = "Confirm your new master password";
        subtitleEl.textContent = "Change";
        stepBadge.hidden = false;
        stepBadge.textContent = "Step 2 of 2";
        hintEl.textContent =
          "Your first entry was accepted. Type it once more to confirm the change.";
        chosen = true;
        consequenceEl.hidden = true;
        placeholder = "Re-type the new password";
        goLabel = "Change password";
        canBack = true;
        foot = "Enter applies the change · Esc goes back to step 1";
        foot = "Enter applies · Esc on an empty field goes back one step";
        break;
      default:
        markStep("unlock");
        stepBadge.hidden = true;
        titleEl.textContent = "Vault locked";
        subtitleEl.textContent = twofa
          ? "Start authorization · two-factor"
          : "Start authorization";
        hintEl.textContent = twofa
          ? "Two-factor unlock: enter your master password, then confirm with " +
            "Windows Hello. The field is already focused; keystrokes go to " +
            "the CyberDesk core only."
          : "Enter your master password. The field is already focused: what " +
            "you type goes straight into the core, never to any page.";
        consequenceEl.hidden = true;
        placeholder = "Enter your master password";
        // Only the unlock prompt reaches this branch on the lock page; the
        // label stays exact rather than assuming which capture it is.
        goLabel = s.capture === "unlock_pass"
          ? (twofa ? "Unlock with Windows Hello" : "Unlock")
          : "Continue";
        foot = "Enter unlocks · Backspace edits · Esc clears the entry · Ctrl+V pastes";
        break;
    }

    // The primary action is the visible route forward at EVERY step, with the
    // keyboard as the accelerator (CD-47 Stage A). Two exceptions, both so
    // that exactly one primary action is ever on screen: while a weak entry
    // is parked the warning block's own override IS the way forward, and
    // while a worker runs there is nothing to submit.
    var weakParked = !!s.weak_pending;
    goEl.hidden = !s.capture || weakParked;
    goEl.textContent = s.busy ? "Working…" : goLabel;
    goEl.disabled = !!s.busy || !(s.chars > 0);
    goEl.title = (!s.busy && !(s.chars > 0)) ? "Type your password first" : "";
    backEl.hidden = !canBack || !!s.busy;

    // The settled choice, at the confirm step only: one line of plain text,
    // never a second field. It states that a weak password was accepted, and
    // does not warn about it again (CD-46 Stage A).
    chosenEl.hidden = !(chosen && s.has_choice);
    chosenNote.hidden = !s.weak_accepted;

    // The placeholder is the neutral empty state (never a verdict).
    placeholderEl.textContent = placeholder;
    placeholderEl.hidden = (s.chars || 0) > 0 || !s.capture || !!s.busy;
    footEl.textContent = foot;

    if (s.hello === "assert") {
      // The host holds the Hello modal open - the second factor (CD-43).
      setStatus("Second factor: confirm with Windows Hello…", true);
    } else if (s.busy) {
      var setupish = s.capture === "setup_confirm" || s.capture === "setup_pass";
      setStatus(setupish ? "Creating the vault…" : "Checking…", true);
    } else if (s.error) {
      setStatus(s.error, false);
    } else {
      setStatus(null);
    }
  }

  window.cdVault = function (json) {
    try { render(JSON.parse(json)); } catch (e) { /* keep last good state */ }
  };

  // Click-to-focus, honestly: the entry is captured by the host the whole
  // time, so a click acknowledges the focus visually instead of moving it.
  entryEl.addEventListener("mousedown", function () {
    entryEl.classList.remove("pulse");
    // Force a reflow so the animation restarts on every click.
    void entryEl.offsetWidth;
    entryEl.classList.add("pulse");
  });

  weakUse.addEventListener("click", function () {
    query({ cmd: "vault_accept_weak" }).then(function (r) {
      try { render(JSON.parse(r)); } catch (e) {}
    }).catch(function (e) { setStatus(String(e), false); });
  });

  offerAdd.addEventListener("click", function () {
    query({ cmd: "vault_enroll_passkey" }).then(function (r) {
      try { render(JSON.parse(r)); } catch (e) {}
    }).catch(function (e) { setStatus(String(e), false); });
  });

  offerSkip.addEventListener("click", function () {
    query({ cmd: "vault_skip_passkey_offer" }).then(function (r) {
      try { render(JSON.parse(r)); } catch (e) {}
    }).catch(function (e) { setStatus(String(e), false); });
  });

  // The primary action sends no characters: the host already holds the entry
  // in locked memory and this only tells it to proceed (the iron law stands).
  goEl.addEventListener("click", function () {
    query({ cmd: "vault_submit" }).then(function (r) {
      try { render(JSON.parse(r)); } catch (e) {}
    }).catch(function (e) { setStatus(String(e), false); });
  });

  backEl.addEventListener("click", function () {
    query({ cmd: "vault_step_back" }).then(function (r) {
      try { render(JSON.parse(r)); } catch (e) {}
    }).catch(function (e) { setStatus(String(e), false); });
  });

  quitEl.addEventListener("click", function () {
    query({ cmd: "quit" }).catch(function () {});
  });

  query({ cmd: "get_vault_state" }).then(function (r) {
    try { render(JSON.parse(r)); } catch (e) {}
  }).catch(function (e) { setStatus(String(e), false); });
})();
