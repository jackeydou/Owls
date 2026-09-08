use crate::ax::ensure_window_key;
use crate::event_helpers::{create_appkit_mouse_event, post_mouse_event, sleep_ms};
use crate::keymap::key_to_keycode;
use crate::platform::*;
use crate::types::*;
use napi::bindgen_prelude::*;
use napi_derive::napi;
use std::ptr::null;

fn write_cg_image_to_png(image: CGImageRef, output_path: &str) -> Result<()> {
    if image.is_null() {
        return Err(Error::new(
            Status::GenericFailure,
            "macOS returned no screenshot image. Grant Screen Recording access to Owls Computer Use in System Settings.",
        ));
    }
    let _image = OwnedCf(image as *const _);
    let path = cfstring(output_path).ok_or_else(|| {
        Error::new(
            Status::InvalidArg,
            "Could not create a CoreFoundation string for the output path.",
        )
    })?;
    let url = unsafe {
        CFURLCreateWithFileSystemPath(null(), path.0 as CFStringRef, KCF_URL_POSIX_PATH_STYLE, 0)
    };
    if url.is_null() {
        return Err(Error::new(
            Status::InvalidArg,
            "Could not create a file URL for the output path.",
        ));
    }
    let _url = OwnedCf(url as *const _);
    let png_type = cfstring("public.png").ok_or_else(|| {
        Error::new(
            Status::GenericFailure,
            "Could not create the PNG UTI string.",
        )
    })?;
    let destination =
        unsafe { CGImageDestinationCreateWithURL(url, png_type.0 as CFStringRef, 1, null()) };
    if destination.is_null() {
        return Err(Error::new(
            Status::GenericFailure,
            "Could not create a PNG image destination.",
        ));
    }
    let _destination = OwnedCf(destination as *const _);
    unsafe {
        CGImageDestinationAddImage(destination, image, null());
        if !CGImageDestinationFinalize(destination) {
            return Err(Error::new(
                Status::GenericFailure,
                "Could not write the screenshot PNG file.",
            ));
        }
    }
    Ok(())
}

#[napi]
pub fn capture_window_png(options: CaptureWindowPngOptions) -> Result<()> {
    let image = unsafe {
        CGWindowListCreateImage(
            CGRectNull,
            KCG_WINDOW_LIST_OPTION_INCLUDING_WINDOW,
            options.window_id,
            KCG_WINDOW_IMAGE_BOUNDS_IGNORE_FRAMING | KCG_WINDOW_IMAGE_BEST_RESOLUTION,
        )
    };
    write_cg_image_to_png(image, &options.path)
}

#[napi]
pub fn capture_display_png(options: CaptureDisplayPngOptions) -> Result<()> {
    let display_id = options
        .display_id
        .unwrap_or_else(|| unsafe { CGMainDisplayID() });
    let image = unsafe { CGDisplayCreateImage(display_id) };
    write_cg_image_to_png(image, &options.path)
}

/// Move the cursor to the given global point. Posts a `mouseMoved` event so
/// hover-aware UI updates correctly.
#[napi]
pub fn mouse_move(options: MouseMoveOptions) -> Result<()> {
    let source = new_source()?;
    let pos = CGPoint {
        x: options.x,
        y: options.y,
    };
    post_mouse_event(
        &source,
        KCG_EVENT_MOUSE_MOVED,
        pos,
        KCG_MOUSE_BUTTON_LEFT,
        None,
        0,
    )?;
    Ok(())
}

/// Click at the given global point. Always issues a move event first so apps
/// see the cursor enter the target before the click. `count` controls
/// single/double/triple click semantics via the `kCGMouseEventClickState`
/// field — required for double-click to actually register as a double-click.
#[napi]
pub fn mouse_click(options: MouseClickOptions) -> Result<()> {
    let button = options.button.unwrap_or(MouseButton::Left);
    let count = options.count.unwrap_or(1).max(1).min(3) as i64;
    let hold_ms = options.hold_ms.unwrap_or(0);
    let flags = flags_from(&options.modifiers);
    let pos = CGPoint {
        x: options.x,
        y: options.y,
    };

    let source = new_source()?;

    // Move first so hover-state updates and the target is the right element.
    post_mouse_event(
        &source,
        KCG_EVENT_MOUSE_MOVED,
        pos,
        KCG_MOUSE_BUTTON_LEFT,
        None,
        0,
    )?;

    for i in 1..=count {
        post_mouse_event(
            &source,
            button.down_event(),
            pos,
            button.as_cg(),
            Some(i),
            flags,
        )?;
        sleep_ms(hold_ms);
        post_mouse_event(
            &source,
            button.up_event(),
            pos,
            button.as_cg(),
            Some(i),
            flags,
        )?;
    }
    Ok(())
}

/// Drag from one point to another with intermediate `mouseDragged` events.
/// Useful for selecting text, moving windows, sliders, file drag-and-drop.
#[napi]
pub fn mouse_drag(options: MouseDragOptions) -> Result<()> {
    let button = options.button.unwrap_or(MouseButton::Left);
    let steps = options.steps.unwrap_or(20).max(1);
    let duration_ms = options.duration_ms.unwrap_or(250);
    let step_delay = duration_ms / steps;

    let source = new_source()?;
    let from = CGPoint {
        x: options.from_x,
        y: options.from_y,
    };
    let to = CGPoint {
        x: options.to_x,
        y: options.to_y,
    };

    post_mouse_event(
        &source,
        KCG_EVENT_MOUSE_MOVED,
        from,
        KCG_MOUSE_BUTTON_LEFT,
        None,
        0,
    )?;
    post_mouse_event(
        &source,
        button.down_event(),
        from,
        button.as_cg(),
        Some(1),
        0,
    )?;

    for i in 1..=steps {
        let t = i as f64 / steps as f64;
        let p = CGPoint {
            x: from.x + (to.x - from.x) * t,
            y: from.y + (to.y - from.y) * t,
        };
        post_mouse_event(&source, button.drag_event(), p, button.as_cg(), Some(1), 0)?;
        sleep_ms(step_delay);
    }

    post_mouse_event(&source, button.up_event(), to, button.as_cg(), Some(1), 0)?;
    Ok(())
}

/// Type arbitrary text. Uses `CGEventKeyboardSetUnicodeString` so it works
/// with any Unicode (CJK, emoji, accented chars) regardless of the active
/// keyboard layout. Does NOT honor IME — the literal characters are
/// inserted into the focused input.
#[napi]
pub fn type_text(options: TypeTextOptions) -> Result<()> {
    let source = new_source()?;
    let delay = options.per_char_delay_ms.unwrap_or(0);

    // UTF-16 chunked per scalar so each event delivers one user-visible
    // character (or surrogate pair for chars outside the BMP).
    for ch in options.text.chars() {
        let mut buf = [0u16; 2];
        let units = ch.encode_utf16(&mut buf);
        let len = units.len();

        let down = unsafe { CGEventCreateKeyboardEvent(source.0, 0, true) };
        if down.is_null() {
            return Err(Error::new(
                Status::GenericFailure,
                "CGEventCreateKeyboardEvent (down) returned null",
            ));
        }
        let down = OwnedEvent(down);
        unsafe { CGEventKeyboardSetUnicodeString(down.0, len, buf.as_ptr()) };
        unsafe { CGEventPost(KCG_HID_EVENT_TAP, down.0) };

        let up = unsafe { CGEventCreateKeyboardEvent(source.0, 0, false) };
        if up.is_null() {
            return Err(Error::new(
                Status::GenericFailure,
                "CGEventCreateKeyboardEvent (up) returned null",
            ));
        }
        let up = OwnedEvent(up);
        unsafe { CGEventKeyboardSetUnicodeString(up.0, len, buf.as_ptr()) };
        unsafe { CGEventPost(KCG_HID_EVENT_TAP, up.0) };

        sleep_ms(delay);
    }

    Ok(())
}

/// Press a single named key with optional modifiers. Useful for shortcuts
/// (Cmd+S, Ctrl+C), navigation (arrow keys), and special keys (Escape, F2).
/// For typing arbitrary text use `type_text` instead.
#[napi]
pub fn press_key(options: PressKeyOptions) -> Result<()> {
    let keycode = key_to_keycode(&options.key).ok_or_else(|| {
    Error::new(
      Status::InvalidArg,
      format!(
        "Unknown key name \"{}\". Pass a known name (e.g. \"return\", \"escape\", \"f5\", \"a\") or a numeric kVK_ keycode.",
        options.key
      ),
    )
  })?;

    let source = new_source()?;
    let flags = flags_from(&options.modifiers);
    let has_mods = options
        .modifiers
        .as_ref()
        .map(|m| !m.empty())
        .unwrap_or(false);

    let down = unsafe { CGEventCreateKeyboardEvent(source.0, keycode, true) };
    if down.is_null() {
        return Err(Error::new(
            Status::GenericFailure,
            "CGEventCreateKeyboardEvent (down) returned null",
        ));
    }
    let down = OwnedEvent(down);
    if has_mods {
        unsafe { CGEventSetFlags(down.0, flags) };
    }
    unsafe { CGEventPost(KCG_HID_EVENT_TAP, down.0) };

    let up = unsafe { CGEventCreateKeyboardEvent(source.0, keycode, false) };
    if up.is_null() {
        return Err(Error::new(
            Status::GenericFailure,
            "CGEventCreateKeyboardEvent (up) returned null",
        ));
    }
    let up = OwnedEvent(up);
    if has_mods {
        unsafe { CGEventSetFlags(up.0, flags) };
    }
    unsafe { CGEventPost(KCG_HID_EVENT_TAP, up.0) };

    Ok(())
}

/// Click into a specific window owned by `pid` **without activating its app**.
///
/// Uses the `CGEventPostToPid` + per-window-id field pattern documented in
/// the bgclick-rev skill. Concretely, for each down/up event we:
///
/// 1. Build an `NSEvent.mouseEvent(...)` at the screen-space point, then
///    extract its `CGEvent`.
/// 2. Set `kCGMouseEventButtonNumber (3)` and `kCGMouseEventClickState (1)`.
/// 3. Set `kCGMouseEventSubtype (7) = 3` — the non-public "synthesized window
///    targeted" subtype that some apps gate on.
/// 4. Set `kCGMouseEventWindowUnderMousePointer (91)` and field `92` to the
///    target `CGWindowID` so the WindowServer routes the event to that window.
/// 5. Call private `CGEventSetWindowLocation` (resolved via `dlsym`) with the
///    window-local point (`screenPoint - windowOrigin`).
/// 6. Keep modifier flags exactly as requested by the caller; production clicks
///    do not add Command/Option as a delivery bypass.
/// 7. Post via `CGEventPostToPid(pid, event)`.
///
/// The clicker app stays frontmost. The target window receives the click, and
/// its `NSWindow` becomes key (`NSWindowDidBecomeKeyNotification`), but
/// `NSApp.isActive` stays false on the target.
#[napi]
pub fn background_click(options: BackgroundClickOptions) -> Result<()> {
    let button = options.button.unwrap_or(MouseButton::Left);
    let count = options.count.unwrap_or(1).max(1).min(3) as i64;
    let hold_ms = options.hold_ms.unwrap_or(0);
    let user_flags = flags_from(&options.modifiers);
    let target_is_active = options.target_is_active.unwrap_or(false);
    let use_command_delivery_bypass = options.use_command_delivery_bypass.unwrap_or(false);
    let delivery_bypass_flag = options
        .delivery_bypass_modifier
        .unwrap_or(DeliveryBypassModifier::Command)
        .as_cg();

    // Production callers leave the legacy bypass disabled so target apps see a
    // plain click unless the user explicitly requested modifiers.
    let mut flags = user_flags;
    if !target_is_active && use_command_delivery_bypass {
        flags |= delivery_bypass_flag;
    }

    let screen = CGPoint {
        x: options.x,
        y: options.y,
    };
    let set_window_location = cached_set_window_location().ok_or_else(|| {
        Error::new(
            Status::GenericFailure,
            "Could not resolve private symbol CGEventSetWindowLocation via dlsym. \
       Background click requires this symbol to be present in CoreGraphics — \
       it has shipped on every macOS WindowServer for many years; if dlsym \
       fails the system is in an unusual state.",
        )
    })?;

    let win_id = options.window_id as i64;

    let post = |event_type: CGEventType, click_idx: i64| -> Result<()> {
        let event = create_appkit_mouse_event(
            event_type,
            screen,
            options.window_id,
            flags,
            next_event_number(),
            click_idx,
        )?;

        // Explicit field writes (the four "magic" fields from the skill).
        unsafe {
            CGEventSetIntegerValueField(
                event.0,
                KCG_MOUSE_EVENT_BUTTON_NUMBER,
                button.as_cg() as i64,
            );
            CGEventSetIntegerValueField(event.0, KCG_MOUSE_EVENT_CLICK_STATE, click_idx);
            CGEventSetIntegerValueField(event.0, KCG_MOUSE_EVENT_SUBTYPE, 3);
            CGEventSetIntegerValueField(
                event.0,
                KCG_MOUSE_EVENT_WINDOW_UNDER_MOUSE_POINTER,
                win_id,
            );
            CGEventSetIntegerValueField(
                event.0,
                KCG_MOUSE_EVENT_WINDOW_UNDER_MOUSE_POINTER_THAT_CAN_HANDLE_THIS_EVENT,
                win_id,
            );
            CGEventSetLocation(event.0, screen);
            let affirmed_screen = CGEventGetLocation(event.0);
            let local = CGPoint {
                x: affirmed_screen.x - options.window_origin_x,
                y: affirmed_screen.y - options.window_origin_y,
            };

            // Keep the event's global location and window-local location derived from
            // the same final point before calling the private setter.
            set_window_location(event.0, local);

            if flags != 0 {
                CGEventSetFlags(event.0, flags);
            }

            // Deliver to the target process directly; bypass the system tap chain.
            CGEventPostToPid(options.pid, event.0);
        }
        Ok(())
    };

    for i in 1..=count {
        post(button.down_event(), i)?;
        sleep_ms(hold_ms);
        post(button.up_event(), i)?;
    }
    Ok(())
}

/// Drag inside a specific window owned by `pid` **without activating its app**.
///
/// Same per-event window-id-tagging pattern as `background_click`, applied to
/// every event in the drag sequence: down → N drag → up. All events go to the
/// same target window via `CGEventPostToPid`.
#[napi]
pub fn background_drag(options: BackgroundDragOptions) -> Result<()> {
    let button = options.button.unwrap_or(MouseButton::Left);
    let user_flags = flags_from(&options.modifiers);
    let steps = options.steps.unwrap_or(20).max(1);
    let duration_ms = options.duration_ms.unwrap_or(250);
    let per_step_ms = duration_ms / steps;

    let flags = user_flags;

    let set_window_location = cached_set_window_location().ok_or_else(|| {
        Error::new(
            Status::GenericFailure,
            "Could not resolve private symbol CGEventSetWindowLocation via dlsym.",
        )
    })?;

    let win_id = options.window_id as i64;
    let win_ox = options.window_origin_x;
    let win_oy = options.window_origin_y;
    let pid = options.pid;
    let cg_button = button.as_cg();

    let post_at = |event_type: CGEventType, x: f64, y: f64| -> Result<()> {
        let screen = CGPoint { x, y };
        let event = create_appkit_mouse_event(
            event_type,
            screen,
            options.window_id,
            flags,
            next_event_number(),
            1,
        )?;
        unsafe {
            CGEventSetIntegerValueField(event.0, KCG_MOUSE_EVENT_BUTTON_NUMBER, cg_button as i64);
            CGEventSetIntegerValueField(event.0, KCG_MOUSE_EVENT_CLICK_STATE, 1);
            CGEventSetIntegerValueField(event.0, KCG_MOUSE_EVENT_SUBTYPE, 3);
            CGEventSetIntegerValueField(
                event.0,
                KCG_MOUSE_EVENT_WINDOW_UNDER_MOUSE_POINTER,
                win_id,
            );
            CGEventSetIntegerValueField(
                event.0,
                KCG_MOUSE_EVENT_WINDOW_UNDER_MOUSE_POINTER_THAT_CAN_HANDLE_THIS_EVENT,
                win_id,
            );
            CGEventSetLocation(event.0, screen);
            let affirmed_screen = CGEventGetLocation(event.0);
            let local = CGPoint {
                x: affirmed_screen.x - win_ox,
                y: affirmed_screen.y - win_oy,
            };
            set_window_location(event.0, local);
            if flags != 0 {
                CGEventSetFlags(event.0, flags);
            }
            CGEventPostToPid(pid, event.0);
        }
        Ok(())
    };

    // mouse-down at the start
    post_at(button.down_event(), options.from_x, options.from_y)?;

    // intermediate drag events
    let dx = options.to_x - options.from_x;
    let dy = options.to_y - options.from_y;
    let drag_evt = button.drag_event();
    for i in 1..=steps {
        let t = i as f64 / steps as f64;
        let x = options.from_x + dx * t;
        let y = options.from_y + dy * t;
        post_at(drag_evt, x, y)?;
        sleep_ms(per_step_ms);
    }

    // mouse-up at the end
    post_at(button.up_event(), options.to_x, options.to_y)?;

    Ok(())
}

/// Return the pid of the current foreground app via NSWorkspace.
#[napi]
pub fn get_frontmost_app_pid() -> FrontmostApp {
    FrontmostApp {
        pid: frontmost_pid(),
    }
}

/// True when the given pid is the foreground app.
#[napi]
pub fn is_app_active(pid: i32) -> bool {
    pid_is_active(pid)
}

/// Activate a running app by pid. Used as a last-resort frontmost restoration
/// guard if a target app activates itself after receiving background input.
#[napi]
pub fn activate_app(pid: i32) -> bool {
    if pid <= 0 {
        return false;
    }
    activate_pid(pid)
}

/// Type Unicode text into a specific app's focused field WITHOUT activating
/// the app. Two-step process:
///   1. If `window_id` is provided, call the AX `AXRaise` action on that
///      window so it becomes the key window inside its own app — this does
///      NOT activate the app at the system level, but it does ensure the
///      next keystroke lands in *that* window's focused first responder.
///   2. Build keyboard events with `CGEventKeyboardSetUnicodeString` and
///      post them via `CGEventPostToPid(pid, event)` — events go directly
///      to the target process's event queue, bypassing the system event
///      tap and the foreground app entirely.
#[napi]
pub fn background_type(options: BackgroundTypeOptions) -> Result<BackgroundTypeResult> {
    let pid = options.pid;
    let window_focused = match options.window_id {
        Some(wid) => ensure_window_key(pid, wid),
        None => false,
    };

    let source = new_source()?;
    let delay = options.per_char_delay_ms.unwrap_or(0);
    let mut characters_posted: u32 = 0;

    for ch in options.text.chars() {
        let mut buf = [0u16; 2];
        let units = ch.encode_utf16(&mut buf);
        let len = units.len();

        let down = unsafe { CGEventCreateKeyboardEvent(source.0, 0, true) };
        if down.is_null() {
            return Err(Error::new(
                Status::GenericFailure,
                "CGEventCreateKeyboardEvent (down) returned null",
            ));
        }
        let down = OwnedEvent(down);
        unsafe {
            CGEventKeyboardSetUnicodeString(down.0, len, buf.as_ptr());
            CGEventPostToPid(pid, down.0);
        }

        let up = unsafe { CGEventCreateKeyboardEvent(source.0, 0, false) };
        if up.is_null() {
            return Err(Error::new(
                Status::GenericFailure,
                "CGEventCreateKeyboardEvent (up) returned null",
            ));
        }
        let up = OwnedEvent(up);
        unsafe {
            CGEventKeyboardSetUnicodeString(up.0, len, buf.as_ptr());
            CGEventPostToPid(pid, up.0);
        }

        characters_posted = characters_posted.saturating_add(1);
        sleep_ms(delay);
    }

    Ok(BackgroundTypeResult {
        window_focused,
        characters_posted,
    })
}

/// Press a single named key (with optional modifiers) targeting a specific
/// process. Same two-step model as `background_type`:
///   1. If `window_id` is provided, AX-raise that window inside the target
///      app so the key event lands in the right key window.
///   2. Post the keyboard event via `CGEventPostToPid` — bypasses the system
///      event tap and the foreground app entirely.
#[napi]
pub fn background_press_key(
    options: BackgroundPressKeyOptions,
) -> Result<BackgroundPressKeyResult> {
    let keycode = key_to_keycode(&options.key).ok_or_else(|| {
    Error::new(
      Status::InvalidArg,
      format!(
        "Unknown key name \"{}\". Pass a known name (e.g. \"return\", \"escape\", \"f5\", \"a\") or a numeric kVK_ keycode.",
        options.key
      ),
    )
  })?;

    let pid = options.pid;
    let window_focused = match options.window_id {
        Some(wid) => ensure_window_key(pid, wid),
        None => false,
    };

    let source = new_source()?;
    let flags = flags_from(&options.modifiers);
    let has_mods = options
        .modifiers
        .as_ref()
        .map(|m| !m.empty())
        .unwrap_or(false);

    let down = unsafe { CGEventCreateKeyboardEvent(source.0, keycode, true) };
    if down.is_null() {
        return Err(Error::new(
            Status::GenericFailure,
            "CGEventCreateKeyboardEvent (down) returned null",
        ));
    }
    let down = OwnedEvent(down);
    if has_mods {
        unsafe { CGEventSetFlags(down.0, flags) };
    }
    unsafe { CGEventPostToPid(pid, down.0) };

    let up = unsafe { CGEventCreateKeyboardEvent(source.0, keycode, false) };
    if up.is_null() {
        return Err(Error::new(
            Status::GenericFailure,
            "CGEventCreateKeyboardEvent (up) returned null",
        ));
    }
    let up = OwnedEvent(up);
    if has_mods {
        unsafe { CGEventSetFlags(up.0, flags) };
    }
    unsafe { CGEventPostToPid(pid, up.0) };

    Ok(BackgroundPressKeyResult { window_focused })
}

/// Standalone helper: make `window_id` the key window of `pid`'s app via the
/// AX `AXRaise` action — without activating the app. Returns true on success.
/// Useful when an agent has already issued one keyboard call and wants to
/// re-focus a different window before the next one.
#[napi]
pub fn ensure_app_window_key(pid: i32, window_id: u32) -> bool {
    ensure_window_key(pid, window_id)
}
