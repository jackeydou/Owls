import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { parseFrontmatter } from '@earendil-works/pi-coding-agent'
import { getDataRoot } from '../pichu-paths.js'
import { createPichuCodingTools, createPichuReadOnlyTools } from '../tools/coding.js'
import type { AgentDefinition, AgentDefinitionSource, AgentDefinitionSummary } from './types.js'

type AgentFrontmatter = {
  name?: string
  description?: string
  model?: string
  readonly?: boolean
  maxTurns?: number
  timeoutMs?: number
  color?: string
}

function slugify(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function builtInDefinitions(): AgentDefinition[] {
  return [
    {
      id: 'explorer',
      name: 'Explorer',
      description: 'Fast read-only codebase exploration and search.',
      systemPrompt:
        'You are an exploration specialist. Search the codebase, gather relevant context, and summarize findings clearly. Do not modify files.',
      model: 'fast',
      readonly: true,
      maxTurns: 12,
      source: 'builtin',
      toolFactory: (cwd) => createPichuReadOnlyTools(cwd)
    },
    {
      id: 'coder',
      name: 'Coder',
      description: 'Code implementation specialist for writing, editing, and debugging.',
      systemPrompt:
        'You are a coding specialist. Implement requested changes carefully, prefer minimal diffs, and verify your work before reporting back.',
      readonly: false,
      maxTurns: 20,
      source: 'builtin',
      toolFactory: (cwd, runtime) =>
        createPichuCodingTools(cwd, undefined, [], () => runtime?.sessionId ?? null)
    },
    {
      id: 'reviewer',
      name: 'Reviewer',
      description: 'Read-only reviewer focused on bugs, risks, and missing tests.',
      systemPrompt:
        'You are a code reviewer. Identify correctness issues, regressions, edge cases, and testing gaps. Be concise and severity-ordered.',
      model: 'fast',
      readonly: true,
      maxTurns: 10,
      source: 'builtin',
      toolFactory: (cwd) => createPichuReadOnlyTools(cwd)
    }
  ]
}

export function getProjectAgentsDir(dataRoot = getDataRoot()): string {
  return join(dataRoot, 'agents')
}

export function getUserAgentsDir(): string {
  return join(getDataRoot().replace(/\/?$/, ''), 'agents')
}

function getGlobalAgentsDir(): string {
  return join(process.env.HOME || '', '.pichu', 'agents')
}

function parseAgentFile(path: string, source: AgentDefinitionSource): AgentDefinition | null {
  const raw = readFileSync(path, 'utf8')
  const parsed = parseFrontmatter<AgentFrontmatter>(raw)
  const body = parsed.body.trim()
  const description = parsed.frontmatter.description?.trim()
  const name = parsed.frontmatter.name?.trim() || slugify(basename(path, '.md'))

  if (!name || !body || !description) {
    return null
  }

  return {
    id: slugify(name),
    name,
    description,
    systemPrompt: body,
    model: parsed.frontmatter.model?.trim(),
    readonly: parsed.frontmatter.readonly === true,
    maxTurns:
      typeof parsed.frontmatter.maxTurns === 'number' ? parsed.frontmatter.maxTurns : undefined,
    timeoutMs:
      typeof parsed.frontmatter.timeoutMs === 'number' ? parsed.frontmatter.timeoutMs : undefined,
    color: parsed.frontmatter.color?.trim(),
    filePath: path,
    source
  }
}

function loadDefinitionsFromDir(
  dir: string,
  source: AgentDefinitionSource
): Map<string, AgentDefinition> {
  const map = new Map<string, AgentDefinition>()
  if (!existsSync(dir)) {
    return map
  }

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) {
      continue
    }
    const def = parseAgentFile(join(dir, entry.name), source)
    if (!def) {
      continue
    }
    map.set(def.id, def)
  }

  return map
}

export function ensureAgentsDirs(dataRoot = getDataRoot()): void {
  mkdirSync(getProjectAgentsDir(dataRoot), { recursive: true })
  mkdirSync(getGlobalAgentsDir(), { recursive: true })
}

export function loadAgentDefinitions(dataRoot = getDataRoot()): AgentDefinition[] {
  ensureAgentsDirs(dataRoot)

  const merged = new Map<string, AgentDefinition>()
  for (const def of builtInDefinitions()) {
    merged.set(def.id, def)
  }
  for (const [id, def] of loadDefinitionsFromDir(getGlobalAgentsDir(), 'user')) {
    merged.set(id, def)
  }
  for (const [id, def] of loadDefinitionsFromDir(getProjectAgentsDir(dataRoot), 'project')) {
    merged.set(id, def)
  }

  return [...merged.values()].sort((a, b) => a.name.localeCompare(b.name))
}

export function listAgentDefinitionSummaries(dataRoot = getDataRoot()): AgentDefinitionSummary[] {
  return loadAgentDefinitions(dataRoot).map(({ toolFactory: _toolFactory, ...rest }) => rest)
}

export function getAgentDefinitionById(
  definitionId: string,
  dataRoot = getDataRoot()
): AgentDefinition | null {
  return loadAgentDefinitions(dataRoot).find((definition) => definition.id === definitionId) ?? null
}
