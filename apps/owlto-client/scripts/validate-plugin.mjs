#!/usr/bin/env node

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const PLUGIN_MODULES = [
  'hooks/hook-config-loader.ts',
  'hooks/hook-types.ts',
  'manifest-loader.ts',
  'mcp-config-loader.ts',
  'plugin-types.ts',
  'plugin-validator.ts'
]
const MAIN_MODULES = ['node-runtime.ts']

async function loadValidatorModule() {
  const sourceRoot = fileURLToPath(new URL('../src/main/plugins/', import.meta.url))
  const mainSourceRoot = fileURLToPath(new URL('../src/main/', import.meta.url))
  const moduleDir = mkdtempSync(join(tmpdir(), 'owlto-plugin-validator-'))

  try {
    for (const file of MAIN_MODULES) {
      const source = readFileSync(join(mainSourceRoot, file), 'utf8').replaceAll(
        './active-runtime.ts'
      )
      writeFileSync(join(moduleDir, file), source, 'utf8')
    }
    writeFileSync(
      join(moduleDir, 'active-runtime.ts'),
      'export function findActiveRuntimeNodePath() { return null }\nexport function findActiveRuntimePythonPath() { return null }\n',
      'utf8'
    )

    for (const file of PLUGIN_MODULES) {
      const source = readFileSync(join(sourceRoot, file), 'utf8')
        .replaceAll('./plugin-types.js', './plugin-types.ts')
        .replaceAll('./manifest-loader.js', './manifest-loader.ts')
        .replaceAll('./mcp-config-loader.js', './mcp-config-loader.ts')
        .replaceAll('./hooks/hook-config-loader.js', './hooks/hook-config-loader.ts')
        .replaceAll('../plugin-types.js', '../plugin-types.ts')
        .replaceAll('./hook-types.js', './hook-types.ts')
        .replaceAll('../node-runtime.js', './node-runtime.ts')
      mkdirSync(dirname(join(moduleDir, file)), { recursive: true })
      writeFileSync(join(moduleDir, file), source, 'utf8')
    }

    return {
      moduleDir,
      module: await import(`${pathToFileURL(join(moduleDir, 'plugin-validator.ts')).href}`)
    }
  } catch (error) {
    rmSync(moduleDir, { recursive: true, force: true })
    throw error
  }
}

const pluginRoot = process.argv[2]

if (!pluginRoot) {
  console.error('Usage: pnpm validate:plugin <path-to-plugin-root>')
  process.exit(2)
}

const loaded = await loadValidatorModule()

try {
  const result = await loaded.module.validatePluginPackageAsync(resolve(pluginRoot))
  const label = result.manifest
    ? `${result.manifest.name}@${result.manifest.version}`
    : result.pluginRoot

  console.log(JSON.stringify(result, null, 2))

  if (!result.ok) {
    console.error(`Plugin validation failed: ${label}`)
    process.exitCode = 1
  } else {
    console.error(`Plugin validation passed: ${label}`)
  }
} finally {
  rmSync(loaded.moduleDir, { recursive: true, force: true })
}
