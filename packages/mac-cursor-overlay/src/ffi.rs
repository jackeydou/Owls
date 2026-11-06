use std::os::raw::c_char;

#[repr(C)]
#[derive(Clone, Copy, Debug)]
pub(crate) struct NativePoint {
    pub(crate) x: f64,
    pub(crate) y: f64,
}

#[repr(C)]
#[derive(Clone, Copy, Debug)]
pub(crate) struct NativeRect {
    pub(crate) x: f64,
    pub(crate) y: f64,
    pub(crate) width: f64,
    pub(crate) height: f64,
}

#[repr(C)]
#[derive(Clone, Copy, Debug)]
pub(crate) struct NativeOverlayState {
    pub(crate) has_window: bool,
    pub(crate) window_visible: bool,
    pub(crate) cursor_visible: bool,
    pub(crate) debug_backdrop_visible: bool,
    pub(crate) level: i32,
    pub(crate) bounds: NativeRect,
    pub(crate) cursor_position: NativePoint,
}

unsafe extern "C" {
    pub(crate) fn owls_cursor_overlay_show(bounds: NativeRect, level: i32) -> bool;
    pub(crate) fn owls_cursor_overlay_hide() -> bool;
    pub(crate) fn owls_cursor_overlay_set_bounds(bounds: NativeRect) -> bool;
    pub(crate) fn owls_cursor_overlay_set_level(level: i32) -> bool;
    pub(crate) fn owls_cursor_overlay_set_attached_window_id(window_id: u32) -> bool;
    pub(crate) fn owls_cursor_overlay_jump_cursor(point: NativePoint) -> bool;
    pub(crate) fn owls_cursor_overlay_flash_click(point: NativePoint) -> bool;
    pub(crate) fn owls_cursor_overlay_set_cursor_visible(visible: bool) -> bool;
    pub(crate) fn owls_cursor_overlay_set_cursor_pressed(pressed: bool) -> bool;
    pub(crate) fn owls_cursor_overlay_set_debug_backdrop(
        visible: bool,
        label: *const c_char,
    ) -> bool;
    pub(crate) fn owls_cursor_overlay_get_state() -> NativeOverlayState;
    pub(crate) fn owls_cursor_overlay_dispose() -> bool;
}
