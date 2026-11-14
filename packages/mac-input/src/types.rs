use crate::platform::{
    CGEventFlags, CGEventType, CGMouseButton, KCG_EVENT_FLAG_MASK_ALTERNATE,
    KCG_EVENT_FLAG_MASK_COMMAND, KCG_EVENT_FLAG_MASK_CONTROL, KCG_EVENT_FLAG_MASK_FN,
    KCG_EVENT_FLAG_MASK_SHIFT, KCG_EVENT_LEFT_MOUSE_DOWN, KCG_EVENT_LEFT_MOUSE_DRAGGED,
    KCG_EVENT_LEFT_MOUSE_UP, KCG_EVENT_OTHER_MOUSE_DOWN, KCG_EVENT_OTHER_MOUSE_DRAGGED,
    KCG_EVENT_OTHER_MOUSE_UP, KCG_EVENT_RIGHT_MOUSE_DOWN, KCG_EVENT_RIGHT_MOUSE_DRAGGED,
    KCG_EVENT_RIGHT_MOUSE_UP, KCG_MOUSE_BUTTON_CENTER, KCG_MOUSE_BUTTON_LEFT,
    KCG_MOUSE_BUTTON_RIGHT,
};
use napi_derive::napi;

// ---------- Public TS-facing types ----------

#[napi(object)]
pub struct AccessibilityStatus {
    /// True when the process appears in Accessibility with the toggle on.
    pub trusted: bool,
}

#[napi(object)]
pub struct FocusedWindowAccessibilityTreeOptions {
    /// Target application pid.
    pub pid: i32,
    /// Traversal scope. Defaults to `focusedWindow`; `app` starts at the app AX root.
    pub scope: Option<String>,
    /// Output mode. Defaults to `interactive`; `raw` emits every traversed AX element.
    pub mode: Option<String>,
    /// Maximum traversal depth starting from the focused window root.
    pub max_depth: Option<u32>,
    /// Maximum number of nodes to collect before truncating.
    pub max_nodes: Option<u32>,
}

#[napi(object)]
pub struct AccessibilityTreeNode {
    pub id: u32,
    pub parent_id: Option<u32>,
    pub depth: u32,
    pub role: String,
    pub role_description: Option<String>,
    pub subrole: Option<String>,
    pub title: Option<String>,
    pub description: Option<String>,
    pub identifier: Option<String>,
    pub value: Option<String>,
    pub value_type: Option<String>,
    pub url: Option<String>,
    pub help: Option<String>,
    pub enabled: Option<bool>,
    pub selected: Option<bool>,
    pub expanded: Option<bool>,
    pub settable: Option<bool>,
    pub position: Option<Point>,
    pub size: Option<AccessibilitySize>,
    pub frame: Option<AccessibilityFrame>,
    pub available_attributes: Vec<String>,
    pub available_actions: Vec<String>,
    pub focused: bool,
}

#[napi(object)]
pub struct FocusedWindowAccessibilityTree {
    pub pid: i32,
    pub window_title: Option<String>,
    pub mode: String,
    pub focused_element_id: Option<u32>,
    pub node_count: u32,
    pub truncated: bool,
    pub text: String,
    pub nodes: Vec<AccessibilityTreeNode>,
}

#[napi(object)]
pub struct AxPressNodeOptions {
    /// Target application pid.
    pub pid: i32,
    /// Node id from the focused-window accessibility tree traversal.
    pub node_id: u32,
    /// Accessibility action name. Defaults to `AXPress`.
    pub action: Option<String>,
    /// Traversal scope used to resolve `node_id`. Defaults to `focusedWindow`.
    pub scope: Option<String>,
    /// Tree mode used to resolve `node_id`. Defaults to `interactive`.
    pub mode: Option<String>,
    /// Maximum traversal depth used to resolve `node_id`.
    pub max_depth: Option<u32>,
    /// Maximum emitted nodes used to resolve `node_id`.
    pub max_nodes: Option<u32>,
}

#[napi(object)]
pub struct AxPressNodeResult {
    pub pid: i32,
    pub node_id: u32,
    pub action: String,
    pub role: String,
    pub title: Option<String>,
    pub identifier: Option<String>,
    pub description: Option<String>,
}

#[napi(object)]
pub struct Point {
    /// Global point coordinate in the CoreGraphics global space (top-left origin, Y grows down).
    pub x: f64,
    pub y: f64,
}

#[napi(object)]
pub struct AccessibilitySize {
    pub width: f64,
    pub height: f64,
}

#[derive(Clone)]
#[napi(object)]
pub struct AccessibilityFrame {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

#[napi(string_enum)]
pub enum MouseButton {
    Left,
    Right,
    Middle,
}

impl MouseButton {
    pub(crate) fn as_cg(&self) -> CGMouseButton {
        match self {
            MouseButton::Left => KCG_MOUSE_BUTTON_LEFT,
            MouseButton::Right => KCG_MOUSE_BUTTON_RIGHT,
            MouseButton::Middle => KCG_MOUSE_BUTTON_CENTER,
        }
    }
    pub(crate) fn down_event(&self) -> CGEventType {
        match self {
            MouseButton::Left => KCG_EVENT_LEFT_MOUSE_DOWN,
            MouseButton::Right => KCG_EVENT_RIGHT_MOUSE_DOWN,
            MouseButton::Middle => KCG_EVENT_OTHER_MOUSE_DOWN,
        }
    }
    pub(crate) fn up_event(&self) -> CGEventType {
        match self {
            MouseButton::Left => KCG_EVENT_LEFT_MOUSE_UP,
            MouseButton::Right => KCG_EVENT_RIGHT_MOUSE_UP,
            MouseButton::Middle => KCG_EVENT_OTHER_MOUSE_UP,
        }
    }
    pub(crate) fn drag_event(&self) -> CGEventType {
        match self {
            MouseButton::Left => KCG_EVENT_LEFT_MOUSE_DRAGGED,
            MouseButton::Right => KCG_EVENT_RIGHT_MOUSE_DRAGGED,
            MouseButton::Middle => KCG_EVENT_OTHER_MOUSE_DRAGGED,
        }
    }
}

#[napi(object)]
pub struct ModifierFlags {
    pub shift: Option<bool>,
    pub control: Option<bool>,
    /// macOS Option / Alt key.
    pub option: Option<bool>,
    pub command: Option<bool>,
    /// macOS function (Fn) key.
    pub function: Option<bool>,
}

impl ModifierFlags {
    pub(crate) fn as_cg(&self) -> CGEventFlags {
        let mut bits: CGEventFlags = 0;
        if self.shift.unwrap_or(false) {
            bits |= KCG_EVENT_FLAG_MASK_SHIFT;
        }
        if self.control.unwrap_or(false) {
            bits |= KCG_EVENT_FLAG_MASK_CONTROL;
        }
        if self.option.unwrap_or(false) {
            bits |= KCG_EVENT_FLAG_MASK_ALTERNATE;
        }
        if self.command.unwrap_or(false) {
            bits |= KCG_EVENT_FLAG_MASK_COMMAND;
        }
        if self.function.unwrap_or(false) {
            bits |= KCG_EVENT_FLAG_MASK_FN;
        }
        bits
    }
    pub(crate) fn empty(&self) -> bool {
        self.as_cg() == 0
    }
}

#[napi(string_enum)]
pub enum DeliveryBypassModifier {
    Command,
    Option,
}

impl DeliveryBypassModifier {
    pub(crate) fn as_cg(&self) -> CGEventFlags {
        match self {
            DeliveryBypassModifier::Command => KCG_EVENT_FLAG_MASK_COMMAND,
            DeliveryBypassModifier::Option => KCG_EVENT_FLAG_MASK_ALTERNATE,
        }
    }
}

pub(crate) fn flags_from(mods: &Option<ModifierFlags>) -> CGEventFlags {
    mods.as_ref().map(|m| m.as_cg()).unwrap_or(0)
}

#[napi(object)]
pub struct MouseMoveOptions {
    pub x: f64,
    pub y: f64,
}

#[napi(object)]
pub struct MouseClickOptions {
    pub x: f64,
    pub y: f64,
    /// Defaults to "left".
    pub button: Option<MouseButton>,
    /// 1 = single click, 2 = double, 3 = triple. Defaults to 1.
    pub count: Option<u32>,
    /// Optional modifier flags held during the click.
    pub modifiers: Option<ModifierFlags>,
    /// Milliseconds to hold the button between down and up. Defaults to 0
    /// (immediate). Useful for "long press" or when the target needs time to
    /// register a press.
    pub hold_ms: Option<u32>,
}

#[napi(object)]
pub struct MouseDragOptions {
    pub from_x: f64,
    pub from_y: f64,
    pub to_x: f64,
    pub to_y: f64,
    /// Defaults to "left".
    pub button: Option<MouseButton>,
    /// Number of intermediate mouse-dragged events. More = smoother. Defaults to 20.
    pub steps: Option<u32>,
    /// Total drag duration in milliseconds. Defaults to 250.
    pub duration_ms: Option<u32>,
}

#[napi(object)]
pub struct TypeTextOptions {
    pub text: String,
    /// Per-character delay in milliseconds. Defaults to 0 (paste-like instant
    /// typing). Some apps drop characters on rapid input — a small delay
    /// (e.g. 5–15ms) helps.
    pub per_char_delay_ms: Option<u32>,
}

#[napi(object)]
pub struct BackgroundClickOptions {
    /// Target process pid (e.g. `MacWindow.ownerPid` from @owlto/mac-window-list).
    pub pid: i32,
    /// CoreGraphics window id of the target window (`MacWindow.windowId`).
    pub window_id: u32,
    /// Window outer bounds origin in CG global points. Used to compute the
    /// window-local point that the private `CGEventSetWindowLocation` setter expects.
    pub window_origin_x: f64,
    pub window_origin_y: f64,
    /// Click position in CG global points (top-left origin of the primary display).
    pub x: f64,
    pub y: f64,
    pub button: Option<MouseButton>,
    /// 1 = single, 2 = double, 3 = triple. Defaults to 1.
    pub count: Option<u32>,
    /// Optional modifier keys. NOTE: when `target_is_active` is false (or unset),
    /// the implementation can OR in a synthetic modifier regardless — this is
    /// the WindowServer "deliver to backgrounded app" filter bypass. The target
    /// app will see that modifier in `modifierFlags`. This is a known trade-off.
    pub modifiers: Option<ModifierFlags>,
    /// Legacy escape hatch for synthetic modifier delivery bypass. Defaults to
    /// false so production clicks are plain mouse events.
    pub use_command_delivery_bypass: Option<bool>,
    /// Which synthetic modifier to OR into background-delivery events if the
    /// legacy bypass is explicitly enabled.
    pub delivery_bypass_modifier: Option<DeliveryBypassModifier>,
    /// True if the target app is currently the foreground app. When false (the
    /// default), the delivery bypass is applied so the WindowServer
    /// actually delivers the event. When true, no bypass is needed and the
    /// click registers without spurious modifiers.
    pub target_is_active: Option<bool>,
    /// Milliseconds to hold between mouse down and up. Defaults to 0.
    pub hold_ms: Option<u32>,
}

#[napi(object)]
pub struct PressKeyOptions {
    /// Either a named key (see README / KEY_NAMES) like "return", "escape",
    /// "tab", "space", "left", "right", "up", "down", "f1".."f12", "home",
    /// "end", "pageup", "pagedown", "delete", "backspace", "a".."z", "0".."9",
    /// or a raw macOS virtual keycode passed as a stringified number ("36" =
    /// kVK_Return). Letters / digits use kVK_ANSI_* and assume an ANSI/QWERTY
    /// layout — for arbitrary text use `type_text` instead.
    pub key: String,
    pub modifiers: Option<ModifierFlags>,
}

#[napi(object)]
pub struct BackgroundDragOptions {
    pub pid: i32,
    pub window_id: u32,
    pub window_origin_x: f64,
    pub window_origin_y: f64,
    pub from_x: f64,
    pub from_y: f64,
    pub to_x: f64,
    pub to_y: f64,
    pub button: Option<MouseButton>,
    /// Number of intermediate `mouseDragged` events. Defaults to 20.
    pub steps: Option<u32>,
    /// Total drag duration in ms. Defaults to 250.
    pub duration_ms: Option<u32>,
    pub modifiers: Option<ModifierFlags>,
    /// True if the target app is currently the foreground app. Used for
    /// diagnostics; drag no longer adds a synthetic Command bypass.
    pub target_is_active: Option<bool>,
}

#[napi(object)]
pub struct FrontmostApp {
    /// Pid of the current frontmost (foreground) app, or null if it could not
    /// be determined (e.g. workspace not yet initialized).
    pub pid: Option<i32>,
}

#[napi(object)]
pub struct BackgroundTypeOptions {
    /// Target process pid (e.g. `MacWindow.ownerPid`).
    pub pid: i32,
    /// Target CGWindowID. STRONGLY recommended. When provided the
    /// implementation calls `ensure_window_key(pid, windowId)` via the AX API
    /// before posting any keystrokes — this makes the matching window the key
    /// window of the target app *without* activating the app, so the
    /// keystrokes land in the focused first responder of the intended window
    /// instead of getting silently dropped or routed to whatever window in the
    /// target app happened to be key last.
    pub window_id: Option<u32>,
    pub text: String,
    pub per_char_delay_ms: Option<u32>,
}

#[napi(object)]
pub struct BackgroundTypeResult {
    /// True when the AX `AXRaise` action successfully focused `window_id`
    /// inside the target app. False if no `window_id` was provided, the
    /// window could not be matched, or the AX call failed (in which case
    /// the keystrokes are still posted — they just may not land where you
    /// expect).
    pub window_focused: bool,
    pub characters_posted: u32,
}

#[napi(object)]
pub struct BackgroundPressKeyOptions {
    pub pid: i32,
    /// Target CGWindowID. STRONGLY recommended — see `BackgroundTypeOptions.window_id`.
    pub window_id: Option<u32>,
    pub key: String,
    pub modifiers: Option<ModifierFlags>,
}

#[napi(object)]
pub struct BackgroundPressKeyResult {
    pub window_focused: bool,
}

#[napi(object)]
pub struct CaptureWindowPngOptions {
    /// CoreGraphics window id to capture.
    pub window_id: u32,
    /// Absolute output path for the PNG file.
    pub path: String,
}

#[napi(object)]
pub struct CaptureDisplayPngOptions {
    /// CoreGraphics display id. Defaults to the main display when omitted.
    pub display_id: Option<u32>,
    /// Absolute output path for the PNG file.
    pub path: String,
}
