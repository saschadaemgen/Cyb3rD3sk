# CyberDesk - Wire Format

Project CARVILON CyberDesk - living document - Status: 2026-07-08

Deliberately thin for now - the formats emerge from CD-02 on. Rule: every interface change is documented here before it lands on main.

## Host<->CEF IPC (planned)

- Explicit allowlist of named commands. Documented per command: name, direction, fields, error cases.
- No generic eval or passthrough channels.
- First commands arrive with CD-02: frame handover (OSR texture), input forwarding (mouse/keyboard), navigation (load URL, back/forward).

## Settings IPC (CD-03, live)

The internal settings view (`cyberdesk://settings/`) talks to the Rust host over
the CEF message router (`window.cefQuery`) — process messages, never network
requests. The bridge is registered ONLY on `cyberdesk://` contexts, so it exists
only on the internal view; the surf zone has no access to it.

Transport: `window.cefQuery({ request, persistent: false, onSuccess, onFailure })`.
`request` is a JSON string; the success response is a JSON string; failures carry
`(error_code, message)`. Commands are an explicit allowlist — no generic eval.

### `get_settings` (view -> host)

- Request: `{"cmd":"get_settings"}`
- Success: `{"feather_edges":<bool>,"animated_background":<bool>,"stay_foreground":<bool>,"glow_intensity":<int>,"search_engine":<str>}`
  - `glow_intensity` is a whole percent (50..=220).
  - `search_engine` ∈ { `google`, `duckduckgo`, `bing`, `startpage` } (CD-07).
- Failure: code 1 (malformed request JSON).

### `set_setting` (view -> host)

- Request: `{"cmd":"set_setting","key":"<key>","value":<bool|int|str>}`
- Writable keys and their value types:
  - `feather_edges`, `animated_background`, `stay_foreground` — boolean.
  - `glow_intensity` — number (whole percent; accepts a JSON number or a numeric
    string, clamped host-side to 50..=220).
  - `search_engine` — string (CD-07); one of `google`, `duckduckgo`, `bing`,
    `startpage`. Any other value is rejected with code 3.
- Effect: updates the in-memory setting (applied by the next rendered frame /
  next navigation) and the SQLite `settings` row (survives restart).
- Success: `{"ok":true,"key":"<key>","value":<bool|int|str>}`
- Failure: code 1 (malformed request), 2 (missing `key`/`value` or wrong type),
  3 (unknown key or unknown `search_engine` value), 4 (unknown `cmd`).

CD-05 (D-0012) renamed the background toggle `deep_field` -> `animated_background`
(it now governs whichever background the template selects) and added the numeric
`glow_intensity`; the store migrates the old key. Unknown commands are rejected
with code 4. There is no passthrough channel.

## Command bar / navigation IPC (CD-04, live)

The command bar view (`cyberdesk://command/`) drives the surf zone's navigation
over the same message-router bridge as the settings view (`window.cefQuery`,
process messages only, registered on `cyberdesk://` contexts only). Every command
here targets the surf view (`Role::Surf`); the internal views are never navigated
through this channel. Error codes share the single space defined above (1 =
malformed request JSON, 2 = missing/wrong-typed field, 4 = unknown `cmd`).

### `get_nav_state` (view -> host)

- Request: `{"cmd":"get_nav_state"}`
- Success: `{"url":<str>,"title":<str>,"can_back":<bool>,"can_forward":<bool>,"loading":<bool>,"scheme":<str>,"favorite":<bool>}`
  - `scheme` ∈ { `https`, `http`, `other` }, derived host-side from `url`. The
    command bar paints the amber "insecure" hint when `scheme == "http"`.
  - `favorite` (CD-07) is whether `url` is currently a favorite; it drives the
    star glyph in the command bar.
- Failure: code 1 (malformed request JSON).

### `navigate` (view -> host)

- Request: `{"cmd":"navigate","input":"<str>"}`
- `input` is the raw command-bar text; the host classifies it (URL vs. search):
  - contains `://` -> used verbatim (an explicit `http://` stays http)
  - `localhost` (optionally `:port`/`/path`), or a dot with no whitespace ->
    `https://<input>`
  - empty -> `about:blank`
  - otherwise -> `https://www.google.com/search?q=<urlencoded>`
- Effect: loads the resolved URL in the surf view and closes the command overlay.
- Success: `{"ok":true,"url":"<resolved-url>"}`
- Failure: code 1 (malformed request), 2 (missing `input`).

### `go_back` / `go_forward` / `reload` (view -> host)

- Request: `{"cmd":"go_back"}` | `{"cmd":"go_forward"}` | `{"cmd":"reload"}`
- Effect: the surf view steps back / forward in session history, or reloads.
  Back/forward are no-ops when `can_back` / `can_forward` (from `get_nav_state`)
  is false.
- Success: `{"ok":true}`
- Failure: code 1 (malformed request JSON).

The F5 / Ctrl+R reload and Ctrl+Shift+R hard reload accelerators are handled
host-side from the shell key map, not over this channel.

## Command palette IPC (CD-07, live)

The command bar is a command palette: it shows live suggestions from the local
favorites + history store (D-0014) and toggles favorites. Same transport and
error-code space as above (internal `cyberdesk://command/` view only). All local
— no network.

### `query_suggestions` (view -> host)

- Request: `{"cmd":"query_suggestions","input":"<str>"}`
  - `input` is the current command-bar text; a missing `input` is treated as empty.
- Success: a JSON array (0..=`command.max_results` items), best first:
  `[{"url":<str>,"title":<str>,"favorite":<bool>}, …]`
  - Ranking (host-side): matching favorites first (in their saved order), then
    matching history by frecency (see D-0014). Empty `input` returns the top
    favorites. Matching is a case-insensitive substring on url + title.
  - The reply length also sets the palette's height host-side (the view is sized
    to `input bar + N rows`).
- Failure: code 1 (malformed request JSON).

### `toggle_favorite` (view -> host)

- Request: `{"cmd":"toggle_favorite","url":"<str>","title":"<str>"}`
  - A missing `title` defaults to empty. Internal `cyberdesk://` / blank URLs are
    ignored (they are never favorited).
- Effect: adds the URL to favorites (appended at the end) or removes it.
- Success: `{"favorite":<bool>}` — the new state (true = now a favorite).
- Failure: code 1 (malformed request), 2 (missing `url`).

The surf-view **Ctrl+D** toggles the current page's favorite host-side (from the
shell key map) rather than over this channel; the palette's star and its Ctrl+D
use `toggle_favorite`.

## NetGuard policy (sketch)

- Per zone: allowed destinations (host, port, protocol), optional pinning fingerprint, limits (rate, volume).
- Default: deny. Policy changes are versioned and logged.
- Format decision (file vs. SQLite) falls with the NetGuard base build.

## CARVILON protocols

- Edge and VPS integration follows in Season 7. The server documents remain authoritative (carvilon-server-wire-format.md); this document then holds only the CyberDesk view (which endpoints, which direction, which auth).
