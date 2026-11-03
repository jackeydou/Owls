import type { Dirent } from 'node:fs'
import { readdir, readFile, realpath, rm, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, isAbsolute, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { normalizeMessageParts } from '../shared/message-parts.js'
import { isFeatureGated } from './feature-gates/local-feature-gate-service.js'
import { getDataRoot } from './pichu-paths.js'
import { getEnabledPluginSkillSourcesAsync } from './plugins/plugin-registry.js'
import type { PluginCommand } from './plugins/plugin-types.js'
import { getSettingsForRenderer } from './stores/settings-store.js'

declare const __PICHU_DEV__: boolean

const SKILL_FILE_NAME = 'SKILL.md'
const AGENTS_DIR_NAME = '.agents'
const SKILLS_DIR_NAME = 'skills'
const PROJECT_ROOT_MARKERS = ['.git']

export type SkillSourceKind = 'repo' | 'agents' | 'claude' | 'pichu' | 'builtin' | 'plugin'

export type SkillSummary = {
  name: string
  qualifiedName?: string
  description: string
  filePath: string
  baseDir: string
  sourceKind: SkillSourceKind
  sourceLabel: string
  sourceRoot: string
  pluginId?: string
  pluginName?: string
  pluginVersion?: string
  pluginRoot?: string
  pluginScripts?: PluginCommand[]
  pluginCommands?: PluginCommand[]
  pluginHasRuntimeRequirements?: boolean
}

export type SkillDiagnostic = {
  type: 'warning' | 'collision'
  message: string
  path: string
  collision?: {
    name: string
    winnerPath: string
    loserPath: string
  }
}

type SkillSource = {
  kind: SkillSourceKind
  rootPath: string
  label: string
  pluginId?: string
  pluginName?: string
  pluginVersion?: string
  pluginRoot?: string
  pluginScripts?: PluginCommand[]
  pluginCommands?: PluginCommand[]
  pluginHasRuntimeRequirements?: boolean
}

type LoadedSkill = SkillSummary

type Frontmatter = {
  name?: string
  description?: string
}

function tildePath(value: string): string {
  const home = homedir()
  if (value === home) return '~'
  return value.startsWith(`${home}${sep}`) ? `~${value.slice(home.length)}` : value
}

function bundledSkillRootCandidates(): string[] {
  const moduleDir = dirname(fileURLToPath(import.meta.url))
  const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath
  const devOnlySourceSkillsRoot =
    typeof __PICHU_DEV__ !== 'undefined' && __PICHU_DEV__
      ? join(moduleDir, '..', '..', 'resources', 'skills')
      : ''

  if (devOnlySourceSkillsRoot) {
    console.info('[skills] dev bundled skills path candidate:', devOnlySourceSkillsRoot)
  }

  return [resourcesPath ? join(resourcesPath, 'skills') : '', devOnlySourceSkillsRoot].filter(
    Boolean
  )
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

async function findProjectRoot(cwd: string): Promise<string> {
  let current = cwd

  while (true) {
    for (const marker of PROJECT_ROOT_MARKERS) {
      if (await pathExists(join(current, marker))) {
        return current
      }
    }

    const parent = dirname(current)
    if (parent === current) {
      return cwd
    }
    current = parent
  }
}

function dirsBetweenProjectRootAndCwd(projectRoot: string, cwd: string): string[] {
  const dirs: string[] = []
  let current = cwd

  while (true) {
    dirs.push(current)
    if (current === projectRoot) break

    const parent = dirname(current)
    if (parent === current) break
    current = parent
  }

  return dirs.reverse()
}

async function resolveRepoSkillSources(cwd?: string): Promise<SkillSource[]> {
  const normalizedCwd = cwd?.trim()
  if (!normalizedCwd || !(await isDirectory(normalizedCwd))) {
    return []
  }

  const projectRoot = await findProjectRoot(normalizedCwd)
  const projectName = basename(projectRoot) || tildePath(projectRoot)
  const dirs = dirsBetweenProjectRootAndCwd(projectRoot, normalizedCwd)
  const sources: SkillSource[] = []

  for (const dir of dirs) {
    const rootPath = join(dir, AGENTS_DIR_NAME, SKILLS_DIR_NAME)
    if (!(await isDirectory(rootPath))) continue

    sources.push({
      kind: 'repo',
      rootPath,
      label: projectName
    })
  }

  return sources
}

async function resolveSkillSources(options: { cwd?: string } = {}): Promise<SkillSource[]> {
  const pichuSkillsRoot = join(getDataRoot(), 'skills')
  const defaultPichuRoot = join(homedir(), '.pichu', 'skills')
  const { enableAgentsSkills, enableClaudeSkills, workingDirectory } = getSettingsForRenderer()
  const sources: SkillSource[] = await resolveRepoSkillSources(options.cwd ?? workingDirectory)

  if (enableAgentsSkills) {
    sources.push({
      kind: 'agents',
      rootPath: join(homedir(), AGENTS_DIR_NAME, SKILLS_DIR_NAME),
      label: '~/.agents/skills'
    })
  }

  if (enableClaudeSkills) {
    sources.push({
      kind: 'claude',
      rootPath: join(homedir(), '.claude', 'skills'),
      label: '~/.claude/skills'
    })
  }

  sources.push({
    kind: 'pichu',
    rootPath: pichuSkillsRoot,
    label: pichuSkillsRoot === defaultPichuRoot ? '~/.pichu/skills' : tildePath(pichuSkillsRoot)
  })

  for (const rootPath of bundledSkillRootCandidates()) {
    sources.push({
      kind: 'builtin',
      rootPath,
      label: 'Built-in Owls skills'
    })
  }

  for (const pluginSource of await getEnabledPluginSkillSourcesAsync()) {
    sources.push({
      kind: 'plugin',
      rootPath: pluginSource.rootPath,
      label: pluginSource.label,
      pluginId: pluginSource.pluginId,
      pluginName: pluginSource.pluginName,
      pluginVersion: pluginSource.pluginVersion,
      pluginRoot: pluginSource.pluginRoot,
      pluginScripts: pluginSource.scripts,
      pluginCommands: pluginSource.commands,
      pluginHasRuntimeRequirements: pluginSource.hasRuntimeRequirements
    })
  }

  return sources
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile()
  } catch {
    return false
  }
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory()
  } catch {
    return false
  }
}

export function parseFrontmatter(raw: string): { frontmatter: Frontmatter; body: string } {
  if (!raw.startsWith('---\n') && !raw.startsWith('---\r\n')) {
    return { frontmatter: {}, body: raw }
  }

  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/)
  if (!match) {
    return { frontmatter: {}, body: raw }
  }

  const frontmatter: Frontmatter = {}
  for (const line of match[1].split(/\r?\n/)) {
    const parsed = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/)
    if (!parsed) continue

    const key = parsed[1]
    let value = parsed[2].trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }

    if (key === 'name' || key === 'description') {
      frontmatter[key] = value
    }
  }

  return { frontmatter, body: match[2] }
}

async function readSkillFromFile(
  filePath: string,
  source: SkillSource
): Promise<{ skill: LoadedSkill | null; diagnostics: SkillDiagnostic[] }> {
  const diagnostics: SkillDiagnostic[] = []

  try {
    const raw = await readFile(filePath, 'utf8')
    const { frontmatter } = parseFrontmatter(raw)
    const baseDir = dirname(filePath)
    const fallbackName =
      basename(filePath) === SKILL_FILE_NAME ? basename(baseDir) : basename(filePath, '.md')
    const name = frontmatter.name?.trim() || fallbackName
    const description = frontmatter.description?.trim()

    if (!description) {
      diagnostics.push({
        type: 'warning',
        message: 'description is required',
        path: filePath
      })
      return { skill: null, diagnostics }
    }

    return {
      skill: {
        name,
        qualifiedName: source.pluginName ? `${source.pluginName}:${name}` : undefined,
        description,
        filePath,
        baseDir,
        sourceKind: source.kind,
        sourceLabel: source.label,
        sourceRoot: source.rootPath,
        pluginId: source.pluginId,
        pluginName: source.pluginName,
        pluginVersion: source.pluginVersion,
        pluginRoot: source.pluginRoot,
        pluginScripts: source.pluginScripts,
        pluginCommands: source.pluginCommands,
        pluginHasRuntimeRequirements: source.pluginHasRuntimeRequirements
      },
      diagnostics
    }
  } catch (error) {
    diagnostics.push({
      type: 'warning',
      message: error instanceof Error ? error.message : 'failed to read skill file',
      path: filePath
    })
    return { skill: null, diagnostics }
  }
}

async function walkSkillsFromDir(
  dir: string,
  source: SkillSource,
  includeRootMarkdownFiles: boolean
): Promise<{ skills: LoadedSkill[]; diagnostics: SkillDiagnostic[] }> {
  const skills: LoadedSkill[] = []
  const diagnostics: SkillDiagnostic[] = []

  if (!(await isDirectory(dir))) {
    return { skills, diagnostics }
  }

  let entries: Dirent[]
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch (error) {
    diagnostics.push({
      type: 'warning',
      message: error instanceof Error ? error.message : 'failed to scan skill directory',
      path: dir
    })
    return { skills, diagnostics }
  }

  for (const entry of entries) {
    if (entry.name !== SKILL_FILE_NAME) continue

    const fullPath = join(dir, entry.name)
    if (!(await isFile(fullPath))) continue

    const loaded = await readSkillFromFile(fullPath, source)
    if (loaded.skill) {
      skills.push(loaded.skill)
    }
    diagnostics.push(...loaded.diagnostics)
    return { skills, diagnostics }
  }

  for (const entry of entries) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules') {
      continue
    }

    const fullPath = join(dir, entry.name)

    if (await isDirectory(fullPath)) {
      const nested = await walkSkillsFromDir(fullPath, source, false)
      skills.push(...nested.skills)
      diagnostics.push(...nested.diagnostics)
      continue
    }

    if (!includeRootMarkdownFiles || !entry.name.endsWith('.md') || !(await isFile(fullPath))) {
      continue
    }

    const loaded = await readSkillFromFile(fullPath, source)
    if (loaded.skill) {
      skills.push(loaded.skill)
    }
    diagnostics.push(...loaded.diagnostics)
  }

  return { skills, diagnostics }
}

async function loadSkillBody(filePath: string): Promise<string> {
  const raw = await readFile(filePath, 'utf8')
  return parseFrontmatter(raw).body.trim()
}

function pluginRuntimeInstructions(skill: SkillSummary): string[] {
  if (skill.sourceKind !== 'plugin' || !skill.pluginName) return []

  const parts = [
    `Plugin runtime: use exec_command to run plugin "${skill.pluginName}" commands and scripts. Enabled plugin bin directories are already on PATH.`
  ]
  const commands = skill.pluginCommands ?? []
  if (commands.length) {
    parts.push(
      'Available plugin commands:',
      ...commands.map(
        (command) => `- ${command.name}${command.description ? `: ${command.description}` : ''}`
      )
    )
  }
  const scripts = skill.pluginScripts ?? []
  if (scripts.length) {
    parts.push(
      'Available plugin scripts:',
      ...scripts.map(
        (script) => `- ${script.name}${script.description ? `: ${script.description}` : ''}`
      )
    )
  }
  parts.push(
    'Invoke commands through exec_command by name when they are on PATH. Invoke scripts with explicit paths or commands documented by the plugin skill.'
  )
  return parts
}

function isSkillVisibleForFeatureGates(skill: SkillSummary): boolean {
  if (skill.name === 'sop-creator') {
    return isFeatureGated('sopCreator')
  }
  return true
}

export async function listSkills(options: { cwd?: string } = {}): Promise<{
  skills: SkillSummary[]
  diagnostics: SkillDiagnostic[]
}> {
  const skills: SkillSummary[] = []
  const diagnostics: SkillDiagnostic[] = []
  const seenNames = new Map<string, SkillSummary>()
  const seenRealPaths = new Set<string>()

  for (const source of await resolveSkillSources(options)) {
    const loaded = await walkSkillsFromDir(source.rootPath, source, true)
    diagnostics.push(...loaded.diagnostics)

    for (const skill of loaded.skills) {
      if (!isSkillVisibleForFeatureGates(skill)) {
        continue
      }

      let realPath = skill.filePath
      try {
        realPath = await realpath(skill.filePath)
      } catch {
        // Keep the original path when realpath resolution fails.
      }

      if (seenRealPaths.has(realPath)) {
        continue
      }

      const winner = seenNames.get(skill.name)
      if (winner) {
        diagnostics.push({
          type: 'collision',
          message: `name "${skill.name}" collision`,
          path: skill.filePath,
          collision: {
            name: skill.name,
            winnerPath: winner.filePath,
            loserPath: skill.filePath
          }
        })
      } else {
        seenNames.set(skill.name, skill)
      }

      seenRealPaths.add(realPath)
      skills.push(skill)
    }
  }

  return { skills, diagnostics }
}

export async function deleteSkill(skillName: string): Promise<{ deleted: boolean }> {
  const pichuSkillsRoot = join(getDataRoot(), 'skills')
  const result = await listSkills()
  const skill = result.skills.find((s) => s.name === skillName && s.sourceKind === 'pichu')
  if (!skill) {
    throw new Error(`Owls skill "${skillName}" not found`)
  }

  const relativeSkillDir = relative(pichuSkillsRoot, skill.baseDir)
  if (!relativeSkillDir || relativeSkillDir.startsWith('..') || isAbsolute(relativeSkillDir)) {
    throw new Error('Can only delete skills from the Owls skills directory')
  }

  await rm(skill.baseDir, { recursive: true, force: true })
  return { deleted: true }
}

export async function readSkillContent(filePath: string): Promise<{ content: string }> {
  const result = await listSkills()
  const skill = result.skills.find((entry) => entry.filePath === filePath)

  if (!skill) {
    throw new Error('Skill not found')
  }

  return {
    content: await readFile(skill.filePath, 'utf8')
  }
}

export async function expandSkillPromptParts(
  text: string,
  parts: unknown,
  options: { cwd?: string } = {}
): Promise<string> {
  const normalizedParts = normalizeMessageParts(parts)
  const skillNames = normalizedParts
    .filter((part) => part.type === 'skill')
    .map((part) => part.target.qualifiedName ?? part.target.name)
    .filter(Boolean)
  if (skillNames.length === 0) return text

  const result = await listSkills({ cwd: options.cwd })
  const skills = skillNames.map((skillName) => findSkillByName(result.skills, skillName))
  if (skills.some((skill) => !skill)) return text

  try {
    const expandedSkills = (
      await Promise.all(
        skills.map((skill) => (skill ? expandSkillInstructions(skill) : Promise.resolve(null)))
      )
    ).filter((entry): entry is string => Boolean(entry))

    return [...expandedSkills, text.trim()].filter(Boolean).join('\n\n')
  } catch {
    return text
  }
}

function findSkillByName(skills: SkillSummary[], skillName: string): SkillSummary | undefined {
  return (
    skills.find((entry) => entry.qualifiedName === skillName) ??
    (() => {
      const matches = skills.filter((entry) => entry.name === skillName)
      return matches.length === 1 ? matches[0] : undefined
    })()
  )
}

async function expandSkillInstructions(skill: SkillSummary): Promise<string | null> {
  const body = await loadSkillBody(skill.filePath)
  if (!body) return null

  const parts = [
    `References are relative to ${skill.baseDir}.`,
    `If this skill mentions SKILL_DIR, use this absolute value: ${skill.baseDir}.`
  ]
  const runtimeInstructions = pluginRuntimeInstructions(skill)
  if (runtimeInstructions.length) {
    parts.push('', ...runtimeInstructions)
  }
  parts.push('', body)
  return parts.join('\n')
}
