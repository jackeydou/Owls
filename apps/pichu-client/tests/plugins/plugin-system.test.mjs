import assert from 'node:assert/strict'
import {
  chmodSync,
  cpSync,
  createWriteStream,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
import { tmpdir, userInfo } from 'node:os'
import { basename, dirname, isAbsolute, join, normalize } from 'node:path'
import { pipeline } from 'node:stream/promises'
import test from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { ZipFile } from 'yazl'

const PLUGIN_ROOT_VARIABLE = '$' + '{PLUGIN_ROOT}'
const PLUGIN_DATA_VARIABLE = '$' + '{PLUGIN_DATA}'

async function importSource(path) {
  return import(`${pathToFileURL(path).href}?ts=${Date.now()}`)
}

async function loadToolApprovalEngineForTest() {
  const moduleDir = mkdtempSync(join(tmpdir(), 'pichu-tool-approval-'))
  const storesDir = join(moduleDir, 'stores')
  const toolsDir = join(moduleDir, 'tools')
  mkdirSync(storesDir, { recursive: true })
  mkdirSync(toolsDir, { recursive: true })
  symlinkSync(
    new URL('../../node_modules', import.meta.url),
    join(moduleDir, 'node_modules'),
    'dir'
  )
  const files = [
    'tool-approval-engine.ts',
    'tool-approval-rules.ts',
    'shell-command-parser.ts',
    'shell-command-safety.ts'
  ]
  for (const file of files) {
    let source = readFileSync(new URL(`../../src/main/${file}`, import.meta.url), 'utf8')
    source = source
      .replaceAll('../shared/tool-approval.js', './tool-approval.ts')
      .replaceAll('./background-terminals.js', './background-terminals.ts')
      .replaceAll('./shell-command-parser.js', './shell-command-parser.ts')
      .replaceAll('./shell-command-safety.js', './shell-command-safety.ts')
      .replaceAll('./stores/tool-approval-store.js', './stores/tool-approval-store.ts')
      .replaceAll('./stores/tool-approval-rule-store.js', './stores/tool-approval-rule-store.ts')
      .replaceAll('./tool-auto-reviewer.js', './tool-auto-reviewer.ts')
      .replaceAll('./tool-approval-rules.js', './tool-approval-rules.ts')
      .replaceAll('./tools/pichu-bash-sandbox.js', './tools/pichu-bash-sandbox.ts')
    if (file === 'tool-approval-engine.ts') {
      source += "\nexport { __test } from './tool-auto-reviewer.ts'\n"
    }
    writeFileSync(join(moduleDir, file), source, 'utf8')
  }
  writeFileSync(
    join(moduleDir, 'background-terminals.ts'),
    `export function isKnownBackgroundTerminalPid(pid) {
  return globalThis.__pichuKnownBackgroundTerminalPidsForTest?.has(pid) ?? false
}
export function isKnownBackgroundTerminalPidForSession(pid) {
  return globalThis.__pichuKnownBackgroundTerminalPidsForTest?.has(pid) ?? false
}
`,
    'utf8'
  )
  writeFileSync(
    join(storesDir, 'tool-approval-store.ts'),
    `export function cancelPendingStoredToolApprovalRequestsForSession() { return 0 }
export function createToolApprovalRequest() {}
export function getStoredToolApprovalRequest() { return null }
export function listPendingToolApprovalRequestRows() { return [] }
export function resolveStoredToolApprovalRequest() { return null }
`,
    'utf8'
  )
  writeFileSync(
    join(storesDir, 'tool-approval-rule-store.ts'),
    `export function findMatchingToolApprovalRule(request) {
  return globalThis.__pichuToolApprovalRuleMatchForTest?.(request) ?? null
}

export function rememberToolApprovalRuleForRequest(request) {
  globalThis.__pichuRememberedToolApprovalRuleRequestsForTest ??= []
  globalThis.__pichuRememberedToolApprovalRuleRequestsForTest.push(request)
  return request.rememberRule ?? null
}
`,
    'utf8'
  )
  writeFileSync(
    join(toolsDir, 'pichu-bash-sandbox.ts'),
    `export function isPichuBashSandboxSupported() {
  return globalThis.__pichuBashSandboxSupportedForTest ?? true
}
`,
    'utf8'
  )
  writeFileSync(
    join(moduleDir, 'tool-auto-reviewer.ts'),
    `const autoReviewRequests = []
const defaultAutoReviewResult = { status: 'denied', riskLevel: 'high', rationale: 'auto review unavailable in tests' }
let autoReviewResult = defaultAutoReviewResult

export const __test = {
  autoReviewRequests,
  setAutoReviewResult(result) {
    autoReviewResult = result
  },
  reset() {
    autoReviewRequests.length = 0
    autoReviewResult = defaultAutoReviewResult
  }
}

export function summarizeAutoReviewAction(request) { return request.description }
export async function reviewToolApprovalRequest(request) {
  autoReviewRequests.push(request)
  return autoReviewResult
}
`,
    'utf8'
  )
  writeFileSync(
    join(moduleDir, 'tool-approval.ts'),
    readFileSync(new URL('../../src/shared/tool-approval.ts', import.meta.url), 'utf8'),
    'utf8'
  )
  return {
    moduleDir,
    approval: await importSource(join(moduleDir, 'tool-approval-engine.ts'))
  }
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

function writePluginHooks(pluginRoot, value) {
  const path = join(pluginRoot, 'com.pichu.app', 'hooks', 'hooks.json')
  mkdirSync(dirname(path), { recursive: true })
  writeJson(path, value)
}

function writeWorkspaceMarketplace(workspaceRoot, value) {
  const path = join(workspaceRoot, 'resources', 'plugins', 'marketplace.json')
  mkdirSync(dirname(path), { recursive: true })
  writeJson(path, value)
  return path
}

function setupTestHooksPluginWorkspace(workspaceRoot) {
  const fixtureRoot = fileURLToPath(new URL('../fixtures/test-hooks-plugin', import.meta.url))
  const pluginDest = join(workspaceRoot, 'resources', 'plugins', 'test-hooks-plugin')
  mkdirSync(dirname(pluginDest), { recursive: true })
  cpSync(fixtureRoot, pluginDest, { recursive: true })
  writeWorkspaceMarketplace(workspaceRoot, {
    name: 'test-hooks',
    interface: { displayName: 'Test Hooks' },
    plugins: [
      {
        name: 'test-hooks-plugin',
        source: {
          type: 'local',
          path: './plugins/test-hooks-plugin'
        },
        policy: {
          installation: 'AVAILABLE',
          authentication: 'ON_FIRST_USE'
        },
        category: 'Developer Tools'
      }
    ]
  })
}

function setTestResourcesPath(resourcesPath) {
  Object.defineProperty(process, 'resourcesPath', {
    value: resourcesPath,
    configurable: true,
    writable: true
  })
}

function appResourcesPath() {
  return fileURLToPath(new URL('../../resources', import.meta.url))
}

function createPlugin(root, name = 'repo-reviewer', options = {}) {
  mkdirSync(join(root, 'skills', 'review-pr'), { recursive: true })
  const manifest = {
    $schema: 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json',
    name,
    version: options.version ?? '1.0.0',
    description: 'Review pull requests.',
    extensions: {
      'com.pichu.app': {
        interface: {
          displayName: 'Repo Reviewer'
        }
      }
    }
  }
  if (options.includeHooks !== false) {
    mkdirSync(join(root, 'com.pichu.app', 'hooks'), { recursive: true })
    writeJson(join(root, 'com.pichu.app', 'hooks', 'hooks.json'), [])
  }
  writeJson(join(root, 'plugin.json'), manifest)
  writeFileSync(
    join(root, 'skills', 'review-pr', 'SKILL.md'),
    ['---', 'name: review-pr', 'description: Review a pull request.', '---', '', 'Review it.'].join(
      '\n'
    ),
    'utf8'
  )
}

async function writeZip(zipPath, configure) {
  const zip = new ZipFile()
  configure(zip)
  const writePromise = pipeline(zip.outputStream, createWriteStream(zipPath))
  zip.end()
  await writePromise
}

async function createPluginZip(sourceRoot, zipPath) {
  await writeZip(zipPath, (zip) => {
    const addDirectory = (directory, prefix = '') => {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const sourcePath = join(directory, entry.name)
        const archivePath = prefix ? `${prefix}/${entry.name}` : entry.name
        if (entry.isDirectory()) {
          addDirectory(sourcePath, archivePath)
        } else if (entry.isFile()) {
          zip.addFile(sourcePath, archivePath)
        }
      }
    }
    addDirectory(sourceRoot)
  })
}

async function loadPluginModulesForTest({ dataRoot, workspaceRoot }) {
  const moduleDir = mkdtempSync(join(tmpdir(), 'pichu-plugin-modules-'))
  globalThis.__pichuPluginTestSettings = new Map()
  setTestResourcesPath(join(workspaceRoot, 'resources'))
  symlinkSync(
    new URL('../../node_modules', import.meta.url),
    join(moduleDir, 'node_modules'),
    'dir'
  )
  const files = [
    'plugin-types.ts',
    'hooks/hook-types.ts',
    'hooks/hook-config-loader.ts',
    'hooks/hook-runner.ts',
    'plugin-auth-runner.ts',
    'plugin-exposure.ts',
    'plugin-source-digest.ts',
    'mcp-config-loader.ts',
    'manifest-loader.ts',
    'marketplace-loader.ts',
    'plugin-admin-local-dev.ts',
    'plugin-registry.ts',
    'plugin-validator.ts',
    'node-runtime.ts'
  ]

  for (const file of files) {
    const sourcePath = new URL(
      file === 'node-runtime.ts' ? `../../src/main/${file}` : `../../src/main/plugins/${file}`,
      import.meta.url
    )
    let source = readFileSync(sourcePath, 'utf8')
    source = source
      .replaceAll('./plugin-types.js', './plugin-types.ts')
      .replaceAll('./mcp-config-loader.js', './mcp-config-loader.ts')
      .replaceAll('./manifest-loader.js', './manifest-loader.ts')
      .replaceAll('./hooks/hook-config-loader.js', './hooks/hook-config-loader.ts')
      .replaceAll('./hooks/hook-runner.js', './hooks/hook-runner.ts')
      .replaceAll('./hook-types.js', './hook-types.ts')
      .replaceAll('../../settings-store.js', '../settings-store.ts')
      .replaceAll('../plugin-types.js', '../plugin-types.ts')
      .replaceAll('./plugin-registry.js', './plugin-registry.ts')
      .replaceAll('./plugin-exposure.js', './plugin-exposure.ts')
      .replaceAll('./plugin-source-digest.js', './plugin-source-digest.ts')
      .replaceAll('./mcp-runtime.js', './mcp-runtime.ts')
      .replaceAll('../plugin-registry.js', '../plugin-registry.ts')
      .replaceAll('./marketplace-loader.js', './marketplace-loader.ts')
      .replaceAll('./plugin-auth-runner.js', './plugin-auth-runner.ts')
      .replaceAll('./plugin-validator.js', './plugin-validator.ts')
      .replaceAll('../node-runtime.js', './node-runtime.ts')
      .replaceAll('../pichu-paths.js', './pichu-paths.ts')
      .replaceAll('../runtime-delivery/active-runtime.js', './active-runtime.ts')
      .replaceAll('../stores/settings-store.js', './settings-store.ts')
      .replaceAll('../settings-store.js', './settings-store.ts')
      .replaceAll('./runtime-delivery/active-runtime.js', './active-runtime.ts')
      .replaceAll('../../shared/plugin-admin.js', './plugin-admin.ts')
    mkdirSync(dirname(join(moduleDir, file)), { recursive: true })
    writeFileSync(join(moduleDir, file), source, 'utf8')
  }

  writeFileSync(
    join(moduleDir, 'mcp-runtime.ts'),
    [
      'export async function stopPluginMcpServersAsync() {}',
      'export async function disposePluginMcpRuntimeAsync() {}',
      ''
    ].join('\n'),
    'utf8'
  )
  writeFileSync(
    join(moduleDir, 'plugin-admin.ts'),
    readFileSync(new URL('../../src/shared/plugin-admin.ts', import.meta.url), 'utf8'),
    'utf8'
  )
  writeFileSync(
    join(moduleDir, 'env.ts'),
    [
      'export function removeUnsupportedNpmConfigEnv(env) { return env }',
      'export function withDefaultRuntimePackageRegistryEnv(env) { return env }',
      'export function withDefaultRuntimePackageManagerEnv(env) { return env }',
      ''
    ].join('\n'),
    'utf8'
  )
  writeFileSync(
    join(moduleDir, 'runtime-certs.ts'),
    'export function findDefaultRuntimeCaBundlePath() { return null }\n',
    'utf8'
  )
  writeFileSync(
    join(moduleDir, 'active-runtime.ts'),
    [
      'export function findActiveRuntimeNodePath() { return null }',
      'export function findActiveRuntimePythonPath() { return null }',
      'export function findActiveRuntimeRoot() { return globalThis.__pichuPluginTestRuntimeRoot ?? null }',
      'export function findActiveRuntimePathEntries() { return [] }',
      ''
    ].join('\n'),
    'utf8'
  )

  writeFileSync(
    join(moduleDir, 'pichu-paths.ts'),
    `export function getDataRoot() { return ${JSON.stringify(dataRoot)} }\n`,
    'utf8'
  )
  writeFileSync(
    join(moduleDir, 'settings-store.ts'),
    [
      'const settings = globalThis.__pichuPluginTestSettings ??= new Map()',
      'export function getStoredSetting(key) { return settings.get(key) }',
      'export function setStoredSetting(key, value) { settings.set(key, value) }',
      'export function getSettingsForRenderer() {',
      `  return { workingDirectory: ${JSON.stringify(workspaceRoot)} }`,
      '}'
    ].join('\n'),
    'utf8'
  )

  return {
    moduleDir,
    manifest: await importSource(join(moduleDir, 'manifest-loader.ts')),
    marketplace: await importSource(join(moduleDir, 'marketplace-loader.ts')),
    localDev: await importSource(join(moduleDir, 'plugin-admin-local-dev.ts')),
    registry: await importSource(join(moduleDir, 'plugin-registry.ts')),
    validator: await importSource(join(moduleDir, 'plugin-validator.ts')),
    authRunner: await importSource(join(moduleDir, 'plugin-auth-runner.ts')),
    settings: await importSource(join(moduleDir, 'settings-store.ts')),
    hookRunner: await importSource(join(moduleDir, 'hooks', 'hook-runner.ts'))
  }
}

async function loadMcpRuntimeForTest() {
  const moduleDir = mkdtempSync(join(tmpdir(), 'pichu-plugin-mcp-runtime-'))
  symlinkSync(
    new URL('../../node_modules', import.meta.url),
    join(moduleDir, 'node_modules'),
    'dir'
  )
  const source = readFileSync(
    new URL('../../src/main/plugins/mcp-runtime.ts', import.meta.url),
    'utf8'
  ).replaceAll('../tools/pichu-bash-sandbox.js', './pichu-bash-sandbox.ts')
  writeFileSync(join(moduleDir, 'mcp-runtime.ts'), source, 'utf8')
  writeFileSync(
    join(moduleDir, 'pichu-bash-sandbox.ts'),
    'export async function preparePichuSandboxedStdioCommand(options) { return { command: options.command, args: options.args } }\n',
    'utf8'
  )
  return {
    moduleDir,
    runtime: await importSource(join(moduleDir, 'mcp-runtime.ts'))
  }
}

async function loadPluginAssetProtocolForTest({ dataRoot, resourcesPath, dev = false }) {
  const moduleDir = mkdtempSync(join(tmpdir(), 'pichu-plugin-assets-'))
  const pluginModuleDir = join(moduleDir, 'src', 'main', 'plugins')
  const mainModuleDir = join(moduleDir, 'src', 'main')
  const sourcePath = new URL('../../src/main/plugins/plugin-asset-protocol.ts', import.meta.url)
  const source = readFileSync(sourcePath, 'utf8')
    .replace('../pichu-paths.js', '../pichu-paths.ts')
    .replace(
      'declare const __PICHU_DEV__: boolean',
      `const __PICHU_DEV__ = ${dev ? 'true' : 'false'}`
    )

  mkdirSync(pluginModuleDir, { recursive: true })
  writeFileSync(join(pluginModuleDir, 'plugin-asset-protocol.ts'), source, 'utf8')
  writeFileSync(
    join(mainModuleDir, 'pichu-paths.ts'),
    `export function getDataRoot() { return ${JSON.stringify(dataRoot)} }\n`,
    'utf8'
  )
  const originalResourcesPath = process.resourcesPath
  if (resourcesPath === undefined) {
    delete process.resourcesPath
  } else {
    setTestResourcesPath(resourcesPath)
  }
  try {
    return {
      moduleDir,
      protocol: await importSource(join(pluginModuleDir, 'plugin-asset-protocol.ts')),
      restore: () => {
        if (originalResourcesPath === undefined) {
          delete process.resourcesPath
        } else {
          process.resourcesPath = originalResourcesPath
        }
      }
    }
  } catch (error) {
    if (originalResourcesPath === undefined) {
      delete process.resourcesPath
    } else {
      process.resourcesPath = originalResourcesPath
    }
    throw error
  }
}

async function loadCodingToolsForTest(options = {}) {
  const moduleDir = mkdtempSync(join(tmpdir(), 'pichu-coding-tools-'))
  const dataRoot = options.dataRoot ?? join(moduleDir, 'data')
  symlinkSync(
    new URL('../../node_modules', import.meta.url),
    join(moduleDir, 'node_modules'),
    'dir'
  )

  const files = [
    { target: 'coding.ts', source: '../../src/main/tools/coding.ts' },
    { target: 'node-runtime.ts', source: '../../src/main/node-runtime.ts' }
  ]
  for (const file of files) {
    const sourcePath = new URL(file.source, import.meta.url)
    let source = readFileSync(sourcePath, 'utf8').replaceAll(
      '../node-runtime.js',
      './node-runtime.ts'
    )
    source = source
      .replaceAll('../background-terminals.js', './background-terminals.ts')
      .replaceAll('../env.js', './env.ts')
      .replaceAll('../pichu-paths.js', './pichu-paths.ts')
      .replaceAll('../runtime-certs.js', './runtime-certs.ts')
      .replaceAll('../runtime-delivery/active-runtime.js', './active-runtime.ts')
      .replaceAll('../stores/settings-store.js', './settings-store.ts')
      .replaceAll('./pichu-bash-sandbox.js', './pichu-bash-sandbox.ts')
    writeFileSync(join(moduleDir, file.target), source, 'utf8')
  }
  writeFileSync(
    join(moduleDir, 'background-terminals.ts'),
    [
      'export async function pollBackgroundTerminalOutput() { return null }',
      'export async function readBackgroundTerminalOutput() { return null }',
      'export function releaseRetainedBackgroundTerminal() {}',
      'export async function writeBackgroundTerminalStdin() { return null }',
      ''
    ].join('\n'),
    'utf8'
  )
  writeFileSync(
    join(moduleDir, 'env.ts'),
    [
      'export function removeUnsupportedNpmConfigEnv(env) { return env }',
      'export function withDefaultRuntimePackageRegistryEnv(env) { return env }',
      'export function withDefaultRuntimePackageManagerEnv(env) { return env }',
      ''
    ].join('\n'),
    'utf8'
  )
  writeFileSync(
    join(moduleDir, 'runtime-certs.ts'),
    'export function findDefaultRuntimeCaBundlePath() { return null }\n',
    'utf8'
  )
  writeFileSync(
    join(moduleDir, 'active-runtime.ts'),
    [
      `export function findActiveRuntimeNodePath() { return ${JSON.stringify(options.runtimeNodePath ?? null)} }`,
      `export function findActiveRuntimePythonPath() { return ${JSON.stringify(options.runtimePythonPath ?? null)} }`,
      `export function findActiveRuntimeRoot() { return ${JSON.stringify(options.runtimeRoot ?? null)} }`,
      `export function findActiveRuntimePathEntries() { return ${JSON.stringify(options.runtimePathEntries ?? [])} }`,
      ''
    ].join('\n'),
    'utf8'
  )
  writeFileSync(
    join(moduleDir, 'pichu-paths.ts'),
    `export function getDataRoot() { return ${JSON.stringify(dataRoot)} }\n`,
    'utf8'
  )
  writeFileSync(
    join(moduleDir, 'settings-store.ts'),
    "export function getAgentTrustProfile() { return 'full' }\n",
    'utf8'
  )
  writeFileSync(
    join(moduleDir, 'pichu-bash-sandbox.ts'),
    [
      "import { spawn } from 'node:child_process'",
      "import { createLocalBashOperations } from '@earendil-works/pi-coding-agent'",
      'export function createPichuSandboxedBashOperations(params = {}) {',
      '  return createLocalBashOperations({ shellPath: params.shellPath })',
      '}',
      'export function runPichuBashSandboxContext(_toolCallId, fn) {',
      '  return fn()',
      '}',
      'export async function runPichuManagedExecCommand(options) {',
      '  return await new Promise((resolve, reject) => {',
      "    const shellPath = options.shellPath ?? process.env.SHELL ?? '/bin/bash'",
      "    const child = spawn(shellPath, ['-c', options.command], {",
      '      cwd: options.cwd,',
      '      env: options.env,',
      "      stdio: ['ignore', 'pipe', 'pipe']",
      '    })',
      "    let output = ''",
      "    child.stdout.on('data', (chunk) => { output += chunk.toString('utf8') })",
      "    child.stderr.on('data', (chunk) => { output += chunk.toString('utf8') })",
      "    child.on('error', reject)",
      '    child.on("close", (exitCode) => {',
      '      const maxOutputChars = options.maxOutputChars ?? output.length',
      '      resolve({',
      '        sessionId: null,',
      '        output: output.length > maxOutputChars ? output.slice(-maxOutputChars) : output,',
      '        exitCode',
      '      })',
      '    })',
      '  })',
      '}',
      ''
    ].join('\n'),
    'utf8'
  )

  return {
    moduleDir,
    codingTools: await importSource(join(moduleDir, 'coding.ts'))
  }
}

async function loadSkillLoaderForTest({ dataRoot, pluginSkillRoot, workingDirectory = '' }) {
  const moduleDir = mkdtempSync(join(tmpdir(), 'pichu-skill-loader-'))
  const sourcePath = new URL('../../src/main/skill-loader.ts', import.meta.url)
  const source = readFileSync(sourcePath, 'utf8')
    .replace('../shared/message-parts.js', './message-parts.ts')
    .replace('./feature-gates/local-feature-gate-service.js', './feature-gate.ts')
    .replace('./pichu-paths.js', './pichu-paths.ts')
    .replace('./stores/settings-store.js', './settings-store.ts')
    .replace('./plugins/plugin-registry.js', './plugin-registry.ts')
    .replace('./feature-gates/local-feature-gate-service.js', './local-feature-gate-service.ts')
  writeFileSync(join(moduleDir, 'skill-loader.ts'), source, 'utf8')
  writeFileSync(
    join(moduleDir, 'local-feature-gate-service.ts'),
    'export function isFeatureGated() { return true }\n',
    'utf8'
  )
  writeFileSync(
    join(moduleDir, 'message-parts.ts'),
    readFileSync(new URL('../../src/shared/message-parts.ts', import.meta.url), 'utf8'),
    'utf8'
  )
  writeFileSync(
    join(moduleDir, 'feature-gate.ts'),
    'export function isFeatureGated() { return false }\n',
    'utf8'
  )
  writeFileSync(
    join(moduleDir, 'pichu-paths.ts'),
    `export function getDataRoot() { return ${JSON.stringify(dataRoot)} }\n`,
    'utf8'
  )
  writeFileSync(
    join(moduleDir, 'settings-store.ts'),
    [
      'export function getSettingsForRenderer() {',
      `  return { enableAgentsSkills: false, enableClaudeSkills: false, workingDirectory: ${JSON.stringify(workingDirectory)} }`,
      '}'
    ].join('\n'),
    'utf8'
  )
  writeFileSync(
    join(moduleDir, 'plugin-registry.ts'),
    [
      'export async function getEnabledPluginSkillSourcesAsync() {',
      '  return [{',
      "    pluginId: 'repo-reviewer',",
      "    pluginName: 'repo-reviewer',",
      "    pluginVersion: '1.0.0',",
      `    pluginRoot: ${JSON.stringify(pluginSkillRoot)},`,
      `    rootPath: ${JSON.stringify(pluginSkillRoot)},`,
      "    label: 'repo-reviewer@1.0.0',",
      "    scripts: [{ name: 'reviewer-script', entry: './scripts/reviewer.js', description: 'Review script.' }],",
      "    commands: [{ name: 'reviewer', entry: './bin/reviewer.js', description: 'Review helper.' }]",
      '  }]',
      '}'
    ].join('\n'),
    'utf8'
  )

  try {
    return await importSource(join(moduleDir, 'skill-loader.ts'))
  } finally {
    rmSync(moduleDir, { recursive: true, force: true })
  }
}

test('loadPluginManifest discovers Agent Plugins fixed component locations', async () => {
  const dataRoot = mkdtempSync(join(tmpdir(), 'pichu-plugin-data-'))
  const workspaceRoot = mkdtempSync(join(tmpdir(), 'pichu-plugin-workspace-'))
  const root = mkdtempSync(join(tmpdir(), 'pichu-plugin-manifest-'))
  let moduleDir = null
  try {
    createPlugin(root)
    const modules = await loadPluginModulesForTest({ dataRoot, workspaceRoot })
    moduleDir = modules.moduleDir
    const loaded = await modules.manifest.loadPluginManifestAsync(root)

    assert.equal(loaded.manifest.name, 'repo-reviewer')
    assert.equal(
      loaded.manifest.schema,
      'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json'
    )
    assert.equal(loaded.manifest.skills, './skills')
    assert.equal(loaded.manifest.hooks, './com.pichu.app/hooks/hooks.json')
    assert.equal(loaded.manifest.hookDeclarations.length, 0)
    assert.equal(loaded.diagnostics.length, 0)
  } finally {
    rmSync(dataRoot, { recursive: true, force: true })
    rmSync(workspaceRoot, { recursive: true, force: true })
    rmSync(root, { recursive: true, force: true })
    if (moduleDir) {
      rmSync(moduleDir, { recursive: true, force: true })
    }
  }
})

test('loadPluginManifest parses Agent Plugins MCP servers with isolated entry failures', async () => {
  const dataRoot = mkdtempSync(join(tmpdir(), 'pichu-plugin-data-'))
  const workspaceRoot = mkdtempSync(join(tmpdir(), 'pichu-plugin-workspace-'))
  const root = mkdtempSync(join(tmpdir(), 'pichu-plugin-mcp-'))
  let moduleDir = null
  try {
    createPlugin(root, 'mcp-plugin', { includeHooks: false })
    writeJson(join(root, 'mcp.json'), {
      $schema: 'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json',
      mcpServers: {
        local: {
          type: 'stdio',
          command: './bin/server',
          args: ['--data', `${PLUGIN_DATA_VARIABLE}/state`],
          cwd: PLUGIN_ROOT_VARIABLE
        },
        remote: {
          type: 'streamable-http',
          url: 'https://example.com/mcp',
          headers: { 'X-Client': 'pichu' }
        },
        invalid: {
          type: 'stdio',
          command: '/bin/absolute-is-not-portable'
        }
      }
    })

    const modules = await loadPluginModulesForTest({ dataRoot, workspaceRoot })
    moduleDir = modules.moduleDir
    const loaded = await modules.manifest.loadPluginManifestAsync(root)
    const validation = await modules.validator.validatePluginPackageAsync(root)

    assert.equal(loaded.manifest.mcpServers, './mcp.json')
    assert.deepEqual(Object.keys(loaded.manifest.mcp.servers), ['local', 'remote'])
    assert.equal(loaded.manifest.mcp.servers.local.type, 'stdio')
    assert.equal(loaded.manifest.mcp.servers.remote.type, 'streamable-http')
    assert.equal(
      loaded.diagnostics.some((diagnostic) => diagnostic.path === 'mcpServers.invalid.command'),
      true
    )
    assert.equal(validation.ok, true)
  } finally {
    rmSync(dataRoot, { recursive: true, force: true })
    rmSync(workspaceRoot, { recursive: true, force: true })
    rmSync(root, { recursive: true, force: true })
    if (moduleDir) rmSync(moduleDir, { recursive: true, force: true })
  }
})

test('MCP runtime exposes stdio tools and injects isolated plugin paths', async () => {
  const pluginRoot = mkdtempSync(join(tmpdir(), 'pichu-plugin-mcp-server-'))
  const pluginDataRoot = join(pluginRoot, 'data')
  let moduleDir = null
  try {
    symlinkSync(
      new URL('../../node_modules', import.meta.url),
      join(pluginRoot, 'node_modules'),
      'dir'
    )
    const serverPath = join(pluginRoot, 'server.mjs')
    writeFileSync(
      serverPath,
      [
        '#!/usr/bin/env node',
        "import { Server } from '@modelcontextprotocol/sdk/server/index.js'",
        "import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'",
        "import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'",
        "const server = new Server({ name: 'fixture', version: '1.0.0' }, { capabilities: { tools: {} } })",
        "server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [{ name: 'echo', description: 'Echo paths', inputSchema: { type: 'object', properties: { value: { type: 'string' } } } }] }))",
        "server.setRequestHandler(CallToolRequestSchema, async (request) => ({ content: [{ type: 'text', text: JSON.stringify({ value: request.params.arguments?.value, root: process.env.PLUGIN_ROOT, data: process.env.PLUGIN_DATA, setting: process.env.TEST_SETTING, arg: process.argv[2] }) }] }))",
        'await server.connect(new StdioServerTransport())',
        ''
      ].join('\n'),
      'utf8'
    )
    chmodSync(serverPath, 0o755)
    const loaded = await loadMcpRuntimeForTest()
    moduleDir = loaded.moduleDir
    const descriptor = {
      pluginId: 'demo.plugin',
      pluginName: 'demo.plugin',
      pluginVersion: '1.0.0',
      pluginRoot,
      pluginDataRoot,
      serverName: 'local-server',
      server: {
        type: 'stdio',
        command: './server.mjs',
        args: [`${PLUGIN_DATA_VARIABLE}/argument`],
        env: {
          TEST_SETTING: `configured:${PLUGIN_ROOT_VARIABLE}`,
          PLUGIN_ROOT: '/must-not-win'
        }
      }
    }

    const tools = await loaded.runtime.createEnabledPluginMcpToolsAsync([descriptor])
    assert.equal(tools.length, 1)
    assert.equal(tools[0].name, 'mcp__demo_2e_plugin__local_2d_server__echo')
    const result = await tools[0].execute('tool-1', { value: 'hello' })
    const payload = JSON.parse(result.content[0].text)
    assert.deepEqual(payload, {
      value: 'hello',
      root: pluginRoot,
      data: pluginDataRoot,
      setting: `configured:${pluginRoot}`,
      arg: `${pluginDataRoot}/argument`
    })
    await loaded.runtime.stopPluginMcpServersAsync('demo.plugin')
  } finally {
    if (moduleDir) rmSync(moduleDir, { recursive: true, force: true })
    rmSync(pluginRoot, { recursive: true, force: true })
  }
})

test('validatePluginPackage rejects legacy manifests without the Agent Plugins schema', async () => {
  const dataRoot = mkdtempSync(join(tmpdir(), 'pichu-plugin-data-'))
  const workspaceRoot = mkdtempSync(join(tmpdir(), 'pichu-plugin-workspace-'))
  const root = mkdtempSync(join(tmpdir(), 'pichu-plugin-legacy-'))
  let moduleDir = null
  try {
    writeJson(join(root, 'plugin.json'), {
      schemaVersion: '1.0',
      name: 'legacy-plugin',
      skills: './skills'
    })
    const modules = await loadPluginModulesForTest({ dataRoot, workspaceRoot })
    moduleDir = modules.moduleDir
    const validation = await modules.validator.validatePluginPackageAsync(root)

    assert.equal(validation.ok, false)
    assert.equal(
      validation.diagnostics.some((diagnostic) => diagnostic.path === '$schema'),
      true
    )
  } finally {
    rmSync(dataRoot, { recursive: true, force: true })
    rmSync(workspaceRoot, { recursive: true, force: true })
    rmSync(root, { recursive: true, force: true })
    if (moduleDir) rmSync(moduleDir, { recursive: true, force: true })
  }
})

test('loadPluginManifest normalizes plugin runtime requirements', async () => {
  const dataRoot = mkdtempSync(join(tmpdir(), 'pichu-plugin-data-'))
  const workspaceRoot = mkdtempSync(join(tmpdir(), 'pichu-plugin-workspace-'))
  const root = mkdtempSync(join(tmpdir(), 'pichu-plugin-runtime-'))
  let moduleDir = null
  try {
    createPlugin(root, 'runtime-plugin', { includeHooks: false })
    const manifestPath = join(root, 'plugin.json')
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    manifest.extensions['com.pichu.app'].runtimeRequirements = {
      node: { version: '>=24', reason: 'Runs JS builders.' },
      python: { version: '>=3.12' },
      nodePackages: [{ name: '@oai/artifact-tool', version: '2.7.6', reason: 'PPTX authoring.' }],
      pythonPackages: [{ name: 'pillow', version: '12.2.0' }],
      nativePackages: [
        {
          name: 'poppler',
          version: '26.05.0',
          commands: ['pdfinfo', 'pdftoppm']
        }
      ],
      capabilities: ['pptx.render']
    }
    writeJson(manifestPath, manifest)

    const modules = await loadPluginModulesForTest({ dataRoot, workspaceRoot })
    moduleDir = modules.moduleDir
    const loaded = await modules.manifest.loadPluginManifestAsync(root)

    assert.deepEqual(
      loaded.manifest.runtimeRequirements,
      manifest.extensions['com.pichu.app'].runtimeRequirements
    )
    assert.equal(loaded.diagnostics.length, 0)
  } finally {
    rmSync(dataRoot, { recursive: true, force: true })
    rmSync(workspaceRoot, { recursive: true, force: true })
    rmSync(root, { recursive: true, force: true })
    if (moduleDir) {
      rmSync(moduleDir, { recursive: true, force: true })
    }
  }
})

test('loadPluginManifest parses agent hook config files into derived declarations', async () => {
  const dataRoot = mkdtempSync(join(tmpdir(), 'pichu-plugin-data-'))
  const workspaceRoot = mkdtempSync(join(tmpdir(), 'pichu-plugin-workspace-'))
  const root = mkdtempSync(join(tmpdir(), 'pichu-plugin-hooks-'))
  let moduleDir = null
  try {
    createPlugin(root, 'repo-reviewer', { includeHooks: false })
    mkdirSync(join(root, 'hooks'), { recursive: true })
    writePluginHooks(root, {
      hooks: {
        PreToolUse: [
          {
            matcher: 'exec_command',
            hooks: [
              {
                type: 'command',
                command: 'python3 ./hooks/pre_tool_use.py',
                timeout: 30,
                statusMessage: 'Checking command'
              }
            ]
          }
        ],
        Stop: [
          {
            matcher: '*',
            hooks: [
              {
                type: 'command',
                command: 'node ./hooks/stop.js'
              }
            ]
          }
        ]
      }
    })
    const manifestPath = join(root, 'plugin.json')
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    writeJson(manifestPath, manifest)

    const modules = await loadPluginModulesForTest({ dataRoot, workspaceRoot })
    moduleDir = modules.moduleDir
    const loaded = await modules.manifest.loadPluginManifestAsync(root)

    assert.equal(loaded.diagnostics.length, 0)
    assert.equal(loaded.manifest.hookDeclarations.length, 1)
    assert.equal(loaded.manifest.hookDeclarations[0].source.type, 'path')
    assert.equal(
      loaded.manifest.hookDeclarations[0].source.path,
      './com.pichu.app/hooks/hooks.json'
    )
    assert.equal(loaded.manifest.hookDeclarations[0].matcherGroupCount, 2)
    assert.equal(loaded.manifest.hookDeclarations[0].commandCount, 2)
    assert.deepEqual(
      loaded.manifest.hookDeclarations[0].events.map((event) => event.event),
      ['PreToolUse', 'Stop']
    )
  } finally {
    rmSync(dataRoot, { recursive: true, force: true })
    rmSync(workspaceRoot, { recursive: true, force: true })
    rmSync(root, { recursive: true, force: true })
    if (moduleDir) {
      rmSync(moduleDir, { recursive: true, force: true })
    }
  }
})

test('loadPluginManifest discovers Owls namespaced agent hooks', async () => {
  const dataRoot = mkdtempSync(join(tmpdir(), 'pichu-plugin-data-'))
  const workspaceRoot = mkdtempSync(join(tmpdir(), 'pichu-plugin-workspace-'))
  const root = mkdtempSync(join(tmpdir(), 'pichu-plugin-default-hooks-'))
  let moduleDir = null
  try {
    createPlugin(root, 'repo-reviewer', { includeHooks: false })
    mkdirSync(join(root, 'hooks'), { recursive: true })
    writePluginHooks(root, {
      hooks: {
        UserPromptSubmit: [
          {
            hooks: [
              {
                type: 'command',
                command: 'node ./hooks/prompt.js'
              }
            ]
          }
        ]
      }
    })

    const modules = await loadPluginModulesForTest({ dataRoot, workspaceRoot })
    moduleDir = modules.moduleDir
    const loaded = await modules.manifest.loadPluginManifestAsync(root)

    assert.equal(loaded.manifest.hooks, './com.pichu.app/hooks/hooks.json')
    assert.equal(loaded.manifest.hookDeclarations.length, 1)
    assert.equal(loaded.manifest.hookDeclarations[0].source.type, 'path')
    assert.equal(
      loaded.manifest.hookDeclarations[0].source.path,
      './com.pichu.app/hooks/hooks.json'
    )
    assert.equal(loaded.manifest.hookDeclarations[0].commandCount, 1)
  } finally {
    rmSync(dataRoot, { recursive: true, force: true })
    rmSync(workspaceRoot, { recursive: true, force: true })
    rmSync(root, { recursive: true, force: true })
    if (moduleDir) {
      rmSync(moduleDir, { recursive: true, force: true })
    }
  }
})

test('loadPluginManifest ignores legacy inline agent hook fields', async () => {
  const dataRoot = mkdtempSync(join(tmpdir(), 'pichu-plugin-data-'))
  const workspaceRoot = mkdtempSync(join(tmpdir(), 'pichu-plugin-workspace-'))
  const root = mkdtempSync(join(tmpdir(), 'pichu-plugin-inline-hooks-'))
  let moduleDir = null
  try {
    createPlugin(root, 'repo-reviewer', { includeHooks: false })
    const manifestPath = join(root, 'plugin.json')
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    manifest.hooks = [
      {
        hooks: {
          SessionStart: [
            {
              matcher: 'startup',
              hooks: [{ type: 'command', command: 'node ./hooks/start.js' }]
            }
          ]
        }
      },
      {
        hooks: {
          PostToolUse: [
            {
              matcher: 'apply_patch',
              hooks: [{ type: 'command', command: 'node ./hooks/post_tool.js' }]
            }
          ]
        }
      }
    ]
    writeJson(manifestPath, manifest)

    const modules = await loadPluginModulesForTest({ dataRoot, workspaceRoot })
    moduleDir = modules.moduleDir
    const loaded = await modules.manifest.loadPluginManifestAsync(root)

    assert.equal(loaded.manifest.hooks, undefined)
    assert.equal(loaded.manifest.hookDeclarations.length, 0)
    assert.equal(
      loaded.diagnostics.some((diagnostic) => diagnostic.path === 'hooks'),
      true
    )
  } finally {
    rmSync(dataRoot, { recursive: true, force: true })
    rmSync(workspaceRoot, { recursive: true, force: true })
    rmSync(root, { recursive: true, force: true })
    if (moduleDir) {
      rmSync(moduleDir, { recursive: true, force: true })
    }
  }
})

test('Agent hook runner executes enabled plugin hooks', async () => {
  const dataRoot = mkdtempSync(join(tmpdir(), 'pichu-plugin-data-'))
  const workspaceRoot = mkdtempSync(join(tmpdir(), 'pichu-plugin-workspace-'))
  let moduleDir = null

  try {
    const pluginRoot = join(workspaceRoot, 'resources', 'plugins', 'repo-reviewer')
    createPlugin(pluginRoot, 'repo-reviewer', { includeHooks: false })
    mkdirSync(join(pluginRoot, 'hooks'), { recursive: true })
    writeFileSync(
      join(pluginRoot, 'hooks', 'prompt.js'),
      [
        'let input = ""',
        'process.stdin.on("data", (chunk) => { input += chunk })',
        'process.stdin.on("end", () => {',
        '  const payload = JSON.parse(input)',
        '  process.stdout.write(JSON.stringify({',
        '    hookSpecificOutput: {',
        '      hookEventName: "UserPromptSubmit",',
        '      additionalContext: "prompt:" + payload.prompt',
        '    }',
        '  }))',
        '})'
      ].join('\n'),
      'utf8'
    )
    writePluginHooks(pluginRoot, {
      hooks: {
        UserPromptSubmit: [
          {
            hooks: [{ type: 'command', command: 'node ./hooks/prompt.js' }]
          }
        ]
      }
    })
    const manifestPath = join(pluginRoot, 'plugin.json')
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    writeJson(manifestPath, manifest)
    writeWorkspaceMarketplace(workspaceRoot, {
      name: 'local-test',
      plugins: [
        {
          name: 'repo-reviewer',
          source: {
            source: 'local',
            path: './plugins/repo-reviewer'
          },
          policy: {
            installation: 'AVAILABLE',
            authentication: 'ON_INSTALL'
          }
        }
      ]
    })

    const modules = await loadPluginModulesForTest({ dataRoot, workspaceRoot })
    moduleDir = modules.moduleDir
    await modules.registry.installPlugin({
      marketplaceName: 'local-test',
      pluginName: 'repo-reviewer'
    })

    const enabledDecision = await modules.hookRunner.runAgentHookEvent({
      eventName: 'UserPromptSubmit',
      context: {
        sessionId: 'session-1',
        cwd: workspaceRoot,
        model: 'test-model'
      },
      extraInput: { prompt: 'hello' }
    })
    assert.deepEqual(enabledDecision.additionalContext, ['prompt:hello'])
  } finally {
    rmSync(dataRoot, { recursive: true, force: true })
    rmSync(workspaceRoot, { recursive: true, force: true })
    if (moduleDir) {
      rmSync(moduleDir, { recursive: true, force: true })
    }
  }
})

test('Agent hook runner uses the current user login shell', async () => {
  const dataRoot = mkdtempSync(join(tmpdir(), 'pichu-plugin-data-'))
  const workspaceRoot = mkdtempSync(join(tmpdir(), 'pichu-plugin-workspace-'))
  let moduleDir = null

  try {
    const modules = await loadPluginModulesForTest({ dataRoot, workspaceRoot })
    moduleDir = modules.moduleDir
    const shell = userInfo().shell?.trim()
    assert.equal(
      modules.hookRunner.getDefaultHookShell(),
      shell && isAbsolute(shell) ? shell : '/bin/sh'
    )
  } finally {
    rmSync(dataRoot, { recursive: true, force: true })
    rmSync(workspaceRoot, { recursive: true, force: true })
    if (moduleDir) {
      rmSync(moduleDir, { recursive: true, force: true })
    }
  }
})

test('Agent hook runner maps exit 2 to prompt block and tool denial', async () => {
  const dataRoot = mkdtempSync(join(tmpdir(), 'pichu-plugin-data-'))
  const workspaceRoot = mkdtempSync(join(tmpdir(), 'pichu-plugin-workspace-'))
  let moduleDir = null

  try {
    const pluginRoot = join(workspaceRoot, 'resources', 'plugins', 'repo-reviewer')
    createPlugin(pluginRoot, 'repo-reviewer', { includeHooks: false })
    mkdirSync(join(pluginRoot, 'hooks'), { recursive: true })
    writeFileSync(
      join(pluginRoot, 'hooks', 'block.js'),
      'process.stderr.write("blocked by hook"); process.exit(2)\n',
      'utf8'
    )
    writePluginHooks(pluginRoot, {
      hooks: {
        UserPromptSubmit: [
          {
            hooks: [{ type: 'command', command: 'node ./hooks/block.js' }]
          }
        ],
        PreToolUse: [
          {
            matcher: 'exec_command',
            hooks: [{ type: 'command', command: 'node ./hooks/block.js' }]
          }
        ],
        PostToolUse: [
          {
            matcher: 'exec_command',
            hooks: [{ type: 'command', command: 'node ./hooks/block.js' }]
          }
        ]
      }
    })
    const manifestPath = join(pluginRoot, 'plugin.json')
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    writeJson(manifestPath, manifest)
    writeWorkspaceMarketplace(workspaceRoot, {
      name: 'local-test',
      plugins: [
        {
          name: 'repo-reviewer',
          source: {
            source: 'local',
            path: './plugins/repo-reviewer'
          },
          policy: {
            installation: 'AVAILABLE',
            authentication: 'ON_FIRST_USE'
          }
        }
      ]
    })

    const modules = await loadPluginModulesForTest({ dataRoot, workspaceRoot })
    moduleDir = modules.moduleDir
    await modules.registry.installPlugin({
      marketplaceName: 'local-test',
      pluginName: 'repo-reviewer'
    })

    const promptDecision = await modules.hookRunner.runAgentHookEvent({
      eventName: 'UserPromptSubmit',
      context: {
        sessionId: 'session-1',
        cwd: workspaceRoot,
        model: 'test-model'
      },
      extraInput: { prompt: 'hello' }
    })
    assert.equal(promptDecision.blockReason, 'blocked by hook')

    const preToolDecision = await modules.hookRunner.runPreToolUseHooks({
      context: {
        sessionId: 'session-1',
        cwd: workspaceRoot,
        model: 'test-model'
      },
      toolName: 'exec_command',
      toolUseId: 'tool-1',
      toolInput: { cmd: 'date' }
    })
    assert.deepEqual(preToolDecision, { block: true, reason: 'blocked by hook' })

    const postToolDecision = await modules.hookRunner.runPostToolUseHooks({
      context: {
        sessionId: 'session-1',
        cwd: workspaceRoot,
        model: 'test-model'
      },
      toolName: 'exec_command',
      toolUseId: 'tool-1',
      toolInput: { cmd: 'date' },
      toolResponse: { content: [{ type: 'text', text: 'original' }], details: {} },
      isError: false
    })
    assert.equal(postToolDecision.isError, true)
    assert.deepEqual(postToolDecision.content, [{ type: 'text', text: 'blocked by hook' }])
  } finally {
    rmSync(dataRoot, { recursive: true, force: true })
    rmSync(workspaceRoot, { recursive: true, force: true })
    if (moduleDir) {
      rmSync(moduleDir, { recursive: true, force: true })
    }
  }
})

test('Agent PermissionRequest hooks aggregate decisions before default approval', async () => {
  const dataRoot = mkdtempSync(join(tmpdir(), 'pichu-plugin-data-'))
  const workspaceRoot = mkdtempSync(join(tmpdir(), 'pichu-plugin-workspace-'))
  let moduleDir = null

  try {
    const pluginRoot = join(workspaceRoot, 'resources', 'plugins', 'repo-reviewer')
    createPlugin(pluginRoot, 'repo-reviewer', { includeHooks: false })
    mkdirSync(join(pluginRoot, 'hooks'), { recursive: true })
    writeFileSync(
      join(pluginRoot, 'hooks', 'allow.js'),
      [
        'let input = ""',
        'process.stdin.on("data", (chunk) => { input += chunk })',
        'process.stdin.on("end", () => {',
        '  const payload = JSON.parse(input)',
        '  if (payload.tool_input.description !== "Needs approval") process.exit(1)',
        '  process.stdout.write(JSON.stringify({',
        '    hookSpecificOutput: { decision: { behavior: "allow" } }',
        '  }))',
        '})'
      ].join('\n'),
      'utf8'
    )
    writeFileSync(
      join(pluginRoot, 'hooks', 'deny.js'),
      [
        'process.stdout.write(JSON.stringify({',
        '  hookSpecificOutput: { decision: { behavior: "deny", message: "denied by hook" } }',
        '}))'
      ].join('\n'),
      'utf8'
    )
    writeFileSync(join(pluginRoot, 'hooks', 'plain.js'), 'process.stdout.write("allow")\n', 'utf8')
    writeFileSync(
      join(pluginRoot, 'hooks', 'mutate.js'),
      'process.stdout.write(JSON.stringify({ hookSpecificOutput: { updatedPermissions: {} } }))\n',
      'utf8'
    )
    writePluginHooks(pluginRoot, {
      hooks: {
        PermissionRequest: [
          {
            matcher: 'allow_tool',
            hooks: [{ type: 'command', command: 'node ./hooks/allow.js' }]
          },
          {
            matcher: 'both_tool',
            hooks: [{ type: 'command', command: 'node ./hooks/allow.js' }]
          },
          {
            matcher: 'both_tool',
            hooks: [{ type: 'command', command: 'node ./hooks/deny.js' }]
          },
          {
            matcher: 'deny_tool',
            hooks: [{ type: 'command', command: 'node ./hooks/deny.js' }]
          },
          {
            matcher: 'plain_tool',
            hooks: [{ type: 'command', command: 'node ./hooks/plain.js' }]
          },
          {
            matcher: 'mutate_tool',
            hooks: [{ type: 'command', command: 'node ./hooks/mutate.js' }]
          },
          {
            matcher: 'Edit',
            hooks: [{ type: 'command', command: 'node ./hooks/allow.js' }]
          }
        ]
      }
    })
    const manifestPath = join(pluginRoot, 'plugin.json')
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    writeJson(manifestPath, manifest)
    writeWorkspaceMarketplace(workspaceRoot, {
      name: 'local-test',
      plugins: [
        {
          name: 'repo-reviewer',
          source: {
            source: 'local',
            path: './plugins/repo-reviewer'
          },
          policy: {
            installation: 'AVAILABLE',
            authentication: 'ON_INSTALL'
          }
        }
      ]
    })

    const modules = await loadPluginModulesForTest({ dataRoot, workspaceRoot })
    moduleDir = modules.moduleDir
    await modules.registry.installPlugin({
      marketplaceName: 'local-test',
      pluginName: 'repo-reviewer'
    })

    const context = {
      sessionId: 'session-1',
      cwd: workspaceRoot,
      model: 'test-model'
    }
    const base = {
      context,
      toolUseId: 'tool-1',
      toolInput: { cmd: 'date' },
      description: 'Needs approval'
    }

    assert.deepEqual(
      await modules.hookRunner.runPermissionRequestHooks({
        ...base,
        toolName: 'allow_tool'
      }),
      { behavior: 'allow' }
    )
    assert.deepEqual(
      await modules.hookRunner.runPermissionRequestHooks({
        ...base,
        toolName: 'deny_tool'
      }),
      { behavior: 'deny', reason: 'denied by hook' }
    )
    assert.deepEqual(
      await modules.hookRunner.runPermissionRequestHooks({
        ...base,
        toolName: 'both_tool'
      }),
      { behavior: 'deny', reason: 'denied by hook' }
    )
    assert.deepEqual(
      await modules.hookRunner.runPermissionRequestHooks({
        ...base,
        toolName: 'plain_tool'
      }),
      { behavior: 'ask' }
    )
    assert.deepEqual(
      await modules.hookRunner.runPermissionRequestHooks({
        ...base,
        toolName: 'unmatched_tool'
      }),
      { behavior: 'ask' }
    )
    assert.deepEqual(
      await modules.hookRunner.runPermissionRequestHooks({
        ...base,
        toolName: 'mutate_tool'
      }),
      {
        behavior: 'deny',
        reason:
          'PermissionRequest hook returned unsupported permission mutation fields and was denied.'
      }
    )
    assert.deepEqual(
      await modules.hookRunner.runPermissionRequestHooks({
        ...base,
        toolName: 'apply_patch',
        matcherValues: ['apply_patch', 'Edit', 'Write']
      }),
      { behavior: 'allow' }
    )
  } finally {
    rmSync(dataRoot, { recursive: true, force: true })
    rmSync(workspaceRoot, { recursive: true, force: true })
    if (moduleDir) {
      rmSync(moduleDir, { recursive: true, force: true })
    }
  }
})

test('Agent hook runner applies PreToolUse input and permission outputs', async () => {
  const dataRoot = mkdtempSync(join(tmpdir(), 'pichu-plugin-data-'))
  const workspaceRoot = mkdtempSync(join(tmpdir(), 'pichu-plugin-workspace-'))
  let moduleDir = null

  try {
    const pluginRoot = join(workspaceRoot, 'resources', 'plugins', 'repo-reviewer')
    createPlugin(pluginRoot, 'repo-reviewer', { includeHooks: false })
    mkdirSync(join(pluginRoot, 'hooks'), { recursive: true })
    writeFileSync(
      join(pluginRoot, 'hooks', 'pre_reserved.js'),
      [
        'process.stdout.write(JSON.stringify({',
        '  hookSpecificOutput: {',
        '    updatedInput: { command: "changed" },',
        '    permissionDecision: "allow"',
        '  }',
        '}))'
      ].join('\n'),
      'utf8'
    )
    writeFileSync(
      join(pluginRoot, 'hooks', 'pre_ask.js'),
      [
        'process.stdout.write(JSON.stringify({',
        '  hookSpecificOutput: {',
        '    permissionDecision: "ask",',
        '    approvalUi: {',
        '      renderer: "json-render",',
        '      spec: {',
        '        root: "root",',
        '        elements: {',
        '          root: { type: "Stack", props: {}, children: ["command", "docs", "preview"] },',
        '          command: { type: "CodeBlock", props: { code: { $state: "/toolInput/command" } }, children: [] },',
        '          docs: { type: "Link", props: { href: "https://example.com/review", label: "Review policy" }, children: [] },',
        '          preview: { type: "Image", props: { src: "data:image/png;base64,iVBORw0KGgo=", alt: "Preview" }, children: [] }',
        '        }',
        '      }',
        '    }',
        '  }',
        '}))'
      ].join('\n'),
      'utf8'
    )
    writeFileSync(
      join(pluginRoot, 'hooks', 'post_reserved.js'),
      [
        'process.stdout.write(JSON.stringify({',
        '  hookSpecificOutput: {',
        '    updatedMCPToolOutput: { content: "changed" },',
        '    suppressOutput: true,',
        '    additionalContext: "post-context"',
        '  }',
        '}))'
      ].join('\n'),
      'utf8'
    )
    writeFileSync(
      join(pluginRoot, 'hooks', 'stop_reserved.js'),
      'process.stdout.write(JSON.stringify({ continue: true, systemMessage: "continue once", suppressOutput: true }))\n',
      'utf8'
    )
    writePluginHooks(pluginRoot, {
      hooks: {
        PreToolUse: [
          {
            matcher: 'reserved_tool',
            hooks: [{ type: 'command', command: 'node ./hooks/pre_reserved.js' }]
          },
          {
            matcher: 'ask_tool',
            hooks: [{ type: 'command', command: 'node ./hooks/pre_ask.js' }]
          }
        ],
        PostToolUse: [
          {
            matcher: 'reserved_tool',
            hooks: [{ type: 'command', command: 'node ./hooks/post_reserved.js' }]
          }
        ],
        Stop: [
          {
            hooks: [{ type: 'command', command: 'node ./hooks/stop_reserved.js' }]
          }
        ]
      }
    })
    const manifestPath = join(pluginRoot, 'plugin.json')
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    writeJson(manifestPath, manifest)
    writeWorkspaceMarketplace(workspaceRoot, {
      name: 'local-test',
      plugins: [
        {
          name: 'repo-reviewer',
          source: {
            source: 'local',
            path: './plugins/repo-reviewer'
          },
          policy: {
            installation: 'AVAILABLE',
            authentication: 'ON_INSTALL'
          }
        }
      ]
    })

    const modules = await loadPluginModulesForTest({ dataRoot, workspaceRoot })
    moduleDir = modules.moduleDir
    await modules.registry.installPlugin({
      marketplaceName: 'local-test',
      pluginName: 'repo-reviewer'
    })

    const context = {
      sessionId: 'session-1',
      cwd: workspaceRoot,
      model: 'test-model'
    }

    assert.deepEqual(
      await modules.hookRunner.runPreToolUseHooks({
        context,
        toolName: 'reserved_tool',
        toolUseId: 'tool-1',
        toolInput: { command: 'date' }
      }),
      {
        updatedInput: { command: 'changed' },
        permissionDecision: 'allow'
      }
    )
    assert.deepEqual(
      await modules.hookRunner.runPreToolUseHooks({
        context,
        toolName: 'ask_tool',
        toolUseId: 'tool-2',
        toolInput: { command: 'date' }
      }),
      {
        updatedInput: undefined,
        permissionDecision: 'ask',
        approvalUi: {
          renderer: 'json-render',
          spec: {
            root: 'root',
            elements: {
              root: {
                type: 'Stack',
                props: {},
                children: ['command', 'docs', 'preview']
              },
              command: {
                type: 'CodeBlock',
                props: { code: { $state: '/toolInput/command' } },
                children: []
              },
              docs: {
                type: 'Link',
                props: { href: 'https://example.com/review', label: 'Review policy' },
                children: []
              },
              preview: {
                type: 'Image',
                props: { src: 'data:image/png;base64,iVBORw0KGgo=', alt: 'Preview' },
                children: []
              }
            }
          }
        }
      }
    )
    assert.equal(
      await modules.hookRunner.runPostToolUseHooks({
        context,
        toolName: 'reserved_tool',
        toolUseId: 'tool-1',
        toolInput: { command: 'date' },
        toolResponse: { content: [{ type: 'text', text: 'original' }], details: {} },
        isError: false
      }),
      undefined
    )
    const stopDecision = await modules.hookRunner.runAgentHookEvent({
      eventName: 'Stop',
      context
    })
    assert.equal(stopDecision.stopContinuationMessage, 'continue once')

    const audit = await modules.registry.listPluginAuditLogAsync(20)
    const preAudit = audit.find(
      (entry) =>
        entry.details?.eventName === 'PreToolUse' &&
        entry.details?.decision?.preToolPermissionDecision === 'allow'
    )
    assert.equal(preAudit?.details?.decision?.updatedInput, true)
    assert.equal(preAudit?.details?.decision?.preToolPermissionDecision, 'allow')
    const preAskAudit = audit.find(
      (entry) =>
        entry.details?.eventName === 'PreToolUse' &&
        entry.details?.decision?.preToolPermissionDecision === 'ask'
    )
    assert.equal(preAskAudit?.details?.decision?.preToolPermissionDecision, 'ask')
    assert.equal(preAskAudit?.details?.decision?.approvalUi, true)
    const postAudit = audit.find((entry) => entry.details?.eventName === 'PostToolUse')
    assert.equal(postAudit?.details?.decision?.ignoredUpdatedMcpToolOutput, true)
    assert.equal(postAudit?.details?.decision?.ignoredSuppressOutput, true)
    const stopAudit = audit.find((entry) => entry.details?.eventName === 'Stop')
    assert.equal(stopAudit?.details?.decision?.ignoredSuppressOutput, true)
  } finally {
    rmSync(dataRoot, { recursive: true, force: true })
    rmSync(workspaceRoot, { recursive: true, force: true })
    if (moduleDir) {
      rmSync(moduleDir, { recursive: true, force: true })
    }
  }
})

test('Agent hook runner supports managed absolute commands and redacts audit output', async () => {
  const dataRoot = mkdtempSync(join(tmpdir(), 'pichu-plugin-data-'))
  const workspaceRoot = mkdtempSync(join(tmpdir(), 'pichu-plugin-workspace-'))
  let moduleDir = null

  try {
    const pluginRoot = join(workspaceRoot, 'resources', 'plugins', 'repo-reviewer')
    createPlugin(pluginRoot, 'repo-reviewer', { includeHooks: false })
    const managedRoot = join(pluginRoot, 'managed')
    mkdirSync(managedRoot, { recursive: true })
    const managedHook = join(managedRoot, 'managed.js')
    writeFileSync(
      managedHook,
      [
        'process.stderr.write("Bearer secret-token token=abc123 /Users/example/private", () => {',
        '  process.exit(1)',
        '})'
      ].join('\n'),
      'utf8'
    )
    mkdirSync(join(pluginRoot, 'hooks'), { recursive: true })
    writePluginHooks(pluginRoot, {
      managed_dir: './managed',
      hooks: {
        UserPromptSubmit: [
          {
            hooks: [{ type: 'command', command: 'node ./managed/managed.js' }]
          }
        ]
      }
    })
    const manifestPath = join(pluginRoot, 'plugin.json')
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    writeJson(manifestPath, manifest)
    writeWorkspaceMarketplace(workspaceRoot, {
      name: 'local-test',
      plugins: [
        {
          name: 'repo-reviewer',
          source: {
            source: 'local',
            path: './plugins/repo-reviewer'
          },
          policy: {
            installation: 'AVAILABLE',
            authentication: 'ON_INSTALL'
          }
        }
      ]
    })

    const modules = await loadPluginModulesForTest({ dataRoot, workspaceRoot })
    moduleDir = modules.moduleDir
    assert.throws(() =>
      modules.hookRunner.prepareHookCommand(`node ${join(workspaceRoot, 'outside.js')}`, pluginRoot)
    )
    assert.doesNotThrow(() =>
      modules.hookRunner.prepareHookCommand(`node ${managedHook}`, pluginRoot, {
        managed_dir: './managed'
      })
    )

    await modules.registry.installPlugin({
      marketplaceName: 'local-test',
      pluginName: 'repo-reviewer'
    })
    await modules.hookRunner.runAgentHookEvent({
      eventName: 'UserPromptSubmit',
      context: {
        sessionId: 'session-1',
        cwd: workspaceRoot,
        model: 'test-model'
      },
      extraInput: { prompt: 'hello' }
    })

    const [audit] = await modules.registry.listPluginAuditLogAsync(1)
    assert.equal(audit.details.stderr.includes('secret-token'), false)
    assert.equal(audit.details.stderr.includes('abc123'), false)
    assert.equal(audit.details.stderr.includes('/Users/example'), false)
    assert.match(audit.details.stderr, /Bearer \[redacted\]/)
    assert.match(audit.details.stderr, /token=\[redacted\]/)
    assert.match(audit.details.stderr, /\/Users\/\[redacted\]/)
  } finally {
    rmSync(dataRoot, { recursive: true, force: true })
    rmSync(workspaceRoot, { recursive: true, force: true })
    if (moduleDir) {
      rmSync(moduleDir, { recursive: true, force: true })
    }
  }
})

test('tool approval engine uses tool-provided metadata instead of name matching', async () => {
  const { approval, moduleDir } = await loadToolApprovalEngineForTest()

  try {
    assert.equal(
      approval.buildToolApprovalRequest({
        sessionId: 'session-1',
        cwd: '/workspace',
        toolName: 'new_tool',
        toolUseId: 'tool-0',
        toolInput: { cmd: 'date' },
        source: 'chat'
      }),
      null
    )

    const request = approval.buildToolApprovalRequest({
      sessionId: 'session-1',
      cwd: '/workspace',
      toolName: 'exec_command',
      toolUseId: 'tool-1',
      toolInput: { cmd: 'date' },
      approval: {
        mode: 'prompt',
        reason: 'Run a local command',
        describe: (input) => input?.cmd
      },
      source: 'chat'
    })

    assert.equal(request.approvalMode, 'prompt')
    assert.equal(request.approvalReason, 'Run a local command')
    assert.equal(request.description, 'date')
    assert.equal(request.parsedCommand.parseStatus, 'parsed')
    assert.equal(request.parsedCommand.executable, 'date')

    const questionRequest = approval.buildToolApprovalRequest({
      sessionId: 'session-1',
      cwd: '/workspace',
      toolName: 'exec_command',
      toolUseId: 'tool-question',
      toolInput: { cmd: 'date' },
      approval: {
        mode: 'prompt',
        reason: 'Run a local command',
        question: 'Run date?'
      },
      source: 'chat'
    })

    assert.equal(questionRequest.approvalReason, 'Run date?')

    const justifiedRequest = approval.buildToolApprovalRequest({
      sessionId: 'session-1',
      cwd: '/workspace',
      toolName: 'exec_command',
      toolUseId: 'tool-justification',
      toolInput: {
        cmd: 'date',
        justification: 'Run date to inspect the current time?'
      },
      approval: {
        mode: 'prompt',
        reason: 'Run a local command',
        question: 'Run date?'
      },
      source: 'chat'
    })

    assert.equal(justifiedRequest.approvalReason, 'Run date to inspect the current time?')

    const originalWarn = console.warn
    const warnings = []
    console.warn = (...args) => warnings.push(args)
    try {
      const guardedRequest = approval.buildToolApprovalRequest({
        sessionId: 'session-1',
        cwd: '/workspace',
        toolName: 'exec_command',
        toolUseId: 'tool-guarded',
        toolInput: { cmd: 'date' },
        approval: {
          mode: () => {
            throw new Error('mode failed')
          },
          reason: () => {
            throw new Error('reason failed')
          },
          question: () => {
            throw new Error('question failed')
          },
          describe: () => {
            throw new Error('describe failed')
          },
          autoReviewAction: () => {
            throw new Error('auto review action failed')
          }
        },
        source: 'chat'
      })

      assert.equal(guardedRequest.approvalMode, 'prompt')
      assert.equal(guardedRequest.approvalReason, undefined)
      assert.equal(guardedRequest.description, 'exec_command')
      assert.equal(guardedRequest.autoReviewAction, undefined)
      assert.equal(warnings.length, 6)
    } finally {
      console.warn = originalWarn
    }

    const bashRequest = approval.buildToolApprovalRequest({
      sessionId: 'session-1',
      cwd: '/workspace',
      toolName: 'exec_command',
      toolUseId: 'tool-argv',
      toolInput: {
        command: 'example-db table create --ttl 30 --fields \'[{"name":"a","type":"String"}]\''
      },
      approval: { mode: 'prompt', reason: 'Run a local command' },
      source: 'chat'
    })

    assert.equal(bashRequest.parsedCommand.parseStatus, 'parsed')
    assert.equal(bashRequest.parsedCommand.executable, 'example-db')
    assert.deepEqual(bashRequest.parsedCommand.argv, [
      'example-db',
      'table',
      'create',
      '--ttl',
      '30',
      '--fields',
      '[{"name":"a","type":"String"}]'
    ])

    const shellSyntaxRequest = approval.buildToolApprovalRequest({
      sessionId: 'session-1',
      cwd: '/workspace',
      toolName: 'exec_command',
      toolUseId: 'tool-shell-syntax',
      toolInput: {
        command: 'echo "$HOME" && example-db table create --ttl 30'
      },
      approval: { mode: 'prompt', reason: 'Run a local command' },
      source: 'chat'
    })

    assert.equal(shellSyntaxRequest.parsedCommand.parseStatus, 'partial')
    assert.equal(shellSyntaxRequest.parsedCommand.executable, 'echo')
    assert.deepEqual(shellSyntaxRequest.parsedCommand.argv, [
      'echo',
      '$HOME',
      'example-db',
      'table',
      'create',
      '--ttl',
      '30'
    ])

    assert.equal(approval.shouldResumeRunAfterToolApprovalResolution('allow'), true)
    assert.equal(approval.shouldResumeRunAfterToolApprovalResolution('deny'), true)
    assert.equal(approval.shouldResumeRunAfterToolApprovalResolution('timeout'), true)
    assert.equal(approval.shouldResumeRunAfterToolApprovalResolution('cancelled'), false)
    assert.equal(approval.shouldResumeRunAfterToolApprovalResolution('unavailable'), true)

    assert.deepEqual(approval.evaluateToolApprovalRequest({ ...request, approvalMode: 'deny' }), {
      behavior: 'deny',
      request: { ...request, approvalMode: 'deny' },
      reason: 'Run a local command'
    })

    let requested = null
    let resolved = null
    approval.setToolApprovalEventSender({
      isAvailable: () => true,
      requested: (nextRequest) => {
        requested = nextRequest
        return true
      },
      resolved: (event) => {
        resolved = event
        return true
      }
    })
    try {
      const approvalPromise = approval.requestToolApproval(request, { mode: 'prompt' })
      assert.equal(requested?.id, request.id)
      assert.equal(approval.listPendingToolApprovalRequests().length, 1)
      assert.equal((await approval.resolveToolApprovalRequest(request.id, 'allow'))?.id, request.id)
      assert.equal(resolved?.behavior, 'allow')
      assert.deepEqual(await approvalPromise, { behavior: 'allow', request })
    } finally {
      approval.setToolApprovalEventSender(null)
    }

    globalThis.__pichuRememberedToolApprovalRuleRequestsForTest = []
    globalThis.__pichuToolApprovalRuleMatchForTest = undefined
    let rememberRequested = null
    approval.setToolApprovalEventSender({
      isAvailable: () => true,
      requested: (nextRequest) => {
        rememberRequested = nextRequest
        return true
      },
      resolved: () => true
    })
    try {
      const rememberRequest = approval.buildToolApprovalRequest({
        sessionId: 'session-1',
        cwd: '/workspace',
        toolName: 'exec_command',
        toolUseId: 'tool-remember',
        toolInput: { cmd: 'git show origin/main:README.md' },
        approval: { mode: 'prompt', reason: 'Run a local command' },
        source: 'chat'
      })
      assert.equal(rememberRequest.rememberRule?.display, 'git show origin/main:README.md')
      const approvalPromise = approval.requestToolApproval(rememberRequest)
      assert.equal(rememberRequested?.id, rememberRequest.id)
      await approval.resolveToolApprovalRequest(rememberRequest.id, 'allow', undefined, {
        rememberRule: true
      })
      assert.deepEqual(await approvalPromise, { behavior: 'allow', request: rememberRequest })
      assert.equal(globalThis.__pichuRememberedToolApprovalRuleRequestsForTest.length, 1)
      assert.equal(
        globalThis.__pichuRememberedToolApprovalRuleRequestsForTest[0].id,
        rememberRequest.id
      )
    } finally {
      approval.setToolApprovalEventSender(null)
    }

    const savedRuleEvents = []
    globalThis.__pichuToolApprovalRuleMatchForTest = (nextRequest) => nextRequest.rememberRule
    approval.setToolApprovalEventSender({
      isAvailable: () => true,
      requested: () => {
        throw new Error('saved rule match should not prompt')
      },
      resolved: () => true,
      autoReviewCompleted: (event) => {
        savedRuleEvents.push(event)
        return true
      }
    })
    try {
      const savedRuleRequest = approval.buildToolApprovalRequest({
        sessionId: 'session-1',
        cwd: '/workspace',
        toolName: 'exec_command',
        toolUseId: 'tool-saved-rule',
        toolInput: { cmd: 'git show origin/main:README.md' },
        approval: { mode: 'prompt', reason: 'Run a local command' },
        source: 'chat'
      })
      assert.deepEqual(await approval.requestToolApproval(savedRuleRequest), {
        behavior: 'allow',
        request: savedRuleRequest
      })
      assert.equal(savedRuleEvents.length, 1)
      assert.match(savedRuleEvents[0].rationale, /Allowed by saved rule/)
    } finally {
      globalThis.__pichuRememberedToolApprovalRuleRequestsForTest = undefined
      globalThis.__pichuToolApprovalRuleMatchForTest = undefined
      approval.setToolApprovalEventSender(null)
    }

    let failedRequestResolved = null
    const originalWarnForRequestedFailure = console.warn
    console.warn = () => {}
    try {
      approval.setToolApprovalEventSender({
        isAvailable: () => true,
        requested: () => {
          throw new Error('renderer went away')
        },
        resolved: (event) => {
          failedRequestResolved = event
          return true
        }
      })
      const failedRequest = approval.buildToolApprovalRequest({
        sessionId: 'session-1',
        cwd: '/workspace',
        toolName: 'exec_command',
        toolUseId: 'tool-requested-throws',
        toolInput: { cmd: 'date' },
        approval: { mode: 'prompt', reason: 'Run a local command' },
        source: 'chat'
      })
      const decision = await approval.requestToolApproval(failedRequest)
      assert.deepEqual(decision, {
        behavior: 'unavailable',
        request: failedRequest,
        reason:
          'Tool exec_command requires approval, but interactive tool approval is not available.'
      })
      assert.equal(failedRequestResolved?.behavior, 'unavailable')
      assert.equal(approval.listPendingToolApprovalRequests().length, 0)
    } finally {
      console.warn = originalWarnForRequestedFailure
      approval.setToolApprovalEventSender(null)
    }

    const automationRequest = approval.buildToolApprovalRequest({
      sessionId: 'session-1',
      cwd: '/workspace',
      toolName: 'exec_command',
      toolUseId: 'tool-2',
      toolInput: { cmd: 'date' },
      approval: { mode: 'prompt', reason: 'Run a local command' },
      source: 'automation'
    })
    assert.deepEqual(await approval.requestToolApproval(automationRequest), {
      behavior: 'unavailable',
      request: automationRequest,
      reason:
        'Tool exec_command requires approval, but automation runs cannot show interactive prompts.'
    })
  } finally {
    rmSync(moduleDir, { recursive: true, force: true })
  }
})

test('tool approval engine keeps user approval pending until an explicit decision', async () => {
  const { approval, moduleDir } = await loadToolApprovalEngineForTest()
  const originalSetTimeout = globalThis.setTimeout

  try {
    const request = approval.buildToolApprovalRequest({
      sessionId: 'session-no-timeout',
      cwd: '/workspace',
      toolName: 'exec_command',
      toolUseId: 'tool-no-timeout',
      toolInput: { cmd: 'date' },
      approval: { mode: 'prompt', reason: 'Run a local command' },
      source: 'chat'
    })

    let requested = null
    approval.setToolApprovalEventSender({
      isAvailable: () => true,
      requested: (nextRequest) => {
        requested = nextRequest
        return true
      },
      resolved: () => true
    })

    globalThis.setTimeout = (callback, delay, ...args) => {
      assert.notEqual(delay, 300_000, 'tool approval prompts must not auto-timeout after 5 minutes')
      return originalSetTimeout(callback, delay, ...args)
    }

    let settled = false
    const approvalPromise = approval.requestToolApproval(request).then((decision) => {
      settled = true
      return decision
    })

    await Promise.resolve()
    assert.equal(requested?.id, request.id)
    assert.equal(settled, false)
    assert.equal(approval.listPendingToolApprovalRequests().length, 1)

    await approval.resolveToolApprovalRequest(request.id, 'allow')
    assert.deepEqual(await approvalPromise, { behavior: 'allow', request })
  } finally {
    globalThis.setTimeout = originalSetTimeout
    approval.setToolApprovalEventSender(null)
    rmSync(moduleDir, { recursive: true, force: true })
  }
})

test('tool approval engine routes auto review decisions before prompting', async () => {
  const { approval, moduleDir } = await loadToolApprovalEngineForTest()

  try {
    approval.__test.reset()
    approval.__test.setAutoReviewResult({
      status: 'approved',
      riskLevel: 'low',
      userAuthorization: 'medium',
      rationale: 'Matches the user request.'
    })

    let requested = null
    let resolveRequested = null
    const autoReviewEvents = []
    approval.setToolApprovalEventSender({
      isAvailable: () => true,
      requested: (nextRequest) => {
        requested = nextRequest
        resolveRequested?.(nextRequest)
        return true
      },
      resolved: () => true,
      autoReviewStarted: (event) => {
        autoReviewEvents.push(event)
        return true
      },
      autoReviewCompleted: (event) => {
        autoReviewEvents.push(event)
        return true
      }
    })

    const request = approval.buildToolApprovalRequest({
      sessionId: 'session-auto-review',
      cwd: '/workspace',
      toolName: 'exec_command',
      toolUseId: 'tool-auto-1',
      toolInput: { cmd: 'printf ok > report.md' },
      approval: {
        mode: 'auto-review',
        reason: 'Only ask for actions detected as potentially unsafe',
        autoReviewAction: (input) => ({ type: 'command', command: input.cmd })
      },
      reviewContext: {
        latestUserRequest: 'Write ok into report.md',
        assistantMessage: 'I will update report.md.'
      },
      source: 'chat'
    })

    assert.equal(request.approvalMode, 'auto-review')
    assert.deepEqual(await approval.requestToolApproval(request), { behavior: 'allow', request })
    assert.equal(requested, null)
    assert.equal(approval.__test.autoReviewRequests.length, 1)
    assert.equal(
      approval.__test.autoReviewRequests[0].reviewContext.latestUserRequest,
      'Write ok into report.md'
    )
    assert.deepEqual(
      autoReviewEvents.map((event) => event.status),
      ['inProgress', 'approved']
    )
    assert.equal(autoReviewEvents[1].userAuthorization, 'medium')

    approval.__test.setAutoReviewResult({
      status: 'denied',
      riskLevel: 'high',
      userAuthorization: 'none',
      rationale: 'Writes outside the requested target.'
    })
    requested = null
    autoReviewEvents.length = 0

    const deniedChatRequest = approval.buildToolApprovalRequest({
      sessionId: 'session-auto-review',
      cwd: '/workspace',
      toolName: 'exec_command',
      toolUseId: 'tool-auto-2',
      toolInput: { cmd: 'printf ok > /tmp/outside.md' },
      approval: {
        mode: 'auto-review',
        reason: 'Only ask for actions detected as potentially unsafe',
        autoReviewAction: (input) => ({ type: 'command', command: input.cmd })
      },
      source: 'chat'
    })

    const requestedPromise = new Promise((resolve) => {
      resolveRequested = resolve
    })
    const deniedPrompt = approval.requestToolApproval(deniedChatRequest)
    await requestedPromise
    assert.equal(requested?.id, deniedChatRequest.id)
    assert.deepEqual(
      autoReviewEvents.map((event) => event.status),
      ['inProgress', 'denied']
    )
    await approval.resolveToolApprovalRequest(deniedChatRequest.id, 'deny', 'User denied.')
    assert.deepEqual(await deniedPrompt, {
      behavior: 'deny',
      request: deniedChatRequest,
      reason: 'User denied.'
    })

    const deniedAutomationRequest = approval.buildToolApprovalRequest({
      sessionId: 'session-auto-review',
      cwd: '/workspace',
      toolName: 'exec_command',
      toolUseId: 'tool-auto-3',
      toolInput: { cmd: 'printf ok > /tmp/outside.md' },
      approval: {
        mode: 'auto-review',
        reason: 'Only ask for actions detected as potentially unsafe',
        autoReviewAction: (input) => ({ type: 'command', command: input.cmd })
      },
      source: 'automation'
    })

    assert.deepEqual(await approval.requestToolApproval(deniedAutomationRequest), {
      behavior: 'deny',
      request: deniedAutomationRequest,
      reason: 'Writes outside the requested target.'
    })

    approval.setToolApprovalEventSender({
      isAvailable: () => false,
      requested: () => {
        throw new Error('requested should not be called')
      },
      resolved: () => true
    })
    const unavailableRequest = approval.buildToolApprovalRequest({
      sessionId: 'session-auto-review',
      cwd: '/workspace',
      toolName: 'exec_command',
      toolUseId: 'tool-auto-4',
      toolInput: { cmd: 'printf ok > /tmp/outside.md' },
      approval: {
        mode: 'auto-review',
        reason: 'Only ask for actions detected as potentially unsafe',
        autoReviewAction: (input) => ({ type: 'command', command: input.cmd })
      },
      source: 'chat'
    })
    assert.deepEqual(await approval.requestToolApproval(unavailableRequest), {
      behavior: 'unavailable',
      request: unavailableRequest,
      reason: 'Tool exec_command requires approval, but interactive tool approval is not available.'
    })
    assert.equal(approval.listPendingToolApprovalRequests().length, 0)
  } finally {
    approval.setToolApprovalEventSender(null)
    rmSync(moduleDir, { recursive: true, force: true })
  }
})

test('tool approval engine deterministically approves read-only local inspection commands', async () => {
  const { approval, moduleDir } = await loadToolApprovalEngineForTest()

  try {
    globalThis.__pichuBashSandboxSupportedForTest = true
    approval.__test.reset()

    let requested = null
    const autoReviewEvents = []
    approval.setToolApprovalEventSender({
      isAvailable: () => true,
      requested: (nextRequest) => {
        requested = nextRequest
        return true
      },
      resolved: () => true,
      autoReviewStarted: (event) => {
        autoReviewEvents.push(event)
        return true
      },
      autoReviewCompleted: (event) => {
        autoReviewEvents.push(event)
        return true
      }
    })

    const request = approval.buildToolApprovalRequest({
      sessionId: 'session-read-only-auto-review',
      cwd: '/workspace',
      toolName: 'exec_command',
      toolUseId: 'tool-read-only-1',
      toolInput: {
        cmd: "git show origin/main:packages/agent/CHANGELOG.md | sed -n '1,160p'"
      },
      approval: {
        mode: 'auto-review',
        reason: 'Only ask for actions detected as potentially unsafe',
        autoReviewAction: (input) => ({ type: 'command', command: input.cmd })
      },
      source: 'chat'
    })

    assert.deepEqual(await approval.requestToolApproval(request), { behavior: 'allow', request })
    assert.equal(requested, null)
    assert.equal(approval.__test.autoReviewRequests.length, 0)
    assert.deepEqual(
      autoReviewEvents.map((event) => event.status),
      ['inProgress', 'approved']
    )
    assert.equal(autoReviewEvents[1].riskLevel, 'low')
    assert.equal(autoReviewEvents[1].rationale, 'Low-risk local read-only inspection.')
  } finally {
    delete globalThis.__pichuBashSandboxSupportedForTest
    approval.setToolApprovalEventSender(null)
    rmSync(moduleDir, { recursive: true, force: true })
  }
})

test('tool approval engine deterministically approves managed process kill commands', async () => {
  const { approval, moduleDir } = await loadToolApprovalEngineForTest()
  try {
    globalThis.__pichuKnownBackgroundTerminalPidsForTest = new Set([43210])
    approval.__test.reset()

    const promptRequest = approval.buildToolApprovalRequest({
      sessionId: 'session-managed-kill',
      cwd: moduleDir,
      toolName: 'exec_command',
      toolUseId: 'tool-managed-kill',
      toolInput: { cmd: 'kill -TERM 43210' },
      approval: {
        mode: 'prompt',
        reason: 'Terminate a local process',
        autoReviewAction: (input) => ({ type: 'command', command: input.cmd })
      },
      reviewContext: {}
    })
    assert.deepEqual(await approval.requestToolApproval(promptRequest), {
      behavior: 'allow',
      request: promptRequest
    })
    assert.equal(approval.listPendingToolApprovalRequests().length, 0)

    const autoReviewRequest = approval.buildToolApprovalRequest({
      sessionId: 'session-managed-kill',
      cwd: moduleDir,
      toolName: 'exec_command',
      toolUseId: 'tool-managed-kill-auto',
      toolInput: { cmd: 'kill -9 43210' },
      approval: {
        mode: 'auto-review',
        reason: 'Terminate a local process',
        autoReviewAction: (input) => ({ type: 'command', command: input.cmd })
      },
      reviewContext: {}
    })
    assert.deepEqual(await approval.requestToolApproval(autoReviewRequest), {
      behavior: 'allow',
      request: autoReviewRequest
    })
    assert.equal(approval.__test.autoReviewRequests.length, 0)

    const processGroupRequest = approval.buildToolApprovalRequest({
      sessionId: 'session-managed-kill',
      cwd: moduleDir,
      toolName: 'exec_command',
      toolUseId: 'tool-managed-kill-pgid',
      toolInput: { cmd: 'kill -- -43210' },
      approval: {
        mode: 'auto-review',
        reason: 'Terminate a local process group',
        autoReviewAction: (input) => ({ type: 'command', command: input.cmd })
      },
      reviewContext: {}
    })
    assert.deepEqual(await approval.requestToolApproval(processGroupRequest), {
      behavior: 'allow',
      request: processGroupRequest
    })
    assert.equal(approval.__test.autoReviewRequests.length, 0)

    const unmanagedRequest = approval.buildToolApprovalRequest({
      sessionId: 'session-managed-kill',
      cwd: moduleDir,
      toolName: 'exec_command',
      toolUseId: 'tool-unmanaged-kill',
      toolInput: { cmd: 'kill 54321' },
      approval: {
        mode: 'auto-review',
        reason: 'Terminate a local process',
        autoReviewAction: (input) => ({ type: 'command', command: input.cmd })
      },
      reviewContext: {}
    })
    assert.deepEqual(await approval.requestToolApproval(unmanagedRequest), {
      behavior: 'unavailable',
      request: unmanagedRequest,
      reason: 'Tool exec_command requires approval, but interactive tool approval is not available.'
    })
    assert.equal(approval.__test.autoReviewRequests.length, 1)
  } finally {
    delete globalThis.__pichuKnownBackgroundTerminalPidsForTest
  }
})

test('tool approval engine uses reviewer for read-only inspection commands without sandbox', async () => {
  const { approval, moduleDir } = await loadToolApprovalEngineForTest()

  try {
    globalThis.__pichuBashSandboxSupportedForTest = false
    approval.__test.reset()
    approval.__test.setAutoReviewResult({
      status: 'approved',
      riskLevel: 'low',
      userAuthorization: 'low',
      rationale: 'Reviewer approved read-only command.'
    })

    approval.setToolApprovalEventSender({
      isAvailable: () => true,
      requested: () => true,
      resolved: () => true,
      autoReviewStarted: () => true,
      autoReviewCompleted: () => true
    })

    const request = approval.buildToolApprovalRequest({
      sessionId: 'session-read-only-no-sandbox',
      cwd: '/workspace',
      toolName: 'exec_command',
      toolUseId: 'tool-read-only-no-sandbox-1',
      toolInput: {
        cmd: "git show origin/main:packages/agent/CHANGELOG.md | sed -n '1,160p'"
      },
      approval: {
        mode: 'auto-review',
        reason: 'Only ask for actions detected as potentially unsafe',
        autoReviewAction: (input) => ({ type: 'command', command: input.cmd })
      },
      source: 'chat'
    })

    assert.deepEqual(await approval.requestToolApproval(request), { behavior: 'allow', request })
    assert.equal(approval.__test.autoReviewRequests.length, 1)
  } finally {
    delete globalThis.__pichuBashSandboxSupportedForTest
    approval.setToolApprovalEventSender(null)
    rmSync(moduleDir, { recursive: true, force: true })
  }
})

test('loadPluginManifest ignores legacy Owls, Codex, and Claude manifests', async () => {
  const dataRoot = mkdtempSync(join(tmpdir(), 'pichu-plugin-data-'))
  const workspaceRoot = mkdtempSync(join(tmpdir(), 'pichu-plugin-workspace-'))
  let moduleDir = null

  try {
    const modules = await loadPluginModulesForTest({ dataRoot, workspaceRoot })
    moduleDir = modules.moduleDir

    for (const manifestDir of ['.pichu-plugin', '.codex-plugin', '.claude-plugin']) {
      const root = mkdtempSync(join(tmpdir(), 'pichu-plugin-ignored-'))
      try {
        mkdirSync(join(root, manifestDir), { recursive: true })
        writeJson(join(root, manifestDir, 'plugin.json'), {
          name: 'ignored-plugin',
          version: '1.0.0',
          description: 'Ignored plugin.',
          skills: '../skills'
        })

        await assert.rejects(
          () => modules.manifest.loadPluginManifestAsync(root),
          /No plugin manifest found/
        )
      } finally {
        rmSync(root, { recursive: true, force: true })
      }
    }
  } finally {
    rmSync(dataRoot, { recursive: true, force: true })
    rmSync(workspaceRoot, { recursive: true, force: true })
    if (moduleDir) {
      rmSync(moduleDir, { recursive: true, force: true })
    }
  }
})

test('validatePluginPackage passes valid packages for CI use', async () => {
  const dataRoot = mkdtempSync(join(tmpdir(), 'pichu-plugin-data-'))
  const workspaceRoot = mkdtempSync(join(tmpdir(), 'pichu-plugin-workspace-'))
  const pluginRoot = mkdtempSync(join(tmpdir(), 'pichu-plugin-valid-'))
  let moduleDir = null

  try {
    createPlugin(pluginRoot, 'repo-reviewer', { includeHooks: false })
    const modules = await loadPluginModulesForTest({ dataRoot, workspaceRoot })
    moduleDir = modules.moduleDir

    const result = await modules.validator.validatePluginPackageAsync(pluginRoot)

    assert.equal(result.ok, true)
    assert.equal(result.manifest.name, 'repo-reviewer')
    assert.equal(
      result.components.some((component) => component.key === 'skills'),
      true
    )
    assert.equal(
      result.diagnostics.some((diagnostic) =>
        diagnostic.message.includes('preserved but not supported')
      ),
      false
    )
  } finally {
    rmSync(dataRoot, { recursive: true, force: true })
    rmSync(workspaceRoot, { recursive: true, force: true })
    rmSync(pluginRoot, { recursive: true, force: true })
    if (moduleDir) {
      rmSync(moduleDir, { recursive: true, force: true })
    }
  }
})

test('validatePluginPackage does not validate managed runtime requirements against app-bundled Node', async () => {
  const dataRoot = mkdtempSync(join(tmpdir(), 'pichu-plugin-data-'))
  const workspaceRoot = mkdtempSync(join(tmpdir(), 'pichu-plugin-workspace-'))
  const pluginRoot = mkdtempSync(join(tmpdir(), 'pichu-plugin-managed-runtime-'))
  let moduleDir = null

  try {
    createPlugin(pluginRoot, 'runtime-reporter', { includeHooks: false })
    const manifestPath = join(pluginRoot, 'plugin.json')
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    manifest.extensions['com.pichu.app'].runtimeRequirements = {
      node: { version: '>=99' }
    }
    writeJson(manifestPath, manifest)
    const modules = await loadPluginModulesForTest({ dataRoot, workspaceRoot })
    moduleDir = modules.moduleDir

    const result = await modules.validator.validatePluginPackageAsync(pluginRoot)

    assert.equal(result.ok, true)
    assert.equal(
      result.diagnostics.some((diagnostic) => diagnostic.message.includes('Plugin requires Node')),
      false
    )
  } finally {
    rmSync(dataRoot, { recursive: true, force: true })
    rmSync(workspaceRoot, { recursive: true, force: true })
    rmSync(pluginRoot, { recursive: true, force: true })
    if (moduleDir) {
      rmSync(moduleDir, { recursive: true, force: true })
    }
  }
})

test('validatePluginPackage rejects fixed component paths that escape the plugin root', async () => {
  const dataRoot = mkdtempSync(join(tmpdir(), 'pichu-plugin-data-'))
  const workspaceRoot = mkdtempSync(join(tmpdir(), 'pichu-plugin-workspace-'))
  const pluginRoot = mkdtempSync(join(tmpdir(), 'pichu-plugin-invalid-'))
  let moduleDir = null

  try {
    createPlugin(pluginRoot, 'repo-reviewer')
    const outsideSkills = join(workspaceRoot, 'outside-skills')
    mkdirSync(outsideSkills, { recursive: true })
    rmSync(join(pluginRoot, 'skills'), { recursive: true, force: true })
    symlinkSync(outsideSkills, join(pluginRoot, 'skills'), 'dir')
    const modules = await loadPluginModulesForTest({ dataRoot, workspaceRoot })
    moduleDir = modules.moduleDir

    const result = await modules.validator.validatePluginPackageAsync(pluginRoot)

    assert.equal(result.ok, false)
    assert.equal(
      result.diagnostics.some((diagnostic) => diagnostic.message.includes('outside plugin root')),
      true
    )
    assert.equal(
      result.components.some(
        (component) => component.key === 'skills' && !component.exists && component.active
      ),
      true
    )
  } finally {
    rmSync(dataRoot, { recursive: true, force: true })
    rmSync(workspaceRoot, { recursive: true, force: true })
    rmSync(pluginRoot, { recursive: true, force: true })
    if (moduleDir) {
      rmSync(moduleDir, { recursive: true, force: true })
    }
  }
})

test('validatePluginPackage reports agent hook config diagnostics without executing hooks', async () => {
  const dataRoot = mkdtempSync(join(tmpdir(), 'pichu-plugin-data-'))
  const workspaceRoot = mkdtempSync(join(tmpdir(), 'pichu-plugin-workspace-'))
  const pluginRoot = mkdtempSync(join(tmpdir(), 'pichu-plugin-hook-diagnostics-'))
  let moduleDir = null

  try {
    createPlugin(pluginRoot, 'repo-reviewer', { includeHooks: false })
    mkdirSync(join(pluginRoot, 'hooks'), { recursive: true })
    writePluginHooks(pluginRoot, {
      hooks: {
        NotARealEvent: [],
        PreToolUse: [
          {
            matcher: '[',
            hooks: [{ type: 'command', command: 'node ./hooks/check.js' }]
          },
          {
            hooks: [{ type: 'shell', command: 'node ./hooks/check.js' }]
          },
          {
            hooks: [{ type: 'command', command: 'node ./hooks/check.js', timeout: 0 }]
          }
        ]
      }
    })
    const manifestPath = join(pluginRoot, 'plugin.json')
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    writeJson(manifestPath, manifest)

    const modules = await loadPluginModulesForTest({ dataRoot, workspaceRoot })
    moduleDir = modules.moduleDir

    const result = await modules.validator.validatePluginPackageAsync(pluginRoot)

    assert.equal(result.ok, false)
    assert.equal(result.manifest.hookDeclarations.length, 1)
    assert.equal(result.manifest.hookDeclarations[0].commandCount, 0)
    assert.equal(
      result.diagnostics.some((diagnostic) =>
        diagnostic.message.includes('Unsupported agent hook event')
      ),
      true
    )
    assert.equal(
      result.diagnostics.some((diagnostic) =>
        diagnostic.message.includes('Hook handler type must be "command"')
      ),
      true
    )
    assert.equal(
      result.diagnostics.some((diagnostic) =>
        diagnostic.message.includes('Hook timeout must be a positive number')
      ),
      true
    )
    assert.equal(
      result.diagnostics.some(
        (diagnostic) =>
          diagnostic.level === 'warning' &&
          diagnostic.message.includes('Hook matcher is not a valid regex')
      ),
      true
    )
    assert.equal(
      result.components.some(
        (component) => component.key === 'hooks' && component.exists && component.active
      ),
      true
    )
  } finally {
    rmSync(dataRoot, { recursive: true, force: true })
    rmSync(workspaceRoot, { recursive: true, force: true })
    rmSync(pluginRoot, { recursive: true, force: true })
    if (moduleDir) {
      rmSync(moduleDir, { recursive: true, force: true })
    }
  }
})

test('validatePluginPackage accepts plugins without optional Owls hooks', async () => {
  const dataRoot = mkdtempSync(join(tmpdir(), 'pichu-plugin-data-'))
  const workspaceRoot = mkdtempSync(join(tmpdir(), 'pichu-plugin-workspace-'))
  const pluginRoot = mkdtempSync(join(tmpdir(), 'pichu-plugin-hook-missing-'))
  let moduleDir = null

  try {
    createPlugin(pluginRoot, 'repo-reviewer', { includeHooks: false })
    const manifestPath = join(pluginRoot, 'plugin.json')
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    writeJson(manifestPath, manifest)

    const modules = await loadPluginModulesForTest({ dataRoot, workspaceRoot })
    moduleDir = modules.moduleDir

    const result = await modules.validator.validatePluginPackageAsync(pluginRoot)

    assert.equal(result.ok, true)
    assert.equal(
      result.diagnostics.some((diagnostic) =>
        diagnostic.message.includes('Hook config file does not exist')
      ),
      false
    )
  } finally {
    rmSync(dataRoot, { recursive: true, force: true })
    rmSync(workspaceRoot, { recursive: true, force: true })
    rmSync(pluginRoot, { recursive: true, force: true })
    if (moduleDir) {
      rmSync(moduleDir, { recursive: true, force: true })
    }
  }
})

test('plugin asset protocol resolves query paths and allows installed and bundled assets', async () => {
  const dataRoot = mkdtempSync(join(tmpdir(), 'pichu-plugin-asset-data-'))
  const workspaceRoot = mkdtempSync(join(tmpdir(), 'pichu-plugin-asset-workspace-'))
  const resourcesPath = join(workspaceRoot, 'resources')
  let loaded = null

  try {
    loaded = await loadPluginAssetProtocolForTest({ dataRoot, resourcesPath })
    const installedIconPath = join(
      dataRoot,
      'plugins',
      'cache',
      'local-test',
      'repo-reviewer',
      '1.0.0',
      'assets',
      'icon.png'
    )
    const bundledIconPath = join(
      resourcesPath,
      'plugins',
      'plugins',
      'repo-reviewer',
      'assets',
      'icon.png'
    )
    const workspacePluginIconPath = join(
      workspaceRoot,
      '.agents',
      'plugins',
      'repo-reviewer',
      'assets',
      'icon.png'
    )
    const runtimePlatformSegment = `${process.platform}-${process.arch}`
    const runtimePluginIconPath = join(
      dataRoot,
      'runtimes',
      'cache',
      'pichu-primary-runtime',
      '2026.6.1100',
      runtimePlatformSegment,
      'plugins',
      'plugins',
      'documents',
      'assets',
      'icon.png'
    )
    const runtimeNativeManifestPath = join(
      dataRoot,
      'runtimes',
      'cache',
      'pichu-primary-runtime',
      '2026.6.1100',
      runtimePlatformSegment,
      'dependencies',
      'native',
      'poppler',
      'manifest.json'
    )
    mkdirSync(dirname(installedIconPath), { recursive: true })
    writeFileSync(installedIconPath, 'icon', 'utf8')
    mkdirSync(dirname(bundledIconPath), { recursive: true })
    writeFileSync(bundledIconPath, 'icon', 'utf8')
    mkdirSync(dirname(runtimePluginIconPath), { recursive: true })
    writeFileSync(runtimePluginIconPath, 'icon', 'utf8')
    const outsideIconPath = join(workspaceRoot, 'outside', 'icon.png')
    const runtimeSymlinkIconPath = join(
      dataRoot,
      'runtimes',
      'cache',
      'pichu-primary-runtime',
      '2026.6.1100',
      runtimePlatformSegment,
      'plugins',
      'plugins',
      'documents',
      'assets',
      'linked-icon.png'
    )
    mkdirSync(dirname(outsideIconPath), { recursive: true })
    writeFileSync(outsideIconPath, 'outside', 'utf8')
    symlinkSync(outsideIconPath, runtimeSymlinkIconPath)

    assert.equal(
      loaded.protocol.pluginAssetPathFromUrl(
        `pichu-plugin-asset://local/asset?path=${encodeURIComponent(installedIconPath)}`
      ),
      normalize(installedIconPath)
    )
    assert.equal(
      await loaded.protocol.isAllowedPluginAssetPath(bundledIconPath),
      true,
      'packaged marketplace plugin assets should be loadable before install'
    )
    assert.equal(
      await loaded.protocol.isAllowedPluginAssetPath(workspacePluginIconPath),
      false,
      'workspace plugin assets should not be loaded outside installed cache'
    )
    assert.equal(
      await loaded.protocol.isAllowedPluginAssetPath(runtimePluginIconPath),
      true,
      'runtime-bundled plugin assets should be loadable from the installed runtime cache'
    )
    assert.equal(
      await loaded.protocol.isAllowedPluginAssetPath(runtimeNativeManifestPath),
      false,
      'runtime non-plugin files should not be loadable through the plugin asset protocol'
    )
    assert.equal(
      await loaded.protocol.isAllowedPluginAssetPath(runtimeSymlinkIconPath),
      false,
      'runtime plugin assets should not escape the runtime cache through symlinks'
    )
    assert.equal(await loaded.protocol.isAllowedPluginAssetPath(outsideIconPath), false)
  } finally {
    if (loaded) {
      loaded.restore()
      rmSync(loaded.moduleDir, { recursive: true, force: true })
    }
    rmSync(dataRoot, { recursive: true, force: true })
    rmSync(workspaceRoot, { recursive: true, force: true })
  }
})

test('bundled plugins with icon assets declare interface icon paths', () => {
  const pluginsRoot = join(appResourcesPath(), 'plugins', 'plugins')
  for (const pluginName of readdirSync(pluginsRoot)) {
    const pluginRoot = join(pluginsRoot, pluginName)
    const manifestPath = join(pluginRoot, 'plugin.json')
    const iconPath = join(pluginRoot, 'assets', 'icon.png')
    const logoPath = join(pluginRoot, 'assets', 'logo.png')

    if (!existsSync(manifestPath) || !existsSync(iconPath)) continue

    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    assert.equal(
      manifest.extensions['com.pichu.app'].interface?.icon,
      './assets/icon.png',
      `${pluginName} should declare its bundled icon asset`
    )

    if (existsSync(logoPath)) {
      assert.equal(
        manifest.extensions['com.pichu.app'].interface?.logo,
        './assets/logo.png',
        `${pluginName} should declare its bundled logo asset`
      )
    }
  }
})

test('bundled marketplace only default-installs expected bundled plugins', () => {
  const marketplace = JSON.parse(
    readFileSync(join(appResourcesPath(), 'plugins', 'marketplace.json'), 'utf8')
  )
  const pluginNames = marketplace.plugins.map((plugin) => plugin.name).sort()
  const defaultPluginNames = marketplace.plugins
    .filter((plugin) => plugin.policy?.installation === 'INSTALLED_BY_DEFAULT')
    .map((plugin) => plugin.name)
    .sort()

  assert.equal(pluginNames.includes('test-hooks-plugin'), false)
  assert.equal(pluginNames.includes('presentations'), false)
  assert.deepEqual(defaultPluginNames, ['in-app-browser-use'])
  assert.equal(
    marketplace.plugins.find((plugin) => plugin.name === 'computer-use')?.policy?.installation,
    'NOT_AVAILABLE'
  )
  assert.equal(
    marketplace.plugins.find((plugin) => plugin.name === 'sites')?.policy?.installation,
    'NOT_AVAILABLE'
  )
})

test('bundled in-app browser plugin ships Codex-shaped runtime script', async () => {
  const pluginRoot = join(appResourcesPath(), 'plugins', 'plugins', 'in-app-browser-use')
  const manifest = JSON.parse(readFileSync(join(pluginRoot, 'plugin.json'), 'utf8'))
  assert.equal(manifest.extensions['com.pichu.app'].bin, undefined)
  assert.equal(manifest.extensions['com.pichu.app'].commands, undefined)
  assert.equal(existsSync(join(pluginRoot, 'bin', 'browser-use')), false)
  assert.equal(existsSync(join(pluginRoot, 'skills', 'in-app-browser-use', 'SKILL.md')), false)
  const skillPath = join(pluginRoot, 'skills', 'control-in-app-browser', 'SKILL.md')
  assert.equal(existsSync(skillPath), true)
  assert.match(readFileSync(skillPath, 'utf8'), /name: control-in-app-browser/)

  const scriptPath = join(pluginRoot, 'scripts', 'browser-client.mjs')
  assert.equal(existsSync(scriptPath), true)
  assert.equal(existsSync(join(pluginRoot, 'scripts', 'node_modules')), false)
  assert.equal(existsSync(join(pluginRoot, 'docs', 'api.md')), true)
  assert.equal(existsSync(join(pluginRoot, 'docs', 'playwright.md')), true)
  assert.equal(
    existsSync(join(pluginRoot, 'docs', 'capabilities', 'browser', 'visibility.md')),
    true
  )

  const scriptSource = readFileSync(scriptPath, 'utf8')
  for (const method of [
    'browser.cua.click',
    'browser.cua.double_click',
    'browser.cua.drag',
    'browser.cua.keypress',
    'browser.cua.move',
    'browser.cua.scroll',
    'browser.cua.type',
    'browser.dom_cua.get_visible_dom',
    'browser.dom_cua.keypress',
    'browser.dom_cua.scroll',
    'browser.dom_cua.type'
  ]) {
    assert.match(scriptSource, new RegExp(method.replaceAll('.', '\\.')))
  }
  assert.doesNotMatch(scriptSource, /browser\.(mouseClick|mouseMove|mouseDrag|type)/)
  assert.doesNotMatch(scriptSource, /\.\/node_modules\//)

  const { setupBrowserRuntime } = await import(`${pathToFileURL(scriptPath).href}?ts=${Date.now()}`)
  const globals = {}
  await setupBrowserRuntime({ globals })

  assert.equal(typeof globals.agent.browsers.list, 'function')
  assert.equal(typeof globals.agent.browsers.get, 'function')
  assert.equal(typeof globals.agent.documentation.get, 'function')

  const browsers = await globals.agent.browsers.list()
  assert.equal(browsers.length, 1)
  assert.equal(browsers[0].id, 'iab')
  assert.equal(browsers[0].type, 'iab')

  const browser = await globals.agent.browsers.get('iab')
  assert.match(await browser.documentation(), /tab\.goto\(url\)/)
  assert.match(await globals.agent.documentation.get('playwright'), /Snapshot Discipline/)
  assert.match(
    await globals.agent.documentation.get('capabilities/browser/visibility'),
    /VisibilityBrowserCapability/
  )
  assert.deepEqual(await browser.capabilities.list(), [
    {
      id: 'visibility',
      description: 'Show Owls session browser to the user.'
    }
  ])
  const visibility = await browser.capabilities.get('visibility')
  assert.equal(typeof visibility.get, 'function')
  assert.equal(typeof visibility.set, 'function')
  assert.equal(await visibility.get(), true)
  assert.equal(typeof browser.tabs.selected, 'function')
  assert.equal(typeof browser.user.openTabs, 'function')

  const tab = await browser.tabs.new()
  assert.equal(typeof tab.back, 'function')
  assert.equal(typeof tab.forward, 'function')
  assert.equal(typeof tab.close, 'function')
  assert.equal(typeof tab.cua.click, 'function')
  assert.equal(typeof tab.cua.drag, 'function')
  assert.equal(typeof tab.cua.keypress, 'function')
  assert.equal(typeof tab.cua.move, 'function')
  assert.equal(typeof tab.cua.scroll, 'function')
  assert.equal(typeof tab.cua.type, 'function')
  assert.equal(typeof tab.dom_cua.get_visible_dom, 'function')
  assert.equal(typeof tab.dom_cua.keypress, 'function')
  assert.equal(typeof tab.dom_cua.scroll, 'function')
  assert.equal(typeof tab.dom_cua.type, 'function')
})

test('test hooks plugin installs into public plugins registry', async () => {
  const dataRootParent = mkdtempSync(join(tmpdir(), 'pichu-plugin-data-parent-'))
  const dataRoot = join(dataRootParent, '.pichu')
  const workspaceRoot = mkdtempSync(join(tmpdir(), 'pichu-plugin-workspace-'))
  let moduleDir = null

  try {
    setupTestHooksPluginWorkspace(workspaceRoot)

    const modules = await loadPluginModulesForTest({ dataRoot, workspaceRoot })
    moduleDir = modules.moduleDir

    const marketplaces = await modules.marketplace.listPluginMarketplaces()
    assert.equal(
      marketplaces.some((marketplace) => marketplace.name === 'test-hooks'),
      true
    )

    const installed = await modules.registry.installPlugin({
      marketplaceName: 'test-hooks',
      pluginName: 'test-hooks-plugin'
    })
    assert.equal(installed.id, 'test-hooks-plugin')
    assert.equal(installed.name, 'test-hooks-plugin')
    assert.equal(installed.sourceMetadata.installedFrom, 'marketplace')
    assert.equal(installed.sourceMetadata.marketplaceName, 'test-hooks')
    assert.equal(
      installed.sourceMetadata.marketplacePath,
      join(workspaceRoot, 'resources', 'plugins', 'marketplace.json')
    )

    assert.equal(existsSync(join(dataRoot, 'plugins', 'installed.json')), true)
    assert.equal(existsSync(join(dataRoot, 'internal-plugins', 'installed.json')), false)
    const registry = JSON.parse(readFileSync(join(dataRoot, 'plugins', 'installed.json'), 'utf8'))
    assert.deepEqual(
      registry.plugins.map((plugin) => plugin.name),
      ['test-hooks-plugin']
    )
    assert.equal(registry.plugins[0].sourceMetadata.marketplaceName, 'test-hooks')
    assert.equal((await modules.registry.listInstalledPluginsAsync()).length, 1)
  } finally {
    if (moduleDir) rmSync(moduleDir, { recursive: true, force: true })
    rmSync(dataRootParent, { recursive: true, force: true })
    rmSync(workspaceRoot, { recursive: true, force: true })
  }
})

test('test hooks plugin emits structured approval UI for approval testing', async () => {
  const dataRootParent = mkdtempSync(join(tmpdir(), 'pichu-plugin-data-parent-'))
  const dataRoot = join(dataRootParent, '.pichu')
  const workspaceRoot = mkdtempSync(join(tmpdir(), 'pichu-plugin-workspace-'))
  let moduleDir = null

  try {
    setupTestHooksPluginWorkspace(workspaceRoot)

    const modules = await loadPluginModulesForTest({ dataRoot, workspaceRoot })
    moduleDir = modules.moduleDir
    await modules.registry.installPlugin({
      marketplaceName: 'test-hooks',
      pluginName: 'test-hooks-plugin'
    })

    const decision = await modules.hookRunner.runPreToolUseHooks({
      context: {
        sessionId: 'session-approval-ui',
        cwd: workspaceRoot,
        model: 'test-model'
      },
      toolName: 'exec_command',
      toolUseId: 'tool-approval-ui',
      toolInput: { cmd: 'echo hook-approval-ui' }
    })

    assert.equal(decision?.permissionDecision, 'ask')
    assert.equal(decision?.approvalUi?.renderer, 'json-render')
    assert.equal(decision.approvalUi.spec.root, 'root')
    assert.deepEqual(Object.keys(decision.approvalUi.spec.elements).sort(), [
      'argv',
      'command',
      'details',
      'policyLink',
      'preview',
      'root',
      'summary'
    ])
    assert.equal(decision.approvalUi.spec.elements.policyLink.type, 'Link')
    assert.equal(decision.approvalUi.spec.elements.preview.type, 'Image')
    assert.equal(decision.approvalUi.spec.elements.argv.type, 'JsonTree')
    assert.equal(decision.approvalUi.spec.elements.command.type, 'CodeBlock')
  } finally {
    if (moduleDir) rmSync(moduleDir, { recursive: true, force: true })
    rmSync(dataRootParent, { recursive: true, force: true })
    rmSync(workspaceRoot, { recursive: true, force: true })
  }
})

test('test hooks plugin emits database approval demo UI state', async () => {
  const dataRootParent = mkdtempSync(join(tmpdir(), 'pichu-plugin-data-parent-'))
  const dataRoot = join(dataRootParent, '.pichu')
  const workspaceRoot = mkdtempSync(join(tmpdir(), 'pichu-plugin-workspace-'))
  let moduleDir = null

  try {
    setupTestHooksPluginWorkspace(workspaceRoot)

    const modules = await loadPluginModulesForTest({ dataRoot, workspaceRoot })
    moduleDir = modules.moduleDir
    await modules.registry.installPlugin({
      marketplaceName: 'test-hooks',
      pluginName: 'test-hooks-plugin'
    })

    const decision = await modules.hookRunner.runPreToolUseHooks({
      context: {
        sessionId: 'session-approval-demo',
        cwd: workspaceRoot,
        model: 'test-model'
      },
      toolName: 'exec_command',
      toolUseId: 'tool-approval-demo',
      toolInput: {
        command:
          'example-db --environment test table create --region sg --database demo_data --table hook_approval_demo_tbl --cluster-name demo_cluster --engine row-store --ttl 30 --fields \'[{"name":"a","type":"String","doc":"id"},{"name":"b","type":"Date","doc":"date"},{"name":"c","type":"UInt8","doc":"version"},{"name":"d","type":"UInt64","doc":"value"}]\' --partition-keys \'[{"name":"date","type":"Date"}]\' --primary-key a --shard-key a --sample-key c --unique-keys "hash(a)" --version-field c --partition-level-unique-keys 1 --enable-disk-based-unique-key-index 0'
      }
    })

    assert.equal(decision?.permissionDecision, 'ask')
    assert.equal(decision?.approvalUi?.renderer, 'json-render')
    assert.equal(decision.approvalUi.spec.elements.fields.type, 'Section')
    assert.equal(decision.approvalUi.spec.elements.fieldsTable.type, 'DataTable')
    assert.deepEqual(decision.approvalUi.spec.elements.fieldsTable.props.columns, [
      { label: 'Name', path: 'name' },
      { label: 'Type', path: 'type' },
      { label: 'Description', path: 'doc' }
    ])
    assert.equal(decision.approvalUi.spec.elements.keys.type, 'Section')
    assert.equal(decision.approvalUi.spec.elements.keysTable.type, 'DataTable')
    assert.equal(decision.approvalUi.spec.elements.parsedArgv.type, 'Section')
    assert.equal(decision.approvalUi.spec.elements.parsedArgvTree.type, 'JsonTree')
    assert.equal(decision.approvalUi.state.commandKind, 'example-db table create')
    assert.equal(decision.approvalUi.state.summaryItems[4].value, 'hook_approval_demo_tbl')
    assert.deepEqual(decision.approvalUi.state.fieldRows, [
      { name: 'a', type: 'String', doc: 'id' },
      { name: 'b', type: 'Date', doc: 'date' },
      { name: 'c', type: 'UInt8', doc: 'version' },
      { name: 'd', type: 'UInt64', doc: 'value' }
    ])
    assert.deepEqual(decision.approvalUi.state.partitionKeys, [{ name: 'date', type: 'Date' }])
    assert.deepEqual(decision.approvalUi.state.keyRows, [
      { name: 'Primary key', value: 'a' },
      { name: 'Shard key', value: 'a' },
      { name: 'Sample key', value: 'c' },
      { name: 'Unique keys', value: 'hash(a)' },
      { name: 'Version field', value: 'c' }
    ])
  } finally {
    if (moduleDir) rmSync(moduleDir, { recursive: true, force: true })
    rmSync(dataRootParent, { recursive: true, force: true })
    rmSync(workspaceRoot, { recursive: true, force: true })
  }
})

test('listPluginMarketplaces reads bundled resources without syncing to data root', async () => {
  const dataRootParent = mkdtempSync(join(tmpdir(), 'pichu-plugin-data-parent-'))
  const dataRoot = join(dataRootParent, '.pichu')
  const workspaceRoot = mkdtempSync(join(tmpdir(), 'pichu-plugin-workspace-'))
  let moduleDir = null

  try {
    const marketplacePath = join(workspaceRoot, 'resources', 'plugins', 'marketplace.json')
    const pluginRoot = join(workspaceRoot, 'resources', 'plugins', 'plugins', 'default-plugin')

    createPlugin(pluginRoot, 'default-plugin', { includeHooks: false })
    writeFileSync(
      join(pluginRoot, 'skills', 'review-pr', 'SKILL.md'),
      [
        '---',
        'name: review-pr',
        'description: Review a pull request from CRLF frontmatter.',
        '---',
        '',
        'Review it.'
      ].join('\r\n'),
      'utf8'
    )
    mkdirSync(dirname(marketplacePath), { recursive: true })
    writeJson(marketplacePath, {
      schemaVersion: '1.0',
      name: 'local-pichu-plugins',
      interface: { displayName: 'Local Owls Plugins' },
      plugins: [
        {
          name: 'default-plugin',
          source: {
            type: 'local',
            path: './plugins/plugins/default-plugin'
          },
          policy: { installation: 'AVAILABLE' },
          category: 'Official'
        },
        {
          name: 'computer-use',
          source: {
            type: 'local',
            path: './plugins/plugins/computer-use'
          },
          policy: { installation: 'NOT_AVAILABLE' }
        },
        {
          name: 'sites',
          source: {
            type: 'local',
            path: './plugins/plugins/sites'
          },
          policy: { installation: 'NOT_AVAILABLE' }
        },
        {
          name: 'remote-zip-plugin',
          source: {
            type: 'zip',
            url: 'https://plugins.example.test/remote-zip-plugin.zip'
          }
        },
        {
          name: 'git-plugin',
          source: {
            type: 'git',
            url: 'https://git.example.test/plugins/git-plugin.git'
          }
        }
      ]
    })

    const modules = await loadPluginModulesForTest({ dataRoot, workspaceRoot })
    moduleDir = modules.moduleDir
    const marketplaces = await modules.marketplace.listPluginMarketplaces()
    const marketplace = marketplaces.find((entry) => entry.path === marketplacePath)
    const plugin = marketplace?.plugins.find((entry) => entry.name === 'default-plugin')
    const resolved = plugin ? await modules.marketplace.resolveMarketplaceSource(plugin) : null
    const availableEntries = await modules.marketplace.listAvailablePluginEntries()
    const availablePlugin = availableEntries.find((entry) => entry.name === 'default-plugin')

    assert.equal(marketplace?.root, join(workspaceRoot, 'resources'))
    assert.equal(resolved?.path, pluginRoot)
    assert.equal(availablePlugin?.skills?.length, 1)
    assert.equal(availablePlugin?.skills?.[0]?.name, 'review-pr')
    assert.equal(
      availablePlugin?.skills?.[0]?.description,
      'Review a pull request from CRLF frontmatter.'
    )
    assert.equal(
      marketplace?.plugins.some((entry) => entry.name === 'computer-use'),
      false
    )
    assert.equal(
      marketplace?.plugins.some((entry) => entry.name === 'sites'),
      false
    )
    assert.equal(
      marketplace?.plugins.some((entry) => entry.name === 'remote-zip-plugin'),
      false
    )
    assert.equal(
      marketplace?.plugins.some((entry) => entry.name === 'git-plugin'),
      false
    )
    assert.equal(
      marketplace?.diagnostics.filter(
        (diagnostic) => diagnostic.message === 'Skipped marketplace entry without name or source'
      ).length,
      2
    )
    assert.equal(
      availableEntries.some((entry) => entry.name === 'computer-use'),
      false
    )
    assert.equal(
      availableEntries.some((entry) => entry.name === 'sites'),
      false
    )
    await assert.rejects(
      modules.registry.installPlugin({
        marketplaceName: 'local-pichu-plugins',
        pluginName: 'sites'
      }),
      /Marketplace plugin not found: sites/
    )
    assert.equal(existsSync(join(dataRoot, 'plugins', 'marketplace.json')), false)
    assert.equal(existsSync(join(dataRoot, 'plugins', 'plugins', 'default-plugin')), false)
  } finally {
    rmSync(dataRootParent, { recursive: true, force: true })
    rmSync(workspaceRoot, { recursive: true, force: true })
    if (moduleDir) {
      rmSync(moduleDir, { recursive: true, force: true })
    }
  }
})

test('marketplace and registry install local plugins into cache', async () => {
  const dataRoot = mkdtempSync(join(tmpdir(), 'pichu-plugin-data-'))
  const workspaceRoot = mkdtempSync(join(tmpdir(), 'pichu-plugin-workspace-'))
  let moduleDir = null

  try {
    const pluginRoot = join(workspaceRoot, 'resources', 'plugins', 'repo-reviewer')
    createPlugin(pluginRoot)
    writeWorkspaceMarketplace(workspaceRoot, {
      name: 'local-test',
      interface: { displayName: 'Local Test' },
      plugins: [
        {
          name: 'repo-reviewer',
          source: {
            source: 'local',
            path: './plugins/repo-reviewer'
          },
          policy: {
            installation: 'AVAILABLE',
            authentication: 'ON_INSTALL'
          },
          category: 'Engineering'
        }
      ]
    })

    const modules = await loadPluginModulesForTest({ dataRoot, workspaceRoot })
    moduleDir = modules.moduleDir

    const marketplaces = await modules.marketplace.listPluginMarketplaces()
    assert.equal(
      marketplaces.some((marketplace) => marketplace.name === 'local-test'),
      true
    )

    const installed = await modules.registry.installPlugin({
      marketplaceName: 'local-test',
      pluginName: 'repo-reviewer'
    })
    assert.equal(installed.enabled, true)
    assert.equal(installed.installedVersion, '1.0.0')
    assert.equal(installed.validationStatus.ok, true)
    assert.equal(installed.sourceMetadata.marketplacePath.endsWith('marketplace.json'), true)
    assert.equal(existsSync(installed.cachePath), true)

    const skillSources = await modules.registry.getEnabledPluginSkillSourcesAsync()
    assert.equal(skillSources.length, 1)
    assert.equal(skillSources[0].pluginName, 'repo-reviewer')

    await modules.registry.setPluginEnabled(installed.id, false)
    assert.equal((await modules.registry.getEnabledPluginSkillSourcesAsync()).length, 0)
    const replaced = await modules.registry.installPlugin({
      marketplaceName: 'local-test',
      pluginName: 'repo-reviewer'
    })
    assert.equal(replaced.id, 'repo-reviewer')
    assert.equal(replaced.installedVersion, '1.0.0')
    assert.equal((await modules.registry.listInstalledPluginsAsync()).length, 1)

    writeWorkspaceMarketplace(workspaceRoot, {
      name: 'local-test',
      plugins: []
    })
    const staleRefresh = await modules.registry.refreshPluginMarketplaces()
    assert.equal(staleRefresh.installed[0].marketplaceStatus.available, false)
    assert.equal(
      staleRefresh.installed[0].diagnostics.some((diagnostic) =>
        diagnostic.message.includes('Marketplace refresh')
      ),
      true
    )

    createPlugin(pluginRoot, 'repo-reviewer', { version: '1.1.0' })
    writeWorkspaceMarketplace(workspaceRoot, {
      name: 'local-test',
      interface: { displayName: 'Local Test' },
      plugins: [
        {
          name: 'repo-reviewer',
          source: {
            source: 'local',
            path: './plugins/repo-reviewer'
          },
          policy: {
            installation: 'AVAILABLE',
            authentication: 'ON_INSTALL'
          },
          category: 'Engineering'
        }
      ]
    })
    const freshRefresh = await modules.registry.refreshPluginMarketplaces()
    assert.equal(freshRefresh.installed[0].marketplaceStatus.available, true)
    assert.equal(freshRefresh.installed[0].marketplaceStatus.availableVersion, '1.1.0')
    const repoReviewer = freshRefresh.available.find((plugin) => plugin.name === 'repo-reviewer')
    assert.ok(repoReviewer)
    assert.equal(repoReviewer.description, 'Review pull requests.')
    assert.equal(repoReviewer.interface.displayName, 'Repo Reviewer')
    const upgraded = await modules.registry.upgradePlugin(installed.id)
    assert.equal(upgraded.installedVersion, '1.1.0')
    assert.equal(upgraded.enabled, false)
    assert.equal(existsSync(upgraded.cachePath), true)
    assert.equal(existsSync(installed.cachePath), false)

    const reinstalled = await modules.registry.reinstallPlugin(installed.id)
    assert.equal(reinstalled.installedVersion, '1.1.0')

    createPlugin(pluginRoot, 'repo-reviewer', { version: '1.0.0' })
    await assert.rejects(
      () => modules.registry.upgradePlugin(installed.id),
      /downgrade is not supported/
    )

    const uninstalled = await modules.registry.uninstallPlugin(installed.id)
    assert.equal(uninstalled.uninstalled, true)
    assert.equal(existsSync(join(dataRoot, 'plugins', 'cache', 'repo-reviewer')), false)
    assert.equal((await modules.registry.listPluginAuditLogAsync()).length >= 2, true)
  } finally {
    rmSync(dataRoot, { recursive: true, force: true })
    rmSync(workspaceRoot, { recursive: true, force: true })
    if (moduleDir) {
      rmSync(moduleDir, { recursive: true, force: true })
    }
  }
})

test('install runs plugin auth login command', async () => {
  const dataRoot = mkdtempSync(join(tmpdir(), 'pichu-plugin-auth-data-'))
  const workspaceRoot = mkdtempSync(join(tmpdir(), 'pichu-plugin-auth-workspace-'))
  let moduleDir = null

  try {
    const pluginRoot = join(workspaceRoot, 'resources', 'plugins', 'repo-reviewer')
    createPlugin(pluginRoot, 'repo-reviewer', { includeHooks: false })
    mkdirSync(join(pluginRoot, 'bin'), { recursive: true })
    const cliPath = join(pluginRoot, 'bin', 'repo-reviewer')
    writeFileSync(
      cliPath,
      [
        '#!/usr/bin/env node',
        'const fs = require("node:fs")',
        'const path = require("node:path")',
        'const data = process.env.AGENT_PLUGIN_DATA',
        'if (!data) process.exit(9)',
        'fs.mkdirSync(data, { recursive: true })',
        'const tokenPath = path.join(data, "auth-token")',
        'fs.appendFileSync(path.join(data, "auth-log"), process.argv.slice(2).join(" ") + "\\n")',
        'if (process.argv[2] === "auth" && process.argv[3] === "status") {',
        '  process.exit(fs.existsSync(tokenPath) ? 0 : 3)',
        '}',
        'if (process.argv[2] === "auth" && process.argv[3] === "login") {',
        '  fs.writeFileSync(tokenPath, process.env.AGENT_PLUGIN_ROOT || "")',
        '  process.exit(0)',
        '}',
        'process.exit(8)'
      ].join('\n'),
      { encoding: 'utf8', mode: 0o755 }
    )
    chmodSync(cliPath, 0o755)
    const manifestPath = join(pluginRoot, 'plugin.json')
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    manifest.extensions['com.pichu.app'].bin = './bin'
    manifest.extensions['com.pichu.app'].commands = {
      'repo-reviewer': {
        entry: './bin/repo-reviewer',
        description: 'Repo reviewer command.'
      }
    }
    manifest.extensions['com.pichu.app'].auth = {
      login: {
        command: 'repo-reviewer',
        args: ['auth', 'login'],
        description: 'Sign in.'
      },
      status: {
        command: 'repo-reviewer',
        args: ['auth', 'status'],
        description: 'Check sign-in status.'
      }
    }
    writeJson(manifestPath, manifest)
    writeWorkspaceMarketplace(workspaceRoot, {
      name: 'local-test',
      plugins: [
        {
          name: 'repo-reviewer',
          source: {
            source: 'local',
            path: './plugins/repo-reviewer'
          },
          policy: {
            installation: 'AVAILABLE',
            authentication: 'ON_FIRST_USE'
          }
        }
      ]
    })

    const modules = await loadPluginModulesForTest({ dataRoot, workspaceRoot })
    moduleDir = modules.moduleDir
    const installed = await modules.registry.installPlugin({
      marketplaceName: 'local-test',
      pluginName: 'repo-reviewer'
    })

    const pluginDataPath = join(dataRoot, 'plugins', 'data', 'repo-reviewer')
    assert.equal(
      readFileSync(join(pluginDataPath, 'auth-log'), 'utf8'),
      'auth status\nauth login\n'
    )
    assert.equal(readFileSync(join(pluginDataPath, 'auth-token'), 'utf8'), installed.cachePath)
    assert.equal((await modules.registry.listInstalledPluginsAsync()).length, 1)
  } finally {
    rmSync(dataRoot, { recursive: true, force: true })
    rmSync(workspaceRoot, { recursive: true, force: true })
    if (moduleDir) {
      rmSync(moduleDir, { recursive: true, force: true })
    }
  }
})

test('install skips undeclared plugin auth command', async () => {
  const dataRoot = mkdtempSync(join(tmpdir(), 'pichu-plugin-auth-undeclared-data-'))
  const workspaceRoot = mkdtempSync(join(tmpdir(), 'pichu-plugin-auth-undeclared-workspace-'))
  let moduleDir = null

  try {
    const pluginRoot = join(workspaceRoot, 'resources', 'plugins', 'undeclared-auth')
    createPlugin(pluginRoot, 'undeclared-auth', { includeHooks: false })
    mkdirSync(join(pluginRoot, 'bin'), { recursive: true })
    const cliPath = join(pluginRoot, 'bin', 'undeclared-auth')
    writeFileSync(
      cliPath,
      [
        '#!/usr/bin/env node',
        'const fs = require("node:fs")',
        'const path = require("node:path")',
        'const data = process.env.AGENT_PLUGIN_DATA',
        'if (data) {',
        '  fs.mkdirSync(data, { recursive: true })',
        '  fs.writeFileSync(path.join(data, "auth-ran"), "yes")',
        '}',
        'process.exit(0)'
      ].join('\n'),
      { encoding: 'utf8', mode: 0o755 }
    )
    chmodSync(cliPath, 0o755)
    const manifestPath = join(pluginRoot, 'plugin.json')
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    manifest.extensions['com.pichu.app'].bin = './bin'
    manifest.extensions['com.pichu.app'].commands = {
      'undeclared-auth': {
        entry: './bin/undeclared-auth'
      }
    }
    manifest.extensions['com.pichu.app'].auth = {
      login: {
        command: 'undeclared-auth auth login --json'
      },
      status: {
        command: 'undeclared-auth auth status --json'
      }
    }
    writeJson(manifestPath, manifest)
    writeWorkspaceMarketplace(workspaceRoot, {
      name: 'local-test',
      plugins: [
        {
          name: 'undeclared-auth',
          source: {
            source: 'local',
            path: './plugins/undeclared-auth'
          },
          policy: {
            installation: 'AVAILABLE',
            authentication: 'ON_FIRST_USE'
          }
        }
      ]
    })

    const modules = await loadPluginModulesForTest({ dataRoot, workspaceRoot })
    moduleDir = modules.moduleDir
    const installed = await modules.registry.installPlugin({
      marketplaceName: 'local-test',
      pluginName: 'undeclared-auth'
    })

    assert.equal(installed.name, 'undeclared-auth')
    assert.equal((await modules.registry.listInstalledPluginsAsync()).length, 1)
    assert.equal(
      existsSync(join(dataRoot, 'plugins', 'data', 'undeclared-auth', 'auth-ran')),
      false
    )
    assert.equal(
      installed.diagnostics.some((diagnostic) =>
        diagnostic.message.includes(
          'auth.status.command must reference a manifest-declared command'
        )
      ),
      true
    )
  } finally {
    rmSync(dataRoot, { recursive: true, force: true })
    rmSync(workspaceRoot, { recursive: true, force: true })
    if (moduleDir) {
      rmSync(moduleDir, { recursive: true, force: true })
    }
  }
})

test('failed plugin auth login warns and keeps installed plugin', async () => {
  const dataRoot = mkdtempSync(join(tmpdir(), 'pichu-plugin-auth-fail-data-'))
  const workspaceRoot = mkdtempSync(join(tmpdir(), 'pichu-plugin-auth-fail-workspace-'))
  let moduleDir = null

  try {
    const pluginRoot = join(workspaceRoot, 'resources', 'plugins', 'repo-reviewer')
    createPlugin(pluginRoot, 'repo-reviewer', { includeHooks: false })
    mkdirSync(join(pluginRoot, 'bin'), { recursive: true })
    const cliPath = join(pluginRoot, 'bin', 'repo-reviewer')
    writeFileSync(
      cliPath,
      [
        '#!/usr/bin/env node',
        'if (process.argv[2] === "auth" && process.argv[3] === "status") process.exit(3)',
        'if (process.argv[2] === "auth" && process.argv[3] === "login") process.exit(7)',
        'process.exit(8)'
      ].join('\n'),
      { encoding: 'utf8', mode: 0o755 }
    )
    chmodSync(cliPath, 0o755)
    const manifestPath = join(pluginRoot, 'plugin.json')
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    manifest.extensions['com.pichu.app'].bin = './bin'
    manifest.extensions['com.pichu.app'].commands = {
      'repo-reviewer': {
        entry: './bin/repo-reviewer'
      }
    }
    manifest.extensions['com.pichu.app'].auth = {
      login: {
        command: 'repo-reviewer',
        args: ['auth', 'login']
      },
      status: {
        command: 'repo-reviewer',
        args: ['auth', 'status']
      }
    }
    writeJson(manifestPath, manifest)
    writeWorkspaceMarketplace(workspaceRoot, {
      name: 'local-test',
      plugins: [
        {
          name: 'repo-reviewer',
          source: {
            source: 'local',
            path: './plugins/repo-reviewer'
          },
          policy: {
            installation: 'AVAILABLE',
            authentication: 'ON_FIRST_USE'
          }
        }
      ]
    })

    const modules = await loadPluginModulesForTest({ dataRoot, workspaceRoot })
    moduleDir = modules.moduleDir
    const installed = await modules.registry.installPlugin({
      marketplaceName: 'local-test',
      pluginName: 'repo-reviewer'
    })
    const installedPlugins = await modules.registry.listInstalledPluginsAsync()
    const auditLog = await modules.registry.listPluginAuditLogAsync()

    assert.equal(installed.name, 'repo-reviewer')
    assert.equal(installed.validationStatus.warningCount >= 1, true)
    assert.equal(
      installed.diagnostics.some((diagnostic) =>
        diagnostic.message.includes('Plugin auth failed: Plugin auth login failed')
      ),
      true
    )
    assert.equal(installedPlugins.length, 1)
    assert.equal(installedPlugins[0].diagnostics.length, installed.diagnostics.length)
    assert.equal(existsSync(join(dataRoot, 'plugins', 'cache', 'repo-reviewer')), true)
    assert.equal(
      auditLog.some((event) => event.action === 'auth' && event.message === 'Plugin auth failed'),
      true
    )
  } finally {
    rmSync(dataRoot, { recursive: true, force: true })
    rmSync(workspaceRoot, { recursive: true, force: true })
    if (moduleDir) {
      rmSync(moduleDir, { recursive: true, force: true })
    }
  }
})

test('failed plugin auth upgrade warns and completes upgrade', async () => {
  const dataRoot = mkdtempSync(join(tmpdir(), 'pichu-plugin-auth-upgrade-fail-data-'))
  const workspaceRoot = mkdtempSync(join(tmpdir(), 'pichu-plugin-auth-upgrade-fail-workspace-'))
  let moduleDir = null

  try {
    const pluginRoot = join(workspaceRoot, 'resources', 'plugins', 'repo-reviewer')
    createPlugin(pluginRoot, 'repo-reviewer', { includeHooks: false, version: '1.0.0' })
    writeWorkspaceMarketplace(workspaceRoot, {
      name: 'local-test',
      plugins: [
        {
          name: 'repo-reviewer',
          source: {
            source: 'local',
            path: './plugins/repo-reviewer'
          },
          policy: {
            installation: 'AVAILABLE',
            authentication: 'ON_FIRST_USE'
          }
        }
      ]
    })

    const modules = await loadPluginModulesForTest({ dataRoot, workspaceRoot })
    moduleDir = modules.moduleDir
    const installed = await modules.registry.installPlugin({
      marketplaceName: 'local-test',
      pluginName: 'repo-reviewer'
    })

    assert.equal(installed.installedVersion, '1.0.0')
    assert.equal(existsSync(installed.cachePath), true)

    createPlugin(pluginRoot, 'repo-reviewer', { includeHooks: false, version: '1.1.0' })
    mkdirSync(join(pluginRoot, 'bin'), { recursive: true })
    const cliPath = join(pluginRoot, 'bin', 'repo-reviewer')
    writeFileSync(
      cliPath,
      [
        '#!/usr/bin/env node',
        'if (process.argv[2] === "auth" && process.argv[3] === "status") process.exit(3)',
        'if (process.argv[2] === "auth" && process.argv[3] === "login") process.exit(7)',
        'process.exit(8)'
      ].join('\n'),
      { encoding: 'utf8', mode: 0o755 }
    )
    chmodSync(cliPath, 0o755)
    const manifestPath = join(pluginRoot, 'plugin.json')
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    manifest.extensions['com.pichu.app'].bin = './bin'
    manifest.extensions['com.pichu.app'].commands = {
      'repo-reviewer': {
        entry: './bin/repo-reviewer'
      }
    }
    manifest.extensions['com.pichu.app'].auth = {
      login: {
        command: 'repo-reviewer',
        args: ['auth', 'login']
      },
      status: {
        command: 'repo-reviewer',
        args: ['auth', 'status']
      }
    }
    writeJson(manifestPath, manifest)

    const upgraded = await modules.registry.upgradePlugin(installed.id)

    const current = (await modules.registry.listInstalledPluginsAsync())[0]
    assert.equal(upgraded.installedVersion, '1.1.0')
    assert.equal(
      upgraded.diagnostics.some((diagnostic) =>
        diagnostic.message.includes('Plugin auth failed: Plugin auth login failed')
      ),
      true
    )
    assert.equal(current.installedVersion, '1.1.0')
    assert.equal(current.cachePath, upgraded.cachePath)
    assert.equal(existsSync(installed.cachePath), false)
    assert.equal(existsSync(upgraded.cachePath), true)
  } finally {
    rmSync(dataRoot, { recursive: true, force: true })
    rmSync(workspaceRoot, { recursive: true, force: true })
    if (moduleDir) {
      rmSync(moduleDir, { recursive: true, force: true })
    }
  }
})

test('plugin auth login timeout resolves even when SIGTERM is ignored', async () => {
  const dataRoot = mkdtempSync(join(tmpdir(), 'pichu-plugin-auth-timeout-data-'))
  const workspaceRoot = mkdtempSync(join(tmpdir(), 'pichu-plugin-auth-timeout-workspace-'))
  let moduleDir = null

  try {
    const pluginRoot = join(workspaceRoot, 'resources', 'plugins', 'repo-reviewer')
    createPlugin(pluginRoot, 'repo-reviewer', { includeHooks: false })
    mkdirSync(join(pluginRoot, 'bin'), { recursive: true })
    const cliPath = join(pluginRoot, 'bin', 'repo-reviewer')
    writeFileSync(
      cliPath,
      [
        '#!/usr/bin/env node',
        'process.on("SIGTERM", () => {})',
        'if (process.argv[2] === "auth" && process.argv[3] === "login") {',
        '  setInterval(() => {}, 1000)',
        '} else {',
        '  process.exit(8)',
        '}'
      ].join('\n'),
      { encoding: 'utf8', mode: 0o755 }
    )
    chmodSync(cliPath, 0o755)
    const manifestPath = join(pluginRoot, 'plugin.json')
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    manifest.extensions['com.pichu.app'].bin = './bin'
    manifest.extensions['com.pichu.app'].commands = {
      'repo-reviewer': {
        entry: './bin/repo-reviewer'
      }
    }
    manifest.extensions['com.pichu.app'].auth = {
      login: {
        command: 'repo-reviewer',
        args: ['auth', 'login']
      },
      status: {
        command: 'repo-reviewer',
        args: ['auth', 'status']
      }
    }
    writeJson(manifestPath, manifest)

    const modules = await loadPluginModulesForTest({ dataRoot, workspaceRoot })
    moduleDir = modules.moduleDir
    const loaded = await modules.manifest.loadPluginManifestAsync(pluginRoot)
    const installed = {
      id: 'repo-reviewer',
      name: loaded.manifest.name,
      version: loaded.manifest.version,
      installedVersion: loaded.manifest.version,
      enabled: true,
      installedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      marketplaceName: 'local-test',
      source: { type: 'local', path: './plugins/repo-reviewer' },
      sourceMetadata: {
        installedFrom: 'marketplace',
        marketplaceName: 'local-test',
        marketplacePath: '',
        marketplaceRoot: '',
        source: { type: 'local', path: './plugins/repo-reviewer' },
        resolvedSourcePath: pluginRoot
      },
      cachePath: pluginRoot,
      manifestPath: loaded.manifestPath,
      manifest: loaded.manifest,
      diagnostics: [],
      validationStatus: {
        ok: true,
        checkedAt: new Date().toISOString(),
        errorCount: 0,
        warningCount: 0
      }
    }

    const startedAt = Date.now()
    await assert.rejects(
      () =>
        modules.authRunner.runPluginAuthLoginAsync(
          installed,
          join(dataRoot, 'plugins', 'data', 'repo-reviewer'),
          {
            timeoutMs: 25,
            forceKillGraceMs: 25,
            forceResolveGraceMs: 25
          }
        ),
      /timed out/
    )
    assert.equal(Date.now() - startedAt < 2_000, true)
  } finally {
    rmSync(dataRoot, { recursive: true, force: true })
    rmSync(workspaceRoot, { recursive: true, force: true })
    if (moduleDir) {
      rmSync(moduleDir, { recursive: true, force: true })
    }
  }
})

test('plugin auth login cancellation terminates the command', async () => {
  const dataRoot = mkdtempSync(join(tmpdir(), 'pichu-plugin-auth-cancel-data-'))
  const workspaceRoot = mkdtempSync(join(tmpdir(), 'pichu-plugin-auth-cancel-workspace-'))
  let moduleDir = null

  try {
    const pluginRoot = join(workspaceRoot, 'resources', 'plugins', 'repo-reviewer')
    createPlugin(pluginRoot, 'repo-reviewer', { includeHooks: false })
    mkdirSync(join(pluginRoot, 'bin'), { recursive: true })
    const cliPath = join(pluginRoot, 'bin', 'repo-reviewer')
    writeFileSync(
      cliPath,
      [
        '#!/usr/bin/env node',
        'process.on("SIGTERM", () => {})',
        'if (process.argv[2] === "auth" && process.argv[3] === "login") {',
        '  setInterval(() => {}, 1000)',
        '} else {',
        '  process.exit(8)',
        '}'
      ].join('\n'),
      { encoding: 'utf8', mode: 0o755 }
    )
    chmodSync(cliPath, 0o755)
    const manifestPath = join(pluginRoot, 'plugin.json')
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    manifest.extensions['com.pichu.app'].bin = './bin'
    manifest.extensions['com.pichu.app'].commands = {
      'repo-reviewer': {
        entry: './bin/repo-reviewer'
      }
    }
    manifest.extensions['com.pichu.app'].auth = {
      login: {
        command: 'repo-reviewer',
        args: ['auth', 'login']
      },
      status: {
        command: 'repo-reviewer',
        args: ['auth', 'status']
      }
    }
    writeJson(manifestPath, manifest)

    const modules = await loadPluginModulesForTest({ dataRoot, workspaceRoot })
    moduleDir = modules.moduleDir
    const loaded = await modules.manifest.loadPluginManifestAsync(pluginRoot)
    const installed = {
      id: 'repo-reviewer',
      name: loaded.manifest.name,
      version: loaded.manifest.version,
      installedVersion: loaded.manifest.version,
      enabled: true,
      installedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      marketplaceName: 'local-test',
      source: { type: 'local', path: './plugins/repo-reviewer' },
      sourceMetadata: {
        installedFrom: 'marketplace',
        marketplaceName: 'local-test',
        marketplacePath: '',
        marketplaceRoot: '',
        source: { type: 'local', path: './plugins/repo-reviewer' },
        resolvedSourcePath: pluginRoot
      },
      cachePath: pluginRoot,
      manifestPath: loaded.manifestPath,
      manifest: loaded.manifest,
      diagnostics: [],
      validationStatus: {
        ok: true,
        checkedAt: new Date().toISOString(),
        errorCount: 0,
        warningCount: 0
      }
    }

    const controller = new AbortController()
    const startedAt = Date.now()
    const login = modules.authRunner.runPluginAuthLoginAsync(
      installed,
      join(dataRoot, 'plugins', 'data', 'repo-reviewer'),
      {
        signal: controller.signal,
        forceKillGraceMs: 25,
        forceResolveGraceMs: 25
      }
    )
    await new Promise((resolve) => setTimeout(resolve, 25))
    controller.abort()
    await assert.rejects(() => login, /cancelled/)
    assert.equal(Date.now() - startedAt < 2_000, true)
  } finally {
    rmSync(dataRoot, { recursive: true, force: true })
    rmSync(workspaceRoot, { recursive: true, force: true })
    if (moduleDir) {
      rmSync(moduleDir, { recursive: true, force: true })
    }
  }
})

test('failed plugin auth login during same-version reinstall warns and completes reinstall', async () => {
  const dataRoot = mkdtempSync(join(tmpdir(), 'pichu-plugin-auth-reinstall-data-'))
  const workspaceRoot = mkdtempSync(join(tmpdir(), 'pichu-plugin-auth-reinstall-workspace-'))
  let moduleDir = null

  try {
    const pluginRoot = join(workspaceRoot, 'resources', 'plugins', 'repo-reviewer')
    createPlugin(pluginRoot, 'repo-reviewer', { includeHooks: false })
    mkdirSync(join(pluginRoot, 'bin'), { recursive: true })
    const cliPath = join(pluginRoot, 'bin', 'repo-reviewer')
    writeFileSync(
      cliPath,
      [
        '#!/usr/bin/env node',
        'if (process.argv[2] === "auth" && process.argv[3] === "login") process.exit(0)',
        'if (process.argv[2] === "auth" && process.argv[3] === "status") process.exit(0)',
        'process.exit(8)'
      ].join('\n'),
      { encoding: 'utf8', mode: 0o755 }
    )
    chmodSync(cliPath, 0o755)
    const manifestPath = join(pluginRoot, 'plugin.json')
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    manifest.extensions['com.pichu.app'].bin = './bin'
    manifest.extensions['com.pichu.app'].commands = {
      'repo-reviewer': {
        entry: './bin/repo-reviewer'
      }
    }
    manifest.extensions['com.pichu.app'].auth = {
      login: {
        command: 'repo-reviewer',
        args: ['auth', 'login']
      },
      status: {
        command: 'repo-reviewer',
        args: ['auth', 'status']
      }
    }
    writeJson(manifestPath, manifest)
    writeWorkspaceMarketplace(workspaceRoot, {
      name: 'local-test',
      plugins: [
        {
          name: 'repo-reviewer',
          source: {
            source: 'local',
            path: './plugins/repo-reviewer'
          }
        }
      ]
    })

    const modules = await loadPluginModulesForTest({ dataRoot, workspaceRoot })
    moduleDir = modules.moduleDir
    const installed = await modules.registry.installPlugin({
      marketplaceName: 'local-test',
      pluginName: 'repo-reviewer'
    })
    assert.equal(existsSync(installed.cachePath), true)

    writeFileSync(
      cliPath,
      [
        '#!/usr/bin/env node',
        'if (process.argv[2] === "auth" && process.argv[3] === "login") process.exit(7)',
        'if (process.argv[2] === "auth" && process.argv[3] === "status") process.exit(3)',
        'process.exit(8)'
      ].join('\n'),
      { encoding: 'utf8', mode: 0o755 }
    )
    chmodSync(cliPath, 0o755)

    const reinstalled = await modules.registry.reinstallPlugin(installed.id)
    assert.equal(existsSync(reinstalled.cachePath), true)
    assert.equal(
      reinstalled.diagnostics.some((diagnostic) =>
        diagnostic.message.includes('Plugin auth failed: Plugin auth login failed')
      ),
      true
    )
    const stillInstalled = await modules.registry.listInstalledPluginsAsync()
    assert.equal(stillInstalled.length, 1)
    assert.equal(stillInstalled[0].cachePath, reinstalled.cachePath)
  } finally {
    rmSync(dataRoot, { recursive: true, force: true })
    rmSync(workspaceRoot, { recursive: true, force: true })
    if (moduleDir) {
      rmSync(moduleDir, { recursive: true, force: true })
    }
  }
})

test('registry installs marketplace default plugins once', async () => {
  const dataRoot = mkdtempSync(join(tmpdir(), 'pichu-plugin-default-data-'))
  const workspaceRoot = mkdtempSync(join(tmpdir(), 'pichu-plugin-default-workspace-'))
  let moduleDir = null

  try {
    const defaultPluginRoot = join(workspaceRoot, 'resources', 'plugins', 'default-plugin')
    const optionalPluginRoot = join(workspaceRoot, 'resources', 'plugins', 'optional-plugin')
    createPlugin(defaultPluginRoot, 'default-plugin')
    createPlugin(optionalPluginRoot, 'optional-plugin')
    writeWorkspaceMarketplace(workspaceRoot, {
      name: 'local-test',
      interface: { displayName: 'Local Test' },
      plugins: [
        {
          name: 'default-plugin',
          source: {
            source: 'local',
            path: './plugins/default-plugin'
          },
          policy: {
            installation: 'INSTALLED_BY_DEFAULT',
            authentication: 'ON_INSTALL'
          },
          category: 'Engineering'
        },
        {
          name: 'optional-plugin',
          source: {
            source: 'local',
            path: './plugins/optional-plugin'
          },
          policy: {
            installation: 'AVAILABLE',
            authentication: 'ON_INSTALL'
          },
          category: 'Engineering'
        }
      ]
    })

    const modules = await loadPluginModulesForTest({ dataRoot, workspaceRoot })
    moduleDir = modules.moduleDir

    const firstResult = await modules.registry.installDefaultMarketplacePlugins()
    assert.deepEqual(
      firstResult.installed.map((plugin) => plugin.name),
      ['default-plugin']
    )
    assert.deepEqual(firstResult.skipped, [])
    assert.deepEqual(firstResult.failed, [])
    assert.deepEqual(
      (await modules.registry.listInstalledPluginsAsync()).map((plugin) => plugin.name),
      ['default-plugin']
    )
    assert.deepEqual(
      JSON.parse(readFileSync(join(dataRoot, 'plugins', 'installed.json'), 'utf8'))
        .autoInstalledPlugins,
      ['default-plugin']
    )

    const secondResult = await modules.registry.installDefaultMarketplacePlugins()
    assert.deepEqual(secondResult.installed, [])
    assert.deepEqual(secondResult.skipped, [
      {
        marketplaceName: 'local-test',
        pluginName: 'default-plugin',
        reason: 'already-installed'
      }
    ])

    const uninstalled = await modules.registry.uninstallPlugin('default-plugin')
    assert.equal(uninstalled.uninstalled, true)
    assert.deepEqual(await modules.registry.listInstalledPluginsAsync(), [])

    const afterUninstallResult = await modules.registry.installDefaultMarketplacePlugins()
    assert.deepEqual(afterUninstallResult.installed, [])
    assert.deepEqual(afterUninstallResult.skipped, [
      {
        marketplaceName: 'local-test',
        pluginName: 'default-plugin',
        reason: 'already-auto-installed'
      }
    ])
    assert.deepEqual(await modules.registry.listInstalledPluginsAsync(), [])
  } finally {
    rmSync(dataRoot, { recursive: true, force: true })
    rmSync(workspaceRoot, { recursive: true, force: true })
    if (moduleDir) {
      rmSync(moduleDir, { recursive: true, force: true })
    }
  }
})

test('registry auto-upgrades installed marketplace plugins', async () => {
  const dataRoot = mkdtempSync(join(tmpdir(), 'pichu-plugin-auto-upgrade-data-'))
  const workspaceRoot = mkdtempSync(join(tmpdir(), 'pichu-plugin-auto-upgrade-workspace-'))
  let moduleDir = null

  try {
    const upgradePluginRoot = join(workspaceRoot, 'resources', 'plugins', 'upgrade-plugin')
    const steadyPluginRoot = join(workspaceRoot, 'resources', 'plugins', 'steady-plugin')
    createPlugin(upgradePluginRoot, 'upgrade-plugin', { version: '1.0.0' })
    createPlugin(steadyPluginRoot, 'steady-plugin', { version: '1.0.0' })
    writeWorkspaceMarketplace(workspaceRoot, {
      name: 'local-test',
      plugins: [
        {
          name: 'upgrade-plugin',
          source: {
            source: 'local',
            path: './plugins/upgrade-plugin'
          },
          policy: { installation: 'AVAILABLE' }
        },
        {
          name: 'steady-plugin',
          source: {
            source: 'local',
            path: './plugins/steady-plugin'
          },
          policy: { installation: 'AVAILABLE' }
        }
      ]
    })

    const modules = await loadPluginModulesForTest({ dataRoot, workspaceRoot })
    moduleDir = modules.moduleDir

    const installedUpgradePlugin = await modules.registry.installPlugin({
      marketplaceName: 'local-test',
      pluginName: 'upgrade-plugin'
    })
    const installedSteadyPlugin = await modules.registry.installPlugin({
      marketplaceName: 'local-test',
      pluginName: 'steady-plugin'
    })
    await modules.registry.setPluginEnabled(installedUpgradePlugin.id, false)

    createPlugin(upgradePluginRoot, 'upgrade-plugin', { version: '1.1.0' })

    const result = await modules.registry.autoUpgradeInstalledPlugins()
    assert.deepEqual(
      result.upgraded.map((plugin) => plugin.name),
      ['upgrade-plugin']
    )
    assert.deepEqual(result.skipped, [
      {
        marketplaceName: 'local-test',
        pluginName: 'steady-plugin',
        reason: 'up-to-date'
      }
    ])
    assert.deepEqual(result.failed, [])

    const installed = await modules.registry.listInstalledPluginsAsync()
    const upgraded = installed.find((plugin) => plugin.name === 'upgrade-plugin')
    const steady = installed.find((plugin) => plugin.name === 'steady-plugin')
    assert.equal(upgraded.installedVersion, '1.1.0')
    assert.equal(upgraded.enabled, false)
    assert.equal(steady.installedVersion, '1.0.0')
    assert.equal(existsSync(installedUpgradePlugin.cachePath), false)
    assert.equal(existsSync(installedSteadyPlugin.cachePath), true)
  } finally {
    rmSync(dataRoot, { recursive: true, force: true })
    rmSync(workspaceRoot, { recursive: true, force: true })
    if (moduleDir) {
      rmSync(moduleDir, { recursive: true, force: true })
    }
  }
})

test('registry refreshes installed local plugins when same-version source content changes', async () => {
  const dataRoot = mkdtempSync(join(tmpdir(), 'pichu-plugin-source-refresh-data-'))
  const workspaceRoot = mkdtempSync(join(tmpdir(), 'pichu-plugin-source-refresh-workspace-'))
  let moduleDir = null

  try {
    const pluginRoot = join(workspaceRoot, 'resources', 'plugins', 'source-refresh-plugin')
    createPlugin(pluginRoot, 'source-refresh-plugin', { version: '1.0.0' })
    writeWorkspaceMarketplace(workspaceRoot, {
      name: 'local-test',
      plugins: [
        {
          name: 'source-refresh-plugin',
          source: {
            source: 'local',
            path: './plugins/source-refresh-plugin'
          },
          policy: { installation: 'INSTALLED_BY_DEFAULT' }
        }
      ]
    })

    const modules = await loadPluginModulesForTest({ dataRoot, workspaceRoot })
    moduleDir = modules.moduleDir

    const installed = await modules.registry.installPlugin({
      marketplaceName: 'local-test',
      pluginName: 'source-refresh-plugin'
    })
    const firstHash = installed.sourceMetadata.resolvedSourceSha256
    assert.equal(typeof firstHash, 'string')
    assert.equal(
      readFileSync(join(installed.cachePath, 'skills', 'review-pr', 'SKILL.md'), 'utf8').includes(
        'Review it.'
      ),
      true
    )

    writeFileSync(
      join(pluginRoot, 'skills', 'review-pr', 'SKILL.md'),
      ['---', 'name: review-pr', 'description: Review a pull request.', '---', '', 'Updated.'].join(
        '\n'
      ),
      'utf8'
    )

    const result = await modules.registry.autoUpgradeInstalledPlugins()
    assert.deepEqual(
      result.upgraded.map((plugin) => plugin.name),
      ['source-refresh-plugin']
    )
    assert.deepEqual(result.skipped, [])
    assert.deepEqual(result.failed, [])

    const [refreshed] = await modules.registry.listInstalledPluginsAsync()
    assert.equal(refreshed.installedVersion, '1.0.0')
    assert.notEqual(refreshed.sourceMetadata.resolvedSourceSha256, firstHash)
    assert.equal(
      readFileSync(join(refreshed.cachePath, 'skills', 'review-pr', 'SKILL.md'), 'utf8').includes(
        'Updated.'
      ),
      true
    )
  } finally {
    rmSync(dataRoot, { recursive: true, force: true })
    rmSync(workspaceRoot, { recursive: true, force: true })
    if (moduleDir) {
      rmSync(moduleDir, { recursive: true, force: true })
    }
  }
})

test('registry refreshes installed local plugins when same-version cache content is stale', async () => {
  const dataRoot = mkdtempSync(join(tmpdir(), 'pichu-plugin-cache-refresh-data-'))
  const workspaceRoot = mkdtempSync(join(tmpdir(), 'pichu-plugin-cache-refresh-workspace-'))
  let moduleDir = null

  try {
    const pluginRoot = join(workspaceRoot, 'resources', 'plugins', 'cache-refresh-plugin')
    createPlugin(pluginRoot, 'cache-refresh-plugin', { version: '1.0.0' })
    writeWorkspaceMarketplace(workspaceRoot, {
      name: 'local-test',
      plugins: [
        {
          name: 'cache-refresh-plugin',
          source: {
            source: 'local',
            path: './plugins/cache-refresh-plugin'
          },
          policy: { installation: 'INSTALLED_BY_DEFAULT' }
        }
      ]
    })

    const modules = await loadPluginModulesForTest({ dataRoot, workspaceRoot })
    moduleDir = modules.moduleDir

    const installed = await modules.registry.installPlugin({
      marketplaceName: 'local-test',
      pluginName: 'cache-refresh-plugin'
    })
    const originalHash = installed.sourceMetadata.resolvedSourceSha256
    assert.equal(typeof originalHash, 'string')

    writeFileSync(
      join(installed.cachePath, 'skills', 'review-pr', 'SKILL.md'),
      ['---', 'name: review-pr', 'description: Review a pull request.', '---', '', 'Stale.'].join(
        '\n'
      ),
      'utf8'
    )
    mkdirSync(join(installed.cachePath, '.tmp', 'command-shims'), { recursive: true })
    writeFileSync(
      join(installed.cachePath, '.tmp', 'command-shims', 'cache-refresh'),
      'shim',
      'utf8'
    )

    const result = await modules.registry.autoUpgradeInstalledPlugins()
    assert.deepEqual(
      result.upgraded.map((plugin) => plugin.name),
      ['cache-refresh-plugin']
    )
    assert.deepEqual(result.skipped, [])
    assert.deepEqual(result.failed, [])

    const [refreshed] = await modules.registry.listInstalledPluginsAsync()
    assert.equal(refreshed.installedVersion, '1.0.0')
    assert.equal(refreshed.sourceMetadata.resolvedSourceSha256, originalHash)
    assert.equal(
      readFileSync(join(refreshed.cachePath, 'skills', 'review-pr', 'SKILL.md'), 'utf8').includes(
        'Review it.'
      ),
      true
    )
    assert.equal(
      existsSync(join(refreshed.cachePath, '.tmp', 'command-shims', 'cache-refresh')),
      false
    )
  } finally {
    rmSync(dataRoot, { recursive: true, force: true })
    rmSync(workspaceRoot, { recursive: true, force: true })
    if (moduleDir) {
      rmSync(moduleDir, { recursive: true, force: true })
    }
  }
})

test('registry auto-upgrades default plugins that were replaced by older developer uploads', async () => {
  const dataRoot = mkdtempSync(join(tmpdir(), 'pichu-plugin-auto-upgrade-default-data-'))
  const workspaceRoot = mkdtempSync(join(tmpdir(), 'pichu-plugin-auto-upgrade-default-workspace-'))
  let moduleDir = null

  try {
    const defaultPluginRoot = join(workspaceRoot, 'resources', 'plugins', 'default-plugin')
    const devPluginRoot = join(workspaceRoot, 'dev-default-plugin')
    createPlugin(defaultPluginRoot, 'default-plugin', { version: '1.0.0' })
    createPlugin(devPluginRoot, 'default-plugin', { version: '1.0.1' })
    writeWorkspaceMarketplace(workspaceRoot, {
      name: 'local-test',
      plugins: [
        {
          name: 'default-plugin',
          source: {
            source: 'local',
            path: './plugins/default-plugin'
          },
          policy: { installation: 'INSTALLED_BY_DEFAULT' }
        }
      ]
    })

    const modules = await loadPluginModulesForTest({ dataRoot, workspaceRoot })
    moduleDir = modules.moduleDir

    const defaultInstall = await modules.registry.installDefaultMarketplacePlugins()
    assert.deepEqual(
      defaultInstall.installed.map((plugin) => plugin.name),
      ['default-plugin']
    )

    const developerInstalled = await modules.registry.installPluginFromDeveloperUpload({
      sourcePath: devPluginRoot
    })
    assert.equal(developerInstalled.sourceMetadata.installedFrom, 'developer-upload')
    assert.equal(developerInstalled.installedVersion, '1.0.1')

    createPlugin(defaultPluginRoot, 'default-plugin', { version: '1.0.2' })

    const result = await modules.registry.autoUpgradeInstalledPlugins()
    assert.deepEqual(
      result.upgraded.map((plugin) => ({
        name: plugin.name,
        installedVersion: plugin.installedVersion,
        installedFrom: plugin.sourceMetadata.installedFrom
      })),
      [
        {
          name: 'default-plugin',
          installedVersion: '1.0.2',
          installedFrom: 'marketplace'
        }
      ]
    )
    assert.deepEqual(result.skipped, [])
    assert.deepEqual(result.failed, [])

    const installed = await modules.registry.listInstalledPluginsAsync()
    assert.equal(installed.length, 1)
    assert.equal(installed[0].installedVersion, '1.0.2')
    assert.equal(installed[0].sourceMetadata.installedFrom, 'marketplace')
    assert.equal(existsSync(developerInstalled.cachePath), false)
  } finally {
    rmSync(dataRoot, { recursive: true, force: true })
    rmSync(workspaceRoot, { recursive: true, force: true })
    if (moduleDir) {
      rmSync(moduleDir, { recursive: true, force: true })
    }
  }
})

test('clearInstalledPlugins removes installed records, cache, and runtime data', async () => {
  const dataRoot = mkdtempSync(join(tmpdir(), 'pichu-plugin-clear-data-'))
  const workspaceRoot = mkdtempSync(join(tmpdir(), 'pichu-plugin-clear-workspace-'))
  let moduleDir = null

  try {
    const pluginRoot = join(workspaceRoot, 'resources', 'plugins', 'repo-reviewer')
    createPlugin(pluginRoot)
    writeWorkspaceMarketplace(workspaceRoot, {
      name: 'local-test',
      plugins: [
        {
          name: 'repo-reviewer',
          source: {
            type: 'local',
            path: './plugins/repo-reviewer'
          }
        }
      ]
    })

    const modules = await loadPluginModulesForTest({ dataRoot, workspaceRoot })
    moduleDir = modules.moduleDir
    const installed = await modules.registry.installPlugin({
      marketplaceName: 'local-test',
      pluginName: 'repo-reviewer'
    })
    const runtimeDataPath = join(dataRoot, 'plugins', 'data', 'repo-reviewer')
    mkdirSync(runtimeDataPath, { recursive: true })
    writeFileSync(join(runtimeDataPath, 'state.json'), '{}\n', 'utf8')

    const result = await modules.registry.clearInstalledPlugins()

    assert.deepEqual(result, { cleared: true, removedCount: 1 })
    assert.deepEqual(await modules.registry.listInstalledPluginsAsync(), [])
    assert.equal(existsSync(installed.cachePath), false)
    assert.equal(existsSync(runtimeDataPath), false)
    assert.equal(existsSync(join(dataRoot, 'plugins', 'marketplace.json')), false)
    assert.equal(existsSync(join(workspaceRoot, 'resources', 'plugins', 'marketplace.json')), true)
    const auditLog = await modules.registry.listPluginAuditLogAsync()
    assert.equal(
      auditLog.some((event) => event.action === 'clear-installed'),
      true
    )
  } finally {
    rmSync(dataRoot, { recursive: true, force: true })
    rmSync(workspaceRoot, { recursive: true, force: true })
    if (moduleDir) {
      rmSync(moduleDir, { recursive: true, force: true })
    }
  }
})

test('plugin skills keep qualified invocation when names collide', async () => {
  const dataRoot = mkdtempSync(join(tmpdir(), 'pichu-skill-data-'))
  const pluginRoot = mkdtempSync(join(tmpdir(), 'pichu-skill-plugin-'))

  try {
    mkdirSync(join(dataRoot, 'skills', 'review-pr'), { recursive: true })
    writeFileSync(
      join(dataRoot, 'skills', 'review-pr', 'SKILL.md'),
      ['---', 'name: review-pr', 'description: Owls review skill.', '---', '', 'Owls body.'].join(
        '\n'
      ),
      'utf8'
    )
    mkdirSync(join(pluginRoot, 'review-pr'), { recursive: true })
    writeFileSync(
      join(pluginRoot, 'review-pr', 'SKILL.md'),
      [
        '---',
        'name: review-pr',
        'description: Plugin review skill.',
        '---',
        '',
        'Plugin body.'
      ].join('\n'),
      'utf8'
    )

    const skillLoader = await loadSkillLoaderForTest({
      dataRoot,
      pluginSkillRoot: pluginRoot
    })
    const result = await skillLoader.listSkills()

    assert.equal(result.skills.filter((skill) => skill.name === 'review-pr').length, 2)
    assert.equal(
      result.diagnostics.some((diagnostic) => diagnostic.type === 'collision'),
      true
    )
    const prompt = 'Review this.'
    const unqualifiedParts = [
      {
        id: 'skill-1',
        type: 'skill',
        text: '/skill:review-pr',
        target: { name: 'review-pr' }
      }
    ]
    const qualifiedParts = [
      {
        id: 'skill-2',
        type: 'skill',
        text: '/skill:repo-reviewer:review-pr',
        target: { name: 'review-pr', qualifiedName: 'repo-reviewer:review-pr' }
      }
    ]

    assert.equal(await skillLoader.expandSkillPromptParts(prompt, unqualifiedParts), prompt)
    assert.match(await skillLoader.expandSkillPromptParts(prompt, qualifiedParts), /Plugin body/)
    assert.match(
      await skillLoader.expandSkillPromptParts(prompt, qualifiedParts),
      /use exec_command/
    )
    assert.match(await skillLoader.expandSkillPromptParts(prompt, qualifiedParts), /reviewer/)
  } finally {
    rmSync(dataRoot, { recursive: true, force: true })
    rmSync(pluginRoot, { recursive: true, force: true })
  }
})

test('skill loader includes project .agents skills from the git root to cwd', async () => {
  const dataRoot = mkdtempSync(join(tmpdir(), 'pichu-skill-data-'))
  const pluginRoot = mkdtempSync(join(tmpdir(), 'pichu-skill-plugin-'))
  const repoRoot = mkdtempSync(join(tmpdir(), 'pichu-skill-repo-'))
  const nestedCwd = join(repoRoot, 'packages', 'app')

  try {
    writeFileSync(join(repoRoot, '.git'), 'gitdir: test\n', 'utf8')
    mkdirSync(join(repoRoot, '.agents', 'skills', 'repo-helper'), { recursive: true })
    writeFileSync(
      join(repoRoot, '.agents', 'skills', 'repo-helper', 'SKILL.md'),
      [
        '---',
        'name: repo-helper',
        'description: Project helper skill.',
        '---',
        '',
        'Use the project helper.'
      ].join('\n'),
      'utf8'
    )
    mkdirSync(join(nestedCwd, '.agents', 'skills', 'nested-helper'), { recursive: true })
    writeFileSync(
      join(nestedCwd, '.agents', 'skills', 'nested-helper', 'SKILL.md'),
      [
        '---',
        'name: nested-helper',
        'description: Nested project helper skill.',
        '---',
        '',
        'Use the nested helper.'
      ].join('\n'),
      'utf8'
    )

    const skillLoader = await loadSkillLoaderForTest({
      dataRoot,
      pluginSkillRoot: pluginRoot,
      workingDirectory: nestedCwd
    })
    const result = await skillLoader.listSkills()
    const repoSkill = result.skills.find((skill) => skill.name === 'repo-helper')
    const nestedSkill = result.skills.find((skill) => skill.name === 'nested-helper')

    assert.equal(repoSkill?.sourceKind, 'repo')
    assert.equal(repoSkill?.sourceRoot, join(repoRoot, '.agents', 'skills'))
    assert.equal(repoSkill?.sourceLabel, basename(repoRoot))
    assert.equal(nestedSkill?.sourceKind, 'repo')
    assert.equal(nestedSkill?.sourceRoot, join(nestedCwd, '.agents', 'skills'))
    assert.equal(nestedSkill?.sourceLabel, basename(repoRoot))
    assert.match(
      await skillLoader.expandSkillPromptParts('Do it.', [
        {
          id: 'skill-1',
          type: 'skill',
          text: '/skill:repo-helper',
          target: { name: 'repo-helper' }
        }
      ]),
      /Use the project helper/
    )
  } finally {
    rmSync(dataRoot, { recursive: true, force: true })
    rmSync(pluginRoot, { recursive: true, force: true })
    rmSync(repoRoot, { recursive: true, force: true })
  }
})

test('validatePluginPackage accepts declared bin commands', async () => {
  const dataRoot = mkdtempSync(join(tmpdir(), 'pichu-plugin-bin-data-'))
  const workspaceRoot = mkdtempSync(join(tmpdir(), 'pichu-plugin-bin-workspace-'))
  const pluginRoot = mkdtempSync(join(tmpdir(), 'pichu-plugin-bin-'))
  let moduleDir = null

  try {
    createPlugin(pluginRoot, 'cli-helper', { includeHooks: false })
    mkdirSync(join(pluginRoot, 'bin'), { recursive: true })
    const cliPath = join(pluginRoot, 'bin', 'cli.js')
    writeFileSync(cliPath, '#!/usr/bin/env node\nconsole.log("ok")\n', 'utf8')
    chmodSync(cliPath, 0o755)
    const manifestPath = join(pluginRoot, 'plugin.json')
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    manifest.extensions['com.pichu.app'].bin = './bin/'
    manifest.extensions['com.pichu.app'].runtime = { node: '>=24' }
    manifest.extensions['com.pichu.app'].permissions = { shell: 'prompt', filesystem: ['read'] }
    manifest.extensions['com.pichu.app'].commands = {
      cli: {
        entry: './bin/cli.js',
        description: 'Run the helper CLI.'
      }
    }
    writeJson(manifestPath, manifest)

    const modules = await loadPluginModulesForTest({ dataRoot, workspaceRoot })
    moduleDir = modules.moduleDir
    const result = await modules.validator.validatePluginPackageAsync(pluginRoot)

    assert.equal(result.ok, true)
    assert.equal(result.manifest.bin, './bin/')
    assert.equal(result.manifest.commands[0].name, 'cli')
    assert.equal(result.components.find((component) => component.key === 'bin').active, true)
  } finally {
    rmSync(dataRoot, { recursive: true, force: true })
    rmSync(workspaceRoot, { recursive: true, force: true })
    rmSync(pluginRoot, { recursive: true, force: true })
    if (moduleDir) {
      rmSync(moduleDir, { recursive: true, force: true })
    }
  }
})

test('validatePluginPackage rejects bin commands outside bin', async () => {
  const dataRoot = mkdtempSync(join(tmpdir(), 'pichu-plugin-bin-invalid-data-'))
  const workspaceRoot = mkdtempSync(join(tmpdir(), 'pichu-plugin-bin-invalid-workspace-'))
  const pluginRoot = mkdtempSync(join(tmpdir(), 'pichu-plugin-bin-invalid-'))
  let moduleDir = null

  try {
    createPlugin(pluginRoot, 'cli-helper', { includeHooks: false })
    mkdirSync(join(pluginRoot, 'bin'), { recursive: true })
    writeFileSync(join(pluginRoot, 'outside.js'), 'console.log("unsafe")\n', 'utf8')
    const manifestPath = join(pluginRoot, 'plugin.json')
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    manifest.extensions['com.pichu.app'].bin = './bin/'
    manifest.extensions['com.pichu.app'].commands = {
      cli: './outside.js'
    }
    writeJson(manifestPath, manifest)

    const modules = await loadPluginModulesForTest({ dataRoot, workspaceRoot })
    moduleDir = modules.moduleDir
    const result = await modules.validator.validatePluginPackageAsync(pluginRoot)

    assert.equal(result.ok, false)
    assert.equal(
      result.diagnostics.some((diagnostic) =>
        diagnostic.message.includes('Command entry must be inside bin')
      ),
      true
    )
  } finally {
    rmSync(dataRoot, { recursive: true, force: true })
    rmSync(workspaceRoot, { recursive: true, force: true })
    rmSync(pluginRoot, { recursive: true, force: true })
    if (moduleDir) {
      rmSync(moduleDir, { recursive: true, force: true })
    }
  }
})

test('validatePluginPackage rejects non-executable bin commands', async () => {
  const dataRoot = mkdtempSync(join(tmpdir(), 'pichu-plugin-bin-mode-data-'))
  const workspaceRoot = mkdtempSync(join(tmpdir(), 'pichu-plugin-bin-mode-workspace-'))
  const pluginRoot = mkdtempSync(join(tmpdir(), 'pichu-plugin-bin-mode-'))
  let moduleDir = null

  try {
    createPlugin(pluginRoot, 'cli-helper', { includeHooks: false })
    mkdirSync(join(pluginRoot, 'bin'), { recursive: true })
    writeFileSync(join(pluginRoot, 'bin', 'cli'), '#!/usr/bin/env node\nconsole.log("ok")\n', {
      encoding: 'utf8',
      mode: 0o644
    })
    const manifestPath = join(pluginRoot, 'plugin.json')
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    manifest.extensions['com.pichu.app'].bin = './bin/'
    manifest.extensions['com.pichu.app'].commands = {
      cli: './bin/cli'
    }
    writeJson(manifestPath, manifest)

    const modules = await loadPluginModulesForTest({ dataRoot, workspaceRoot })
    moduleDir = modules.moduleDir
    const result = await modules.validator.validatePluginPackageAsync(pluginRoot)

    assert.equal(result.ok, false)
    assert.equal(
      result.diagnostics.some((diagnostic) =>
        diagnostic.message.includes('Declared command entry must be executable')
      ),
      true
    )
  } finally {
    rmSync(dataRoot, { recursive: true, force: true })
    rmSync(workspaceRoot, { recursive: true, force: true })
    rmSync(pluginRoot, { recursive: true, force: true })
    if (moduleDir) {
      rmSync(moduleDir, { recursive: true, force: true })
    }
  }
})

test('coding exec_command tool resolves enabled plugin bin commands from PATH', async () => {
  const dataRoot = mkdtempSync(join(tmpdir(), 'pichu-plugin-bin-command-data-'))
  const workspaceRoot = mkdtempSync(join(tmpdir(), 'pichu-plugin-bin-command-workspace-'))
  const pluginRoot = join(workspaceRoot, 'resources', 'plugins', 'cli-helper')
  let pluginModuleDir = null
  let codingModuleDir = null

  try {
    createPlugin(pluginRoot, 'cli-helper', { includeHooks: false })
    mkdirSync(join(pluginRoot, 'bin'), { recursive: true })
    const entryPath = join(pluginRoot, 'bin', 'cli.js')
    writeFileSync(
      entryPath,
      [
        '#!/usr/bin/env node',
        'console.log(JSON.stringify({',
        '  execPath: process.execPath,',
        '  path: process.env.PATH,',
        '  cwd: process.cwd(),',
        '  args: process.argv.slice(2)',
        '}))'
      ].join('\n'),
      'utf8'
    )
    chmodSync(entryPath, 0o755)
    const manifestPath = join(pluginRoot, 'plugin.json')
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    manifest.extensions['com.pichu.app'].bin = './bin/'
    manifest.extensions['com.pichu.app'].commands = {
      'cli-helper': './bin/cli.js'
    }
    writeJson(manifestPath, manifest)
    writeWorkspaceMarketplace(workspaceRoot, {
      name: 'local-test',
      plugins: [
        {
          name: 'cli-helper',
          source: {
            type: 'local',
            path: './plugins/cli-helper'
          }
        }
      ]
    })

    const modules = await loadPluginModulesForTest({ dataRoot, workspaceRoot })
    pluginModuleDir = modules.moduleDir
    const installed = await modules.registry.installPlugin({
      marketplaceName: 'local-test',
      pluginName: 'cli-helper'
    })
    const pluginBinPaths = await modules.registry.getEnabledPluginBinPathsAsync()
    const codingModules = await loadCodingToolsForTest()
    codingModuleDir = codingModules.moduleDir
    const execCommandTool = codingModules.codingTools
      .createPichuCodingTools(workspaceRoot, undefined, pluginBinPaths)
      .find((tool) => tool.name === 'exec_command')
    assert.equal(Boolean(execCommandTool), true)

    const result = await execCommandTool.execute('test-plugin-exec-command', {
      cmd: 'cli-helper one two'
    })
    const parsed = JSON.parse(result.details.output.trim())
    const pathParts = parsed.path.split(':')
    const shimPath = join(installed.cachePath, '.tmp', 'command-shims')
    const shimPathIndex = pathParts.indexOf(shimPath)

    assert.equal(shimPathIndex >= 0, true, parsed.path)
    assert.equal(pathParts[shimPathIndex + 1], join(installed.cachePath, 'bin'))
    assert.equal(existsSync(parsed.execPath), true)
    assert.equal(parsed.cwd, realpathSync(workspaceRoot))
    assert.deepEqual(parsed.args, ['one', 'two'])
    assert.equal(existsSync(join(shimPath, 'cli-helper')), true)
  } finally {
    rmSync(dataRoot, { recursive: true, force: true })
    rmSync(workspaceRoot, { recursive: true, force: true })
    if (pluginModuleDir) {
      rmSync(pluginModuleDir, { recursive: true, force: true })
    }
    if (codingModuleDir) {
      rmSync(codingModuleDir, { recursive: true, force: true })
    }
  }
})

test('coding exec_command tool rm wrapper deletes targets through shell', {
  skip: process.platform === 'win32'
}, async () => {
  const workspaceRoot = mkdtempSync(join(tmpdir(), 'pichu-bash-rm-wrapper-'))
  const resourcesRoot = mkdtempSync(join(tmpdir(), 'pichu-bash-rm-wrapper-resources-'))
  const originalResourcesPath = process.resourcesPath
  let moduleDir = null

  try {
    const bundledNodePath = join(
      resourcesRoot,
      'node',
      `${process.platform}-${process.arch}`,
      'bin',
      process.platform === 'win32' ? 'node.exe' : 'node'
    )
    mkdirSync(dirname(bundledNodePath), { recursive: true })
    symlinkSync(process.execPath, bundledNodePath)
    setTestResourcesPath(resourcesRoot)

    const modules = await loadCodingToolsForTest()
    moduleDir = modules.moduleDir
    const execCommandTool = modules.codingTools
      .createPichuCodingTools(workspaceRoot)
      .find((tool) => tool.name === 'exec_command')
    assert.equal(Boolean(execCommandTool), true)

    const result = await execCommandTool.execute('test-exec-command-rm-wrapper', {
      cmd: [
        'mkdir removable',
        'rm -rf removable',
        'if test -e removable; then echo still-present; exit 1; fi',
        'echo removed'
      ].join(' && ')
    })

    assert.equal(result.details.output.trim(), 'removed')
    assert.equal(existsSync(join(workspaceRoot, 'removable')), false)
  } finally {
    if (originalResourcesPath === undefined) {
      delete process.resourcesPath
    } else {
      process.resourcesPath = originalResourcesPath
    }
    rmSync(workspaceRoot, { recursive: true, force: true })
    rmSync(resourcesRoot, { recursive: true, force: true })
    if (moduleDir) {
      rmSync(moduleDir, { recursive: true, force: true })
    }
  }
})

test('coding exec_command tool does not leak host NODE_ENV', async () => {
  const workspaceRoot = mkdtempSync(join(tmpdir(), 'pichu-bash-node-env-'))
  const resourcesRoot = mkdtempSync(join(tmpdir(), 'pichu-bash-node-env-resources-'))
  const originalResourcesPath = process.resourcesPath
  const originalNodeEnv = process.env.NODE_ENV
  let moduleDir = null

  try {
    const bundledNodePath = join(
      resourcesRoot,
      'node',
      `${process.platform}-${process.arch}`,
      'bin',
      process.platform === 'win32' ? 'node.exe' : 'node'
    )
    mkdirSync(dirname(bundledNodePath), { recursive: true })
    symlinkSync(process.execPath, bundledNodePath)
    setTestResourcesPath(resourcesRoot)
    process.env.NODE_ENV = 'development'

    const modules = await loadCodingToolsForTest()
    moduleDir = modules.moduleDir
    const execCommandTool = modules.codingTools
      .createPichuCodingTools(workspaceRoot)
      .find((tool) => tool.name === 'exec_command')
    assert.equal(Boolean(execCommandTool), true)

    const result = await execCommandTool.execute('test-exec-command-node-env', {
      cmd: 'printf "%s" "$' + '{NODE_ENV-unset}"'
    })

    assert.equal(result.details.output.trim(), 'unset')
  } finally {
    if (originalNodeEnv === undefined) {
      delete process.env.NODE_ENV
    } else {
      process.env.NODE_ENV = originalNodeEnv
    }
    if (originalResourcesPath === undefined) {
      delete process.resourcesPath
    } else {
      process.resourcesPath = originalResourcesPath
    }
    rmSync(workspaceRoot, { recursive: true, force: true })
    rmSync(resourcesRoot, { recursive: true, force: true })
    if (moduleDir) {
      rmSync(moduleDir, { recursive: true, force: true })
    }
  }
})

test('enabled plugin command shims replace symlinked tmp directory safely', {
  skip: process.platform === 'win32'
}, async () => {
  const dataRoot = mkdtempSync(join(tmpdir(), 'pichu-plugin-bin-shim-safe-data-'))
  const workspaceRoot = mkdtempSync(join(tmpdir(), 'pichu-plugin-bin-shim-safe-workspace-'))
  const outsideRoot = mkdtempSync(join(tmpdir(), 'pichu-plugin-bin-shim-outside-'))
  const pluginRoot = join(workspaceRoot, 'resources', 'plugins', 'cli-helper')
  let moduleDir = null

  try {
    createPlugin(pluginRoot, 'cli-helper', { includeHooks: false })
    mkdirSync(join(pluginRoot, 'bin'), { recursive: true })
    const entryPath = join(pluginRoot, 'bin', 'cli.js')
    writeFileSync(entryPath, '#!/usr/bin/env node\nconsole.log("ok")\n', 'utf8')
    chmodSync(entryPath, 0o755)
    const manifestPath = join(pluginRoot, 'plugin.json')
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    manifest.extensions['com.pichu.app'].bin = './bin/'
    manifest.extensions['com.pichu.app'].commands = {
      'cli-helper': './bin/cli.js'
    }
    writeJson(manifestPath, manifest)
    writeWorkspaceMarketplace(workspaceRoot, {
      name: 'local-test',
      plugins: [
        {
          name: 'cli-helper',
          source: {
            type: 'local',
            path: './plugins/cli-helper'
          }
        }
      ]
    })

    const modules = await loadPluginModulesForTest({ dataRoot, workspaceRoot })
    moduleDir = modules.moduleDir
    const installed = await modules.registry.installPlugin({
      marketplaceName: 'local-test',
      pluginName: 'cli-helper'
    })
    const tmpPath = join(installed.cachePath, '.tmp')
    rmSync(tmpPath, { recursive: true, force: true })
    symlinkSync(outsideRoot, tmpPath, 'dir')

    const pluginBinPaths = await modules.registry.getEnabledPluginBinPathsAsync()
    const shimPath = join(installed.cachePath, '.tmp', 'command-shims')

    assert.equal(pluginBinPaths.includes(shimPath), true)
    assert.equal(pluginBinPaths.includes(join(installed.cachePath, 'bin')), true)
    assert.equal(lstatSync(join(installed.cachePath, '.tmp')).isSymbolicLink(), false)
    assert.equal(existsSync(join(shimPath, 'cli-helper')), true)
    assert.equal(existsSync(join(outsideRoot, 'command-shims')), false)
  } finally {
    rmSync(dataRoot, { recursive: true, force: true })
    rmSync(workspaceRoot, { recursive: true, force: true })
    rmSync(outsideRoot, { recursive: true, force: true })
    if (moduleDir) {
      rmSync(moduleDir, { recursive: true, force: true })
    }
  }
})

test('coding exec_command tool prepends bundled Node to PATH', {
  skip: process.platform === 'win32'
}, async () => {
  const workspaceRoot = mkdtempSync(join(tmpdir(), 'pichu-bundled-node-bash-'))
  const resourcesRoot = mkdtempSync(join(tmpdir(), 'pichu-bundled-node-resources-'))
  const originalResourcesPath = process.resourcesPath
  let moduleDir = null

  try {
    const bundledNodePath = join(
      resourcesRoot,
      'node',
      `${process.platform}-${process.arch}`,
      'bin',
      process.platform === 'win32' ? 'node.exe' : 'node'
    )
    mkdirSync(dirname(bundledNodePath), { recursive: true })
    writeFileSync(
      bundledNodePath,
      `#!/bin/sh\nprintf '%s\\n' 'v24.15.0|${bundledNodePath}'\n`,
      'utf8'
    )
    chmodSync(bundledNodePath, 0o755)
    setTestResourcesPath(resourcesRoot)

    const modules = await loadCodingToolsForTest()
    moduleDir = modules.moduleDir
    const execCommandTool = modules.codingTools
      .createPichuCodingTools(workspaceRoot)
      .find((tool) => tool.name === 'exec_command')
    assert.equal(Boolean(execCommandTool), true)

    const result = await execCommandTool.execute('test-exec-command', {
      cmd: 'node -p "process.version + \\"|\\" + process.execPath"'
    })
    const output = result.details.output.trim()

    assert.match(output, /^v24\.15\.0\|/)
    assert.equal(output, `v24.15.0|${bundledNodePath}`)
  } finally {
    if (originalResourcesPath === undefined) {
      delete process.resourcesPath
    } else {
      process.resourcesPath = originalResourcesPath
    }
    rmSync(workspaceRoot, { recursive: true, force: true })
    rmSync(resourcesRoot, { recursive: true, force: true })
    if (moduleDir) {
      rmSync(moduleDir, { recursive: true, force: true })
    }
  }
})

test('plugin ZIP extraction rejects compression bombs and special files', async () => {
  const dataRoot = mkdtempSync(join(tmpdir(), 'pichu-plugin-data-'))
  const workspaceRoot = mkdtempSync(join(tmpdir(), 'pichu-plugin-workspace-'))
  const bombZipPath = join(workspaceRoot, 'compression-bomb.zip')
  const specialFileZipPath = join(workspaceRoot, 'special-file.zip')
  let moduleDir = null

  try {
    await writeZip(bombZipPath, (zip) => {
      zip.addBuffer(Buffer.alloc(1024 * 1024), 'large-zero-file.bin')
    })
    await writeZip(specialFileZipPath, (zip) => {
      zip.addBuffer(Buffer.from('target'), 'link', { mode: 0o120777 })
    })

    const modules = await loadPluginModulesForTest({ dataRoot, workspaceRoot })
    moduleDir = modules.moduleDir

    await assert.rejects(
      modules.marketplace.extractZipArchive(bombZipPath, join(workspaceRoot, 'bomb-output')),
      /compression ratio limit/
    )
    await assert.rejects(
      modules.marketplace.extractZipArchive(
        specialFileZipPath,
        join(workspaceRoot, 'special-file-output')
      ),
      /unsupported special file/
    )
  } finally {
    rmSync(dataRoot, { recursive: true, force: true })
    rmSync(workspaceRoot, { recursive: true, force: true })
    if (moduleDir) {
      rmSync(moduleDir, { recursive: true, force: true })
    }
  }
})

test('developer upload installs into plugins registry without internal marketplace files', async () => {
  const dataRoot = mkdtempSync(join(tmpdir(), 'pichu-plugin-data-'))
  const workspaceRoot = mkdtempSync(join(tmpdir(), 'pichu-plugin-workspace-'))
  let moduleDir = null

  try {
    const pluginRoot = join(workspaceRoot, 'dev-plugin')
    createPlugin(pluginRoot, 'dev-overwrite-plugin', { version: '9.9.9' })
    const modules = await loadPluginModulesForTest({ dataRoot, workspaceRoot })
    moduleDir = modules.moduleDir

    const installed = await modules.registry.installPluginFromDeveloperUpload({
      sourcePath: pluginRoot
    })
    assert.equal(installed.id, 'dev-overwrite-plugin')
    assert.equal(installed.sourceMetadata.installedFrom, 'developer-upload')
    assert.equal(existsSync(join(dataRoot, 'plugins', 'installed.json')), true)
    assert.equal(existsSync(join(dataRoot, 'internal-plugins', 'installed.json')), false)
    assert.equal(existsSync(join(dataRoot, 'internal-plugins', 'marketplace.json')), false)
  } finally {
    rmSync(dataRoot, { recursive: true, force: true })
    rmSync(workspaceRoot, { recursive: true, force: true })
    if (moduleDir) {
      rmSync(moduleDir, { recursive: true, force: true })
    }
  }
})

test('local dev uploads keep versioned dev sources and can reinstall or remove versions', async () => {
  const dataRoot = mkdtempSync(join(tmpdir(), 'pichu-plugin-data-'))
  const workspaceRoot = mkdtempSync(join(tmpdir(), 'pichu-plugin-workspace-'))
  const firstSourceRoot = mkdtempSync(join(tmpdir(), 'pichu-plugin-local-dev-v1-'))
  const secondSourceRoot = mkdtempSync(join(tmpdir(), 'pichu-plugin-local-dev-v2-'))
  const firstZipPath = join(tmpdir(), `pichu-local-dev-v1-${Date.now()}-${process.pid}.zip`)
  const secondZipPath = join(tmpdir(), `pichu-local-dev-v2-${Date.now()}-${process.pid}.zip`)
  let moduleDir = null

  try {
    createPlugin(firstSourceRoot, 'local-dev-plugin', { version: '1.0.0' })
    createPlugin(secondSourceRoot, 'local-dev-plugin', { version: '2.0.0' })
    await createPluginZip(firstSourceRoot, firstZipPath)
    await createPluginZip(secondSourceRoot, secondZipPath)

    const modules = await loadPluginModulesForTest({ dataRoot, workspaceRoot })
    moduleDir = modules.moduleDir
    const installedVersions = () =>
      JSON.parse(readFileSync(join(dataRoot, 'plugins', 'installed.json'), 'utf8')).plugins.map(
        (plugin) => plugin.installedVersion
      )

    const firstUpload = await modules.localDev.uploadPluginVersionToLocalDev(
      'local-dev-plugin',
      firstZipPath
    )
    const secondUpload = await modules.localDev.uploadPluginVersionToLocalDev(
      'local-dev-plugin',
      secondZipPath
    )

    assert.equal(
      firstUpload.sourcePath,
      normalize(join(dataRoot, 'plugins', 'dev-sources', 'local-dev-plugin', '1.0.0'))
    )
    assert.equal(
      secondUpload.sourcePath,
      normalize(join(dataRoot, 'plugins', 'dev-sources', 'local-dev-plugin', '2.0.0'))
    )
    assert.equal(existsSync(firstUpload.sourcePath), true)
    assert.equal(existsSync(secondUpload.sourcePath), true)

    const catalogAfterUpload = await modules.localDev.listLocalPluginUploads()
    assert.deepEqual(
      catalogAfterUpload[0].versions.map((version) => version.version),
      ['2.0.0', '1.0.0']
    )
    assert.deepEqual(installedVersions(), ['2.0.0'])

    await modules.localDev.installPluginVersionFromLocalDev({
      pluginName: 'local-dev-plugin',
      version: '1.0.0'
    })
    assert.deepEqual(installedVersions(), ['1.0.0'])
    assert.equal(existsSync(secondUpload.sourcePath), true)

    const removed = await modules.localDev.uninstallPluginVersionFromLocalDev({
      pluginName: 'local-dev-plugin',
      version: '1.0.0'
    })
    assert.deepEqual(removed, { removed: true, uninstalled: true })
    assert.equal(existsSync(firstUpload.sourcePath), false)
    assert.equal(existsSync(secondUpload.sourcePath), true)
    assert.deepEqual(installedVersions(), [])

    const catalogAfterRemove = await modules.localDev.listLocalPluginUploads()
    assert.deepEqual(
      catalogAfterRemove[0].versions.map((version) => version.version),
      ['2.0.0']
    )
  } finally {
    rmSync(dataRoot, { recursive: true, force: true })
    rmSync(workspaceRoot, { recursive: true, force: true })
    rmSync(firstSourceRoot, { recursive: true, force: true })
    rmSync(secondSourceRoot, { recursive: true, force: true })
    rmSync(firstZipPath, { force: true })
    rmSync(secondZipPath, { force: true })
    if (moduleDir) {
      rmSync(moduleDir, { recursive: true, force: true })
    }
  }
})

test('developer upload replaces marketplace install with the same plugin name', async () => {
  const dataRoot = mkdtempSync(join(tmpdir(), 'pichu-plugin-data-'))
  const workspaceRoot = mkdtempSync(join(tmpdir(), 'pichu-plugin-workspace-'))
  let moduleDir = null

  try {
    const marketplaceRoot = join(workspaceRoot, 'resources', 'plugins', 'shared-plugin')
    createPlugin(marketplaceRoot, 'shared-plugin', { version: '1.0.0' })
    writeWorkspaceMarketplace(workspaceRoot, {
      name: 'local-test',
      plugins: [
        {
          name: 'shared-plugin',
          source: { type: 'local', path: './plugins/shared-plugin' }
        }
      ]
    })

    const devRoot = join(workspaceRoot, 'dev-shared-plugin')
    createPlugin(devRoot, 'shared-plugin', { version: '9.9.9-dev' })

    const modules = await loadPluginModulesForTest({ dataRoot, workspaceRoot })
    moduleDir = modules.moduleDir

    const marketplaceInstalled = await modules.registry.installPlugin({
      marketplaceName: 'local-test',
      pluginName: 'shared-plugin'
    })
    assert.equal(marketplaceInstalled.sourceMetadata.installedFrom, 'marketplace')
    assert.equal(marketplaceInstalled.installedVersion, '1.0.0')

    const developerInstalled = await modules.registry.installPluginFromDeveloperUpload({
      sourcePath: devRoot
    })
    assert.equal(developerInstalled.sourceMetadata.installedFrom, 'developer-upload')
    assert.equal(developerInstalled.installedVersion, '9.9.9-dev')
    assert.equal((await modules.registry.listInstalledPluginsAsync()).length, 1)
    assert.equal(existsSync(marketplaceInstalled.cachePath), false)
  } finally {
    rmSync(dataRoot, { recursive: true, force: true })
    rmSync(workspaceRoot, { recursive: true, force: true })
    if (moduleDir) {
      rmSync(moduleDir, { recursive: true, force: true })
    }
  }
})

test('marketplace install replaces developer upload with the same plugin name', async () => {
  const dataRoot = mkdtempSync(join(tmpdir(), 'pichu-plugin-data-'))
  const workspaceRoot = mkdtempSync(join(tmpdir(), 'pichu-plugin-workspace-'))
  let moduleDir = null

  try {
    const marketplaceRoot = join(workspaceRoot, 'resources', 'plugins', 'shared-plugin')
    createPlugin(marketplaceRoot, 'shared-plugin', { version: '2.0.0' })
    writeWorkspaceMarketplace(workspaceRoot, {
      name: 'local-test',
      plugins: [
        {
          name: 'shared-plugin',
          source: { type: 'local', path: './plugins/shared-plugin' }
        }
      ]
    })

    const devRoot = join(workspaceRoot, 'dev-shared-plugin')
    createPlugin(devRoot, 'shared-plugin', { version: '9.9.9-dev' })

    const modules = await loadPluginModulesForTest({ dataRoot, workspaceRoot })
    moduleDir = modules.moduleDir

    const developerInstalled = await modules.registry.installPluginFromDeveloperUpload({
      sourcePath: devRoot
    })
    assert.equal(developerInstalled.installedVersion, '9.9.9-dev')

    const marketplaceInstalled = await modules.registry.installPlugin({
      marketplaceName: 'local-test',
      pluginName: 'shared-plugin'
    })
    assert.equal(marketplaceInstalled.sourceMetadata.installedFrom, 'marketplace')
    assert.equal(marketplaceInstalled.installedVersion, '2.0.0')
    assert.equal((await modules.registry.listInstalledPluginsAsync()).length, 1)
    assert.equal(existsSync(developerInstalled.cachePath), false)
  } finally {
    rmSync(dataRoot, { recursive: true, force: true })
    rmSync(workspaceRoot, { recursive: true, force: true })
    if (moduleDir) {
      rmSync(moduleDir, { recursive: true, force: true })
    }
  }
})

test('skill loader documents plugin scripts and commands', async () => {
  const dataRoot = mkdtempSync(join(tmpdir(), 'pichu-skill-data-'))
  const pluginRoot = mkdtempSync(join(tmpdir(), 'pichu-skill-plugin-'))
  try {
    mkdirSync(join(pluginRoot, 'review-pr'), { recursive: true })
    writeFileSync(
      join(pluginRoot, 'review-pr', 'SKILL.md'),
      [
        '---',
        'name: review-pr',
        'description: Plugin review skill.',
        '---',
        '',
        'Plugin body.'
      ].join('\n'),
      'utf8'
    )

    const skillLoader = await loadSkillLoaderForTest({
      dataRoot,
      pluginSkillRoot: pluginRoot
    })
    const expanded = await skillLoader.expandSkillPromptParts('Run helper.', [
      {
        id: 'skill-1',
        type: 'skill',
        text: '/skill:repo-reviewer:review-pr',
        target: { name: 'review-pr', qualifiedName: 'repo-reviewer:review-pr' }
      }
    ])

    assert.match(expanded, /Available plugin scripts/)
    assert.match(expanded, /reviewer-script/)
    assert.match(expanded, /Available plugin commands/)
    assert.match(expanded, /reviewer/)
  } finally {
    rmSync(dataRoot, { recursive: true, force: true })
    rmSync(pluginRoot, { recursive: true, force: true })
  }
})
