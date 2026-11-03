import type { Spec } from '@json-render/core'
import { JSONUIProvider, Renderer } from '@json-render/react'
import { type ReactNode, useEffect, useMemo, useState } from 'react'
import {
  isJsonRenderState,
  type JsonRenderDocument,
  type JsonRenderState
} from '../../../../shared/json-render'
import { pichuJsonRenderRegistry } from './registry'
import {
  type JsonRenderStateFileReader,
  type JsonRenderStateResolution,
  resolveJsonRenderStateSource
} from './resolve-state-source'
import {
  isJsonRenderSpec,
  type JsonRenderSpecValidationOptions,
  jsonRenderSpecIssue
} from './validation'

type JsonRenderFallbackContext = {
  issue: string
  document: JsonRenderDocument
  state?: Record<string, unknown>
}

export type JsonRenderProps = {
  document: JsonRenderDocument
  stateFileReader?: JsonRenderStateFileReader
  initialState?: Record<string, unknown>
  registry?: typeof pichuJsonRenderRegistry
  validationOptions?: JsonRenderSpecValidationOptions
  pendingFallback?: ReactNode
  renderFallback?: (context: JsonRenderFallbackContext) => ReactNode
}

const EMPTY_RESOLUTION: JsonRenderStateResolution = {
  ok: true,
  sourceKind: 'empty',
  state: {}
}

type InstrumentableSpecElement = {
  type: string
  props?: Record<string, unknown>
  children?: string[]
}

type InstrumentableSpec = {
  root: string
  elements: Record<string, InstrumentableSpecElement>
}

function statePointerFromDataTableProps(props: Record<string, unknown>): string | undefined {
  if (
    typeof props.rows === 'object' &&
    props.rows !== null &&
    !Array.isArray(props.rows) &&
    typeof (props.rows as { $state?: unknown }).$state === 'string'
  ) {
    return (props.rows as { $state: string }).$state
  }
  if (
    typeof props.data === 'object' &&
    props.data !== null &&
    !Array.isArray(props.data) &&
    typeof (props.data as { $state?: unknown }).$state === 'string'
  ) {
    return (props.data as { $state: string }).$state
  }
  return undefined
}

function instrumentJsonRenderSpec(spec: Spec): Spec {
  const source = spec as unknown as InstrumentableSpec
  const parentByChildId = new Map<string, string>()
  for (const [elementId, element] of Object.entries(source.elements)) {
    for (const childId of element.children ?? []) {
      parentByChildId.set(childId, elementId)
    }
  }

  const elements: Spec['elements'] = {}
  for (const [elementId, element] of Object.entries(source.elements)) {
    const contentId = `${elementId}.__pichu_content`
    elements[elementId] = {
      type: 'SelectableNode',
      props: {
        elementId,
        elementType: element.type,
        renderer: 'json-render',
        parentElementId: parentByChildId.get(elementId),
        label:
          typeof element.props?.title === 'string'
            ? element.props.title
            : typeof element.props?.label === 'string'
              ? element.props.label
              : undefined
      },
      children: [contentId]
    }
    const props = element.props ?? {}
    elements[contentId] = {
      ...element,
      props:
        element.type === 'DataTable'
          ? {
              ...props,
              __pichuElementId: elementId,
              __pichuStatePointer: statePointerFromDataTableProps(props)
            }
          : props
    }
  }
  return { ...spec, elements }
}

function fallback(
  document: JsonRenderDocument,
  issue: string,
  renderFallback: JsonRenderProps['renderFallback'],
  state?: JsonRenderState
): ReactNode {
  return renderFallback?.({ issue, document, state }) ?? null
}

export function JsonRender({
  document,
  stateFileReader,
  initialState,
  registry = pichuJsonRenderRegistry,
  validationOptions,
  pendingFallback = null,
  renderFallback
}: JsonRenderProps): React.JSX.Element | null {
  const stateSource = document.state_source
  const specIssue = useMemo(
    () => jsonRenderSpecIssue(document.spec, validationOptions),
    [document.spec, validationOptions]
  )
  const inlineStateResolution = useMemo<JsonRenderStateResolution | null>(() => {
    if (stateSource === undefined) return EMPTY_RESOLUTION
    if (typeof stateSource === 'string') return null
    if (!isJsonRenderState(stateSource)) {
      return { ok: false, issue: 'Json render state_source must be a JSON object.' }
    }
    return { ok: true, sourceKind: 'inline', state: stateSource }
  }, [stateSource])
  const [stateResolution, setStateResolution] =
    useState<JsonRenderStateResolution>(EMPTY_RESOLUTION)
  const [resolvingState, setResolvingState] = useState(false)

  useEffect(() => {
    if (inlineStateResolution) {
      setResolvingState(false)
      return
    }
    let active = true
    setResolvingState(true)
    void resolveJsonRenderStateSource(stateSource, stateFileReader).then((resolution) => {
      if (!active) return
      setStateResolution(resolution)
      setResolvingState(false)
    })
    return () => {
      active = false
    }
  }, [inlineStateResolution, stateFileReader, stateSource])

  if (document.renderer !== 'json-render') {
    return <>{fallback(document, 'Unsupported json render document renderer.', renderFallback)}</>
  }
  if (specIssue) {
    return <>{fallback(document, specIssue, renderFallback)}</>
  }
  if (!isJsonRenderSpec(document.spec)) {
    return <>{fallback(document, 'Json render spec is invalid.', renderFallback)}</>
  }
  if (resolvingState) return <>{pendingFallback}</>
  const resolvedState = inlineStateResolution ?? stateResolution
  if (!resolvedState.ok) {
    return <>{fallback(document, resolvedState.issue, renderFallback)}</>
  }
  const providerState = initialState
    ? { ...resolvedState.state, ...initialState }
    : resolvedState.state

  const renderSpec = instrumentJsonRenderSpec(document.spec)

  return (
    <JSONUIProvider registry={registry} initialState={providerState}>
      <Renderer spec={renderSpec} registry={registry} />
    </JSONUIProvider>
  )
}
