import { executeCdp } from './cdp-backend.js'
import {
  type BrowserUseActionExpectation,
  type BrowserUseSelector,
  browserUseClick,
  browserUseFill,
  browserUseWaitFor,
  resolveLocatorCandidates
} from './locator.js'

type ComplexActionOptions = {
  timeoutMs?: number
  expect?: BrowserUseActionExpectation
}

export type SelectOptionParams = ComplexActionOptions & {
  trigger: BrowserUseSelector
  option: BrowserUseSelector
  valueSelector?: BrowserUseSelector
  value?: string
}

export type DatePickerParams = ComplexActionOptions & {
  input: BrowserUseSelector
  value: string
  calendarDay?: BrowserUseSelector
}

export type TreeSelectParams = ComplexActionOptions & {
  trigger: BrowserUseSelector
  item: BrowserUseSelector
  checkbox?: BrowserUseSelector
  tagText?: string
}

export type ScrollUntilParams = {
  target: BrowserUseSelector
  container?: BrowserUseSelector
  timeoutMs?: number
  stepPx?: number
  maxScrolls?: number
}

async function waitForOverlaySignal(sessionKey: string, timeoutMs?: number): Promise<void> {
  await browserUseWaitFor(
    sessionKey,
    {
      type: 'selectorVisible',
      selector: {
        type: 'css',
        value:
          '[role="listbox"],[role="menu"],[role="tree"],[role="dialog"],dialog,[data-radix-popper-content-wrapper]'
      }
    },
    { timeoutMs: Math.min(timeoutMs ?? 2_000, 2_000) }
  ).catch(() => undefined)
}

export async function browserUseSelectOption(sessionKey: string, params: SelectOptionParams) {
  await browserUseClick(sessionKey, params.trigger)
  await waitForOverlaySignal(sessionKey, params.timeoutMs)
  await browserUseClick(sessionKey, params.option, {
    ...(params.expect ?? {}),
    ...(params.valueSelector && params.value !== undefined
      ? {
          valueEquals: {
            selector: params.valueSelector,
            value: params.value
          }
        }
      : {})
  })
  return browserUseWaitFor(
    sessionKey,
    params.value !== undefined
      ? { type: 'textVisible', value: params.value }
      : {
          type: 'selectorHidden',
          selector: { type: 'css', value: '[role="listbox"],[role="menu"]' }
        },
    { timeoutMs: params.timeoutMs }
  )
}

export async function browserUsePickDate(sessionKey: string, params: DatePickerParams) {
  try {
    return await browserUseFill(sessionKey, params.input, params.value, params.expect)
  } catch (inputError) {
    if (!params.calendarDay) throw inputError
    await browserUseClick(sessionKey, params.input)
    await waitForOverlaySignal(sessionKey, params.timeoutMs)
    await browserUseClick(sessionKey, params.calendarDay, params.expect)
    return browserUseWaitFor(
      sessionKey,
      {
        type: 'selectorHidden',
        selector: { type: 'css', value: '[role="dialog"],[role="grid"],.ant-picker-dropdown' }
      },
      { timeoutMs: params.timeoutMs }
    )
  }
}

export async function browserUseTreeSelect(sessionKey: string, params: TreeSelectParams) {
  await browserUseClick(sessionKey, params.trigger)
  await waitForOverlaySignal(sessionKey, params.timeoutMs)
  if (params.checkbox) {
    await browserUseClick(sessionKey, params.checkbox)
  } else {
    await browserUseClick(sessionKey, params.item)
  }
  if (params.tagText) {
    return browserUseWaitFor(sessionKey, { type: 'textVisible', value: params.tagText }, params)
  }
  if (params.expect) {
    return browserUseWaitFor(
      sessionKey,
      params.expect.textVisible
        ? { type: 'textVisible', value: params.expect.textVisible }
        : { type: 'selectorHidden', selector: { type: 'css', value: '[role="tree"]' } },
      params
    )
  }
  return browserUseWaitFor(
    sessionKey,
    { type: 'selectorHidden', selector: { type: 'css', value: '[role="tree"]' } },
    params
  )
}

export async function browserUseScrollUntil(sessionKey: string, params: ScrollUntilParams) {
  const timeoutMs = params.timeoutMs ?? 5_000
  const stepPx = params.stepPx ?? 600
  const maxScrolls = params.maxScrolls ?? 20
  const startedAt = Date.now()

  for (let index = 0; index <= maxScrolls && Date.now() - startedAt <= timeoutMs; index += 1) {
    const matches = await resolveLocatorCandidates(sessionKey, params.target)
    if (matches.nodes.some((node) => node.visible)) {
      return browserUseWaitFor(
        sessionKey,
        { type: 'selectorVisible', selector: params.target },
        { timeoutMs: 500 }
      )
    }
    if (params.container) {
      const containers = await resolveLocatorCandidates(sessionKey, params.container)
      const token = containers.nodes.find((node) => node.visible)?.token
      if (token) {
        await executeCdp(sessionKey, 'Runtime.evaluate', {
          expression: `window.__pichuBrowserUse.scrollToken(${JSON.stringify(token)}, ${JSON.stringify(stepPx)})`,
          awaitPromise: true,
          returnByValue: true
        })
        continue
      }
    }
    await executeCdp(sessionKey, 'Runtime.evaluate', {
      expression: `window.scrollBy(${JSON.stringify({ left: 0, top: stepPx, behavior: 'instant' })})`,
      awaitPromise: true,
      returnByValue: true
    })
  }

  throw new Error(`Browser Use could not find target after ${maxScrolls} scroll step(s).`)
}
