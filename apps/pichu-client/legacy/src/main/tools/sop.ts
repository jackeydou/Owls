import { lstat, realpath, stat } from 'node:fs/promises'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import type { AgentTool } from '@earendil-works/pi-agent-core'
import { Type } from 'typebox'
import { requireFeatureGateEnabled } from '../feature-gates/local-feature-gate-service.js'
import { saveSopFromJsonPathAsync } from '../sop/store.js'

function requireSopCreatorFeatureGate(): void {
  requireFeatureGateEnabled('sopCreator', 'SOP Creator tools')
}

const saveSopSchema = Type.Object({
  sopJsonPath: Type.String({
    description:
      'Absolute path inside the current workspace, or path relative to the current workspace directory, to an pichu.sop_graph.v1 JSON file.'
  })
})

async function resolveWorkspaceJsonPath(cwd: string, sopJsonPath: string): Promise<string> {
  const trimmed = sopJsonPath.trim()
  if (!trimmed) {
    throw new Error('sopJsonPath must be a non-empty string.')
  }
  const resolvedPath = isAbsolute(trimmed) ? trimmed : resolve(cwd, trimmed)
  const info = await lstat(resolvedPath)
  if (info.isSymbolicLink()) {
    throw new Error('sopJsonPath must not be a symlink.')
  }
  if (!info.isFile()) {
    throw new Error('sopJsonPath must point to a JSON file.')
  }

  const [realCwd, realJsonPath] = await Promise.all([realpath(cwd), realpath(resolvedPath)])
  const relativePath = relative(realCwd, realJsonPath)
  if (
    relativePath === '' ||
    relativePath === '..' ||
    relativePath.startsWith(`..${sep}`) ||
    isAbsolute(relativePath)
  ) {
    throw new Error('sopJsonPath must be a file inside the current workspace directory.')
  }

  const fileStat = await stat(realJsonPath)
  if (!fileStat.isFile()) {
    throw new Error('sopJsonPath must point to a JSON file.')
  }
  return realJsonPath
}

function createSaveSopTool(cwd: string): AgentTool<typeof saveSopSchema> {
  return {
    name: 'save_sop',
    label: 'Save SOP',
    description:
      'Save an pichu.sop_graph.v1 JSON file into the Owls data root SOP directory and update the local SOP index. ' +
      'Use this after creating or editing an SOP graph JSON with the sop-creator skill.',
    parameters: saveSopSchema,
    executionMode: 'sequential',
    async execute(_toolCallId, params) {
      requireSopCreatorFeatureGate()
      const result = await saveSopFromJsonPathAsync(
        await resolveWorkspaceJsonPath(cwd, params.sopJsonPath)
      )
      return {
        content: [
          {
            type: 'text',
            text: `Saved SOP ${result.sopId}@${result.version}.`
          }
        ],
        details: {
          ok: true,
          ...result
        }
      }
    }
  }
}

export function createSopTools(cwd: string): AgentTool[] {
  return [createSaveSopTool(cwd)]
}
