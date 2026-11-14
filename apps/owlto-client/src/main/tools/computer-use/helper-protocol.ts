export type ComputerUseHelperMouseButton = 'Left' | 'Right' | 'Middle'

export type ComputerUseHelperDeliveryBypassModifier = 'Command' | 'Option'

export type ComputerUseHelperModifierFlags = {
  shift?: boolean
  control?: boolean
  option?: boolean
  command?: boolean
  function?: boolean
}

export type ComputerUseHelperAccessibilityTreeOptions = {
  pid: number
  scope?: string
  mode?: string
  maxDepth?: number
  maxNodes?: number
}

export type ComputerUseHelperAxPressNodeOptions = ComputerUseHelperAccessibilityTreeOptions & {
  nodeId: number
  action?: string
}

export type ComputerUseHelperRequest =
  | {
      id: string
      method: 'ping'
    }
  | {
      id: string
      method: 'accessibilityStatus'
    }
  | {
      id: string
      method: 'activateApp'
      params: { pid: number }
    }
  | {
      id: string
      method: 'isAppActive'
      params: { pid: number }
    }
  | {
      id: string
      method: 'getFrontmostAppPid'
    }
  | {
      id: string
      method: 'mouseMove'
      params: { x: number; y: number }
    }
  | {
      id: string
      method: 'mouseClick'
      params: {
        x: number
        y: number
        button?: ComputerUseHelperMouseButton
        count?: number
        modifiers?: ComputerUseHelperModifierFlags
        holdMs?: number
      }
    }
  | {
      id: string
      method: 'mouseDrag'
      params: {
        fromX: number
        fromY: number
        toX: number
        toY: number
        button?: ComputerUseHelperMouseButton
        steps?: number
        durationMs?: number
      }
    }
  | {
      id: string
      method: 'typeText'
      params: { text: string; perCharDelayMs?: number }
    }
  | {
      id: string
      method: 'pressKey'
      params: { key: string; modifiers?: ComputerUseHelperModifierFlags }
    }
  | {
      id: string
      method: 'backgroundClick'
      params: {
        pid: number
        windowId: number
        windowOriginX: number
        windowOriginY: number
        x: number
        y: number
        button?: ComputerUseHelperMouseButton
        count?: number
        modifiers?: ComputerUseHelperModifierFlags
        useCommandDeliveryBypass?: boolean
        deliveryBypassModifier?: ComputerUseHelperDeliveryBypassModifier
        targetIsActive?: boolean
        holdMs?: number
      }
    }
  | {
      id: string
      method: 'backgroundDrag'
      params: {
        pid: number
        windowId: number
        windowOriginX: number
        windowOriginY: number
        fromX: number
        fromY: number
        toX: number
        toY: number
        button?: ComputerUseHelperMouseButton
        steps?: number
        durationMs?: number
        modifiers?: ComputerUseHelperModifierFlags
        targetIsActive?: boolean
      }
    }
  | {
      id: string
      method: 'backgroundType'
      params: { pid: number; windowId?: number; text: string; perCharDelayMs?: number }
    }
  | {
      id: string
      method: 'backgroundPressKey'
      params: {
        pid: number
        windowId?: number
        key: string
        modifiers?: ComputerUseHelperModifierFlags
      }
    }
  | {
      id: string
      method: 'getFocusedWindowAccessibilityTree'
      params: ComputerUseHelperAccessibilityTreeOptions
    }
  | {
      id: string
      method: 'axPressNode'
      params: ComputerUseHelperAxPressNodeOptions
    }
  | {
      id: string
      method: 'captureWindowPng'
      params: { windowId: number }
    }
  | {
      id: string
      method: 'captureDesktopPng'
      params: { displayId?: number }
    }

export type ComputerUseHelperResponse =
  | {
      id: string
      ok: true
      result: ComputerUseHelperResult
    }
  | {
      id: string
      ok: false
      error: {
        message: string
        name?: string
        stack?: string
      }
    }

export type ComputerUseHelperResult =
  | {
      type: 'pong'
      processId: number
    }
  | {
      type: 'accessibilityStatus'
      trusted: boolean
    }
  | {
      type: 'ok'
    }
  | {
      type: 'boolean'
      value: boolean
    }
  | {
      type: 'frontmostAppPid'
      pid: number | null
    }
  | {
      type: 'backgroundType'
      windowFocused: boolean
      charactersPosted: number
    }
  | {
      type: 'backgroundPressKey'
      windowFocused: boolean
    }
  | {
      type: 'focusedWindowAccessibilityTree'
      value: {
        pid: number
        windowTitle?: string
        mode: string
        focusedElementId?: number
        nodeCount: number
        truncated: boolean
        text: string
        nodes: Array<Record<string, unknown>>
      }
    }
  | {
      type: 'axPressNode'
      value: {
        pid: number
        nodeId: number
        action: string
        role: string
        title?: string
        identifier?: string
        description?: string
      }
    }
  | {
      type: 'capturedPng'
      path: string
    }
