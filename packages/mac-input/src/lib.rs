#![cfg(target_os = "macos")]
#![deny(clippy::all)]

//! Synthesize mouse and keyboard events on macOS via the public CoreGraphics
//! event APIs. All coordinates are in **CG global points** (top-left origin
//! of the primary display, Y grows down) - same coordinate space used by
//! `CGWindowListCopyWindowInfo`, Electron's `screen.getAllDisplays()`, and
//! the screenshot tools in `apps/owls-client/src/main/screen-capture.ts`.
//!
//! Posting events to other applications requires the calling process to be
//! granted **Accessibility** permission in System Settings -> Privacy &
//! Security -> Accessibility. `check_accessibility()` reports the current
//! status. Events posted without it will be silently dropped by the system.

mod api;
mod ax;
mod event_helpers;
mod keymap;
mod platform;
mod types;

pub use api::{
    activate_app, background_click, background_drag, background_press_key, background_type,
    capture_display_png, capture_window_png, ensure_app_window_key, get_frontmost_app_pid,
    is_app_active, mouse_click, mouse_drag, mouse_move, press_key, type_text,
};
pub use ax::{ax_press_node, check_accessibility, get_focused_window_accessibility_tree};
pub use types::*;
