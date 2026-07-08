//! winit application: window creation, the render loop, the embedded CEF
//! browser, and clean ESC exit.

use std::sync::Arc;
use std::time::Instant;

use winit::application::ApplicationHandler;
use winit::dpi::LogicalSize;
use winit::event::WindowEvent;
use winit::event_loop::{ActiveEventLoop, ControlFlow, EventLoop};
use winit::keyboard::{KeyCode, PhysicalKey};
use winit::window::{Fullscreen, Window, WindowId};

use crate::browser;
use crate::renderer::SurfaceRenderer;

/// Run the shell. `windowed == true` opens a 1600x900 dev window instead of
/// borderless fullscreen on the primary monitor.
pub fn run(windowed: bool) {
    let event_loop = EventLoop::new().expect("failed to create event loop");
    // Poll continuously so the ring animates smoothly (vsync-capped presentation).
    event_loop.set_control_flow(ControlFlow::Poll);

    let mut app = Shell {
        windowed,
        window: None,
        renderer: None,
        start: Instant::now(),
        cef_inited: false,
        browser_started: false,
    };
    event_loop.run_app(&mut app).expect("event loop error");

    // The loop has exited; shut CEF (and its UI thread) down.
    browser::shutdown_cef();
}

struct Shell {
    windowed: bool,
    window: Option<Arc<Window>>,
    renderer: Option<SurfaceRenderer>,
    start: Instant,
    cef_inited: bool,
    browser_started: bool,
}

/// Native window handle (HWND as isize) of a winit window.
fn window_hwnd(window: &Window) -> isize {
    use winit::raw_window_handle::{HasWindowHandle, RawWindowHandle};
    match window
        .window_handle()
        .expect("failed to get window handle")
        .as_raw()
    {
        RawWindowHandle::Win32(handle) => handle.hwnd.get(),
        _ => panic!("expected a Win32 window handle"),
    }
}

/// Centered rectangle (device pixels) for the embedded browser: 60% width,
/// 70% height of the window's client area.
fn child_rect(window: &Window) -> (i32, i32, i32, i32) {
    let size = window.inner_size();
    let w = (size.width as f32 * 0.60) as i32;
    let h = (size.height as f32 * 0.70) as i32;
    let x = (size.width as i32 - w) / 2;
    let y = (size.height as i32 - h) / 2;
    (x, y, w, h)
}

impl ApplicationHandler for Shell {
    fn resumed(&mut self, event_loop: &ActiveEventLoop) {
        if self.window.is_some() {
            return;
        }

        let mut attributes = Window::default_attributes().with_title("CARVILON CyberDesk");
        attributes = if self.windowed {
            // Fixed size keeps the embedded browser rectangle correctly placed
            // without reflow handling (out of scope for CD-01).
            attributes
                .with_inner_size(LogicalSize::new(1600.0, 900.0))
                .with_resizable(false)
        } else {
            attributes
                .with_fullscreen(Some(Fullscreen::Borderless(None)))
                .with_decorations(false)
        };

        let window = Arc::new(
            event_loop
                .create_window(attributes)
                .expect("failed to create window"),
        );

        let renderer = SurfaceRenderer::new(window.clone());
        self.window = Some(window);
        self.renderer = Some(renderer);

        // CEF's multi-threaded message loop starts here and returns immediately.
        if !self.cef_inited {
            browser::init_cef();
            self.cef_inited = true;
        }
    }

    fn window_event(&mut self, event_loop: &ActiveEventLoop, _id: WindowId, event: WindowEvent) {
        match event {
            WindowEvent::CloseRequested => event_loop.exit(),

            WindowEvent::KeyboardInput { event, .. } => {
                // ESC while the shell (not the page) has focus. ESC inside the
                // CEF view is handled by browser::CyberKeyboardHandler.
                if event.state.is_pressed()
                    && event.physical_key == PhysicalKey::Code(KeyCode::Escape)
                {
                    event_loop.exit();
                }
            }

            WindowEvent::Resized(size) => {
                if let Some(renderer) = self.renderer.as_mut() {
                    renderer.resize(size.width, size.height);
                }
            }

            WindowEvent::RedrawRequested => {
                let time = self.start.elapsed().as_secs_f32();
                if let Some(renderer) = self.renderer.as_mut() {
                    renderer.render(time);
                }
            }

            _ => {}
        }
    }

    fn about_to_wait(&mut self, event_loop: &ActiveEventLoop) {
        // Create the embedded browser once the CEF context is initialised.
        if !self.browser_started && browser::context_ready() {
            if let Some(window) = self.window.clone() {
                let hwnd = window_hwnd(&window);
                let (x, y, w, h) = child_rect(&window);
                browser::create_child_browser(hwnd, x, y, w, h);
                self.browser_started = true;
            }
        }

        // ESC pressed inside the page routes here.
        if browser::quit_requested() {
            event_loop.exit();
        }

        if let Some(window) = self.window.as_ref() {
            window.request_redraw();
        }
    }
}
