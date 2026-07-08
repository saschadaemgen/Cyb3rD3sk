//! winit application: window creation, the render loop, and clean ESC exit.

use std::sync::Arc;
use std::time::Instant;

use winit::application::ApplicationHandler;
use winit::event::WindowEvent;
use winit::event_loop::{ActiveEventLoop, ControlFlow, EventLoop};
use winit::keyboard::{KeyCode, PhysicalKey};
use winit::window::{Fullscreen, Window, WindowId};

use crate::renderer::SurfaceRenderer;

/// Run the shell. `windowed == true` opens a 1600x900 dev window instead of
/// borderless fullscreen on the primary monitor.
pub fn run(windowed: bool) {
    let event_loop = EventLoop::new().expect("failed to create event loop");
    // Poll continuously so the ring animates smoothly (presentation is vsync-capped).
    event_loop.set_control_flow(ControlFlow::Poll);

    let mut app = Shell {
        windowed,
        window: None,
        renderer: None,
        start: Instant::now(),
    };
    event_loop.run_app(&mut app).expect("event loop error");
}

struct Shell {
    windowed: bool,
    window: Option<Arc<Window>>,
    renderer: Option<SurfaceRenderer>,
    start: Instant,
}

impl ApplicationHandler for Shell {
    fn resumed(&mut self, event_loop: &ActiveEventLoop) {
        if self.window.is_some() {
            return;
        }

        let mut attributes = Window::default_attributes().with_title("CARVILON CyberDesk");
        attributes = if self.windowed {
            attributes
                .with_inner_size(winit::dpi::LogicalSize::new(1600.0, 900.0))
                .with_resizable(true)
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
    }

    fn window_event(
        &mut self,
        event_loop: &ActiveEventLoop,
        _id: WindowId,
        event: WindowEvent,
    ) {
        match event {
            WindowEvent::CloseRequested => event_loop.exit(),

            WindowEvent::KeyboardInput { event, .. } => {
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

    fn about_to_wait(&mut self, _event_loop: &ActiveEventLoop) {
        if let Some(window) = self.window.as_ref() {
            window.request_redraw();
        }
    }
}
