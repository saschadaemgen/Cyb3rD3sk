// Info panel logic (CD-13). Talks to the Rust host exclusively over the CEF
// message router (window.cefQuery) — no network, no fetch, no external
// resources. Commands: get_info_items, dismiss_item, check_updates (and reuses
// navigate for notes links). Wire format in docs/cyberdesk-wire-format.md.

(function () {
  "use strict";

  var itemsEl = document.getElementById("items");
  var statusEl = document.getElementById("status-list");
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

  function statusRow(name, version, upToDate, available) {
    var row = el("div", "status-row");
    var left = el("div", "");
    left.appendChild(el("div", "status-name", name));
    left.appendChild(el("div", "status-ver", version));
    row.appendChild(left);
    if (upToDate) {
      row.appendChild(el("span", "status-state ok", "up to date"));
    } else {
      row.appendChild(el("span", "status-state update", available ? (available + " available") : "update available"));
    }
    return row;
  }

  function render(snap) {
    // Update items (the NEW, non-dismissed ones).
    itemsEl.replaceChildren();
    (snap.items || []).forEach(function (it) { itemsEl.appendChild(renderItem(it)); });

    // Calm component status: always honest about versions.
    statusEl.replaceChildren();
    var cd = snap.cyberdesk || {};
    statusEl.appendChild(statusRow("CyberDesk", cd.version || "?", !!cd.up_to_date, cd.latest));
    var cef = snap.cef || {};
    var cefVer = (cef.version || "?") + (cef.chromium ? " · Chromium " + cef.chromium : "");
    statusEl.appendChild(statusRow("CEF core", cefVer, !!cef.up_to_date, cef.recommended));

    if (!snap.have_feed && (!snap.items || snap.items.length === 0)) {
      statusEl.appendChild(el("p", "empty", "No feed data yet — the update manifest could not be reached."));
    }

    // Footer.
    if (snap.checked_ago) {
      checkedEl.textContent = "Checked " + snap.checked_ago;
    } else {
      checkedEl.textContent = "Not checked yet";
    }
  }

  function load() {
    return query({ cmd: "get_info_items" })
      .then(function (resp) { render(JSON.parse(resp)); })
      .catch(function () { checkedEl.textContent = "Info unavailable"; });
  }

  checkNowBtn.addEventListener("click", function () {
    checkedEl.textContent = "Checking…";
    query({ cmd: "check_updates" }).catch(function () {});
    // The check runs async on the host worker; refresh a couple of times to pick
    // up the fresh result (small manifest, usually well under a second).
    setTimeout(load, 1200);
    setTimeout(load, 3000);
  });

  load();
})();
