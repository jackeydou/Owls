use crate::conversions::{level_from_native, level_to_native, to_native_point, to_native_rect};
use crate::ffi::{
    owlto_cursor_overlay_dispose, owlto_cursor_overlay_flash_click, owlto_cursor_overlay_get_state,
    owlto_cursor_overlay_hide, owlto_cursor_overlay_jump_cursor,
    owlto_cursor_overlay_set_attached_window_id, owlto_cursor_overlay_set_bounds,
    owlto_cursor_overlay_set_cursor_pressed, owlto_cursor_overlay_set_cursor_visible,
    owlto_cursor_overlay_set_debug_backdrop, owlto_cursor_overlay_set_level,
    owlto_cursor_overlay_show,
};
use crate::types::{OverlayBounds, OverlayLevel, OverlayPoint, OverlayState};
use napi::bindgen_prelude::*;
use napi_derive::napi;
use std::ffi::CString;

fn ensure(success: bool, action: &str) -> Result<()> {
    if success {
        Ok(())
    } else {
        Err(Error::new(
            Status::GenericFailure,
            format!("Native cursor overlay operation failed: {action}."),
        ))
    }
}

#[napi]
pub fn show_overlay(bounds: OverlayBounds, level: OverlayLevel) -> Result<()> {
    let bounds = to_native_rect(bounds)?;
    ensure(
        unsafe { owlto_cursor_overlay_show(bounds, level_to_native(&level)) },
        "showOverlay",
    )
}

#[napi]
pub fn hide_overlay() -> Result<()> {
    ensure(unsafe { owlto_cursor_overlay_hide() }, "hideOverlay")
}

#[napi]
pub fn set_overlay_bounds(bounds: OverlayBounds) -> Result<()> {
    let bounds = to_native_rect(bounds)?;
    ensure(
        unsafe { owlto_cursor_overlay_set_bounds(bounds) },
        "setOverlayBounds",
    )
}

#[napi]
pub fn set_overlay_level(level: OverlayLevel) -> Result<()> {
    ensure(
        unsafe { owlto_cursor_overlay_set_level(level_to_native(&level)) },
        "setOverlayLevel",
    )
}

#[napi]
pub fn set_attached_window_id(window_id: Option<u32>) -> Result<()> {
    ensure(
        unsafe { owlto_cursor_overlay_set_attached_window_id(window_id.unwrap_or(0)) },
        "setAttachedWindowId",
    )
}

#[napi]
pub fn jump_cursor(point: OverlayPoint) -> Result<()> {
    let point = to_native_point(point)?;
    ensure(
        unsafe { owlto_cursor_overlay_jump_cursor(point) },
        "jumpCursor",
    )
}

#[napi]
pub fn flash_click(point: OverlayPoint) -> Result<()> {
    let point = to_native_point(point)?;
    ensure(
        unsafe { owlto_cursor_overlay_flash_click(point) },
        "flashClick",
    )
}

#[napi]
pub fn set_cursor_visible(visible: bool) -> Result<()> {
    ensure(
        unsafe { owlto_cursor_overlay_set_cursor_visible(visible) },
        "setCursorVisible",
    )
}

#[napi]
pub fn set_cursor_pressed(pressed: bool) -> Result<()> {
    ensure(
        unsafe { owlto_cursor_overlay_set_cursor_pressed(pressed) },
        "setCursorPressed",
    )
}

#[napi]
pub fn set_debug_backdrop(visible: bool, label: Option<String>) -> Result<()> {
    let c_label = match label {
        Some(value) => Some(CString::new(value).map_err(|_| {
            Error::new(
                Status::InvalidArg,
                "Debug backdrop label must not contain NUL bytes.",
            )
        })?),
        None => None,
    };
    ensure(
        unsafe {
            owlto_cursor_overlay_set_debug_backdrop(
                visible,
                c_label
                    .as_ref()
                    .map(|value| value.as_ptr())
                    .unwrap_or(std::ptr::null()),
            )
        },
        "setDebugBackdrop",
    )
}

#[napi]
pub fn get_overlay_state() -> OverlayState {
    let state = unsafe { owlto_cursor_overlay_get_state() };
    OverlayState {
        has_window: state.has_window,
        window_visible: state.window_visible,
        cursor_visible: state.cursor_visible,
        debug_backdrop_visible: state.debug_backdrop_visible,
        level: level_from_native(state.level),
        bounds: OverlayBounds {
            x: state.bounds.x,
            y: state.bounds.y,
            width: state.bounds.width,
            height: state.bounds.height,
        },
        cursor_position: OverlayPoint {
            x: state.cursor_position.x,
            y: state.cursor_position.y,
        },
    }
}

#[napi]
pub fn dispose_overlay() -> Result<()> {
    ensure(unsafe { owlto_cursor_overlay_dispose() }, "disposeOverlay")
}
