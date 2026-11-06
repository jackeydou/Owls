import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import {
  activateApp,
  axPressNode,
  backgroundClick,
  backgroundDrag,
  backgroundPressKey,
  backgroundType,
  captureDisplayPng,
  captureWindowPng,
  checkAccessibility,
  getFocusedWindowAccessibilityTree,
  getFrontmostAppPid,
  isAppActive,
  mouseClick,
  mouseDrag,
  mouseMove,
  pressKey,
  typeText
} from '@owls/mac-input'
import type {
  ComputerUseHelperRequest,
  ComputerUseHelperResponse,
  ComputerUseHelperResult
} from './helper-protocol.js'

function serializeError(id: string, error: unknown): ComputerUseHelperResponse {
  if (error instanceof Error) {
    return {
      id,
      ok: false,
      error: {
        name: error.name,
        message: error.message,
        stack: error.stack
      }
    }
  }
  const message = (() => {
    if (typeof error === 'string') return error
    try {
      return JSON.stringify(error)
    } catch {
      return String(error)
    }
  })()
  return {
    id,
    ok: false,
    error: {
      message
    }
  }
}

function handleRequest(request: ComputerUseHelperRequest): ComputerUseHelperResult {
  if (request.method === 'ping') {
    return { type: 'pong', processId: process.pid }
  }

  if (request.method === 'accessibilityStatus') {
    return {
      type: 'accessibilityStatus',
      trusted: process.platform === 'darwin' ? checkAccessibility().trusted : false
    }
  }

  if (request.method === 'activateApp') {
    return { type: 'boolean', value: activateApp(request.params.pid) }
  }

  if (request.method === 'isAppActive') {
    return { type: 'boolean', value: isAppActive(request.params.pid) }
  }

  if (request.method === 'getFrontmostAppPid') {
    return { type: 'frontmostAppPid', pid: getFrontmostAppPid().pid ?? null }
  }

  if (request.method === 'mouseMove') {
    mouseMove(request.params)
    return { type: 'ok' }
  }

  if (request.method === 'mouseClick') {
    mouseClick(request.params as Parameters<typeof mouseClick>[0])
    return { type: 'ok' }
  }

  if (request.method === 'mouseDrag') {
    mouseDrag(request.params as Parameters<typeof mouseDrag>[0])
    return { type: 'ok' }
  }

  if (request.method === 'typeText') {
    typeText(request.params)
    return { type: 'ok' }
  }

  if (request.method === 'pressKey') {
    pressKey(request.params)
    return { type: 'ok' }
  }

  if (request.method === 'backgroundClick') {
    backgroundClick(request.params as Parameters<typeof backgroundClick>[0])
    return { type: 'ok' }
  }

  if (request.method === 'backgroundDrag') {
    backgroundDrag(request.params as Parameters<typeof backgroundDrag>[0])
    return { type: 'ok' }
  }

  if (request.method === 'backgroundType') {
    const result = backgroundType(request.params)
    return {
      type: 'backgroundType',
      windowFocused: result.windowFocused,
      charactersPosted: result.charactersPosted
    }
  }

  if (request.method === 'backgroundPressKey') {
    const result = backgroundPressKey(request.params)
    return {
      type: 'backgroundPressKey',
      windowFocused: result.windowFocused
    }
  }

  if (request.method === 'getFocusedWindowAccessibilityTree') {
    return {
      type: 'focusedWindowAccessibilityTree',
      value: getFocusedWindowAccessibilityTree(request.params) as unknown as {
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
  }

  if (request.method === 'axPressNode') {
    return {
      type: 'axPressNode',
      value: axPressNode(request.params)
    }
  }

  if (request.method === 'captureWindowPng') {
    const dir = mkdtempSync(join(tmpdir(), 'owls-computer-use-capture-'))
    const outputPath = join(dir, `window-${request.params.windowId}.png`)
    captureWindowPng({ windowId: request.params.windowId, path: outputPath })
    return { type: 'capturedPng', path: outputPath }
  }

  if (request.method === 'captureDesktopPng') {
    const dir = mkdtempSync(join(tmpdir(), 'owls-computer-use-capture-'))
    const outputPath = join(dir, `desktop-${request.params.displayId ?? 'primary'}.png`)
    captureDisplayPng({ displayId: request.params.displayId, path: outputPath })
    return { type: 'capturedPng', path: outputPath }
  }

  const exhaustive: never = request
  throw new Error(`Unsupported Computer Use helper request: ${JSON.stringify(exhaustive)}`)
}

const supportedMethods = new Set<ComputerUseHelperRequest['method']>([
  'ping',
  'accessibilityStatus',
  'activateApp',
  'isAppActive',
  'getFrontmostAppPid',
  'mouseMove',
  'mouseClick',
  'mouseDrag',
  'typeText',
  'pressKey',
  'backgroundClick',
  'backgroundDrag',
  'backgroundType',
  'backgroundPressKey',
  'getFocusedWindowAccessibilityTree',
  'axPressNode',
  'captureWindowPng',
  'captureDesktopPng'
])

function parseRequest(value: string): ComputerUseHelperRequest {
  const parsed = JSON.parse(value) as unknown
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Computer Use helper request must be a JSON object.')
  }

  const request = parsed as Partial<ComputerUseHelperRequest>
  if (typeof request.id !== 'string' || request.id.length === 0) {
    throw new Error('Computer Use helper request is missing id.')
  }
  if (typeof request.method !== 'string' || !supportedMethods.has(request.method)) {
    throw new Error('Computer Use helper request has an unsupported method.')
  }
  return request as ComputerUseHelperRequest
}

const lines = createInterface({
  input: process.stdin,
  crlfDelay: Number.POSITIVE_INFINITY
})

lines.on('line', (line) => {
  let requestId = 'unknown'
  try {
    const request = parseRequest(line)
    requestId = request.id
    const response: ComputerUseHelperResponse = {
      id: request.id,
      ok: true,
      result: handleRequest(request)
    }
    process.stdout.write(`${JSON.stringify(response)}\n`)
  } catch (error) {
    process.stdout.write(`${JSON.stringify(serializeError(requestId, error))}\n`)
  }
})

process.stdin.resume()
