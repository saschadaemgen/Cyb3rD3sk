//! CEF (Chromium Embedded Framework) integration — the CyberDesk surf-zone.
//!
//! Stage B of CD-01: embeds a chromeless CEF browser (Alloy runtime style, so
//! there is no toolbar/omnibox — just the page surface) as a native child
//! window inside the shell window. This is a feasibility proof; there is no
//! off-screen rendering or compositing yet (that is CD-02/CD-03).
//!
//! CEF runs with a **multi-threaded message loop** (like the upstream
//! `cefclient`): `CefInitialize` returns immediately and CEF services its own
//! UI thread, while winit owns the main thread's event loop. All CEF callbacks
//! therefore arrive on CEF's UI thread, so shared state is behind a `Mutex` /
//! atomics.
//!
//! Sandbox note: the Windows CEF sandbox is disabled here (`no_sandbox`); see
//! docs/cyberdesk-decisions.md, D-0008, for the tracked deviation.

use std::os::raw::c_int;
use std::ptr;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};

use cef::*;

/// Page loaded into the embedded surf-zone view for the CD-01 feasibility proof.
const HOME_URL: &str = "https://www.google.com/";

/// Windows virtual-key code for ESC.
const VK_ESCAPE: c_int = 0x1B;

#[derive(Default)]
struct CefState {
    context_ready: bool,
}

fn state() -> &'static Arc<Mutex<CefState>> {
    static STATE: OnceLock<Arc<Mutex<CefState>>> = OnceLock::new();
    STATE.get_or_init(|| Arc::new(Mutex::new(CefState::default())))
}

static QUIT_REQUESTED: AtomicBool = AtomicBool::new(false);

/// True once ESC has been pressed inside the CEF view (the winit key handler
/// covers ESC while the shell itself has focus).
pub fn quit_requested() -> bool {
    QUIT_REQUESTED.load(Ordering::Relaxed)
}

// --- Process / lifecycle ----------------------------------------------------

/// Must be the first thing `main` does. Binds the CEF API version and runs the
/// CEF sub-process logic: for CEF sub-processes (renderer/GPU/utility, launched
/// as `cyberdesk.exe --type=...`) this blocks until the sub-process exits and
/// then terminates the process; for the main browser process it returns.
pub fn run_subprocess_if_needed() {
    let _ = api_hash(sys::CEF_API_VERSION_LAST, 0);

    let args = args::Args::new();
    let code = execute_process(Some(args.as_main_args()), None::<&mut App>, ptr::null_mut());
    if code >= 0 {
        std::process::exit(code);
    }
}

/// Initialise CEF for the main browser process. Multi-threaded message loop
/// (CEF runs its own UI thread), sandbox disabled. Returns immediately.
pub fn init_cef() {
    let mut app = CyberApp::new();

    // Give CEF its own isolated profile/cache next to the executable. Without a
    // dedicated root_cache_path CEF uses a default shared location, which can
    // collide with a separately installed Chrome (process-singleton behaviour,
    // loading a foreign session, GPU-process instability). The surf-zone must
    // never share state with the user's own browser.
    let cache_path = std::env::current_exe()
        .ok()
        .and_then(|exe| exe.parent().map(|dir| dir.join("cyberdesk-cache")))
        .map(|p| CefString::from(p.to_string_lossy().as_ref()))
        .unwrap_or_default();

    let settings = Settings {
        no_sandbox: 1,
        multi_threaded_message_loop: 1,
        root_cache_path: cache_path,
        ..Default::default()
    };

    let args = args::Args::new();
    let ok = cef::initialize(
        Some(args.as_main_args()),
        Some(&settings),
        Some(&mut app),
        ptr::null_mut(),
    );
    assert_eq!(ok, 1, "CefInitialize failed");
}

/// Shut CEF down. Call once, after the event loop has exited.
pub fn shutdown_cef() {
    cef::shutdown();
}

/// True once `OnContextInitialized` has fired — after this the browser can be
/// created.
pub fn context_ready() -> bool {
    state().lock().unwrap().context_ready
}

/// Create the chromeless Alloy child browser inside the parent window's client
/// area at the given device-pixel rectangle. Call once. Safe to call from the
/// main thread — `CreateBrowser` is asynchronous and thread-safe.
pub fn create_child_browser(parent_hwnd: isize, x: i32, y: i32, width: i32, height: i32) {
    let window_info = WindowInfo {
        runtime_style: RuntimeStyle::ALLOY,
        ..Default::default()
    }
    .set_as_child(
        sys::HWND(parent_hwnd as *mut sys::HWND__),
        &Rect { x, y, width, height },
    );

    let mut client = CyberClient::new();
    let url = CefString::from(HOME_URL);
    let browser_settings = BrowserSettings::default();

    let created = browser_host_create_browser(
        Some(&window_info),
        Some(&mut client),
        Some(&url),
        Some(&browser_settings),
        None,
        None,
    );
    assert_eq!(created, 1, "CefBrowserHost::CreateBrowser failed");
}

// --- CEF handler implementations --------------------------------------------

wrap_app! {
    pub struct CyberApp;

    impl App {
        fn browser_process_handler(&self) -> Option<BrowserProcessHandler> {
            Some(CyberBrowserProcessHandler::new())
        }
    }
}

wrap_browser_process_handler! {
    struct CyberBrowserProcessHandler;

    impl BrowserProcessHandler {
        fn on_context_initialized(&self) {
            state().lock().unwrap().context_ready = true;
        }
    }
}

wrap_client! {
    struct CyberClient;

    impl Client {
        fn life_span_handler(&self) -> Option<LifeSpanHandler> {
            Some(CyberLifeSpanHandler::new())
        }

        fn keyboard_handler(&self) -> Option<KeyboardHandler> {
            Some(CyberKeyboardHandler::new())
        }
    }
}

wrap_life_span_handler! {
    struct CyberLifeSpanHandler;

    impl LifeSpanHandler {
        // Suppress popups entirely — the surf-zone never spawns new windows,
        // and we must NOT hijack the main view to arbitrary popup targets
        // (that would let ad popups navigate the page away).
        fn on_before_popup(
            &self,
            _browser: Option<&mut Browser>,
            _frame: Option<&mut Frame>,
            _popup_id: c_int,
            _target_url: Option<&CefString>,
            _target_frame_name: Option<&CefString>,
            _target_disposition: WindowOpenDisposition,
            _user_gesture: c_int,
            _popup_features: Option<&PopupFeatures>,
            _window_info: Option<&mut WindowInfo>,
            _client: Option<&mut Option<Client>>,
            _settings: Option<&mut BrowserSettings>,
            _extra_info: Option<&mut Option<DictionaryValue>>,
            _no_javascript_access: Option<&mut c_int>,
        ) -> c_int {
            1 // cancel the popup
        }
    }
}

wrap_keyboard_handler! {
    struct CyberKeyboardHandler;

    impl KeyboardHandler {
        fn on_pre_key_event(
            &self,
            _browser: Option<&mut Browser>,
            event: Option<&KeyEvent>,
            _os_event: Option<&mut sys::tagMSG>,
            _is_keyboard_shortcut: Option<&mut c_int>,
        ) -> c_int {
            if let Some(event) = event {
                if event.windows_key_code == VK_ESCAPE {
                    QUIT_REQUESTED.store(true, Ordering::Relaxed);
                    return 1; // consume ESC so the page never sees it
                }
            }
            0 // let every other key through (typing must work in the page)
        }
    }
}
