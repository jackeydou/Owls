import { isJsonRenderState, type JsonRenderState } from '../../../../shared/json-render'

export type JsonRenderStateFileReadResult =
  | {
      exists: true
      content: string
    }
  | {
      exists: false
    }

export type JsonRenderStateFileReader = (path: string) => Promise<JsonRenderStateFileReadResult>

export type JsonRenderStateResolution =
  | {
      ok: true
      sourceKind: 'empty' | 'inline' | 'file'
      state: JsonRenderState
    }
  | {
      ok: false
      issue: string
    }

function parseStateFileContent(content: string): JsonRenderStateResolution {
  let parsed: unknown
  try {
    parsed = JSON.parse(content) as unknown
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { ok: false, issue: `Json render state file is not valid JSON: ${message}` }
  }
  if (!isJsonRenderState(parsed)) {
    return { ok: false, issue: 'Json render state file must contain a JSON object.' }
  }
  return { ok: true, sourceKind: 'file', state: parsed }
}

export async function resolveJsonRenderStateSource(
  stateSource: unknown,
  fileReader?: JsonRenderStateFileReader
): Promise<JsonRenderStateResolution> {
  if (stateSource === undefined) return { ok: true, sourceKind: 'empty', state: {} }
  if (typeof stateSource !== 'string') {
    if (!isJsonRenderState(stateSource)) {
      return { ok: false, issue: 'Json render state_source must be a JSON object.' }
    }
    return { ok: true, sourceKind: 'inline', state: stateSource }
  }
  if (!fileReader) {
    return { ok: false, issue: 'Json render state_source file paths require a file reader.' }
  }

  let result: JsonRenderStateFileReadResult
  try {
    result = await fileReader(stateSource)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { ok: false, issue: `Json render state file could not be read: ${message}` }
  }
  if (!result.exists) {
    return { ok: false, issue: `Json render state file does not exist: ${stateSource}` }
  }
  return parseStateFileContent(result.content)
}
