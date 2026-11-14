import type { AgentTool } from '@earendil-works/pi-agent-core'
import { Type } from 'typebox'

import {
  captureEmbeddedBrowserSnapshot,
  clickEmbeddedBrowser,
  ensureEmbeddedBrowserVisible,
  executeEmbeddedBrowserScript,
  fillEmbeddedBrowser,
  openEmbeddedBrowserUrl,
  pressEmbeddedBrowser,
  scrollEmbeddedBrowser,
  setActiveEmbeddedBrowserSession,
  typeEmbeddedBrowser,
  waitEmbeddedBrowser
} from '../ipc-handlers/embedded-browser-handler.js'

let getCurrentEmbeddedBrowserToolSessionId: (() => string | null) | null = null

function activateEmbeddedBrowserToolSession(): void {
  setActiveEmbeddedBrowserSession(getCurrentEmbeddedBrowserToolSessionId?.() ?? null)
}

const embeddedBrowserStatusSchema = Type.Object({})

const embeddedBrowserOpenSchema = Type.Object({
  url: Type.String({
    description: 'URL to open in the visible Owls right-sidebar embedded browser.'
  }),
  waitUntilLoaded: Type.Optional(
    Type.Boolean({
      description: 'When true, wait for the page load event before returning. Defaults to true.'
    })
  )
})

const embeddedBrowserEvalSchema = Type.Object({
  code: Type.String({
    description: 'JavaScript to execute in the visible Owls right-sidebar embedded browser.'
  })
})

const embeddedBrowserSnapshotSchema = Type.Object({
  maxTextLength: Type.Optional(
    Type.Number({
      description: 'Maximum page text characters to return. Defaults to 12000.'
    })
  )
})

const embeddedBrowserClickSchema = Type.Object({
  selector: Type.Optional(Type.String({ description: 'CSS selector for the element to click.' })),
  text: Type.Optional(
    Type.String({
      description:
        'Visible text or aria-label to match when selector is not available. Prefer selectors from embeddedBrowserSnapshot when possible.'
    })
  )
})

const embeddedBrowserFillSchema = Type.Object({
  selector: Type.Optional(Type.String({ description: 'CSS selector for an input-like element.' })),
  text: Type.Optional(Type.String({ description: 'Text hint for the target input.' })),
  label: Type.Optional(Type.String({ description: 'Associated label text for the target input.' })),
  placeholder: Type.Optional(
    Type.String({ description: 'Placeholder text for the target input.' })
  ),
  name: Type.Optional(Type.String({ description: 'Name attribute for the target input.' })),
  value: Type.String({ description: 'Value to put into the input.' }),
  clear: Type.Optional(Type.Boolean({ description: 'When false, append instead of replacing.' })),
  submit: Type.Optional(
    Type.Boolean({ description: 'When true, submit the closest form after fill.' })
  )
})

const embeddedBrowserTypeSchema = Type.Object({
  selector: Type.Optional(
    Type.String({ description: 'Optional CSS selector. Omit to type into the focused element.' })
  ),
  text: Type.String({ description: 'Text to append to the target editable element.' })
})

const embeddedBrowserPressSchema = Type.Object({
  selector: Type.Optional(
    Type.String({
      description: 'Optional CSS selector. Omit to send the key to the focused element.'
    })
  ),
  key: Type.String({ description: 'Key to press, e.g. Enter, Escape, Backspace, ArrowDown.' })
})

const embeddedBrowserScrollSchema = Type.Object({
  x: Type.Optional(
    Type.Number({ description: 'Horizontal scroll delta per step. Defaults to 0.' })
  ),
  y: Type.Optional(
    Type.Number({ description: 'Vertical scroll delta per step. Defaults to stepPx or 600.' })
  ),
  times: Type.Optional(Type.Number({ description: 'Number of scroll steps. Defaults to 1.' })),
  stepPx: Type.Optional(
    Type.Number({ description: 'Vertical scroll delta alias. Defaults to 600.' })
  ),
  delayMs: Type.Optional(Type.Number({ description: 'Delay between steps. Defaults to 50ms.' }))
})

const embeddedBrowserWaitSchema = Type.Object({
  ms: Type.Optional(Type.Number({ description: 'Wait a fixed number of milliseconds.' })),
  selector: Type.Optional(Type.String({ description: 'Wait until this CSS selector exists.' })),
  text: Type.Optional(
    Type.String({ description: 'Wait until this text appears in the page body.' })
  ),
  timeoutMs: Type.Optional(
    Type.Number({ description: 'Maximum wait for selector/text. Defaults to 5000ms.' })
  )
})

const embeddedBrowserStatusTool: AgentTool<typeof embeddedBrowserStatusSchema> = {
  name: 'embeddedBrowserStatus',
  label: 'Embedded Browser Status',
  description:
    'Inspect the visible Owls right-sidebar embedded browser instance and whether it is attached.',
  parameters: embeddedBrowserStatusSchema,
  async execute() {
    activateEmbeddedBrowserToolSession()
    const status = await ensureEmbeddedBrowserVisible()
    return {
      content: [
        {
          type: 'text',
          text: status.attached
            ? `Embedded browser is attached at ${status.url ?? 'about:blank'}.`
            : 'Embedded browser is not attached. Use embeddedBrowserOpen to show and navigate it.'
        }
      ],
      details: status
    }
  }
}

const embeddedBrowserOpenTool: AgentTool<typeof embeddedBrowserOpenSchema> = {
  name: 'embeddedBrowserOpen',
  label: 'Open Embedded Browser',
  description:
    'Show and navigate the visible Owls right-sidebar embedded browser. The instance persists across app route changes.',
  parameters: embeddedBrowserOpenSchema,
  async execute(_toolCallId, params) {
    activateEmbeddedBrowserToolSession()
    const status = await openEmbeddedBrowserUrl(params.url, {
      waitUntilLoaded: params.waitUntilLoaded ?? true,
      visible: true
    })
    return {
      content: [{ type: 'text', text: `Embedded browser opened ${status.url ?? params.url}.` }],
      details: status
    }
  }
}

const embeddedBrowserSnapshotTool: AgentTool<typeof embeddedBrowserSnapshotSchema> = {
  name: 'embeddedBrowserSnapshot',
  label: 'Embedded Browser Snapshot',
  description:
    'Inspect the current sidebar browser page text and a compact list of interactive elements with selectors.',
  parameters: embeddedBrowserSnapshotSchema,
  async execute(_toolCallId, params) {
    activateEmbeddedBrowserToolSession()
    const snapshot = await captureEmbeddedBrowserSnapshot(params.maxTextLength ?? 12_000)
    const elements = snapshot.elements
      .map((element) => {
        const label = element.text || element.placeholder || element.name || element.href || ''
        return `${element.index}. ${element.tagName}${element.type ? `[${element.type}]` : ''} selector=${JSON.stringify(element.selector)} text=${JSON.stringify(label)}`
      })
      .join('\n')
    return {
      content: [
        {
          type: 'text',
          text: `URL: ${snapshot.url}\nTitle: ${snapshot.title}\n\nPage text:\n${snapshot.text}\n\nInteractive elements:\n${elements || '(none found)'}`
        }
      ],
      details: snapshot
    }
  }
}

const embeddedBrowserEvalTool: AgentTool<typeof embeddedBrowserEvalSchema> = {
  name: 'embeddedBrowserEval',
  label: 'Embedded Browser Eval',
  description: 'Execute JavaScript in the visible Owls right-sidebar embedded browser.',
  parameters: embeddedBrowserEvalSchema,
  async execute(_toolCallId, params) {
    activateEmbeddedBrowserToolSession()
    const result = await executeEmbeddedBrowserScript(params.code)
    return {
      content: [
        { type: 'text', text: typeof result === 'string' ? result : JSON.stringify(result ?? null) }
      ],
      details: { result }
    }
  }
}

const embeddedBrowserClickTool: AgentTool<typeof embeddedBrowserClickSchema> = {
  name: 'embeddedBrowserClick',
  label: 'Embedded Browser Click',
  description:
    'Click an element in the visible Owls right-sidebar embedded browser by selector or visible text.',
  parameters: embeddedBrowserClickSchema,
  async execute(_toolCallId, params) {
    activateEmbeddedBrowserToolSession()
    const result = await clickEmbeddedBrowser(params)
    return {
      content: [{ type: 'text', text: 'Embedded browser click completed.' }],
      details: result
    }
  }
}

const embeddedBrowserFillTool: AgentTool<typeof embeddedBrowserFillSchema> = {
  name: 'embeddedBrowserFill',
  label: 'Embedded Browser Fill',
  description:
    'Fill an input, textarea, or contenteditable element in the visible Owls right-sidebar embedded browser.',
  parameters: embeddedBrowserFillSchema,
  async execute(_toolCallId, params) {
    activateEmbeddedBrowserToolSession()
    const result = await fillEmbeddedBrowser(params)
    return {
      content: [{ type: 'text', text: 'Embedded browser fill completed.' }],
      details: result
    }
  }
}

const embeddedBrowserTypeTool: AgentTool<typeof embeddedBrowserTypeSchema> = {
  name: 'embeddedBrowserType',
  label: 'Embedded Browser Type',
  description:
    'Append text to a focused or selected editable element in the visible Owls right-sidebar embedded browser.',
  parameters: embeddedBrowserTypeSchema,
  async execute(_toolCallId, params) {
    activateEmbeddedBrowserToolSession()
    const result = await typeEmbeddedBrowser(params)
    return {
      content: [{ type: 'text', text: 'Embedded browser typing completed.' }],
      details: result
    }
  }
}

const embeddedBrowserPressTool: AgentTool<typeof embeddedBrowserPressSchema> = {
  name: 'embeddedBrowserPress',
  label: 'Embedded Browser Key Press',
  description:
    'Send a key press to a focused or selected element in the visible Owls right-sidebar embedded browser.',
  parameters: embeddedBrowserPressSchema,
  async execute(_toolCallId, params) {
    activateEmbeddedBrowserToolSession()
    const result = await pressEmbeddedBrowser(params)
    return {
      content: [{ type: 'text', text: `Embedded browser key ${params.key} pressed.` }],
      details: result
    }
  }
}

const embeddedBrowserScrollTool: AgentTool<typeof embeddedBrowserScrollSchema> = {
  name: 'embeddedBrowserScroll',
  label: 'Embedded Browser Scroll',
  description: 'Scroll the visible Owls right-sidebar embedded browser page.',
  parameters: embeddedBrowserScrollSchema,
  async execute(_toolCallId, params) {
    activateEmbeddedBrowserToolSession()
    const result = await scrollEmbeddedBrowser(params)
    return {
      content: [{ type: 'text', text: 'Embedded browser scroll completed.' }],
      details: result
    }
  }
}

const embeddedBrowserWaitTool: AgentTool<typeof embeddedBrowserWaitSchema> = {
  name: 'embeddedBrowserWait',
  label: 'Embedded Browser Wait',
  description:
    'Wait for time, a selector, or text in the visible Owls right-sidebar embedded browser.',
  parameters: embeddedBrowserWaitSchema,
  async execute(_toolCallId, params) {
    activateEmbeddedBrowserToolSession()
    const result = await waitEmbeddedBrowser(params)
    return {
      content: [{ type: 'text', text: 'Embedded browser wait completed.' }],
      details: result
    }
  }
}

export function createEmbeddedBrowserTools(options?: { getCurrentSessionId: () => string | null }) {
  getCurrentEmbeddedBrowserToolSessionId = options?.getCurrentSessionId ?? null
  return [
    embeddedBrowserStatusTool,
    embeddedBrowserOpenTool,
    embeddedBrowserSnapshotTool,
    embeddedBrowserEvalTool,
    embeddedBrowserClickTool,
    embeddedBrowserFillTool,
    embeddedBrowserTypeTool,
    embeddedBrowserPressTool,
    embeddedBrowserScrollTool,
    embeddedBrowserWaitTool
  ]
}
