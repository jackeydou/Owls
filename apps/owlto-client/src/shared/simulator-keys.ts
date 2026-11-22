/**
 * USB HID keyboard usages (page 0x07), the codes the simulator's keyboard takes. The panel maps
 * `KeyboardEvent.code` through them; the worker's `simulator_type` maps US-keyboard text.
 */

export const HID_SHIFT = 225
export const HID_COMMAND = 227
export const HID_RETURN = 40
export const HID_V = 25

const letters = Object.fromEntries(
  Array.from({ length: 26 }, (_, i) => [`Key${String.fromCharCode(65 + i)}`, 4 + i])
)
const digits = Object.fromEntries(
  Array.from({ length: 10 }, (_, i) => [`Digit${(i + 1) % 10}`, 30 + i])
)

/** `KeyboardEvent.code` → usage, for the keys a phone keyboard has, plus arrows and modifiers. */
const CODES: Record<string, number> = {
  ...letters,
  ...digits,
  Enter: 40,
  NumpadEnter: 40,
  Escape: 41,
  Backspace: 42,
  Tab: 43,
  Space: 44,
  Minus: 45,
  Equal: 46,
  BracketLeft: 47,
  BracketRight: 48,
  Backslash: 49,
  Semicolon: 51,
  Quote: 52,
  Backquote: 53,
  Comma: 54,
  Period: 55,
  Slash: 56,
  CapsLock: 57,
  Delete: 76,
  ArrowRight: 79,
  ArrowLeft: 80,
  ArrowDown: 81,
  ArrowUp: 82,
  ControlLeft: 224,
  ShiftLeft: 225,
  AltLeft: 226,
  MetaLeft: 227,
  ControlRight: 228,
  ShiftRight: 229,
  AltRight: 230,
  MetaRight: 231
}

export function hidUsageForCode(code: string): number | null {
  return CODES[code] ?? null
}

const SHIFTED: Record<string, string> = {
  '!': '1',
  '@': '2',
  '#': '3',
  $: '4',
  '%': '5',
  '^': '6',
  '&': '7',
  '*': '8',
  '(': '9',
  ')': '0',
  _: '-',
  '+': '=',
  '{': '[',
  '}': ']',
  '|': '\\',
  ':': ';',
  '"': "'",
  '~': '`',
  '<': ',',
  '>': '.',
  '?': '/'
}
const PLAIN: Record<string, number> = {
  ' ': 44,
  '\n': 40,
  '\t': 43,
  '-': 45,
  '=': 46,
  '[': 47,
  ']': 48,
  '\\': 49,
  ';': 51,
  "'": 52,
  '`': 53,
  ',': 54,
  '.': 55,
  '/': 56
}

export type Keystroke = { usage: number; shift: boolean }

function plainUsage(char: string): number | null {
  if (char >= 'a' && char <= 'z') return 4 + char.charCodeAt(0) - 97
  if (char >= '1' && char <= '9') return 30 + char.charCodeAt(0) - 49
  if (char === '0') return 39
  return PLAIN[char] ?? null
}

/** The keystrokes that type `text` on a US keyboard, or null when a character has none. */
export function keystrokesFor(text: string): Keystroke[] | null {
  const strokes: Keystroke[] = []
  for (const char of text) {
    const plain = plainUsage(char)
    if (plain !== null) {
      strokes.push({ usage: plain, shift: false })
      continue
    }
    const lower = char >= 'A' && char <= 'Z' ? char.toLowerCase() : SHIFTED[char]
    const usage = lower ? plainUsage(lower) : null
    if (usage === null) return null
    strokes.push({ usage, shift: true })
  }
  return strokes
}
