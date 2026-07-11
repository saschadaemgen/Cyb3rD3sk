// Info panel logic (CD-13, detailed component list + held-back state CD-20).
// Talks to the Rust host exclusively over the CEF message router (window.cefQuery)
// — no network, no fetch, no external resources. Commands: get_info_items,
// dismiss_item, check_updates (and reuses navigate for notes links). Wire format
// in docs/cyberdesk-wire-format.md.

(function () {
  "use strict";

  var itemsEl = document.getElementById("items");
  var compsEl = document.getElementById("components");
  var checkedEl = document.getElementById("checked");
  var checkNowBtn = document.getElementById("check-now");

  function query(req) {
    return new Promise(function (resolve, reject) {
      if (!window.cefQuery) {
        reject("info IPC unavailable");
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

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  // A notes link opens in the active slot (host closes the panel on navigate).
  function openNotes(url) {
    query({ cmd: "navigate", input: url }).catch(function () {});
  }

  function dismiss(id) {
    query({ cmd: "dismiss_item", id: id }).then(load).catch(function () {});
  }

  // --- Update item cards (the notification-rail seed) -----------------------
  function renderItem(it) {
    var card = el("div", "item " + (it.severity || "recommended"));
    var head = el("div", "item-head");
    head.appendChild(el("span", "item-title", it.title));
    head.appendChild(el("span", "item-sev", it.severity || "recommended"));
    card.appendChild(head);
    card.appendChild(el("div", "item-body", it.body));

    var actions = el("div", "item-actions");
    if (it.action && it.action.url) {
      var notes = el("button", "btn", it.action.label || "Release notes");
      notes.addEventListener("click", function () { openNotes(it.action.url); });
      actions.appendChild(notes);
    }
    var dis = el("button", "btn ghost", "Dismiss");
    dis.addEventListener("click", function () { dismiss(it.id); });
    actions.appendChild(dis);
    card.appendChild(actions);
    return card;
  }

  // --- Component list: three honest states + informational (CD-20) ----------
  // The state map is the single place the vocabulary lives, so the wording stays
  // consistent and never claims more than the host reported.
  var STATE = {
    current:       { cls: "ok",     label: "Up to date" },
    update:        { cls: "update", label: "Update available" },
    held_back:     { cls: "held",   label: "Held back" },
    informational: { cls: "info",   label: "Installed" }
  };

  function renderComponent(c) {
    var status = c.status || "informational";
    var meta = STATE[status] || STATE.informational;

    var card = el("div", "comp comp-" + status);

    var head = el("div", "comp-head");
    head.appendChild(el("span", "comp-name", c.name || c.id || "?"));
    head.appendChild(el("span", "comp-state " + meta.cls, meta.label));
    card.appendChild(head);

    // Installed version (+ optional secondary detail, e.g. "Chromium 149.x").
    var ver = "Installed " + (c.version || "?");
    if (c.detail) ver += " · " + c.detail;
    card.appendChild(el("div", "comp-ver", ver));

    // Upstream line — only where there is something honest to say.
    if (status === "update" && c.latest) {
      card.appendChild(el("div", "comp-upstream update", "Version " + c.latest + " available"));
    } else if (status === "held_back" && c.latest) {
      card.appendChild(el("div", "comp-upstream held", "Newest release " + c.latest + " — deliberately not installed"));
    }

    // Held-back explanation: why we hold it, and what unpins it. Reads as an
    // intentional decision, never as an error or a pending user action.
    if (status === "held_back") {
      if (c.reason) card.appendChild(el("div", "comp-reason", c.reason));
      if (c.note) card.appendChild(el("div", "comp-note", c.note));
    }

    return card;
  }

  function render(snap) {
    // Update items (the NEW, non-dismissed ones); empty when up to date.
    itemsEl.replaceChildren();
    (snap.items || []).forEach(function (it) { itemsEl.appendChild(renderItem(it)); });

    // The detailed component list: always shown, always honest.
    compsEl.replaceChildren();
    (snap.components || []).forEach(function (c) { compsEl.appendChild(renderComponent(c)); });

    if (!snap.have_feed && (!snap.components || snap.components.length === 0)) {
      compsEl.appendChild(el("p", "empty", "No feed data yet — the update manifest could not be reached."));
    }

    // Footer: honest about the last check. A failed live fetch is never dressed up
    // as a clean "up to date" — we say the check failed and note we're showing the
    // last-known data (CD-20).
    if (snap.feed_ok === false) {
      var msg = "Last check failed";
      if (snap.checked_ago) msg += " · " + snap.checked_ago;
      if (snap.have_feed) msg += " · showing last known data";
      checkedEl.textContent = msg;
      checkedEl.classList.add("failed");
    } else {
      checkedEl.classList.remove("failed");
      checkedEl.textContent = snap.checked_ago ? ("Checked " + snap.checked_ago) : "Not checked yet";
    }
  }

  function load() {
    return query({ cmd: "get_info_items" })
      .then(function (resp) { render(JSON.parse(resp)); })
      .catch(function () { checkedEl.textContent = "Info unavailable"; });
  }

  checkNowBtn.addEventListener("click", function () {
    checkedEl.classList.remove("failed");
    checkedEl.textContent = "Checking…";
    query({ cmd: "check_updates" }).catch(function () {});
    // The check runs async on the host worker; refresh a couple of times to pick
    // up the fresh result (small manifest, usually well under a second).
    setTimeout(load, 1200);
    setTimeout(load, 3000);
  });

  load();
})();
